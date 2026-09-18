"""Session state, cached data access and the global filter sidebar. One place, every page."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

import hashlib

import pandas as pd
import streamlit as st

from core.db import Database
from core.models import Account, BACKTEST_SOURCES, DEMO_SOURCES, LIVE_SOURCES

DEFAULT_TZ = "Europe/London"
SCOPES = {"Live": LIVE_SOURCES, "Backtests": BACKTEST_SOURCES, "Demo": DEMO_SOURCES,
          "All": LIVE_SOURCES + BACKTEST_SOURCES}
SOURCE_LABELS = {"Backtests": "Backtesting", "Live": "Forward testing", "All": "All"}
PRESETS = ["All time", "Today", "This week", "Last 7 days", "Last 30 days", "Last 90 days", "Year to date", "Custom"]


def get_db() -> Database:
    from ui.access import current_database
    return current_database()


def version() -> int:
    return int(st.session_state.get("data_version", 0))


def bump() -> None:
    st.session_state["data_version"] = version() + 1
    load_trades.clear()


@st.cache_data(show_spinner=False)
def load_trades(workspace_key: str, data_version: int, _db) -> pd.DataFrame:
    return _db.trades_df()


def trades() -> pd.DataFrame:
    db = get_db()
    key = hashlib.sha256(f"{db.url}|{getattr(db, 'schema', '')}".encode()).hexdigest()
    return load_trades(key, version(), db)


def tz() -> str:
    return st.session_state.get("tz") or get_db().get_setting("tz", DEFAULT_TZ)


def account() -> Account:
    accts = get_db().accounts()
    wanted = st.session_state.get("filters", {}).get("account_id")
    for a in accts:
        if a.id == wanted:
            return a
    return accts[0]


def _default_filters() -> dict:
    return {"scope": "Backtests", "preset": "All time", "start": None, "end": None, "account_id": None,
            "symbols": [], "setups": [], "direction": "Both", "sessions": [], "tags": []}


def filters() -> dict:
    if "filters" not in st.session_state:
        f = _default_filters()
        # first visit: land on the first scope that actually has trades (Live, else Demo, else Backtests)
        df = trades()
        if not df.empty:
            present = set(df["source"].unique())
            for name in ("Backtests", "Live"):
                if present & set(SCOPES[name]):
                    f["scope"] = name
                    break
        st.session_state["filters"] = f
    return st.session_state["filters"]


def _preset_range(preset: str, today: date) -> tuple[Optional[date], Optional[date]]:
    if preset == "Today":
        return today, today
    if preset == "This week":
        return today - timedelta(days=today.weekday()), today
    if preset == "Last 7 days":
        return today - timedelta(days=6), today
    if preset == "Last 30 days":
        return today - timedelta(days=29), today
    if preset == "Last 90 days":
        return today - timedelta(days=89), today
    if preset == "Year to date":
        return date(today.year, 1, 1), today
    return None, None


def sidebar(df_all: pd.DataFrame) -> None:
    """Render the global filter controls. Call once per page, inside `with st.sidebar:`."""
    f = filters()
    db = get_db()
    st.caption("Filters apply to every page")

    if f["scope"] not in SOURCE_LABELS:
        f["scope"] = "All"

    f["scope"] = st.radio("Data source", list(SOURCE_LABELS), index=list(SOURCE_LABELS).index(f["scope"]),
                          format_func=SOURCE_LABELS.get, help="All shows both histories. Results stay separated by testing type.")
    scoped = df_all[df_all["source"].isin(SCOPES[f["scope"]])] if not df_all.empty else df_all

    f["preset"] = st.selectbox("Period", PRESETS, index=PRESETS.index(f["preset"]))
    local_today = pd.Timestamp.now(tz=tz()).date()
    if f["preset"] == "Custom":
        c1, c2 = st.columns(2)
        f["start"] = c1.date_input("From", value=f["start"] or (local_today - timedelta(days=30)))
        f["end"] = c2.date_input("To", value=f["end"] or local_today)
    else:
        f["start"], f["end"] = _preset_range(f["preset"], local_today)

    accts = db.accounts()
    names = {a.id: a.name for a in accts}
    opts = [None] + list(names)
    f["account_id"] = st.selectbox("Account", opts, index=opts.index(f["account_id"]) if f["account_id"] in opts else 0,
                                   format_func=lambda i: "All accounts" if i is None else names[i])

    syms = sorted(scoped["symbol"].dropna().unique()) if not scoped.empty else []
    f["symbols"] = st.multiselect("Symbols", syms, default=[s for s in f["symbols"] if s in syms])
    setups = sorted(s for s in scoped["setup_name"].dropna().unique() if s) if not scoped.empty else []
    f["setups"] = st.multiselect("Models / setups", setups, default=[s for s in f["setups"] if s in setups])
    f["direction"] = st.radio("Direction", ["Both", "Long", "Short"], index=["Both", "Long", "Short"].index(f["direction"]),
                              horizontal=True)
    sessions = sorted(s for s in scoped["session"].dropna().unique() if s) if not scoped.empty else []
    if sessions:
        f["sessions"] = st.multiselect("Sessions", sessions, default=[s for s in f["sessions"] if s in sessions])
    all_tags = sorted({t for lst in scoped["tags"] for t in (lst or [])}) if not scoped.empty else []
    if all_tags:
        f["tags"] = st.multiselect("Tags", all_tags, default=[t for t in f["tags"] if t in all_tags])

    if st.button("Reset filters", use_container_width=True):
        st.session_state["filters"] = _default_filters()
        st.rerun()

    n = len(apply_filters(df_all))
    kind = "sqlite" if db.is_sqlite else "postgres"
    st.markdown(f'<div class="tl-foot">{n} trades in view · {db.count_trades()} stored · {kind}<br>'
                f'Times shown in {tz()}</div>', unsafe_allow_html=True)


def apply_filters(df_all: pd.DataFrame) -> pd.DataFrame:
    f = filters()
    if df_all is None or df_all.empty:
        return df_all
    d = df_all[df_all["source"].isin(SCOPES[f["scope"]])]
    if f.get("account_id") is not None:
        d = d[d["account_id"] == f["account_id"]]
    if f.get("start") or f.get("end"):
        local = pd.to_datetime(d["entry_time"]).dt.tz_localize("UTC").dt.tz_convert(tz()).dt.date
        if f.get("start"):
            d = d[local >= f["start"]]
            local = local[local.index.isin(d.index)]
        if f.get("end"):
            d = d[local <= f["end"]]
    if f.get("symbols"):
        d = d[d["symbol"].isin(f["symbols"])]
    if f.get("setups"):
        d = d[d["setup_name"].isin(f["setups"])]
    if f.get("direction") and f["direction"] != "Both":
        d = d[d["direction"] == f["direction"].lower()]
    if f.get("sessions"):
        d = d[d["session"].isin(f["sessions"])]
    if f.get("tags"):
        want = set(f["tags"])
        d = d[d["tags"].apply(lambda lst: bool(want & set(lst or [])))]
    return d


def page_setup(title: str, sidebar_renderer=None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Standard page prologue: CSS, sidebar filters. Returns (all_trades, filtered_trades)."""
    from ui.style import inject_css
    from ui.components import workspace_guide
    from ui import access
    access.require_login()
    inject_css()
    df_all = trades()
    with st.sidebar:
        access.sidebar()
        (sidebar_renderer or sidebar)(df_all)
        workspace_guide()
    filtered = apply_filters(df_all)
    needs_results = title not in {"Import", "Settings", "Trade Journal", "Team", "Risk"}
    if title == "Test & Log" and st.session_state.get("edge_lane", "Explore my edge") != "Explore my edge":
        needs_results = False
    if needs_results and filters()["scope"] == "All":
        filtered = statistics_sample(filtered)
    return df_all, filtered


