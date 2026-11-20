"""Event-driven bar-by-bar backtester with no look-ahead.

Rules that keep it honest
-------------------------
- A signal is read at the CLOSE of bar i and can only fill at the OPEN of bar i+1.
- Stops and targets are checked against each bar's high/low. If both could have
  been hit in the same bar we assume the STOP was hit first (conservative).
- A trailing stop is checked with the level it had at the bar's open, and only
  then ratcheted with that bar's extreme — the bar can't trail itself.
- Slippage (in ticks) is charged against you on every entry and exit.
- Commission is charged per contract per round turn.
- Prices are rounded to the instrument's tick size.

Strategy contract
-----------------
    def generate_signals(bars: pd.DataFrame, params: dict) -> pd.Series | pd.DataFrame

Return a Series of ints (1 = go long, -1 = go short, 0 = nothing) aligned with
`bars`, or a DataFrame with a `signal` column plus optional `stop` and `target`
columns holding absolute price levels to use when a signal fires. Optional
module-level `PARAMS = {"name": default, ...}` and `RANGES = {"name": [..]}`
drive the UI and the parameter sweep.

Stats are computed with core.metrics so backtests and live trades are measured
identically.
"""
from __future__ import annotations

import importlib.util
import itertools
import math
from dataclasses import dataclass, field, asdict
from datetime import time
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import pandas as pd

from .instruments import round_to_tick
from .metrics import compute_df_fields, summary_stats, equity_curve
from .models import Direction, Source, Trade

StrategyFn = Callable[[pd.DataFrame, dict], "pd.Series | pd.DataFrame"]


@dataclass
class BacktestConfig:
    symbol: str = "MES"
    multiplier: float = 5.0
    tick_size: float = 0.25
    commission_per_contract: float = 1.0      # round turn
    slippage_ticks: float = 1.0               # per side
    starting_balance: float = 50_000.0
    # sizing: fixed contracts, or risk-based if risk_dollars is set and a stop exists
    contracts: int = 1
    risk_dollars: Optional[float] = None
    max_contracts: int = 10
    # exits (points = price units). None disables.
    stop_points: Optional[float] = None
    target_points: Optional[float] = None
    trailing_points: Optional[float] = None
    max_bars_in_trade: Optional[int] = None
    # session (bar timestamps' own clock). None disables.
    session_start: Optional[time] = None
    session_end: Optional[time] = None
    flat_at_session_end: bool = True
    allow_flip: bool = True                    # opposite signal closes and reverses
    one_trade_per_day: bool = False


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    stats: dict
    equity: pd.DataFrame          # per-bar mark-to-market: t, equity
    config: dict
    params: dict
    strategy: str = ""

    def trade_objects(self) -> list[Trade]:
        return [Trade.from_row(r) for r in self.trades.to_dict("records")] if len(self.trades) else []


def _validate_bars(bars: pd.DataFrame) -> pd.DataFrame:
    need = {"t", "o", "h", "l", "c"}
    missing = need - set(bars.columns)
    if missing:
        raise ValueError(f"bars missing columns: {sorted(missing)}")
    b = bars.copy()
    b["t"] = pd.to_datetime(b["t"])
    if b["t"].dt.tz is not None:
        b["t"] = b["t"].dt.tz_localize(None)
    b = b.sort_values("t").reset_index(drop=True)
    if "v" not in b:
        b["v"] = 0.0
    return b


def _in_session(ts: pd.Timestamp, cfg: BacktestConfig) -> bool:
    if cfg.session_start is None and cfg.session_end is None:
        return True
    tm = ts.time()
    if cfg.session_start is not None and tm < cfg.session_start:
        return False
    if cfg.session_end is not None and tm >= cfg.session_end:
        return False
    return True


