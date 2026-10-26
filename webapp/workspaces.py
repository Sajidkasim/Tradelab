"""Workspace-scoped reads and cache invalidation, independent of Streamlit reruns."""
from dataclasses import asdict
from datetime import datetime, date
from enum import Enum
import math
from threading import RLock
from time import monotonic

import numpy as np
import pandas as pd

from core import charts, edge, metrics
from core.db import Database
from core.models import Account, LIVE_SOURCES, BACKTEST_SOURCES
from services import trade_labels

SCOPES = {"Backtesting": BACKTEST_SOURCES, "Forward testing": LIVE_SOURCES,
          "All": LIVE_SOURCES + BACKTEST_SOURCES}


def clean(value):
    """JSON-safe values; unavailable numbers remain null, never invented zeroes."""
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [clean(v) for v in value]
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date, pd.Timestamp)):
        if pd.isna(value):
            return None
        stamp = pd.Timestamp(value)
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("UTC")
        return stamp.isoformat()
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if value is pd.NA or value is pd.NaT:
        return None
    return value


def records(frame):
    return clean(frame.to_dict("records"))


def serialise_trade(trade):
    row = asdict(trade)
    row.pop("screenshot_path", None)
    row["labels"] = edge.read_labels(trade.tags)
    row["needs_tagging"] = not trade.setup_name.strip() or not row["labels"]["reviewed"]
    return clean(row)


class Workspaces:
    def __init__(self, config):
        self.root = Database(config.database)
        self.root.init()
        if not self.root.accounts():
            self.root.upsert_account(Account("My account", 50000, 1000, 2000))
        self.databases = {"owner": self.root}
        self.frames = {}
        self.lock = RLock()

    def database(self, key):
        # This app can open only the owner's original tables. Existing teammate
        # schemas are preserved but cannot be selected by any request or cookie.
        if key != 'owner':
            raise PermissionError('This is a personal journal.')
        with self.lock:
            return self.root

    def trades(self, key):
        with self.lock:
            cached = self.frames.get(key)
            if cached is None or monotonic() - cached[0] > 5:
                frame = self.database(key).trades_df(sources=SCOPES["All"])
                self.frames[key] = (monotonic(), frame)
            return self.frames[key][1].copy(deep=True)

    def bump(self, key):
        """The web equivalent of state.bump(): call after every workspace write."""
        with self.lock:
            self.frames.pop(key, None)

    def close(self):
        for db in self.databases.values():
            db.engine.dispose()

    def metadata(self, key):
        db = self.database(key)
        frame = self.trades(key)
        book = edge.playbook(db.get_setting(edge.PLAYBOOK_KEY))
        used = sorted(set(frame["setup_name"].dropna()) - {""}) if not frame.empty else []
        return clean({"accounts": [asdict(a) for a in db.accounts()],
                      "instruments": {k: asdict(v) for k, v in db.instruments().items()},
                      "playbook": book, "strategies": list(dict.fromkeys(book["strategies"] + [s.name for s in db.setups()] + used)),
                      "timeframes": edge.TIMEFRAMES, "confirmations": edge.CONFIRMATIONS,
                      "news": edge.NEWS, "conditions": edge.CONDITIONS,
                      "windows": list(edge.NY_WINDOWS), "palette": charts.PALETTE,
                      "tag_mappings": db.get_setting(trade_labels.MAPPING_KEY, {})})

    def results(self, key, filters):
        frame = self.trades(key)
        # All can browse both histories, but a results sample is always singular.
        scope = filters.sample if filters.scope == "All" else filters.scope
        base = frame[frame["source"].isin(SCOPES[scope])].copy()
        if filters.account_id is not None:
            base = base[base["account_id"] == filters.account_id]
        for name, bound, after in (("start", filters.start, True), ("end", filters.end, False)):
            if bound:
                stamp = pd.Timestamp(bound).tz_localize("America/New_York").tz_convert("UTC").tz_localize(None)
                times = pd.to_datetime(base["entry_time"], utc=True).dt.tz_localize(None)
                base = base[times >= stamp] if after else base[times < stamp + pd.Timedelta(days=1)]
        base = edge.prepare(base)
        if not base.empty:
            base["setup_name"] = base["setup_name"].fillna("").replace("", "Unclassified")
        query = {name: getattr(filters, name) for name in ("strategy", "direction", "level", "timeframe", "entry_timeframe", "confirmations", "news", "condition", "window", "symbol")}
        matched = edge.select(base, **query)
        stats = metrics.summary_stats(matched)
        closed = metrics.closed(matched)
        equity = metrics.equity_curve(matched)
        if not equity.empty:
            # Display wall clocks in the same New York zone as the trade journal.
            equity['time'] = pd.to_datetime(equity['time'], utc=True).dt.tz_convert('America/New_York').dt.tz_localize(None)
        chart = charts.equity_chart(equity, filters.mode, title="") if stats["trades"] else None
        import json
        response = {"stats": clean(stats), "sample": scope, "collection_count": len(metrics.closed(base)),
                    "r_count": int(closed["r_multiple"].notna().sum()) if not closed.empty else 0,
                    "chart": json.loads(chart.to_json()) if chart else None}
        if filters.detail:
            response["breakdown"] = records(metrics.breakdown(matched, filters.comparison))
        return response
