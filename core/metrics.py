"""Performance metrics. Every function is pure: DataFrame in, numbers/frames out.

The same functions are used for live trades and for backtest results, so the two
are always computed identically.

Conventions
-----------
- gross_pnl = (exit - entry) * qty * multiplier, sign flipped for shorts
- net_pnl   = gross_pnl - fees
- initial_risk = |entry - stop| * qty * multiplier        (None if no stop)
- r_multiple   = net_pnl / initial_risk                    (None if no stop)
- A win is net_pnl > 0, a loss is net_pnl < 0, a scratch is net_pnl == 0.
  Scratches are excluded from win rate but counted separately.
- Open trades (exit_price is null) are excluded from every statistic.
"""
from __future__ import annotations

import math
from datetime import datetime, time
from typing import Iterable, Optional

import numpy as np
import pandas as pd

from .models import Direction, Trade

MIN_SAMPLE = 30   # below this, stats get a "small sample" flag


# --------------------------------------------------------------------------
# Per-trade fields
# --------------------------------------------------------------------------
def gross_pnl(entry: float, exit_: float, qty: float, multiplier: float,
              direction: Direction | str) -> float:
    sign = 1 if (direction == Direction.LONG or direction == "long") else -1
    return (exit_ - entry) * qty * multiplier * sign


def compute_trade_fields(t: Trade) -> Trade:
    """Fill gross_pnl, net_pnl, initial_risk, r_multiple on a Trade in place."""
    if t.stop_price is not None:
        t.initial_risk = abs(t.entry_price - t.stop_price) * t.qty * t.multiplier
    else:
        t.initial_risk = None
    if t.exit_price is None:
        t.gross_pnl = t.net_pnl = t.r_multiple = None
        return t
    t.gross_pnl = gross_pnl(t.entry_price, t.exit_price, t.qty, t.multiplier, t.direction)
    t.net_pnl = t.gross_pnl - (t.fees or 0.0)
    t.r_multiple = (t.net_pnl / t.initial_risk
                    if t.initial_risk and t.initial_risk > 0 else None)
    return t


def compute_df_fields(df: pd.DataFrame) -> pd.DataFrame:
    """Vectorised version of compute_trade_fields. Returns a copy."""
    df = df.copy()
    sign = np.where(df["direction"].astype(str).str.lower() == "short", -1.0, 1.0)
    has_exit = df["exit_price"].notna()
    df["gross_pnl"] = np.where(
        has_exit,
        (df["exit_price"].fillna(0) - df["entry_price"]) * df["qty"] * df["multiplier"] * sign,
        np.nan)
    df["net_pnl"] = df["gross_pnl"] - df.get("fees", 0).fillna(0)
    stop = df["stop_price"] if "stop_price" in df else pd.Series(np.nan, index=df.index)
    df["initial_risk"] = (df["entry_price"] - stop).abs() * df["qty"] * df["multiplier"]
    df["r_multiple"] = np.where(
        (df["initial_risk"] > 0) & has_exit, df["net_pnl"] / df["initial_risk"], np.nan)
    return df


