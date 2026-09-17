"""Hand-known research samples: intersections, missing labels and persistence."""
from datetime import datetime

import pandas as pd
import pytest

from core import edge, metrics
from core.db import Database
from core.models import Source


@pytest.fixture
def db():
    value = Database(":memory:")
    value.init()
    return value


def make_trade(db, **changes):
    values = dict(symbol="MNQ", direction="long", account_id=None, source=Source.BACKTEST,
                  strategy="Turtle Soup", entry_time="2026-09-01T09:35:00-04:00",
                  exit_time="2026-09-01T09:45:00-04:00", instruments=db.instruments(),
                  tags=edge.write_labels(level="FVG", timeframe="4H", confirmations=["SMT", "CISD"]),
                  net_pnl=100.0, risk_amount=50.0)
    values.update(changes)
    return edge.build_trade(**values)


def test_labels_round_trip_preserves_other_metadata_and_can_clear_confirmations():
    tags = edge.write_labels(["pnl-only", "A+", "smt", "edge:news:Major news"],
                             level="NWOG", timeframe="Weekly", confirmations=["CISD", "CISD"])
    labels = edge.read_labels(tags)
    assert tags[:2] == ["pnl-only", "A+"]
    assert labels == dict(level="NWOG", timeframe="Weekly", entry_timeframe=edge.UNKNOWN, confirmations=["CISD"],
                          condition=edge.UNKNOWN, news=edge.UNKNOWN, reviewed=True)
    assert edge.read_labels(edge.write_labels(tags))["confirmations"] == []
    assert edge.read_labels('["smt", "CISD", "unrelated"]')["confirmations"] == ["CISD", "SMT"]


def test_entry_timeframe_is_recorded_and_filtered_separately_from_level_timeframe(db):
    tags = edge.write_labels(level="FVG", timeframe="4H", entry_timeframe="1m")
    labels = edge.read_labels(tags)
    assert labels["timeframe"] == "4H"
    assert labels["entry_timeframe"] == "1m"
    # Trades labelled before the field existed read as not recorded, never as a level timeframe.
    legacy = edge.read_labels(edge.write_labels(timeframe="4H"))
    assert legacy["timeframe"] == "4H" and legacy["entry_timeframe"] == edge.UNKNOWN
    for i, (timeframe, entry_timeframe) in enumerate([("4H", "1m"), ("4H", "5m"), ("1H", "1m")]):
        t = make_trade(db, tags=edge.write_labels(level="FVG", timeframe=timeframe, entry_timeframe=entry_timeframe))
        t.external_id = f"tf-{i}"
        db.insert_trades([t])
    prepared = edge.prepare(db.trades_df())
    assert list(prepared["edge_entry_timeframe"]) == ["1m", "5m", "1m"]
    assert len(edge.select(prepared, timeframe="4H")) == 2
    assert len(edge.select(prepared, entry_timeframe="1m")) == 2
    assert len(edge.select(prepared, timeframe="4H", entry_timeframe="1m")) == 1
    assert len(edge.select(prepared, entry_timeframe=edge.UNKNOWN)) == 0


def test_playbook_lists_fall_back_to_defaults_and_clean_user_entries():
    defaults = edge.playbook(None)
    assert defaults == {"strategies": edge.STRATEGIES, "levels": edge.LEVELS}
    assert defaults["strategies"] is not edge.STRATEGIES  # a copy, so edits never touch the module defaults
    custom = edge.playbook({"strategies": [" Silver Bullet ", "Silver Bullet", "", None, float("nan"), "AMD"]})
    assert custom["strategies"] == ["Silver Bullet", "AMD"]
    assert custom["levels"] == edge.LEVELS
    assert edge.playbook({"levels": []})["levels"] == []  # an emptied list stays empty
    assert edge.playbook("garbage") == defaults
    assert edge.playbook({"strategies": "not a list"}) == defaults


def test_combination_is_intersection_with_known_statistics(db):
    for i, (pnl, confirmations) in enumerate([(100, ["SMT", "CISD"]), (-50, ["SMT", "CISD"]),
                                              (200, ["SMT"]), (-50, ["CISD"]), (0, ["SMT", "CISD"]) ]):
        t = make_trade(db, net_pnl=pnl, tags=edge.write_labels(level="FVG", confirmations=confirmations))
        t.external_id = f"sample-{i}"
        db.insert_trades([t])
    prepared = edge.prepare(db.trades_df())
    matched = edge.select(prepared, confirmations=["SMT", "CISD"], level="FVG")
    s = metrics.summary_stats(matched)
    assert s["trades"] == 3
    assert s["win_rate"] == pytest.approx(0.5)
    assert s["avg_r"] == pytest.approx(1 / 3)
    assert s["scratches"] == 1
    assert len(edge.select(prepared, confirmations=["SMT"])) == 4
    assert len(prepared) == 5  # filtering did not mutate the source


