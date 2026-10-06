"""Exercise the new workflow against an isolated in-memory database."""
from pathlib import Path
from datetime import date

import pytest
from streamlit.testing.v1 import AppTest

from core.db import Database
from core import edge
from core.models import Account, Source
from ui import state


@pytest.fixture
def app_db(monkeypatch):
    db = Database(":memory:")
    db.init()
    db.upsert_account(Account("Research test", 50000, 500, 2000))
    monkeypatch.setattr(state, "get_db", lambda: db)
    monkeypatch.setattr(state, "trades", db.trades_df)
    return db


def start(lane="Explore my edge"):
    app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / "app.py"), default_timeout=20)
    app.session_state["filters"] = {**state._default_filters(), "scope": "Backtests"}
    app.run()
    if lane != "Explore my edge":
        app.session_state["trade_action"] = "add" if lane == "Log a trade" else "review"
        app.session_state["edge_pending"] = lane == "Import & review"
        app.switch_page("views/journal.py").run()
    assert not app.exception
    return app


def test_empty_explorer_and_combination_filters_render(app_db):
    app = start()
    app.checkbox(key="edge_filter_confirm_SMT").check().run()
    app.checkbox(key="edge_filter_confirm_CISD").check().run()
    assert not app.exception
    assert any("No closed trades match yet" in item.value for item in app.markdown)


def test_quick_save_clears_result_retains_labels_and_refreshes_stats(app_db):
    app = start("Log a trade")
    app.checkbox(key="edge_log_0_confirm_SMT").check().run()
    app.number_input(key="edge_log_0_pnl").set_value(500.0)
    app.number_input(key="edge_log_0_risk").set_value(250.0).run()
    assert not app.exception
    app.button(key="edge_log_0_save").click().run()
    assert not app.exception
    assert app_db.count_trades() == 1
    saved = app_db.trades_df().iloc[0]
    assert saved["r_multiple"] == 2
    assert saved["source"] == "backtest"
    assert app.number_input(key="edge_log_1_pnl").value is None
    assert app.checkbox(key="edge_log_1_confirm_SMT").value is True
    assert app.session_state["data_version"] == 1
    app.switch_page("views/edge_lab.py").run()
    assert not app.exception
    assert any("100.0%" in item.value for item in app.markdown)


def test_review_queue_empty_and_scope_offers_all_without_demo(app_db):
    app = start("Import & review")
    assert not app.exception
    assert next(r for r in app.radio if r.label == "Data source").options == ["Backtesting", "Forward testing", "All"]
    assert any("Your review queue starts here" in item.value for item in app.markdown)


def test_forward_source_and_historical_date_survive_rapid_logging(app_db):
    app = start("Log a trade")
    app.selectbox(key="edge_log_0_source").select("manual").run()
    app.date_input(key="edge_log_0_date").set_value(date(2025, 3, 12)).run()
    app.number_input(key="edge_log_0_pnl").set_value(-100.0)
    app.number_input(key="edge_log_0_risk").set_value(100.0).run()
    app.button(key="edge_log_0_save").click().run()
    assert not app.exception
    saved = app_db.trades_df().iloc[0]
    assert saved["source"] == "manual"
    assert saved["entry_time"].date() == date(2025, 3, 12)
    assert saved["exit_time"] == saved["entry_time"]
    assert app.selectbox(key="edge_log_1_source").value == "manual"


def test_import_review_saves_labels_and_advances_without_losing_r(app_db):
    for day in [1, 2]:
        trade = edge.build_trade(symbol="MNQ", direction="long", source=Source.BACKTEST,
                                 account_id=app_db.accounts()[0].id, strategy="Turtle Soup",
                                 entry_time=f"2026-09-0{day}T13:35:00Z", exit_time=f"2026-09-0{day}T13:40:00Z",
                                 instruments=app_db.instruments(), tags=[], net_pnl=100, risk_amount=50)
        app_db.insert_trades([trade])
    app = start("Import & review")
    tid = app.selectbox(key="edge_review_trade").value
    app.checkbox(key=f"review_{tid}_confirm_SMT").check()
    app.selectbox(key=f"review_{tid}_news").select("Major news")
    app.checkbox(key=f"review_{tid}_confirmed").check()
    next(b for b in app.button if b.label == "Save & next").click().run()
    assert not app.exception
    saved = app_db.get_trade(tid)
    assert saved.r_multiple == 2
    assert edge.read_labels(saved.tags)["confirmations"] == ["SMT"]
    assert edge.read_labels(saved.tags)["news"] == "Major news"
    assert app.selectbox(key="edge_review_trade").value != tid