def closed(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty or "exit_price" not in df:
        return df
    return df[df["exit_price"].notna() & df["net_pnl"].notna()].copy()


# --------------------------------------------------------------------------
# Win rate with confidence interval
# --------------------------------------------------------------------------
def wilson_interval(wins: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson score interval for a proportion. Returns (low, high) in [0, 1]."""
    if n <= 0:
        return (0.0, 0.0)
    p = wins / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


# --------------------------------------------------------------------------
# Equity and drawdown
# --------------------------------------------------------------------------
def equity_curve(df: pd.DataFrame, starting_balance: float = 0.0,
                 time_col: str = "exit_time") -> pd.DataFrame:
    """Cumulative equity after each closed trade, ordered by exit time.
    Columns: time, net_pnl, equity, peak, drawdown, drawdown_pct."""
    c = closed(df)
    if c.empty:
        return pd.DataFrame(columns=["time", "net_pnl", "equity", "peak",
                                     "drawdown", "drawdown_pct"])
    c = c.sort_values(time_col)
    eq = starting_balance + c["net_pnl"].cumsum()
    peak = np.maximum.accumulate(np.r_[starting_balance, eq.values])[1:]
    dd = eq.values - peak
    with np.errstate(divide="ignore", invalid="ignore"):
        dd_pct = np.where(peak != 0, dd / peak, 0.0)
    return pd.DataFrame({
        "time": c[time_col].values, "net_pnl": c["net_pnl"].values,
        "equity": eq.values, "peak": peak, "drawdown": dd, "drawdown_pct": dd_pct,
    })


def max_drawdown(equity: Iterable[float], starting_balance: float = 0.0) -> dict:
    """Largest peak-to-trough fall of an equity series.
    Returns {"amount": $, "pct": fraction of peak, "peak_index", "trough_index"}."""
    e = np.asarray(list(equity), dtype=float)
    if e.size == 0:
        return {"amount": 0.0, "pct": 0.0, "peak_index": None, "trough_index": None}
    series = np.r_[starting_balance, e]
    peaks = np.maximum.accumulate(series)
    dd = series - peaks
    trough = int(np.argmin(dd))
    amount = float(-dd[trough])
    peak_val = float(peaks[trough])
    pct = amount / peak_val if peak_val > 0 else 0.0
    peak_idx = int(np.argmax(series[: trough + 1]))
    return {"amount": amount, "pct": pct,
            "peak_index": max(peak_idx - 1, 0) if amount > 0 else None,
            "trough_index": trough - 1 if amount > 0 else None}


def r_equity(closed_trades: pd.DataFrame) -> dict:
    """Cumulative R for risk-recorded closed trades, ordered by exit and trade ID."""
    if closed_trades.empty or "r_multiple" not in closed_trades:
        return {"values": [], "net_r": None, "max_drawdown_r": None}
    order = ["exit_time", "id"] if "id" in closed_trades else "exit_time"
    returns = closed_trades.sort_values(order, kind="stable")["r_multiple"].to_numpy(dtype=float, na_value=np.nan)
    returns = returns[np.isfinite(returns)]
    if not len(returns):
        return {"values": [], "net_r": None, "max_drawdown_r": None}
    cumulative = returns.cumsum()
    return {"values": np.r_[0.0, cumulative], "net_r": float(cumulative[-1]),
            "max_drawdown_r": max_drawdown(cumulative)["amount"]}


def daily_pnl(df: pd.DataFrame, time_col: str = "exit_time") -> pd.Series:
    c = closed(df)
    if c.empty:
        return pd.Series(dtype=float)
    d = c.groupby(pd.to_datetime(c[time_col]).dt.date)["net_pnl"].sum()
    d.index = pd.to_datetime(d.index)
    return d.sort_index()


def sharpe(daily: pd.Series, capital: float, periods: int = 252) -> Optional[float]:
    """Annualised Sharpe on daily P&L expressed as a return on `capital`."""
    if capital <= 0 or len(daily) < 2:
        return None
    r = daily / capital
    sd = r.std(ddof=1)
    if sd == 0 or np.isnan(sd):
        return None
    return float(r.mean() / sd * math.sqrt(periods))


def sortino(daily: pd.Series, capital: float, periods: int = 252) -> Optional[float]:
    if capital <= 0 or len(daily) < 2:
        return None
    r = daily / capital
    downside = r[r < 0]
    if len(downside) < 2:
        return None
    dsd = math.sqrt((downside ** 2).mean())
    if dsd == 0:
        return None
    return float(r.mean() / dsd * math.sqrt(periods))


# --------------------------------------------------------------------------
# Streaks
# --------------------------------------------------------------------------
def streaks(df: pd.DataFrame, time_col: str = "exit_time") -> dict:
    c = closed(df)
    if c.empty:
        return {"longest_win": 0, "longest_loss": 0, "current": 0,
                "win_streaks": [], "loss_streaks": []}
    outcomes = np.sign(c.sort_values(time_col)["net_pnl"].values)
    outcomes = outcomes[outcomes != 0]
    win_runs, loss_runs = [], []
    run = 0
    for o in outcomes:
        if run == 0 or np.sign(run) == o:
            run += int(o)
        else:
            (win_runs if run > 0 else loss_runs).append(abs(run))
            run = int(o)
    if run > 0:
        win_runs.append(run)
    elif run < 0:
        loss_runs.append(-run)
    return {
        "longest_win": max(win_runs, default=0),
        "longest_loss": max(loss_runs, default=0),
        "current": int(run),            # +n = n wins in a row, -n = n losses in a row
        "win_streaks": win_runs, "loss_streaks": loss_runs,
    }


# --------------------------------------------------------------------------
# The summary everyone uses
# --------------------------------------------------------------------------
def summary_stats(df: pd.DataFrame, starting_balance: float = 0.0) -> dict:
    """All headline statistics for a set of trades. Safe on an empty frame."""
    c = closed(df)
    n = len(c)
    out: dict = {"trades": n, "open_trades": int(len(df) - n) if len(df) else 0,
                 "small_sample": n < MIN_SAMPLE}
    if n == 0:
        out.update({"wins": 0, "losses": 0, "scratches": 0, "win_rate": None,
                    "win_rate_ci": (0.0, 0.0), "net_pnl": 0.0, "gross_pnl": 0.0,
                    "fees": 0.0, "avg_win": None, "avg_loss": None,
                    "payoff_ratio": None, "profit_factor": None,
                    "expectancy": None, "expectancy_r": None, "avg_r": None,
                    "best_trade": None, "worst_trade": None, "max_drawdown": 0.0,
                    "max_drawdown_pct": 0.0, "sharpe": None, "sortino": None,
                    "longest_win_streak": 0, "longest_loss_streak": 0,
                    "current_streak": 0, "avg_hold_minutes": None,
                    "trading_days": 0, "avg_daily_pnl": None, "best_day": None,
                    "worst_day": None, "return_pct": None})
        return out

    pnl = c["net_pnl"].astype(float)
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]
    scratches = int((pnl == 0).sum())
    decided = len(wins) + len(losses)
    wr = len(wins) / decided if decided else None

    avg_win = float(wins.mean()) if len(wins) else None
    avg_loss = float(-losses.mean()) if len(losses) else None
    gross_w, gross_l = float(wins.sum()), float(-losses.sum())
    pf = (gross_w / gross_l) if gross_l > 0 else (math.inf if gross_w > 0 else None)
    payoff = (avg_win / avg_loss) if (avg_win is not None and avg_loss) else None
    expectancy = (float(pnl.mean()) if decided else None)
    r = c["r_multiple"].dropna().astype(float) if "r_multiple" in c else pd.Series(dtype=float)
    avg_r = float(r.mean()) if len(r) else None

    eq = equity_curve(c, starting_balance)
    mdd = max_drawdown(eq["equity"].values, starting_balance)
    daily = daily_pnl(c)
    capital = starting_balance if starting_balance > 0 else max(abs(pnl).sum(), 1.0)
    st = streaks(c)

    hold = None
    if "entry_time" in c and "exit_time" in c:
        h = (pd.to_datetime(c["exit_time"]) - pd.to_datetime(c["entry_time"])).dt.total_seconds() / 60
        hold = float(h.mean()) if len(h) else None

    net = float(pnl.sum())
    out.update({
        "wins": int(len(wins)), "losses": int(len(losses)), "scratches": scratches,
        "win_rate": wr, "win_rate_ci": wilson_interval(len(wins), decided),
        "net_pnl": net, "gross_pnl": float(c["gross_pnl"].sum()) if "gross_pnl" in c else net,
        "fees": float(c["fees"].sum()) if "fees" in c else 0.0,
        "avg_win": avg_win, "avg_loss": avg_loss, "payoff_ratio": payoff,
        "profit_factor": pf, "expectancy": expectancy, "expectancy_r": avg_r, "avg_r": avg_r,
        "best_trade": float(pnl.max()), "worst_trade": float(pnl.min()),
        "max_drawdown": mdd["amount"], "max_drawdown_pct": mdd["pct"],
        "sharpe": sharpe(daily, capital), "sortino": sortino(daily, capital),
        "longest_win_streak": st["longest_win"], "longest_loss_streak": st["longest_loss"],
        "current_streak": st["current"], "avg_hold_minutes": hold,
        "trading_days": int(len(daily)),
        "avg_daily_pnl": float(daily.mean()) if len(daily) else None,
        "best_day": float(daily.max()) if len(daily) else None,
        "worst_day": float(daily.min()) if len(daily) else None,
        "return_pct": (net / starting_balance) if starting_balance > 0 else None,
    })
    return out


_R_BUCKETS = [
    ("≤−2R", -math.inf, -1.75),
    ("−1.5R", -1.75, -1.25),
    ("−1R", -1.25, -0.75),
    ("−0.5R", -0.75, -0.15),
    ("0R", -0.15, 0.25),
    ("+0.5R", 0.25, 0.75),
    ("+1R", 0.75, 1.5),
    ("+2R", 1.5, 2.5),
    ("+3R+", 2.5, math.inf),
]


def return_distribution(df: pd.DataFrame) -> dict:
    """Bucket closed trade returns (R-multiple preferred, else P&L) for distribution chart."""
    c = closed(df)
    labels = [label for label, _, _ in _R_BUCKETS]
    if c.empty:
        return {"unit": "R", "buckets": [{"label": lb, "count": 0} for lb in labels], "mean": None, "total": 0}

    r_vals = c["r_multiple"].dropna().astype(float) if "r_multiple" in c else pd.Series(dtype=float)
    if len(r_vals) > 0:
        counts = [0] * len(_R_BUCKETS)
        for val in r_vals:
            for idx, (_, low, high) in enumerate(_R_BUCKETS):
                if low <= val < high or (idx == len(_R_BUCKETS) - 1 and val >= low):
                    counts[idx] += 1
                    break
        return {
            "unit": "R",
            "buckets": [{"label": lb, "count": cnt} for lb, cnt in zip(labels, counts)],
            "mean": float(r_vals.mean()),
            "total": int(len(r_vals)),
        }

    pnl = c["net_pnl"].astype(float)
    scale = float(pnl.abs().median()) or 100.0
    norm = pnl / scale
    counts = [0] * len(_R_BUCKETS)
    for val in norm:
        for idx, (_, low, high) in enumerate(_R_BUCKETS):
            if low <= val < high or (idx == len(_R_BUCKETS) - 1 and val >= low):
                counts[idx] += 1
                break
    return {
        "unit": "relative",
        "buckets": [{"label": lb.replace("R", "×"), "count": cnt} for lb, cnt in zip(labels, counts)],
        "mean": float(norm.mean()),
        "total": int(len(pnl)),
    }


# --------------------------------------------------------------------------
# Breakdowns
# --------------------------------------------------------------------------
_BREAKDOWN_COLS = ["trades", "win_rate", "net_pnl", "expectancy", "avg_r", "profit_factor"]


def breakdown(df: pd.DataFrame, by: str | list[str]) -> pd.DataFrame:
    """Stats per group. `by` can be a column name or a list of column names."""
    c = closed(df)
    if c.empty:
        return pd.DataFrame(columns=([by] if isinstance(by, str) else by) + _BREAKDOWN_COLS)
    rows = []
    for key, g in c.groupby(by, dropna=False):
        s = summary_stats(g)
        keyd = dict(zip([by] if isinstance(by, str) else by,
                        key if isinstance(key, tuple) else (key,)))
        rows.append({**keyd, "trades": s["trades"], "win_rate": s["win_rate"],
                     "net_pnl": s["net_pnl"], "expectancy": s["expectancy"],
                     "avg_r": s["avg_r"], "profit_factor": s["profit_factor"],
                     "small_sample": s["small_sample"]})
    return pd.DataFrame(rows).sort_values("net_pnl", ascending=False).reset_index(drop=True)


def add_time_features(df: pd.DataFrame, tz: str = "UTC",
                      time_col: str = "entry_time") -> pd.DataFrame:
    """Add hour, weekday, hold_minutes, hold_bucket columns (in the given timezone)."""
    df = df.copy()
    if df.empty:
        return df
    t = pd.to_datetime(df[time_col])
    if t.dt.tz is None:
        t = t.dt.tz_localize("UTC")
    t = t.dt.tz_convert(tz)
    df["hour"] = t.dt.hour
    df["weekday"] = t.dt.day_name()
    df["date"] = t.dt.date
    if "exit_time" in df:
        mins = (pd.to_datetime(df["exit_time"]) - pd.to_datetime(df["entry_time"])).dt.total_seconds() / 60
        df["hold_minutes"] = mins
        df["hold_bucket"] = pd.cut(
            mins, bins=[-1, 5, 15, 30, 60, 240, 1440, 1e9],
            labels=["<5m", "5–15m", "15–30m", "30–60m", "1–4h", "4h–1d", ">1d"])
    return df


def hour_weekday_heatmap(df: pd.DataFrame, tz: str = "UTC",
                         value: str = "expectancy") -> pd.DataFrame:
    """Pivot: rows = weekday, cols = hour, cells = expectancy (or net_pnl / trades)."""
    c = add_time_features(closed(df), tz)
    if c.empty:
        return pd.DataFrame()
    agg = {"expectancy": "mean", "net_pnl": "sum", "trades": "size"}[value]
    src = c["net_pnl"] if value != "trades" else c["net_pnl"]
    p = c.assign(_v=src).pivot_table(index="weekday", columns="hour", values="_v", aggfunc=agg)
    order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    return p.reindex([d for d in order if d in p.index])


def rolling_expectancy(df: pd.DataFrame, window: int = 20,
                       time_col: str = "exit_time", use_r: bool = True) -> pd.DataFrame:
    """Rolling mean of R (or $) over the last `window` trades — shows an edge going cold."""
    c = closed(df).sort_values(time_col)
    if c.empty:
        return pd.DataFrame(columns=["time", "rolling"])
    col = "r_multiple" if (use_r and "r_multiple" in c) else "net_pnl"
    series = c[col].astype(float)
    return pd.DataFrame({"time": c[time_col].values,
                         "rolling": series.rolling(window, min_periods=max(3, window // 2)).mean().values})


# --------------------------------------------------------------------------
# Mistakes and rule adherence
# --------------------------------------------------------------------------
def pnl_by_tag(df: pd.DataFrame, col: str = "mistake_tags") -> pd.DataFrame:
    """One row per tag: how many trades carry it and their combined net P&L."""
    c = closed(df)
    if c.empty or col not in c:
        return pd.DataFrame(columns=["tag", "trades", "net_pnl", "avg_pnl", "win_rate"])
    ex = c[[col, "net_pnl"]].explode(col).dropna(subset=[col])
    if ex.empty:
        return pd.DataFrame(columns=["tag", "trades", "net_pnl", "avg_pnl", "win_rate"])
    g = ex.groupby(col)["net_pnl"]
    out = pd.DataFrame({"trades": g.size(), "net_pnl": g.sum(), "avg_pnl": g.mean(),
                        "win_rate": g.apply(lambda s: (s > 0).sum() / max((s != 0).sum(), 1))})
    return out.reset_index().rename(columns={col: "tag"}).sort_values("net_pnl")


def what_if_without_tag(df: pd.DataFrame, tag: str, col: str = "mistake_tags",
                        starting_balance: float = 0.0) -> dict:
    """Stats with and without the trades carrying `tag`."""
    c = closed(df)
    has = c[col].apply(lambda tags: tag in (tags or [])) if col in c else pd.Series(False, index=c.index)
    return {"with": summary_stats(c, starting_balance),
            "without": summary_stats(c[~has], starting_balance),
            "removed_trades": int(has.sum()),
            "removed_pnl": float(c.loc[has, "net_pnl"].sum()) if has.any() else 0.0}


def rule_adherence(df: pd.DataFrame) -> pd.DataFrame:
    """Compare trades where rules_followed is True vs False."""
    c = closed(df)
    if c.empty or "rules_followed" not in c:
        return pd.DataFrame()
    rows = []
    for label, mask in (("followed", c["rules_followed"] == True),      # noqa: E712
                        ("broke", c["rules_followed"] == False),        # noqa: E712
                        ("unknown", c["rules_followed"].isna())):
        s = summary_stats(c[mask])
        rows.append({"rules": label, "trades": s["trades"], "win_rate": s["win_rate"],
                     "expectancy": s["expectancy"], "avg_r": s["avg_r"], "net_pnl": s["net_pnl"]})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------
DEFAULT_SESSIONS = {
    # label: (start, end) in the configured timezone, half-open [start, end)
    "Asia":          (time(0, 0),  time(7, 0)),
    "London":        (time(7, 0),  time(12, 0)),
    "NY AM":         (time(12, 0), time(16, 0)),
    "NY PM":         (time(16, 0), time(21, 0)),
    "After hours":   (time(21, 0), time(23, 59, 59)),
}


def session_of(ts: datetime | pd.Timestamp, tz: str = "UTC",
               sessions: dict | None = None) -> str:
    sessions = sessions or DEFAULT_SESSIONS
    t = pd.Timestamp(ts)
    if t.tz is None:
        t = t.tz_localize("UTC")
    local = t.tz_convert(tz).time()
    for label, (s, e) in sessions.items():
        if s <= local < e:
            return label
    return "Other"


def assign_sessions(df: pd.DataFrame, tz: str = "UTC",
                    sessions: dict | None = None) -> pd.DataFrame:
    df = df.copy()
    if df.empty:
        return df
    df["session"] = [session_of(t, tz, sessions) for t in df["entry_time"]]
    return df
