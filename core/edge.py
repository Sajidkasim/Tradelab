"""Playbook labels, exact-combination filtering and trade-entry validation.

Statistical answers are delegated to metrics. Structured labels live in the
existing tags field so imports, backups and the journal share one trade format.
"""
from __future__ import annotations

from datetime import time
import json
import math

import pandas as pd

from . import importers, metrics
from .models import Source, Trade

PREFIX = "edge:"
UNKNOWN = "Not recorded"
# Default playbook lists. Strategies and key levels can be edited by the user (see playbook()).
LEVELS = ["FVG", "IFVG", "Order block", "Previous day high / low", "Previous week high / low",
          "Previous month high / low", "NWOG", "RTH gap", "Daily / 4H wick", "Range midpoint",
          "0.62 retracement", "Pivot level"]
TIMEFRAMES = ["Weekly", "Daily", "4H", "1H", "15m", "5m", "1m", "15s"]
CONFIRMATIONS = ["SMT", "CISD", "MSS", "FVG", "IFVG", "Displacement", "Liquidity sweep", "Second sweep"]
STRATEGIES = ["Turtle Soup", "Displacement continuation", "Range reversal", "AMD", "MMXM"]
CONDITIONS = ["Trending", "Range-bound", "Unclear"]
NEWS = ["Major news", "No major news"]
# Single-valued labels stored as edge:<key>:<value>. "timeframe" is the key level's timeframe;
# "entry_timeframe" is the chart the entry was taken on.
LABEL_KEYS = ("level", "timeframe", "entry_timeframe", "condition", "news")
PLAYBOOK_KEY = "edge_playbook"
PLAYBOOK_DEFAULTS = {"strategies": STRATEGIES, "levels": LEVELS}


def playbook(stored=None) -> dict[str, list[str]]:
    """The user's editable lists (strategies, key levels), read from the saved setting.

    Pure: pass in db.get_setting(PLAYBOOK_KEY). A list the user saved is used exactly as saved,
    trimmed and de-duplicated, even when emptied; anything missing or malformed falls back to the
    defaults. Always returns copies, so callers can never mutate the module defaults.
    """
    lists = {key: list(values) for key, values in PLAYBOOK_DEFAULTS.items()}
    if isinstance(stored, dict):
        for key in lists:
            values = stored.get(key)
            if isinstance(values, (list, tuple)):
                cleaned: list[str] = []
                for value in values:
                    if value is None or (isinstance(value, float) and math.isnan(value)):
                        continue
                    text = str(value).strip()
                    if text and text not in cleaned:
                        cleaned.append(text)
                lists[key] = cleaned
    return lists
NY_WINDOWS = {
    "Pre-open · 08:30–09:30": (time(8, 30), time(9, 30)),
    "Opening drive · 09:30–10:00": (time(9, 30), time(10)),
    "Morning · 10:00–12:00": (time(10), time(12)),
    "Lunch · 12:00–13:00": (time(12), time(13)),
    "Afternoon · 13:00–16:00": (time(13), time(16)),
}


def tag_list(value) -> list[str]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            parsed = value.split(",")
        value = parsed
    return [str(x).strip() for x in value if str(x).strip()] if isinstance(value, (list, tuple)) else []


def read_labels(tags) -> dict:
    labels = {key: UNKNOWN for key in LABEL_KEYS}
    labels.update(confirmations=[], reviewed=False)
    aliases = {x.casefold(): x for x in CONFIRMATIONS}
    for tag in tag_list(tags):
        if tag == "edge:reviewed":
            labels["reviewed"] = True
        elif tag.startswith(PREFIX):
            parts = tag.split(":", 2)
            if len(parts) != 3:
                continue
            _, key, value = parts
            if key == "confirmation":
                labels["confirmations"].append(value)
            elif key in LABEL_KEYS:
                labels[key] = value
        elif tag.casefold() in aliases:
            labels["confirmations"].append(aliases[tag.casefold()])
    labels["confirmations"] = sorted(set(labels["confirmations"]))
    return labels


def write_labels(tags=(), *, level=UNKNOWN, timeframe=UNKNOWN, entry_timeframe=UNKNOWN,
                 condition=UNKNOWN, news=UNKNOWN, confirmations=()) -> list[str]:
    # Preserve unrelated tags; adopt recognised legacy confirmation tags to make
    # unchecking a previously imported confirmation effective.
    aliases = {x.casefold() for x in CONFIRMATIONS}
    kept = [t for t in tag_list(tags) if not t.startswith(PREFIX) and t.casefold() not in aliases]
    for key, value in (("level", level), ("timeframe", timeframe), ("entry_timeframe", entry_timeframe),
                       ("condition", condition), ("news", news)):
        if value and value != UNKNOWN:
            kept.append(f"{PREFIX}{key}:{value}")
    kept.extend(f"{PREFIX}confirmation:{v}" for v in sorted(set(confirmations)))
    return kept + ["edge:reviewed"]


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    """Add descriptive dimensions without changing any trade or statistic."""
    d = df.copy()
    labels = [read_labels(t) for t in d.get("tags", pd.Series([[] for _ in range(len(d))], index=d.index))]
    for key in LABEL_KEYS + ("confirmations", "reviewed"):
        d[f"edge_{key}"] = [row[key] for row in labels]
    d["edge_window"] = [metrics.session_of(t, "America/New_York", NY_WINDOWS)
                        if pd.notna(t) else UNKNOWN for t in d.get("entry_time", [])]
    d["edge_confirmation_set"] = [" + ".join(row["confirmations"]) or
                                    ("None checked" if row["reviewed"] else UNKNOWN) for row in labels]
    return d