def test_entry_timeframe_is_saved_and_filtered_separately_from_level_timeframe(app_db):
    app = start("Log a trade")
    app.selectbox(key="edge_log_0_timeframe").select("4H")
    app.selectbox(key="edge_log_0_entry_timeframe").select("1m")
    app.number_input(key="edge_log_0_pnl").set_value(100.0)
    app.number_input(key="edge_log_0_risk").set_value(50.0).run()
    app.button(key="edge_log_0_save").click().run()
    assert not app.exception
    labels = edge.read_labels(app_db.get_trade(int(app_db.trades_df().iloc[0]["id"])).tags)
    assert labels["timeframe"] == "4H"
    assert labels["entry_timeframe"] == "1m"
    assert app.selectbox(key="edge_log_1_entry_timeframe").value == "1m"  # remembered for the next trade
    app.switch_page("views/edge_lab.py").run()
    app.selectbox(key="edge_filter_entry_timeframe").select("5m").run()
    assert not app.exception
    assert any("No closed trades match yet" in item.value for item in app.markdown)
    app.selectbox(key="edge_filter_entry_timeframe").select("1m").run()
    assert any("100.0%" in item.value for item in app.markdown)
    assert "Entry timeframe" in app.selectbox(key="edge_compare_by").options


def test_edited_playbook_lists_drive_the_log_and_filter_options(app_db):
    app_db.set_setting(edge.PLAYBOOK_KEY, {"strategies": ["Silver Bullet"], "levels": ["Asia high / low"]})
    app = start("Log a trade")
    assert app.selectbox(key="edge_log_0_strategy").options == ["Silver Bullet"]
    assert app.selectbox(key="edge_log_0_strategy").value == "Silver Bullet"
    assert app.selectbox(key="edge_log_0_level").options == [edge.UNKNOWN, "Asia high / low"]
    app.switch_page("views/edge_lab.py").run()
    assert not app.exception
    assert app.selectbox(key="edge_filter_strategy").options == ["All strategies", "Silver Bullet"]
    assert app.selectbox(key="edge_filter_level").options == ["Any level", "Asia high / low", edge.UNKNOWN]


def test_removed_level_stays_selectable_on_trades_that_already_use_it(app_db):
    trade = edge.build_trade(symbol="MNQ", direction="long", source=Source.BACKTEST,
                             account_id=app_db.accounts()[0].id, strategy="Turtle Soup",
                             entry_time="2026-09-01T13:35:00Z", exit_time="2026-09-01T13:40:00Z",
                             instruments=app_db.instruments(), tags=edge.write_labels(level="NWOG"),
                             net_pnl=100, risk_amount=50)
    app_db.insert_trades([trade])
    app_db.set_setting(edge.PLAYBOOK_KEY, {"levels": ["FVG"]})
    app = start()
    assert app.selectbox(key="edge_filter_level").options == ["Any level", "FVG", "NWOG", edge.UNKNOWN]
    app.selectbox(key="edge_filter_level").select("NWOG").run()
    assert any("100.0%" in item.value for item in app.markdown)


def test_trades_owns_entry_and_import_with_clear_return_path(app_db):
    app = start()
    assert not app.sidebar.radio
    assert not app.sidebar.selectbox
    assert not app.sidebar.multiselect
    assert not app.number_input
    assert app.radio(key="edge_scope").options == ["Backtesting", "Forward testing", "All"]
    app.switch_page("views/journal.py").run()
    next(b for b in app.button if b.label == "Add trade").click().run()
    assert not app.exception
    assert app.number_input(key="edge_log_0_pnl") is not None
    next(b for b in app.button if b.label == "Back to trades").click().run()
    next(b for b in app.button if b.label == "Import FX Replay").click().run()
    assert not app.exception
    assert len(app.get("file_uploader")) > 0
    next(b for b in app.button if b.label == "Back to trades").click().run()
    assert not app.exception
    assert any("Your review queue starts here" in item.value for item in app.markdown)