def local_today() -> date:
    return pd.Timestamp.now(tz=tz()).date()


def today_slice(df: pd.DataFrame) -> pd.DataFrame:
    """Trades closed today in the configured timezone (for the daily limit tracker)."""
    if df is None or df.empty:
        return df
    closed = df[df["exit_time"].notna()]
    if closed.empty:
        return closed
    local = pd.to_datetime(closed["exit_time"]).dt.tz_localize("UTC").dt.tz_convert(tz()).dt.date
    return closed[local == local_today()]


def risk_df(df_all: pd.DataFrame) -> pd.DataFrame:
    """Trades the risk trackers should use: the scope being viewed when it is real-money-like
    (Live or Demo); otherwise Live. Backtests never drive the limit trackers."""
    if df_all is None or df_all.empty:
        return df_all
    scope = filters()["scope"]
    src = SCOPES[scope] if scope in ("Live", "Demo") else SCOPES["Live"]
    d = df_all[df_all["source"].isin(src)]
    acc = filters().get("account_id")
    return d[d["account_id"] == acc] if acc is not None else d


DEFAULT_SESSIONS = [{"label": "London", "start": "08:00", "end": "13:00"}, {"label": "NY open", "start": "14:30", "end": "16:00"},
                    {"label": "Midday", "start": "16:00", "end": "19:00"}, {"label": "Power hour", "start": "19:00", "end": "21:00"}]


def sessions_parsed() -> dict:
    """{label: (start_time, end_time)} from settings, else the defaults."""
    from datetime import time as _time
    rows = get_db().get_setting("sessions", DEFAULT_SESSIONS)
    out = {}
    for r in rows:
        try:
            out[r["label"]] = (_time.fromisoformat(str(r["start"])), _time.fromisoformat(str(r["end"])))
        except (KeyError, ValueError):
            continue
    return out


def statistics_sample(df):
    """All is a browsing scope, never a pooled statistical sample."""
    if filters()["scope"] != "All":
        return df
    scope = st.radio("Results sample", ["Backtests", "Live"], format_func=SOURCE_LABELS.get,
                     horizontal=True, key="results_source")
    st.caption("Browsing all trades. These results show only the selected testing type.")
    return df[df["source"].isin(SCOPES[scope])].copy() if not df.empty else df
