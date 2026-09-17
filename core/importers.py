"""Import helpers shared by every import path (CSV, Excel journal, clipboard, JSON).

Flow:  raw DataFrame -> auto_map() proposes a column mapping -> the UI lets the user
       adjust it -> normalise() turns rows into Trade objects + a list of row errors
       -> preview -> db.insert_trades().

A file can hold ROUND-TURN rows (entry and exit on one line) or FILL rows (one
execution per line, with a side and size). detect_shape() tells them apart;
fills are routed through fills_to_trades.pair_fills.
"""
from __future__ import annotations

import difflib
import json
import re
from datetime import datetime
from typing import Any, Optional

import pandas as pd

from .instruments import instrument_map
from .metrics import compute_trade_fields
from .models import Direction, Instrument, InstrumentType, Source, Trade

# target field -> synonyms seen in broker exports and hand-kept journals
SYNONYMS: dict[str, list[str]] = {
    "symbol":       ["symbol", "instrument", "contract", "ticker", "market", "product", "underlying", "contractname"],
    "direction":    ["direction", "side", "position", "long/short", "longshort", "buy/sell", "type of trade", "b/s"],
    "qty":          ["qty", "quantity", "size", "contracts", "lots", "volume", "filled", "shares", "position size"],
    "entry_time":   ["entry time", "entrytime", "open time", "opened", "entry date", "date", "time", "timestamp",
                     "entered at", "boughttimestamp", "entry_time", "datetime"],
    "exit_time":    ["exit time", "exittime", "close time", "closed", "exit date", "exited at", "soldtimestamp", "exit_time"],
    "entry_price":  ["entry price", "entry", "open price", "avg entry", "buy price", "buyprice", "entryprice", "fill price", "price in"],
    "exit_price":   ["exit price", "exit", "close price", "avg exit", "sell price", "sellprice", "exitprice", "price out"],
    "stop_price":   ["stop", "stop price", "stop loss", "sl", "initial stop", "stoploss"],
    "target_price": ["target", "target price", "take profit", "tp", "profit target"],
    "fees":         ["fees", "commission", "commissions", "fee", "costs", "comm"],
    "multiplier":   ["multiplier", "point value", "contract multiplier"],
    "setup_name":   ["setup", "strategy", "model", "playbook", "pattern", "system"],
    "timeframe":    ["timeframe", "tf", "chart", "interval"],
    "notes":        ["notes", "comment", "comments", "journal", "review"],
    "tags":         ["tags", "labels"],
    "mistake_tags": ["mistakes", "mistake", "errors"],
    "confidence":   ["confidence", "grade", "rating", "conviction"],
    "rules_followed": ["rules followed", "followed rules", "plan followed", "a+ setup", "discipline"],
    "pnl":          ["pnl", "p&l", "profit", "net pnl", "net p&l", "profit/loss", "realized", "realised",
                     "net profit", "result $", "pl", "p/l"],
    "r_multiple":   ["r", "r multiple", "rmultiple", "r-multiple", "rr", "r:r", "reward/risk", "realized r",
                     "realised r", "r result"],
    "risk_amount":  ["risk", "risk $", "risk amount", "$ risk", "risked", "risk usd"],
    "roi":          ["roi", "return %", "return", "gain %", "% gain", "pnl %"],
    "session":      ["session", "killzone", "kill zone", "time of day"],
    "trade_name":   ["trade name", "name", "title"],
    "external_id":  ["id", "trade id", "tradeid", "order id", "orderid", "ref"],
    # fill-shaped files
    "price":        ["price", "fill price", "exec price", "avg price"],
    "timestamp":    ["timestamp", "time", "datetime", "executed", "exec time", "creationtimestamp", "date/time"],
}

FILL_FIELDS = {"side", "size", "price", "timestamp"}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9/&+]", " ", str(s).lower()).strip()


def auto_map(columns: list[str], cutoff: float = 0.75) -> dict[str, Optional[str]]:
    """Propose {target_field: source_column or None} for a set of source columns.
    Exact synonym matches win; otherwise the closest fuzzy match above `cutoff`."""
    normed = {c: _norm(c) for c in columns}
    used: set[str] = set()
    out: dict[str, Optional[str]] = {}
    # pass 1: exact synonym hits
    for field, syns in SYNONYMS.items():
        hit = next((c for c, n in normed.items() if n in syns and c not in used), None)
        if hit:
            out[field] = hit; used.add(hit)
    # pass 2: fuzzy
    for field, syns in SYNONYMS.items():
        if field in out:
            continue
        best, best_score = None, 0.0
        for c, n in normed.items():
            if c in used:
                continue
            score = max(difflib.SequenceMatcher(None, n, s).ratio() for s in syns)
            if score > best_score:
                best, best_score = c, score
        out[field] = best if best_score >= cutoff else None
        if out[field]:
            used.add(out[field])
    return out