def run_backtest(bars: pd.DataFrame, strategy: StrategyFn, params: dict | None,
                 cfg: BacktestConfig, strategy_name: str = "") -> BacktestResult:
    params = dict(params or {})
    b = _validate_bars(bars)
    sig = strategy(b, params)
    if isinstance(sig, pd.DataFrame):
        signals = sig["signal"].fillna(0).astype(int).values
        stop_lv = sig["stop"].values if "stop" in sig else None
        tgt_lv = sig["target"].values if "target" in sig else None
    else:
        signals = pd.Series(sig).fillna(0).astype(int).values
        stop_lv = tgt_lv = None
    if len(signals) != len(b):
        raise ValueError("strategy must return one signal per bar")

    slip = cfg.slippage_ticks * cfg.tick_size
    o, h, l, c, t = b["o"].values, b["h"].values, b["l"].values, b["c"].values, b["t"]
    pos: Optional[dict] = None
    pending: Optional[dict] = None
    trades: list[dict] = []
    eq_rows = []
    realised = 0.0
    n = 0
    last_trade_day = None

    def close_position(price: float, when: pd.Timestamp, reason: str, slipped: bool = True):
        """Exit at `price`. Market-style exits (stops, flips, time, session) are slipped
        against us; a target is a resting limit order and fills at its level."""
        nonlocal pos, realised, n
        exit_px = round_to_tick(price - (slip * pos["dir"] if slipped else 0.0), cfg.tick_size)
        fees = cfg.commission_per_contract * pos["qty"]
        n += 1
        trades.append({
            "external_id": f"bt-{n}", "symbol": cfg.symbol, "direction": pos["direction"],
            "qty": pos["qty"], "entry_time": pos["entry_time"], "exit_time": when,
            "entry_price": pos["entry_price"], "exit_price": exit_px,
            "stop_price": pos["initial_stop"], "target_price": pos["target"],
            "multiplier": cfg.multiplier, "fees": fees, "source": Source.BACKTEST.value,
            "instrument_type": "future", "setup_name": strategy_name or "backtest",
            "tags": [reason], "mistake_tags": [], "notes": "", "session": "",
            "timeframe": "", "rules_followed": None, "confidence": None, "emotion": "",
            "screenshot_path": "", "mae": pos["mae"], "mfe": pos["mfe"],
            "bars_held": pos["bars"],
        })
        realised += (exit_px - pos["entry_price"]) * pos["dir"] * pos["qty"] * cfg.multiplier - fees
        pos = None

    def open_position(direction: int, price: float, when: pd.Timestamp, i: int):
        nonlocal pos
        entry_px = round_to_tick(price + slip * direction, cfg.tick_size)
        stop = target = None
        if stop_lv is not None and not np.isnan(stop_lv[i]):
            stop = float(stop_lv[i])
        elif cfg.stop_points:
            stop = entry_px - cfg.stop_points * direction
        if tgt_lv is not None and not np.isnan(tgt_lv[i]):
            target = float(tgt_lv[i])
        elif cfg.target_points:
            target = entry_px + cfg.target_points * direction
        if stop is not None:
            stop = round_to_tick(stop, cfg.tick_size)
        if target is not None:
            target = round_to_tick(target, cfg.tick_size)
        qty = cfg.contracts
        if cfg.risk_dollars and stop is not None:
            per = abs(entry_px - stop) * cfg.multiplier + cfg.commission_per_contract
            qty = int(math.floor(cfg.risk_dollars / per)) if per > 0 else 0
            qty = max(0, min(qty, cfg.max_contracts))
        if qty <= 0:
            return
        pos = {"dir": direction, "direction": "long" if direction > 0 else "short",
               "qty": qty, "entry_price": entry_px, "entry_time": when, "entry_idx": i,
               "stop": stop, "initial_stop": stop, "target": target,
               "extreme": entry_px, "bars": 0, "mae": 0.0, "mfe": 0.0}

    for i in range(len(b)):
        ts = t.iloc[i]
        day = ts.date()

        # 1) session end: flat before anything else if the previous bar closed the session
        if pos is not None and cfg.flat_at_session_end and cfg.session_end is not None \
                and not _in_session(ts, cfg):
            close_position(o[i], ts, "session_end")

        # 2) execute the pending order at this bar's open
        if pending is not None:
            d = pending["dir"]; src_i = pending["i"]
            pending = None
            if _in_session(ts, cfg) and not (cfg.one_trade_per_day and last_trade_day == day):
                if pos is not None and pos["dir"] != d and cfg.allow_flip:
                    close_position(o[i], ts, "flip")
                if pos is None:
                    open_position(d, o[i], ts, src_i)
                    if pos is not None:
                        last_trade_day = day

        # 3) intrabar exits on the open position
        if pos is not None:
            d = pos["dir"]
            stop, target = pos["stop"], pos["target"]
            exit_px = None; reason = None
            if stop is not None and ((d > 0 and l[i] <= stop) or (d < 0 and h[i] >= stop)):
                # gap through the stop fills at the open
                exit_px = o[i] if ((d > 0 and o[i] < stop) or (d < 0 and o[i] > stop)) else stop
                reason = "stop"
            elif target is not None and ((d > 0 and h[i] >= target) or (d < 0 and l[i] <= target)):
                exit_px = o[i] if ((d > 0 and o[i] > target) or (d < 0 and o[i] < target)) else target
                reason = "target"
            # excursion tracking (in points, favourable positive)
            fav = (h[i] - pos["entry_price"]) if d > 0 else (pos["entry_price"] - l[i])
            adv = (pos["entry_price"] - l[i]) if d > 0 else (h[i] - pos["entry_price"])
            pos["mfe"] = max(pos["mfe"], fav * pos["qty"] * cfg.multiplier)
            pos["mae"] = max(pos["mae"], adv * pos["qty"] * cfg.multiplier)
            pos["bars"] += 1
            if exit_px is not None:
                close_position(exit_px, ts, reason, slipped=(reason == "stop"))
            else:
                # ratchet trailing stop AFTER checking this bar
                if cfg.trailing_points:
                    if d > 0:
                        pos["extreme"] = max(pos["extreme"], h[i])
                        new_stop = round_to_tick(pos["extreme"] - cfg.trailing_points, cfg.tick_size)
                        pos["stop"] = new_stop if pos["stop"] is None else max(pos["stop"], new_stop)
                    else:
                        pos["extreme"] = min(pos["extreme"], l[i])
                        new_stop = round_to_tick(pos["extreme"] + cfg.trailing_points, cfg.tick_size)
                        pos["stop"] = new_stop if pos["stop"] is None else min(pos["stop"], new_stop)
                # time exit at the close
                if cfg.max_bars_in_trade and pos["bars"] >= cfg.max_bars_in_trade:
                    close_position(c[i], ts, "time")
                # end-of-session flat at the last in-session bar's close
                elif cfg.flat_at_session_end and cfg.session_end is not None and i + 1 < len(b) \
                        and not _in_session(t.iloc[i + 1], cfg):
                    close_position(c[i], ts, "session_end")

        # 4) read the signal at this bar's close -> pending for next bar
        s = int(signals[i])
        if s != 0 and (pos is None or (pos["dir"] != s and cfg.allow_flip)):
            pending = {"dir": s, "i": i}

        # mark-to-market equity at close
        unreal = 0.0
        if pos is not None:
            unreal = (c[i] - pos["entry_price"]) * pos["dir"] * pos["qty"] * cfg.multiplier
        eq_rows.append((ts, cfg.starting_balance + realised + unreal))

    # close anything left at the final close
    if pos is not None:
        close_position(c[-1], t.iloc[-1], "end_of_data")

    tdf = pd.DataFrame(trades)
    if not tdf.empty:
        tdf = compute_df_fields(tdf)
    stats = summary_stats(tdf, cfg.starting_balance) if not tdf.empty else summary_stats(pd.DataFrame(), cfg.starting_balance)
    stats["exposure_pct"] = (
        float(tdf["bars_held"].sum()) / len(b) * 100.0
        if (not tdf.empty and len(b) > 0) else 0.0
    )
    stats["bars"] = int(len(b))
    stats["exit_reasons"] = (tdf["tags"].apply(lambda x: x[0]).value_counts().to_dict()
                             if not tdf.empty else {})
    eq = pd.DataFrame(eq_rows, columns=["t", "equity"])
    cfg_d = asdict(cfg)
    for k in ("session_start", "session_end"):
        if cfg_d[k] is not None:
            cfg_d[k] = cfg_d[k].isoformat()
    return BacktestResult(trades=tdf, stats=stats, equity=eq, config=cfg_d,
                          params=params, strategy=strategy_name)


