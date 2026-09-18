from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

from core import edge
from core.db import Database
from core.models import Account, Source
from ui import access, state

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def db(monkeypatch):
    value = Database(":memory:"); value.init()
    value.upsert_account(Account("Test account", 50000, 1000, 2000))
    monkeypatch.setattr(state, "get_db", lambda: value)
    monkeypatch.setattr(state, "trades", value.trades_df)
    return value


def test_website_without_login_configuration_never_reads_trades(monkeypatch):
    monkeypatch.setattr(access, "is_local", lambda: False)
    monkeypatch.setattr(access, "auth_configured", lambda: False)
    def forbidden():
        raise AssertionError("Private database read before login")
    monkeypatch.setattr(state, "trades", forbidden)
    app = AppTest.from_file(str(ROOT / "app.py")).run()
    assert not app.exception
    assert any("Google sign-in needs connecting" in item.value for item in app.info)
    assert not app.radio


def test_all_scope_browses_both_but_never_pools_the_results(db):
    for source, pnl in [(Source.BACKTEST, 100), (Source.MANUAL, -50)]:
        db.insert_trades([edge.build_trade(symbol="MNQ", direction="long", source=source,
                           strategy="Turtle Soup", account_id=db.accounts()[0].id,
                           entry_time="2026-09-01T13:35:00Z", exit_time="2026-09-01T13:40:00Z",
                           instruments=db.instruments(), tags=[], net_pnl=pnl, risk_amount=50)])
    app = AppTest.from_file(str(ROOT / "app.py"), default_timeout=20).run()
    app.radio(key="edge_scope").set_value("All").run()
    assert not app.exception
    assert any("100.0%" in item.value for item in app.markdown)
    app.radio(key="results_source").set_value("Live").run()
    assert not app.exception
    assert not any("100.0%" in item.value for item in app.markdown)
    assert any("0.0%" in item.value for item in app.markdown)
    app.session_state["edge_lane"] = "Import & review"
    app.run()
    assert not app.exception
    assert len(app.selectbox(key="edge_review_trade").options) == 2


def test_import_home_has_one_uploader_and_no_tabs_or_broker_calls(db, monkeypatch):
    from core.projectx_api import ProjectXClient
    def forbidden():
        raise AssertionError("Broker contacted while displaying file upload")
    monkeypatch.setattr(ProjectXClient, "from_env", forbidden)
    app = AppTest.from_file(str(ROOT / "app.py"), default_timeout=20).run()
    app.switch_page("views/import_.py").run()
    assert not app.exception
    assert not app.tabs
    assert len(app.get("file_uploader")) == 1


def test_trade_cache_is_partitioned_by_workspace(monkeypatch, tmp_path):
    databases = []
    for name, pnl in [("alice", 100), ("bob", -50)]:
        db = Database(tmp_path / f"{name}.db"); db.init()
        db.upsert_account(Account(name, 50000, 1000, 2000))
        db.insert_trades([edge.build_trade(symbol="MNQ", direction="long", source=Source.BACKTEST,
                            strategy=name, account_id=db.accounts()[0].id,
                            entry_time="2026-09-01T13:35:00Z", exit_time="2026-09-01T13:40:00Z",
                            instruments=db.instruments(), tags=[], net_pnl=pnl, risk_amount=50)])
        databases.append(db)
    state.load_trades.clear()
    for db, expected in zip(databases + databases[:1], [100, -50, 100]):
        monkeypatch.setattr(state, "get_db", lambda db=db: db)
        assert state.trades().iloc[0]["net_pnl"] == expected
    state.load_trades.clear()