def detect_shape(mapping: dict[str, Optional[str]]) -> str:
    """'fills' when rows are single executions, else 'trades'."""
    has_exit = bool(mapping.get("exit_price"))
    has_side_size = bool(mapping.get("direction")) and bool(mapping.get("qty")) and bool(mapping.get("price") or mapping.get("entry_price"))
    if not has_exit and has_side_size and not mapping.get("entry_time"):
        return "fills"
    if not has_exit and has_side_size and mapping.get("timestamp") and not mapping.get("entry_price"):
        return "fills"
    return "trades"


def _parse_direction(v: Any) -> Optional[Direction]:
    s = str(v).strip().lower()
    if s in ("long", "buy", "b", "bought", "l", "1", "bid"):
        return Direction.LONG
    if s in ("short", "sell", "s", "sold", "sh", "-1", "ask"):
        return Direction.SHORT
    return None


def _parse_float(v: Any) -> Optional[float]:
    if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
        return None
    s = str(v).replace("$", "").replace(",", "").replace("−", "-").strip()
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return None


def _parse_time(v: Any, dayfirst: bool = True) -> Optional[datetime]:
    if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
        return None
    try:
        t = pd.to_datetime(v, dayfirst=dayfirst)
    except Exception:  # noqa: BLE001
        return None
    if pd.isna(t):
        return None
    if t.tzinfo is not None:
        t = t.tz_convert("UTC").tz_localize(None)
    return t.to_pydatetime()


def _parse_list(v: Any) -> list[str]:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return []
    s = str(v).strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            return [str(x) for x in json.loads(s)]
        except Exception:  # noqa: BLE001
            pass
    return [x.strip() for x in re.split(r"[;,|]", s) if x.strip()]


def _parse_bool(v: Any) -> Optional[bool]:
    s = str(v).strip().lower()
    if s in ("y", "yes", "true", "1", "✓", "x"):
        return True
    if s in ("n", "no", "false", "0"):
        return False
    return None


def normalise(df: pd.DataFrame, mapping: dict[str, Optional[str]],
              instruments: Optional[dict[str, Instrument]] = None,
              source: Source = Source.CSV, account_id: Optional[int] = None,
              dayfirst: bool = True, default_symbol: str = "") -> tuple[list[Trade], list[dict]]:
    """Turn mapped rows into Trade objects. Returns (trades, errors) where each error
    is {"row": n, "error": str}. Rows with errors are skipped, never half-imported."""
    instruments = instruments or instrument_map()
    trades, errors = [], []
    g = lambda row, field: row.get(mapping.get(field)) if mapping.get(field) else None  # noqa: E731
    for n, row in enumerate(df.to_dict("records")):
        try:
            sym = str(g(row, "symbol") or default_symbol).strip().upper()
            if not sym:
                raise ValueError("missing symbol")
            from .fills_to_trades import root_symbol
            root = root_symbol(sym)
            ins = instruments.get(root) or instruments.get(sym)
            direction = _parse_direction(g(row, "direction"))
            if direction is None:
                raise ValueError(f"unrecognised direction {g(row, 'direction')!r}")
            qty = _parse_float(g(row, "qty")) or 1.0
            entry = _parse_float(g(row, "entry_price"))
            exit_ = _parse_float(g(row, "exit_price"))
            file_pnl = _parse_float(g(row, "pnl")) if mapping.get("pnl") else None
            entry_time = _parse_time(g(row, "entry_time"), dayfirst)
            if entry_time is None:
                raise ValueError("missing or unreadable entry time")
            extra_tags: list[str] = []
            mult = _parse_float(g(row, "multiplier")) or (ins.multiplier if ins else None)
            if entry is None and exit_ is None and file_pnl is not None:
                # P&L-only row (FX Replay / journal exports without prices): keep the P&L exactly,
                # with synthetic prices so the maths still flows through the normal formulas.
                entry, exit_, qty, mult = 0.0, file_pnl * direction.sign, 1.0, 1.0
                extra_tags.append("pnl-only")
            if entry is None:
                raise ValueError("missing entry price" + ("" if file_pnl is not None else " (and no P&L column to fall back on)"))
            if mult is None:
                raise ValueError(f"unknown instrument {sym}: add it in Settings or map a multiplier column")
            t = Trade(
                symbol=root if ins else sym, direction=direction, qty=abs(qty), entry_time=entry_time,
                entry_price=entry, exit_time=_parse_time(g(row, "exit_time"), dayfirst),
                exit_price=exit_, stop_price=_parse_float(g(row, "stop_price")),
                target_price=_parse_float(g(row, "target_price")), multiplier=mult,
                fees=abs(_parse_float(g(row, "fees")) or 0.0),
                instrument_type=(ins.instrument_type if ins else InstrumentType.FUTURE),
                source=source, external_id=str(g(row, "external_id") or "").strip(),
                account_id=account_id, setup_name=str(g(row, "setup_name") or "").strip(),
                timeframe=str(g(row, "timeframe") or "").strip(), notes=str(g(row, "notes") or "").strip(),
                tags=_parse_list(g(row, "tags")), mistake_tags=_parse_list(g(row, "mistake_tags")),
                rules_followed=_parse_bool(g(row, "rules_followed")) if mapping.get("rules_followed") else None,
            )
            conf = _parse_float(g(row, "confidence"))
            t.confidence = int(conf) if conf is not None and 1 <= conf <= 5 else None
            t.tags.extend(extra_tags)
            if mapping.get("session") and g(row, "session"):
                t.session = str(g(row, "session")).strip()
            if mapping.get("trade_name") and g(row, "trade_name") and not t.setup_name:
                t.setup_name = str(g(row, "trade_name")).strip()
            if t.exit_time is None and t.exit_price is not None:
                t.exit_time = t.entry_time
            compute_trade_fields(t)
            if not t.external_id:
                t.external_id = fingerprint(t)
            # R and risk from the file when the row has no stop to derive them from
            file_r = _parse_float(g(row, "r_multiple")) if mapping.get("r_multiple") else None
            file_risk = _parse_float(g(row, "risk_amount")) if mapping.get("risk_amount") else None
            if t.net_pnl is not None and t.initial_risk in (None, 0):
                if file_risk and file_risk > 0:
                    t.initial_risk = abs(file_risk); t.r_multiple = t.net_pnl / t.initial_risk
                elif file_r not in (None, 0) and t.net_pnl != 0:
                    t.initial_risk = abs(t.net_pnl / file_r); t.r_multiple = file_r
            # sanity: if the file carries its own P&L, flag a large disagreement
            if "pnl-only" not in t.tags and file_pnl is not None and t.net_pnl is not None \
                    and abs(file_pnl - t.net_pnl) > max(1.0, abs(file_pnl) * 0.02):
                t.tags.append("pnl-mismatch")
                t.notes = (t.notes + f" [file P&L {file_pnl:,.2f} vs computed {t.net_pnl:,.2f}]").strip()
            trades.append(t)
        except Exception as e:  # noqa: BLE001
            errors.append({"row": n + 1, "error": str(e)})
    return trades, errors