def test_saved_combination_can_be_cleared_and_reapplied(app_db):
    app = start()
    app.checkbox(key="edge_filter_confirm_SMT").check()
    app.selectbox(key="edge_filter_level").select("FVG")
    app.text_input(key="edge_recipe_name").set_value("My research question").run()
    next(b for b in app.button if b.label == "Save combination").click().run()
    next(b for b in app.button if b.label == "Clear setup filters").click().run()
    assert not app.checkbox(key="edge_filter_confirm_SMT").value
    next(b for b in app.button if b.label == "Apply combination").click().run()
    assert not app.exception
    assert app.checkbox(key="edge_filter_confirm_SMT").value
    assert app.selectbox(key="edge_filter_level").value == "FVG"


def test_trades_editor_all_queue_save_next_and_bulk_preserve_results(app_db):
    for day in [1, 2]:
        trade = edge.build_trade(symbol='MNQ', direction='long', source=Source.BACKTEST,
                                 account_id=app_db.accounts()[0].id, strategy='Turtle Soup',
                                 entry_time=f'2026-09-0{day}T13:35:00Z', exit_time=f'2026-09-0{day}T13:40:00Z',
                                 instruments=app_db.instruments(), tags=[], net_pnl=100, risk_amount=50)
        app_db.insert_trades([trade])
    app = start()
    app.switch_page('views/journal.py').run()
    assert not app.exception
    first = app.selectbox(key='edge_review_trade').value
    app.selectbox(key=f'review_{first}_entry_timeframe').set_value('1m')
    app.checkbox(key=f'review_{first}_confirmed').check()
    next(b for b in app.button if b.label == 'Save & next').click().run()
    assert not app.exception
    assert app.selectbox(key='edge_review_trade').value != first
    assert app_db.get_trade(first).r_multiple == 2
    ids = app_db.trades_df()['id'].tolist()
    app.multiselect(key='review_bulk_ids').set_value(ids)
    app.selectbox(key='review_bulk_strategy').set_value('AMD').run()
    app.button(key='review_bulk_apply').click().run()
    assert not app.exception
    assert app_db.trades_df()['setup_name'].tolist() == ['AMD','AMD']
    assert app_db.trades_df()['r_multiple'].tolist() == [2,2]


def test_bulk_strategy_refreshes_open_trade_editor(app_db):
    trade = edge.build_trade(symbol='MNQ', direction='long', source=Source.BACKTEST,
                            account_id=app_db.accounts()[0].id, strategy='Turtle Soup',
                            entry_time='2026-09-01T13:35:00Z', exit_time='2026-09-01T13:40:00Z',
                            instruments=app_db.instruments(), tags=[], net_pnl=100, risk_amount=50)
    app_db.insert_trades([trade])
    app = start('Import & review')
    tid = app.selectbox(key='edge_review_trade').value
    app.multiselect(key='review_bulk_ids').set_value([tid])
    app.selectbox(key='review_bulk_strategy').set_value('AMD').run()
    app.button(key='review_bulk_apply').click().run()
    assert not app.exception
    assert app.selectbox(key=f'review_{tid}_strategy').value == 'AMD'


def test_custom_imported_confirmation_survives_review(app_db):
    trade = edge.build_trade(symbol='MNQ', direction='long', source=Source.BACKTEST,
                            account_id=app_db.accounts()[0].id, strategy='Turtle Soup',
                            entry_time='2026-09-01T13:35:00Z', exit_time='2026-09-01T13:40:00Z',
                            instruments=app_db.instruments(), tags=['edge:confirmation:My custom signal'], net_pnl=100, risk_amount=50)
    app_db.insert_trades([trade])
    app = start('Import & review')
    tid = app.selectbox(key='edge_review_trade').value
    next(b for b in app.button if b.label == 'Save changes').click().run()
    assert not app.exception
    assert 'My custom signal' in edge.read_labels(app_db.get_trade(tid).tags)['confirmations']
