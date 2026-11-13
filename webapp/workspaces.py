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
from services import trade_labels, fixed_rr, weekdays, strategy_catalog, research, review, tag_cleanup
from . import custom_trade_fields, lab_settings, import_updates, journal_preferences, release_notes

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
    row["custom_fields"] = custom_trade_fields.values(trade.tags, trade.custom_metadata)
    row.update(fixed_rr.read(trade.tags))
    row["needs_tagging"] = not trade.setup_name.strip() or not row["labels"]["reviewed"]
    row['study_id'] = research.test_id(trade.tags)
    row.update(review.missing(row))
    return clean(row)


class Workspaces:
    def __init__(self, config):
        self.google = None
        self.root = Database(config.database)
        self.root.init()
        if not self.root.accounts():
            self.root.upsert_account(Account("My account", 50000, 1000, 2000))
        self.databases = {"owner": self.root}
        self.frames = {}
        self.lock = RLock()  # Shared team data only.
        self._registry_lock = RLock()
        self._workspace_locks = {}
        if config.google_required:
            from .google_access import GoogleAccess, harden_tables
            from core.db import metadata as trading_metadata
            harden_tables(self.root, trading_metadata.sorted_tables)
            self.google = GoogleAccess(self.root, config)

    def workspace_lock(self, key):
        with self._registry_lock:
            if key not in self._workspace_locks:
                self._workspace_locks[key] = RLock()
            return self._workspace_locks[key]

    def database(self, key):
        if self.google and not self.google.registered(key):
            raise PermissionError('Sign in to your own journal.')
        if not self.google and key != 'owner':
            raise PermissionError('This is a personal journal.')
        with self.workspace_lock(key):
            if key not in self.databases:
                from services.team import MemberDatabase
                from core.db import metadata as trading_metadata
                from .google_access import harden_tables
                database = MemberDatabase(self.root, key)
                database.init()
                harden_tables(database, trading_metadata.sorted_tables)
                if not database.accounts():
                    journal_preferences.fresh(database)
                    database.upsert_account(Account('My account', 50000, 1000, 2000))
                self.databases[key] = database
            return self.databases[key]

    def trades(self, key):
        with self.workspace_lock(key):
            with self._registry_lock:
                cached = self.frames.get(key)
            if cached is None or monotonic() - cached[0] > 5:
                frame = self.database(key).trades_df(sources=SCOPES["All"])
                cached = (monotonic(), frame)
                with self._registry_lock:
                    if key not in self.frames and len(self.frames) >= 32:
                        self.frames.pop(next(iter(self.frames)))
                    self.frames[key] = cached
            return cached[1].copy(deep=True)

    def bump(self, key):
        """Invalidate cached results after writes."""
        with self.workspace_lock(key), self._registry_lock:
            self.frames.pop(key, None)

    def close(self):
        if self.google:
            self.google.close()
        for db in self.databases.values():
            db.engine.dispose()

    def archived_choices(self, key, frame=None):
        database = self.database(key)
        frame = self.trades(key) if frame is None else frame
        archived = {**strategy_catalog.archived(database, frame), **lab_settings.archived(database, frame)}
        dismissed = database.get_setting(lab_settings.DISMISSED_ARCHIVES_KEY, {})
        return {field: [name for name in names if name not in dismissed.get(field, [])]
                for field, names in archived.items()}

    def metadata(self, key):
        from services import import_tag_catalog
        db = self.database(key)
        frame = self.trades(key)
        lab = lab_settings.read(db)
        mappings = db.get_setting(trade_labels.MAPPING_KEY, {})
        lab.update(lab_settings.choices(db, frame, mappings))
        book = strategy_catalog.read(db, frame, mappings)
        aliases = db.get_setting(tag_cleanup.KEY, {})
        for field, name in tag_cleanup.LIST_FIELDS.items():
            target = book if name in book else lab
            if name in target:
                target[name] = tag_cleanup.names(target[name], field, aliases)
        labels = [edge.read_labels(tags) for tags in frame['tags']]
        result_options = {field: list(dict.fromkeys(label[field] for label in labels if label.get(field)))
                          for field in ('news', 'condition')}
        result_options['symbols'] = sorted(frame['symbol'].dropna().unique())
        result_options['target_rrs'] = list(dict.fromkeys(
            value for tags in frame['tags'] if (value := fixed_rr.read(tags)['target_rr']) != edge.UNKNOWN))
        return clean({"custom_trade_fields": custom_trade_fields.definitions(db), "trade_count": len(frame), "result_options": result_options, "release_notes": release_notes.read(db), "journal_preferences": journal_preferences.read(db), "accounts": [asdict(a) for a in db.accounts()],
                      "instruments": {k: asdict(v) for k, v in db.instruments().items()},
                      "playbook": book, "strategies": book['strategies'],
                      "archived_choices": self.archived_choices(key, frame),
                      "timeframes": list(dict.fromkeys(lab['level_timeframes'] + lab['entry_timeframes'])),
                      "level_timeframes": lab['level_timeframes'], "entry_timeframes": lab['entry_timeframes'],
                      "confirmations": lab['confirmations'],
                      "news": lab["news"], "conditions": lab["conditions"],
                      "weekdays": list(weekdays.DAYS[:5]),
                      "windows": [item["name"] for item in lab["sessions"]], "lab_settings": lab, "palette": charts.PALETTE,
                      "import_profile": db.get_setting(import_updates.PROFILE_KEY, {}),
                      "tag_mappings": mappings,
                      "automatic_tags": import_tag_catalog.for_database(db, frame).automatic,
                      "target_rrs": sorted({fixed_rr.ratio(value)[0] for value in trade_labels.mapped_values(mappings, 'target_rr')}),
                      "tag_suggestions": ([] if journal_preferences.read(db)['personal_setup'] else tag_cleanup.mapping_values(trade_labels.fx_tag_guide(), aliases)),
                      **research.catalogue(db, frame)})

    def results(self, key, filters):
        frame = self.trades(key)
        # The owner explicitly requested a combined laboratory history. Older
        # clients retain their separate samples unless they opt into combined All.
        scope = ("All" if filters.combined else filters.sample) if filters.scope == "All" else filters.scope
        base = frame[frame["source"].isin(SCOPES[scope])].copy()
        if filters.study_id:
            if filters.study_id != 'unassigned':
                research.get_test(self.database(key), filters.study_id)
            wanted = '' if filters.study_id == 'unassigned' else filters.study_id
            base = base[base['tags'].map(research.test_id) == wanted]
        if filters.account_id is not None:
            base = base[base["account_id"] == filters.account_id]
        for name, bound, after in (("start", filters.start, True), ("end", filters.end, False)):
            if bound:
                local_bound = pd.Timestamp(bound) + (pd.Timedelta(days=1) if not after else pd.Timedelta(0))
                stamp = local_bound.tz_localize(journal_preferences.read(self.database(key))["timezone"]).tz_convert("UTC").tz_localize(None)
                times = pd.to_datetime(base["entry_time"], utc=True).dt.tz_localize(None)
                base = base[times >= stamp] if after else base[times < stamp]
        base = edge.prepare(base)
        if not base.empty:
            base["setup_name"] = base["setup_name"].fillna("").replace("", "Unclassified")
        query = {name: getattr(filters, name) for name in ("strategy", "direction", "level", "timeframe", "entry_timeframe", "confirmations", "news", "condition", "window", "symbol")}
        if filters.window != "New York":
            settings = lab_settings.read(self.database(key))
            base["edge_window"] = [lab_settings.session_of(stamp, settings) for stamp in base["entry_time"]]
        matched = edge.select(base, **query)
        if filters.weekday != 'All days':
            zone = lab_settings.read(self.database(key))['timezone']
            days = matched['entry_time'].map(lambda stamp: weekdays.entry_day(stamp, zone))
            matched = matched.loc[days == filters.weekday]
        if filters.target_rr != 'Any RR':
            target = fixed_rr.ratio(filters.target_rr)[0]
            matched = matched[matched['tags'].map(lambda tags: fixed_rr.read(tags)['target_rr'] == target)]
        if filters.custom_fields:
            matched = custom_trade_fields.filter_frame(matched, self.database(key), filters.custom_fields)
        stats = metrics.summary_stats(matched)
        closed = metrics.closed(matched)
        equity = metrics.equity_curve(matched)
        if not equity.empty:
            # Display wall clocks in the selected journal zone.
            equity['time'] = pd.to_datetime(equity['time'], utc=True).dt.tz_convert(journal_preferences.read(self.database(key))['timezone']).dt.tz_localize(None)
        chart = charts.equity_chart(equity, filters.mode, title="") if stats["trades"] else None
        import json
        response = {"stats": clean(stats), "fixed_rr": clean(fixed_rr.summary(matched)), "sample": scope, "collection_count": len(metrics.closed(base)),
                    "r_count": int(closed["r_multiple"].notna().sum()) if not closed.empty else 0,
                    "chart": json.loads(chart.to_json()) if chart else None,
                    "chart_latest": clean({"time": equity["time"].iloc[-1].isoformat(), "equity": equity["equity"].iloc[-1]}) if not equity.empty else None}
        if filters.detail:
            response["breakdown"] = records(metrics.breakdown(matched, filters.comparison))
        return response
