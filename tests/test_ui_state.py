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


def test_settings_prefix_escapes_underscores_and_targeted_trade_lookups():
    db = Database(":memory:"); db.init()
    db.set_setting("primus_daily:1", {"ok": True})
    db.set_setting("primusXdaily:1", {"ok": False})
    assert list(db.settings_with_prefix("primus_daily:")) == ["primus_daily:1"]
    assert dict(db.iter_settings_for_keys(["primus_daily:1", "missing"])) == {"primus_daily:1": {"ok": True}}
    trades = seed_demo_trades(3, seed=5, start=datetime(2026, 6, 1))
    trades[0].external_id = "ext-lookup-1"
    trades[1].tags = ["lab:journal:2026-06-02:abc"]
    assert db.insert_trades(trades) == {"inserted": 3, "skipped": 0}
    assert db.insert_trades([trades[0]]) == {"inserted": 0, "skipped": 1}
    found = db.get_trade_by_external_id("ext-lookup-1")
    assert found is not None and found.external_id == "ext-lookup-1"
    by_id = db.get_trades_by_ids([found.id, 999999])
    assert list(by_id) == [found.id]
    tagged_id = db.find_trade_id_by_tag("lab:journal:2026-06-02:abc")
    assert tagged_id is not None and tagged_id != found.id