def fingerprint(t: Trade) -> str:
    """Deterministic id for rows that carry no broker id, so re-importing the same file is a no-op.
    Built from what identifies a trade: symbol, side, size, entry time/price, exit price, source."""
    import hashlib
    key = "|".join(str(x) for x in (t.symbol, t.direction.value, round(t.qty, 6), t.entry_time.isoformat(timespec="minutes"),
                                    round(t.entry_price, 6), None if t.exit_price is None else round(t.exit_price, 6), t.source.value))
    return f"fp-{hashlib.sha1(key.encode()).hexdigest()[:16]}"


def read_any(path_or_buffer, sheet: Optional[str] = None) -> pd.DataFrame:
    """CSV, TSV, XLSX (a sheet or the first one) or JSON -> DataFrame with string column names."""
    name = str(getattr(path_or_buffer, "name", path_or_buffer)).lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        xl = pd.ExcelFile(path_or_buffer)
        sh = sheet or ("Journal" if "Journal" in xl.sheet_names else xl.sheet_names[0])
        df = xl.parse(sh)
    elif name.endswith(".json"):
        df = pd.read_json(path_or_buffer)
    else:
        df = pd.read_csv(path_or_buffer, sep=None, engine="python")
    df.columns = [str(c).strip() for c in df.columns]
    return df.dropna(how="all")


def read_clipboard_text(text: str) -> pd.DataFrame:
    """Rows pasted from a spreadsheet (tab separated) or a CSV."""
    from io import StringIO
    sep = "\t" if "\t" in text.splitlines()[0] else ","
    df = pd.read_csv(StringIO(text), sep=sep)
    df.columns = [str(c).strip() for c in df.columns]
    return df.dropna(how="all")


def preview(trades: list[Trade], existing_external_ids: set[str]) -> pd.DataFrame:
    """What the confirm screen shows: each trade with a status of new / duplicate / open."""
    rows = []
    for t in trades:
        status = "duplicate" if (t.external_id and t.external_id in existing_external_ids) else ("open" if t.is_open else "new")
        rows.append({"status": status, "symbol": t.symbol, "direction": t.direction.value, "qty": t.qty,
                     "entry_time": t.entry_time, "entry_price": t.entry_price, "exit_price": t.exit_price,
                     "net_pnl": t.net_pnl, "r_multiple": t.r_multiple, "setup": t.setup_name,
                     "external_id": t.external_id})
    return pd.DataFrame(rows)
