"""Filter logic in ui/state.py, exercised without a running Streamlit server."""
from datetime import date, datetime

import pandas as pd
import streamlit as st

from core.db import Database
from core.demo import seed_demo_trades
from ui import state


def _df():
    db = Database(":memory:"); db.init()
    trades = seed_demo_trades(60, seed=3, start=datetime(2026, 6, 1))
    trades[0].source = trades[0].source.__class__("csv"); trades[0].external_id = "live-1"
    trades[0].tags = ["A+"]
    db.insert_trades(trades)
    return db.trades_df()


def test_scope_and_symbol_and_direction_filters():
    df = _df()
    st.session_state["filters"] = {**state._default_filters(), "scope": "Demo"}
    d = state.apply_filters(df)
    assert set(d["source"]) == {"demo"} and len(d) == 59
    st.session_state["filters"]["symbols"] = ["MES"]; st.session_state["filters"]["direction"] = "Long"
    d = state.apply_filters(df)
    assert set(d["symbol"]) == {"MES"} and set(d["direction"]) == {"long"}
    st.session_state["filters"] = {**state._default_filters(), "scope": "Live"}
    assert len(state.apply_filters(df)) == 1


def test_date_preset_and_tags():
    df = _df()
    st.session_state["filters"] = {**state._default_filters(), "scope": "All", "preset": "Custom",
                                   "start": date(2026, 6, 1), "end": date(2026, 6, 10)}
    d = state.apply_filters(df)
    assert not d.empty and d["entry_time"].max() < pd.Timestamp("2026-06-11")
    st.session_state["filters"] = {**state._default_filters(), "scope": "All", "tags": ["A+"]}
    assert len(state.apply_filters(df)) == 1


def test_first_visit_lands_on_a_scope_with_data():
    # with only demo trades, the default scope should become Demo rather than an empty Live view
    for k in ("filters", "data_version"):
        st.session_state.pop(k, None)
    for p in ("Today", "This week", "Last 7 days", "Last 30 days", "Last 90 days", "Year to date", "All time"):
        s, e = state._preset_range(p, date(2026, 9, 16))
        assert (s is None) == (p == "All time")
    assert state._preset_range("This week", date(2026, 9, 16)) == (date(2026, 9, 14), date(2026, 9, 16))


def test_bulk_update_trade_sessions_updates_only_target_rows():
    db = Database(":memory:"); db.init()
    trades = seed_demo_trades(5, seed=9, start=datetime(2026, 6, 1))
    db.insert_trades(trades)
    before = db.trades_df().sort_values("id").reset_index(drop=True)
    target_id = int(before.loc[0, "id"])
    untouched_id = int(before.loc[1, "id"])
    updated = db.bulk_update_trade_sessions({target_id: "London"})
    assert updated == 1
    assert db.bulk_update_trade_sessions({}) == 0
    after = db.trades_df().sort_values("id").reset_index(drop=True)
    assert after.loc[after["id"] == target_id, "session"].iloc[0] == "London"
    assert after.loc[after["id"] == untouched_id, "session"].iloc[0] == before.loc[1, "session"]
    assert after["net_pnl"].tolist() == before["net_pnl"].tolist()
    assert after["r_multiple"].tolist() == before["r_multiple"].tolist()
