"""Reconstruct round-turn trades from half-turn fills using FIFO matching.

A broker (TopstepX / ProjectX included) reports executions, not trades:
"bought 2 MES @ 5000.25", "sold 1 MES @ 5003.00", ... This module turns that
stream into journal rows.

Definitions
-----------
Leg      one FIFO match between an entry fill and an exit fill (or parts of them).
Episode  a position from flat back to flat. This is what we call a "trade":
         it may contain several entry fills (scale-in) and exit fills (partial exits).
         Entry/exit prices on the trade are quantity-weighted averages, so
         (avg_exit - avg_entry) * qty * multiplier equals the sum of the legs exactly.
Flip     a single fill that closes the current position and opens the opposite one.
         It is split: the closing part ends one episode, the remainder starts the next.

Open positions at the end of the fill stream are emitted as open trades
(exit_price None) with the realised part described in `notes`, unless
include_open=False.

Fees are attributed per contract: each fill's fee is spread evenly over its size,
so a fill that spans two episodes gives each its share.

ProjectX side codes: 0 = Bid (buy), 1 = Ask (sell).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Optional

import pandas as pd

from .models import Direction, Fill, Source, Trade

EPS = 1e-9


@dataclass
class Leg:
    symbol: str
    direction: Direction
    qty: float
    entry_price: float
    exit_price: float
    entry_time: datetime
    exit_time: datetime
    fees: float
    entry_fill_id: str
    exit_fill_id: str

    @property
    def points(self) -> float:
        return (self.exit_price - self.entry_price) * self.direction.sign


@dataclass
class _Lot:
    qty: float
    price: float
    time: datetime
    fee_per_unit: float
    fill_id: str
    order_id: str = ""


@dataclass
class _Episode:
    symbol: str
    direction: Direction
    account_id: Optional[int]
    lots: list[_Lot] = field(default_factory=list)
    entries: list[tuple[float, float, datetime, float, str]] = field(default_factory=list)
    exits: list[tuple[float, float, datetime, float, str]] = field(default_factory=list)
    legs: list[Leg] = field(default_factory=list)

    @property
    def entered_qty(self) -> float:
        return sum(q for q, *_ in self.entries)

    @property
    def exited_qty(self) -> float:
        return sum(q for q, *_ in self.exits)

    @property
    def is_flat(self) -> bool:
        return not self.lots

    def avg_price(self, side: str) -> Optional[float]:
        rows = self.entries if side == "entry" else self.exits
        q = sum(r[0] for r in rows)
        return (sum(r[0] * r[1] for r in rows) / q) if q > EPS else None

    def to_trade(self, multiplier: float, tick_size: Optional[float] = None) -> Trade:
        first_entry = self.entries[0]
        entry_fees = sum(r[3] for r in self.entries)
        exit_fees = sum(r[3] for r in self.exits)
        t = Trade(
            symbol=self.symbol, direction=self.direction, qty=self.entered_qty,
            entry_time=first_entry[2], entry_price=self.avg_price("entry"),
            exit_time=self.exits[-1][2] if self.is_flat and self.exits else None,
            exit_price=self.avg_price("exit") if self.is_flat else None,
            multiplier=multiplier, fees=entry_fees + exit_fees, source=Source.API,
            external_id=f"{self.symbol}:{first_entry[4]}", account_id=self.account_id,
        )
        n_in, n_out = len(self.entries), len(self.exits)
        if n_in > 1:
            t.tags.append("scale-in")
        if n_out > 1:
            t.tags.append("partial-exit")
        if not self.is_flat:
            t.tags.append("open")
            realised = sum(l.points * l.qty * multiplier for l in self.legs) - exit_fees
            t.notes = (f"OPEN: {self.exited_qty:g} of {self.entered_qty:g} closed, "
                       f"realised so far {realised:,.2f} (before entry fees)")
        return t


def _to_utc_naive(ts) -> datetime:
    t = pd.Timestamp(ts)
    if t.tz is not None:
        t = t.tz_convert("UTC").tz_localize(None)
    return t.to_pydatetime()


def _as_fills(fills: Iterable[Fill] | pd.DataFrame) -> list[Fill]:
    if isinstance(fills, pd.DataFrame):
        out = []
        for r in fills.to_dict("records"):
            side = r["side"]
            if not isinstance(side, Direction):
                s = str(side).strip().lower()
                side = Direction.LONG if s in ("buy", "b", "long", "bid", "0") else Direction.SHORT
            out.append(Fill(fill_id=str(r.get("fill_id", r.get("id", ""))),
                            symbol=str(r["symbol"]), timestamp=_to_utc_naive(r["timestamp"]),
                            side=side, size=float(r["size"]), price=float(r["price"]),
                            fees=float(r.get("fees", 0) or 0), order_id=str(r.get("order_id", "") or ""),
                            account_id=r.get("account_id")))
        return out
    return [Fill(**{**f.__dict__, "timestamp": _to_utc_naive(f.timestamp)}) for f in fills]


def pair_fills(fills: Iterable[Fill] | pd.DataFrame, multipliers: dict[str, float] | None = None,
               include_open: bool = True) -> tuple[list[Trade], list[Leg]]:
    """FIFO-pair fills into round-turn trades.

    Returns (trades, legs). Trades are episodes (flat-to-flat). Legs are the
    individual FIFO matches, useful for auditing.
    """
    multipliers = multipliers or {}
    fs = sorted(_as_fills(fills), key=lambda f: (f.symbol, f.account_id or 0, f.timestamp, f.fill_id))
    trades: list[Trade] = []
    all_legs: list[Leg] = []
    open_eps: dict[tuple[str, Optional[int]], _Episode] = {}

    for f in fs:
        if f.size <= EPS:
            continue
        key = (f.symbol, f.account_id)
        remaining = f.size
        fee_pu = (f.fees or 0.0) / f.size
        while remaining > EPS:
            ep = open_eps.get(key)
            if ep is None:
                ep = _Episode(symbol=f.symbol, direction=f.side, account_id=f.account_id)
                open_eps[key] = ep
            if f.side == ep.direction:
                # entry or scale-in
                ep.lots.append(_Lot(remaining, f.price, f.timestamp, fee_pu, f.fill_id, f.order_id))
                ep.entries.append((remaining, f.price, f.timestamp, fee_pu * remaining, f.fill_id))
                remaining = 0.0
            else:
                # exit: consume lots FIFO
                lot = ep.lots[0]
                take = min(lot.qty, remaining)
                leg = Leg(symbol=f.symbol, direction=ep.direction, qty=take,
                          entry_price=lot.price, exit_price=f.price,
                          entry_time=lot.time, exit_time=f.timestamp,
                          fees=(lot.fee_per_unit + fee_pu) * take,
                          entry_fill_id=lot.fill_id, exit_fill_id=f.fill_id)
                ep.legs.append(leg)
                all_legs.append(leg)
                lot.qty -= take
                remaining -= take
                if lot.qty <= EPS:
                    ep.lots.pop(0)
                # record the exit portion (merge consecutive exits from the same fill)
                if ep.exits and ep.exits[-1][4] == f.fill_id:
                    q, p, t, fee, fid = ep.exits[-1]
                    ep.exits[-1] = (q + take, p, t, fee + fee_pu * take, fid)
                else:
                    ep.exits.append((take, f.price, f.timestamp, fee_pu * take, f.fill_id))
                if ep.is_flat:
                    trades.append(ep.to_trade(multipliers.get(f.symbol, 1.0)))
                    del open_eps[key]
                    # if remaining > 0 the loop continues and opens the flipped position

    if include_open:
        for (sym, _), ep in open_eps.items():
            trades.append(ep.to_trade(multipliers.get(sym, 1.0)))

    from .metrics import compute_trade_fields
    for t in trades:
        compute_trade_fields(t)
    trades.sort(key=lambda t: t.entry_time)
    return trades, all_legs


def legs_df(legs: list[Leg]) -> pd.DataFrame:
    return pd.DataFrame([{
        "symbol": l.symbol, "direction": l.direction.value, "qty": l.qty,
        "entry_price": l.entry_price, "exit_price": l.exit_price,
        "entry_time": l.entry_time, "exit_time": l.exit_time, "points": l.points,
        "fees": l.fees, "entry_fill_id": l.entry_fill_id, "exit_fill_id": l.exit_fill_id,
    } for l in legs])


# --------------------------------------------------------------------------
# ProjectX adapter
# --------------------------------------------------------------------------
def fills_from_projectx(trades_json: list[dict], contract_symbols: dict[str, str],
                        account_id: Optional[int] = None) -> pd.DataFrame:
    """Convert the `trades` array from POST /api/Trade/search into a fills frame.

    contract_symbols maps contractId -> root symbol (e.g. "CON.F.US.MES.Z26" -> "MES").
    Voided fills are dropped. side 0 = buy, 1 = sell.
    """
    rows = []
    for t in trades_json:
        if t.get("voided"):
            continue
        cid = str(t.get("contractId"))
        rows.append({
            "fill_id": str(t.get("id")), "symbol": contract_symbols.get(cid, cid),
            "timestamp": t.get("creationTimestamp"),
            "side": "buy" if int(t.get("side", 0)) == 0 else "sell",
            "size": float(t.get("size", 0)), "price": float(t.get("price", 0)),
            "fees": float(t.get("fees") or 0), "order_id": str(t.get("orderId", "")),
            "account_id": account_id if account_id is not None else t.get("accountId"),
            "broker_pnl": t.get("profitAndLoss"),
        })
    df = pd.DataFrame(rows)
    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    return df


def reconcile_with_broker(fills: pd.DataFrame, trades: list[Trade]) -> pd.DataFrame:
    """Compare our gross P&L per symbol with the broker's reported profitAndLoss.

    The broker reports P&L on closing fills only (null = half-turn / opening fill).
    A non-zero difference means a multiplier is wrong or a fill is missing.
    Only closed trades are compared.
    """
    if fills.empty or "broker_pnl" not in fills:
        return pd.DataFrame(columns=["symbol", "ours", "broker", "difference"])
    b = fills.dropna(subset=["broker_pnl"]).groupby("symbol")["broker_pnl"].sum()
    ours = {}
    for t in trades:
        if t.gross_pnl is not None:
            ours[t.symbol] = ours.get(t.symbol, 0.0) + t.gross_pnl
    syms = sorted(set(b.index) | set(ours))
    out = pd.DataFrame({"symbol": syms,
                        "ours": [round(ours.get(s, 0.0), 2) for s in syms],
                        "broker": [round(float(b.get(s, 0.0)), 2) for s in syms]})
    out["difference"] = (out["ours"] - out["broker"]).round(2)
    return out


def root_symbol(contract_name: str) -> str:
    """'CON.F.US.MES.Z26' -> 'MES', 'MESZ26' -> 'MES', 'MES' -> 'MES'."""
    s = contract_name.strip().upper()
    if "." in s:
        parts = s.split(".")
        # ProjectX ids look like CON.F.US.MES.Z26 — the root is the 4th part
        if len(parts) >= 4:
            return parts[3]
        return parts[-1]
    # strip a month code + 2-digit year suffix, e.g. MESZ26, ESH6
    import re
    m = re.match(r"^([A-Z0-9]+?)([FGHJKMNQUVXZ])\d{1,2}$", s)
    return m.group(1) if m else s