def test_news_unknown_never_counts_as_no_news(db):
    for i, news in enumerate([edge.UNKNOWN, "Major news", "No major news"]):
        t = make_trade(db, tags=edge.write_labels(news=news))
        t.external_id = str(i)
        db.insert_trades([t])
    data = edge.prepare(db.trades_df())
    for value in [edge.UNKNOWN, "Major news", "No major news"]:
        assert len(edge.select(data, news=value)) == 1


def test_new_york_windows_follow_dst_and_exclude_other_sessions():
    frame = pd.DataFrame({"entry_time": pd.to_datetime(["2026-01-05 14:35", "2026-07-06 13:35",
                                                        "2026-07-06 08:00", "2026-07-06 20:00"]),
                          "tags": [[], [], [], []]})
    prepared = edge.prepare(frame)
    assert list(prepared["edge_window"])[:2] == ["Opening drive · 09:30–10:00"] * 2
    assert len(edge.select(prepared)) == 2
    assert len(edge.select(prepared, window="All sessions")) == 4


@pytest.mark.parametrize("pnl, expected_r", [(100, 2), (-50, -1), (0, 0)])
def test_quick_result_save_and_review_preserve_net_r_and_scope(db, pnl, expected_r):
    trade = make_trade(db, net_pnl=pnl)
    assert db.insert_trades([trade])["inserted"] == 1
    saved = db.get_trade(int(db.trades_df().iloc[0]["id"]))
    db.update_trade(saved.id, tags=edge.write_labels(saved.tags, news="Major news"), notes="Reviewed")
    saved = db.get_trade(saved.id)
    assert saved.net_pnl == pytest.approx(pnl)
    assert saved.r_multiple == pytest.approx(expected_r)
    assert saved.source == Source.BACKTEST
    assert saved.entry_time == datetime(2026, 9, 1, 13, 35)
    assert db.insert_trades([trade])["skipped"] == 1


def test_price_entry_uses_instrument_multiplier_and_fees(db):
    t = make_trade(db, net_pnl=None, risk_amount=None, entry_price=20000, stop_price=20010,
                   exit_price=19980, qty=2, fees=2, direction="short")
    assert t.initial_risk == 40
    assert t.net_pnl == 78
    assert t.r_multiple == pytest.approx(1.95)
    db.insert_trades([t])
    tid = int(db.trades_df().iloc[0]["id"])
    db.update_trade(tid, stop_price=20020)
    assert db.get_trade(tid).r_multiple == pytest.approx(78 / 80)
    db.update_trade(tid, stop_price=None)
    assert db.get_trade(tid).initial_risk is None
    assert db.get_trade(tid).r_multiple is None


@pytest.mark.parametrize("changes", [dict(risk_amount=0), dict(net_pnl=float("nan")),
                                     dict(direction=None), dict(strategy=" "), dict(symbol="UNKNOWN"),
                                     dict(exit_time="2026-08-01T00:00Z"), dict(source=Source.DEMO),
                                     dict(net_pnl=None, entry_price=20000, stop_price=20001, exit_price=20020)])
def test_invalid_entries_are_rejected(db, changes):
    with pytest.raises(ValueError):
        make_trade(db, **changes)
    assert db.count_trades() == 0


def test_empty_and_untagged_samples_are_safe(db):
    assert edge.select(edge.prepare(db.trades_df())).empty
    t = make_trade(db, tags=[])
    db.insert_trades([t])
    d = edge.prepare(db.trades_df())
    assert d.iloc[0]["edge_news"] == edge.UNKNOWN
    assert not d.iloc[0]["edge_reviewed"]
    assert edge.select(d, confirmations=["SMT"]).empty


def test_thousand_trade_sample_filters_without_mixing_sources(db):
    trades = []
    for i in range(1000):
        t = make_trade(db, net_pnl=100 if i % 2 else -50,
                       source=Source.BACKTEST if i < 800 else Source.MANUAL)
        t.external_id = f"large-{i}"
        trades.append(t)
    db.insert_trades(trades)
    from core.models import BACKTEST_SOURCES, LIVE_SOURCES
    for sources, count in [(BACKTEST_SOURCES, 800), (LIVE_SOURCES, 200)]:
        matched = edge.select(edge.prepare(db.trades_df(sources=sources)), confirmations=["SMT", "CISD"])
        s = metrics.summary_stats(matched)
        assert s["trades"] == count
        assert s["win_rate"] == pytest.approx(0.5)
        assert s["avg_r"] == pytest.approx(0.5)


def test_same_execution_on_different_accounts_is_not_a_duplicate(db):
    for account in (1, 2):
        assert db.insert_trades([make_trade(db, account_id=account)])["inserted"] == 1
    assert db.count_trades() == 2