# --------------------------------------------------------------------------
# Parameter sweep, plateau check, walk-forward
# --------------------------------------------------------------------------
def sweep(bars: pd.DataFrame, strategy: StrategyFn, grid: dict[str, list],
          cfg: BacktestConfig, base_params: dict | None = None,
          metrics: tuple[str, ...] = ("trades", "win_rate", "expectancy", "expectancy_r",
                                      "profit_factor", "net_pnl", "max_drawdown")) -> pd.DataFrame:
    """Run every combination in `grid`. Returns one row per combination."""
    keys = list(grid)
    rows = []
    for combo in itertools.product(*[grid[k] for k in keys]):
        p = {**(base_params or {}), **dict(zip(keys, combo))}
        r = run_backtest(bars, strategy, p, cfg)
        row = {k: v for k, v in p.items()}
        row.update({m: r.stats.get(m) for m in metrics})
        rows.append(row)
    return pd.DataFrame(rows)


def plateau_check(results: pd.DataFrame, x: str, y: str, metric: str = "expectancy") -> dict:
    """Is the best (x, y) cell part of a stable plateau or an isolated island?

    Compares the best cell with the mean of its neighbours in the grid.
    ratio close to 1 = plateau (good); high ratio or negative neighbours = island (overfit).
    """
    piv = results.pivot_table(index=y, columns=x, values=metric)
    if piv.empty or piv.isna().all().all():
        return {"verdict": "no data"}
    arr = piv.values.astype(float)
    bi, bj = np.unravel_index(np.nanargmax(arr), arr.shape)
    best = arr[bi, bj]
    neigh = []
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if di == dj == 0:
                continue
            ii, jj = bi + di, bj + dj
            if 0 <= ii < arr.shape[0] and 0 <= jj < arr.shape[1] and not np.isnan(arr[ii, jj]):
                neigh.append(arr[ii, jj])
    if not neigh:
        return {"verdict": "grid too small", "best": best}
    nmean = float(np.mean(neigh))
    if best <= 0:
        verdict = "no positive edge anywhere"
    elif nmean <= 0:
        verdict = "island — neighbours lose money; likely overfit"
    elif best / nmean > 1.5:
        verdict = "spiky — best cell is much better than neighbours; be sceptical"
    else:
        verdict = "plateau — neighbours perform similarly; more trustworthy"
    return {"verdict": verdict, "best": float(best), "best_params": {x: piv.columns[bj], y: piv.index[bi]},
            "neighbour_mean": nmean, "ratio": (best / nmean) if nmean else None, "grid": piv}


