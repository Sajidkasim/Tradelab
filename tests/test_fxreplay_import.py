"""FX Replay-style exports: P&L and R without prices, sessions, trade names; kept out of live stats."""
import pandas as pd
import pytest

from core.importers import auto_map, normalise
from core.models import Source, LIVE_SOURCES, BACKTEST_SOURCES
from core.db import Database
from core import metrics


def test_pnl_only_rows_keep_exact_pnl_and_r():
    df = pd.DataFrame({
        "Trade Name": ["London sweep", "NY ORB"],
        "Date": ["2026-08-04 08:15", "2026-08-05 14:35"],
        "Symbol": ["EURUSD", "NQ"],
        "Side": ["Buy", "Sell"],
        "P&L": [125.50, -80.00],
        "R": [2.51, -1.0],
        "Session": ["London", "New York"],
        "Tags": ["sweep, fvg", "orb"],
    })
    m = auto_map(list(df.columns))
    assert m["trade_name"] == "Trade Name" and m["pnl"] == "P&L" and m["r_multiple"] == "R" and m["session"] == "Session"
    trades, errors = normalise(df, m, source=Source.FXREPLAY)
    assert errors == [] and len(trades) == 2
    a, b = trades
    assert a.net_pnl == pytest.approx(125.50) and a.r_multiple == pytest.approx(2.51)
    assert a.initial_risk == pytest.approx(125.50 / 2.51)
    assert b.net_pnl == pytest.approx(-80.0) and b.r_multiple == pytest.approx(-1.0) and b.direction.value == "short"
    assert "pnl-only" in a.tags and a.session == "London" and a.setup_name == "London sweep"
    assert a.tags[:2] == ["sweep", "fvg"] and a.source == Source.FXREPLAY


def test_risk_amount_column_gives_r():
    df = pd.DataFrame({"Date": ["2026-08-04"], "Symbol": ["MES"], "Direction": ["Long"], "Entry Price": [5000],
                       "Exit Price": [5010], "Risk": [25.0]})
    trades, _ = normalise(df, auto_map(list(df.columns)))
    assert trades[0].net_pnl == 50.0 and trades[0].r_multiple == pytest.approx(2.0)


def test_backtest_sources_stay_out_of_live_stats():
    db = Database(":memory:"); db.init()
    df = pd.DataFrame({"Date": ["2026-08-04", "2026-08-05"], "Symbol": ["MES", "MES"], "Direction": ["Long", "Long"],
                       "Entry Price": [5000, 5000], "Exit Price": [5010, 4990]})
    live, _ = normalise(df, auto_map(list(df.columns)), source=Source.CSV)
    bt, _ = normalise(df, auto_map(list(df.columns)), source=Source.FXREPLAY)
    for i, t in enumerate(live + bt):
        t.external_id = f"x{i}"
    db.insert_trades(live + bt)
    assert db.count_trades() == 4
    assert len(db.trades_df(sources=LIVE_SOURCES)) == 2
    assert len(db.trades_df(sources=BACKTEST_SOURCES)) == 2
    s = metrics.summary_stats(db.trades_df(sources=LIVE_SOURCES))
    assert s["trades"] == 2 and s["net_pnl"] == 0.0
    assert set(LIVE_SOURCES).isdisjoint(BACKTEST_SOURCES)