def select(df: pd.DataFrame, *, direction="Both", strategy="All strategies", level="Any level",
           timeframe="Any timeframe", entry_timeframe="Any timeframe", confirmations=(),
           news="Any news status", condition="Any condition", window="New York",
           symbol="All markets") -> pd.DataFrame:
    d = df.copy()
    if d.empty:
        return d
    for col, value, unrestricted in (("direction", direction, "Both"), ("setup_name", strategy, "All strategies"),
                                     ("edge_level", level, "Any level"), ("edge_timeframe", timeframe, "Any timeframe"),
                                     ("edge_entry_timeframe", entry_timeframe, "Any timeframe"),
                                     ("edge_news", news, "Any news status"), ("edge_condition", condition, "Any condition"),
                                     ("symbol", symbol, "All markets")):
        if value != unrestricted:
            d = d[d[col] == value]
    if window == "New York":
        d = d[d["edge_window"].isin(NY_WINDOWS)]
    elif window != "All sessions":
        d = d[d["edge_window"] == window]
    if confirmations:
        wanted = set(confirmations)
        d = d[d["edge_confirmations"].apply(lambda values: wanted.issubset(set(values)))]
    return d.copy()


def build_trade(*, symbol, direction, account_id, source, strategy, entry_time, exit_time,
                instruments, tags, notes="", net_pnl=None, risk_amount=None,
                entry_price=None, exit_price=None, stop_price=None, target_price=None,
                qty=1, fees=0, rules_followed=None) -> Trade:
    """Validate a closed journal entry, then use the existing import/metric engine."""
    if source not in (Source.BACKTEST, Source.MANUAL):
        raise ValueError("Choose backtesting or forward testing for a manual trade.")
    if symbol not in instruments:
        raise ValueError("Choose an instrument configured in Settings.")
    if direction not in ("long", "short"):
        raise ValueError("Choose Buy or Sell.")
    if not isinstance(strategy, str) or not strategy.strip():
        raise ValueError("Give this trade a strategy name.")
    start, end = pd.Timestamp(entry_time), pd.Timestamp(exit_time)
    if pd.isna(start) or pd.isna(end) or end < start:
        raise ValueError("Exit time must be on or after entry time.")
    raw = {"symbol": symbol, "direction": direction, "entry_time": start.isoformat(),
           "exit_time": end.isoformat(), "setup_name": strategy.strip(), "notes": notes,
           "tags": json.dumps(tag_list(tags)), "rules_followed": rules_followed}
    if net_pnl is not None:
        if not math.isfinite(net_pnl) or risk_amount is None or not math.isfinite(risk_amount) or risk_amount <= 0:
            raise ValueError("Enter a finite net result and the positive dollar risk actually planned for this trade.")
        raw.update(pnl=net_pnl, risk_amount=risk_amount)
    else:
        if any(v is None or not math.isfinite(v) or v <= 0 for v in (entry_price, exit_price, stop_price, qty)):
            raise ValueError("Entry, exit, original stop and quantity must all be greater than zero.")
        if not math.isfinite(fees) or fees < 0:
            raise ValueError("Fees must be zero or positive.")
        if (direction == "long" and stop_price >= entry_price) or (direction == "short" and stop_price <= entry_price):
            raise ValueError("Use the original stop: below entry for a buy, above entry for a sell.")
        if target_price and ((direction == "long" and target_price <= entry_price) or
                             (direction == "short" and target_price >= entry_price)):
            raise ValueError("The planned target must be above a buy entry or below a sell entry.")
        raw.update(entry_price=entry_price, exit_price=exit_price, stop_price=stop_price,
                   target_price=target_price or None, qty=qty, fees=fees)
    trades, errors = importers.normalise(pd.DataFrame([raw]), {k: k for k in raw}, instruments,
                                         source=source, account_id=account_id, dayfirst=False)
    if errors:
        raise ValueError(errors[0]["error"])
    trade = trades[0]
    trade.external_id = f"edge-{account_id}-{trade.external_id}"
    trade.session = metrics.session_of(trade.entry_time, "America/New_York", NY_WINDOWS)
    return trade