def walk_forward(bars: pd.DataFrame, strategy: StrategyFn, grid: dict[str, list],
                 cfg: BacktestConfig, n_windows: int = 4, in_sample_frac: float = 0.7,
                 objective: str = "expectancy_r", base_params: dict | None = None,
                 min_trades: int = 10) -> dict:
    """Rolling optimise-then-test. Only the stitched out-of-sample result should be believed."""
    b = _validate_bars(bars)
    edges = np.linspace(0, len(b), n_windows + 1).astype(int)
    windows = []
    oos_trades = []
    for w in range(n_windows):
        seg = b.iloc[edges[w]:edges[w + 1]]
        cut = int(len(seg) * in_sample_frac)
        ins, oos = seg.iloc[:cut], seg.iloc[cut:]
        if len(ins) < 10 or len(oos) < 5:
            continue
        res = sweep(ins, strategy, grid, cfg, base_params)
        res = res[res["trades"] >= min_trades] if (res["trades"] >= min_trades).any() else res
        obj = res[objective].astype(float).fillna(-np.inf)
        best = res.loc[obj.idxmax()]
        best_params = {**(base_params or {}), **{k: best[k] for k in grid}}
        oos_res = run_backtest(oos, strategy, best_params, cfg)
        windows.append({"window": w + 1, "in_sample_start": ins["t"].iloc[0],
                        "oos_start": oos["t"].iloc[0], "oos_end": oos["t"].iloc[-1],
                        "best_params": {k: best[k] for k in grid},
                        "is_" + objective: float(best[objective]) if pd.notna(best[objective]) else None,
                        "oos_" + objective: oos_res.stats.get(objective),
                        "oos_trades": oos_res.stats["trades"],
                        "oos_net_pnl": oos_res.stats["net_pnl"]})
        if not oos_res.trades.empty:
            oos_trades.append(oos_res.trades)
    all_oos = pd.concat(oos_trades, ignore_index=True) if oos_trades else pd.DataFrame()
    stats = summary_stats(all_oos, cfg.starting_balance)
    eq = equity_curve(all_oos, cfg.starting_balance) if not all_oos.empty else pd.DataFrame()
    return {"windows": pd.DataFrame(windows), "oos_trades": all_oos, "oos_stats": stats,
            "oos_equity": eq}


# --------------------------------------------------------------------------
# Strategy plugins
# --------------------------------------------------------------------------
def load_strategies(folder: str | Path) -> dict[str, dict]:
    """Discover *.py files exposing generate_signals(bars, params).
    Returns {name: {"fn": callable, "params": {...}, "ranges": {...}, "doc": str}}."""
    out = {}
    folder = Path(folder)
    if not folder.exists():
        return out
    for f in sorted(folder.glob("*.py")):
        if f.name.startswith("_"):
            continue
        spec = importlib.util.spec_from_file_location(f"strategies.{f.stem}", f)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
        except Exception as e:  # a broken plugin must not kill the app
            out[f.stem] = {"error": str(e)}
            continue
        fn = getattr(mod, "generate_signals", None)
        if callable(fn):
            out[f.stem] = {"fn": fn, "params": dict(getattr(mod, "PARAMS", {})),
                           "ranges": dict(getattr(mod, "RANGES", {})),
                           "doc": (mod.__doc__ or "").strip()}
    return out


# --------------------------------------------------------------------------
# Built-in rule-builder conditions (for the no-code UI)
# --------------------------------------------------------------------------
def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def atr(bars: pd.DataFrame, n: int = 14) -> pd.Series:
    pc = bars["c"].shift(1)
    tr = pd.concat([bars["h"] - bars["l"], (bars["h"] - pc).abs(), (bars["l"] - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def vwap(bars: pd.DataFrame) -> pd.Series:
    """Session-anchored VWAP (resets each calendar day)."""
    tp = (bars["h"] + bars["l"] + bars["c"]) / 3
    day = pd.to_datetime(bars["t"]).dt.date
    pv = (tp * bars["v"]).groupby(day).cumsum()
    vv = bars["v"].groupby(day).cumsum().replace(0, np.nan)
    return pv / vv


def build_rule_strategy(rules: list[dict], logic: str = "and") -> StrategyFn:
    """Compose a strategy from simple rule dicts, e.g.
        {"type": "ma_cross", "fast": 9, "slow": 21}                 -> long on cross up, short on cross down
        {"type": "rsi", "n": 14, "buy_below": 30, "sell_above": 70}
        {"type": "prior_day_break"}                                 -> long above yesterday's high, short below its low
        {"type": "vwap_cross"}
        {"type": "time_window", "start": "09:30", "end": "11:00"}   -> filter only
    Long fires when every (and) / any (or) directional rule says long, and all filters pass.
    """
    def fn(bars: pd.DataFrame, params: dict) -> pd.Series:
        longs, shorts, filters = [], [], []
        c = bars["c"]
        for r in rules:
            t = r["type"]
            if t == "ma_cross":
                f, s = ema(c, int(r.get("fast", 9))), ema(c, int(r.get("slow", 21)))
                up = (f > s) & (f.shift(1) <= s.shift(1))
                dn = (f < s) & (f.shift(1) >= s.shift(1))
                longs.append(up); shorts.append(dn)
            elif t == "rsi":
                v = rsi(c, int(r.get("n", 14)))
                longs.append(v < float(r.get("buy_below", 30)))
                shorts.append(v > float(r.get("sell_above", 70)))
            elif t == "prior_day_break":
                day = pd.to_datetime(bars["t"]).dt.date
                dh = bars.groupby(day)["h"].max().shift(1)
                dl = bars.groupby(day)["l"].min().shift(1)
                ph = day.map(dh).astype(float); pl = day.map(dl).astype(float)
                longs.append((c > ph) & (c.shift(1) <= ph.shift(1).fillna(ph)))
                shorts.append((c < pl) & (c.shift(1) >= pl.shift(1).fillna(pl)))
            elif t == "vwap_cross":
                v = vwap(bars)
                longs.append((c > v) & (c.shift(1) <= v.shift(1)))
                shorts.append((c < v) & (c.shift(1) >= v.shift(1)))
            elif t == "time_window":
                tm = pd.to_datetime(bars["t"]).dt.time
                s = time.fromisoformat(r["start"]); e = time.fromisoformat(r["end"])
                filters.append(pd.Series([(s <= x < e) for x in tm], index=bars.index))
        def combine(parts):
            if not parts:
                return pd.Series(False, index=bars.index)
            out = parts[0].fillna(False)
            for p in parts[1:]:
                out = (out & p.fillna(False)) if logic == "and" else (out | p.fillna(False))
            return out
        L, S = combine(longs), combine(shorts)
        for f in filters:
            L &= f; S &= f
        sig = pd.Series(0, index=bars.index)
        sig[L] = 1
        sig[S & ~L] = -1
        return sig
    return fn
