"""Hand-built trades with known answers for every metric."""
import math
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from core import metrics
from core.models import Direction, Trade


def _trade(i, direction, entry, exit_, qty=1, mult=5.0, stop=None, fees=0.0, hold=10):
    t0 = datetime(2026, 9, 1, 14, 0) + timedelta(days=i)
    t = Trade(symbol="MES", direction=direction, qty=qty, entry_time=t0, entry_price=entry,
              exit_time=t0 + timedelta(minutes=hold), exit_price=exit_, stop_price=stop,
              multiplier=mult, fees=fees, external_id=f"t{i}")
    return metrics.compute_trade_fields(t)


def test_gross_pnl_long_and_short():
    assert metrics.gross_pnl(5000, 5004, 2, 5.0, Direction.LONG) == pytest.approx(40.0)
    assert metrics.gross_pnl(5000, 5004, 2, 5.0, Direction.SHORT) == pytest.approx(-40.0)
    assert metrics.gross_pnl(5000, 4996, 1, 50.0, "short") == pytest.approx(200.0)


def test_compute_trade_fields_r_and_fees():
    t = _trade(0, Direction.LONG, 5000, 5008, qty=2, stop=4996, fees=2.0)
    assert t.gross_pnl == pytest.approx(80.0)          # 8 pts * 2 * $5
    assert t.net_pnl == pytest.approx(78.0)
    assert t.initial_risk == pytest.approx(40.0)       # 4 pts * 2 * $5
    assert t.r_multiple == pytest.approx(78 / 40)
    t2 = _trade(1, Direction.SHORT, 5000, 5010, stop=5005)   # loser, short
    assert t2.net_pnl == pytest.approx(-50.0)
    assert t2.r_multiple == pytest.approx(-2.0)


def test_open_trade_has_no_pnl():
    t = Trade(symbol="MES", direction=Direction.LONG, qty=1, entry_time=datetime(2026, 9, 1),
              entry_price=5000, stop_price=4995, multiplier=5)
    metrics.compute_trade_fields(t)
    assert t.net_pnl is None and t.r_multiple is None and t.initial_risk == 25.0


@pytest.fixture
def ten_trades():
    # net P&L sequence (fees 0): +100, -50, -50, +200, -50, -50, -50, +150, 0, +100
    rows = [
        _trade(0, Direction.LONG, 5000, 5020, stop=4990),    # +100, risk 50 -> 2R
        _trade(1, Direction.LONG, 5000, 4990, stop=4990),    # -50  -> -1R
        _trade(2, Direction.SHORT, 5000, 5010, stop=5010),   # -50  -> -1R
        _trade(3, Direction.SHORT, 5000, 4960, stop=5010),   # +200 -> 4R
        _trade(4, Direction.LONG, 5000, 4990, stop=4990),    # -50
        _trade(5, Direction.LONG, 5000, 4990, stop=4990),    # -50
        _trade(6, Direction.LONG, 5000, 4990, stop=4990),    # -50
        _trade(7, Direction.LONG, 5000, 5030, stop=4990),    # +150 -> 3R
        _trade(8, Direction.LONG, 5000, 5000, stop=4990),    # 0 scratch
        _trade(9, Direction.SHORT, 5000, 4980, stop=5010),   # +100 -> 2R
    ]
    df = pd.DataFrame([t.to_row() for t in rows])
    df["mistake_tags"] = [[] for _ in range(len(df))]
    df["tags"] = [[] for _ in range(len(df))]
    return df


def test_summary_stats_known_values(ten_trades):
    s = metrics.summary_stats(ten_trades, starting_balance=10_000)
    assert s["trades"] == 10
    assert s["wins"] == 4 and s["losses"] == 5 and s["scratches"] == 1
    assert s["win_rate"] == pytest.approx(4 / 9)
    assert s["net_pnl"] == pytest.approx(300.0)
    assert s["avg_win"] == pytest.approx(137.5)         # (100+200+150+100)/4
    assert s["avg_loss"] == pytest.approx(50.0)
    assert s["payoff_ratio"] == pytest.approx(2.75)
    assert s["profit_factor"] == pytest.approx(550 / 250)
    assert s["expectancy"] == pytest.approx(30.0)        # mean of all 10 incl. scratch
    assert s["avg_r"] == pytest.approx((2 - 1 - 1 + 4 - 1 - 1 - 1 + 3 + 0 + 2) / 10)
    assert s["longest_loss_streak"] == 3
    assert s["longest_win_streak"] == 2                  # +150, (scratch ignored), +100
    assert s["current_streak"] == 2
    assert s["best_trade"] == 200 and s["worst_trade"] == -50
    # equity: 100, 50, 0, 200, 150, 100, 50, 200, 200, 300 -> peak 200 at t3, trough 50 -> DD 150
    assert s["max_drawdown"] == pytest.approx(150.0)
    assert s["max_drawdown_pct"] == pytest.approx(150 / 10_200)
    assert s["return_pct"] == pytest.approx(0.03)
    assert s["small_sample"] is True
    lo, hi = s["win_rate_ci"]
    assert lo < 4 / 9 < hi


def test_wilson_interval_reference_values():
    lo, hi = metrics.wilson_interval(6, 10)
    assert lo == pytest.approx(0.3127, abs=1e-3)
    assert hi == pytest.approx(0.8318, abs=1e-3)
    assert metrics.wilson_interval(0, 0) == (0.0, 0.0)
    lo, hi = metrics.wilson_interval(60, 100)
    assert hi - lo < 0.8318 - 0.3127      # more trades -> tighter


def test_max_drawdown_sequence():
    dd = metrics.max_drawdown([100, 50, 0, 200, 150, 100, 50, 200, 200, 300], 0)
    assert dd["amount"] == pytest.approx(150.0)
    dd0 = metrics.max_drawdown([10, 20, 30], 0)
    assert dd0["amount"] == 0.0 and dd0["peak_index"] is None
    # the series is EQUITY (absolute balances); the starting balance is the first peak
    dd1 = metrics.max_drawdown([900, 800], 1000)
    assert dd1["amount"] == pytest.approx(200.0)
    assert dd1["pct"] == pytest.approx(0.2)


def test_empty_frame_is_safe():
    s = metrics.summary_stats(pd.DataFrame())
    assert s["trades"] == 0 and s["win_rate"] is None and s["net_pnl"] == 0.0


def test_streaks_ignore_scratches():
    df = pd.DataFrame({"net_pnl": [1, 1, 0, -1, -1, -1, 1], "exit_price": 1,
                       "exit_time": pd.date_range("2026-01-01", periods=7)})
    st = metrics.streaks(df)
    assert st == {"longest_win": 2, "longest_loss": 3, "current": 1,
                  "win_streaks": [2, 1], "loss_streaks": [3]}


def test_breakdown_and_tags(ten_trades):
    df = ten_trades.copy()
    df["setup_name"] = ["A"] * 5 + ["B"] * 5
    b = metrics.breakdown(df, "setup_name").set_index("setup_name")
    assert b.loc["A", "net_pnl"] == pytest.approx(150.0)
    assert b.loc["B", "net_pnl"] == pytest.approx(150.0)
    assert b.loc["A", "trades"] == 5
    df["mistake_tags"] = [["chased"], [], ["chased", "moved stop"], [], [], [], [], [], [], []]
    tags = metrics.pnl_by_tag(df).set_index("tag")
    assert tags.loc["chased", "trades"] == 2
    assert tags.loc["chased", "net_pnl"] == pytest.approx(50.0)
    wi = metrics.what_if_without_tag(df, "chased")
    assert wi["removed_trades"] == 2 and wi["without"]["trades"] == 8
    assert wi["without"]["net_pnl"] == pytest.approx(250.0)


def test_rule_adherence(ten_trades):
    df = ten_trades.copy()
    df["rules_followed"] = [True] * 8 + [False] * 2
    ra = metrics.rule_adherence(df).set_index("rules")
    assert ra.loc["followed", "trades"] == 8 and ra.loc["broke", "trades"] == 2
    assert ra.loc["broke", "net_pnl"] == pytest.approx(100.0)


def test_sharpe_sortino_and_daily():
    df = pd.DataFrame({"net_pnl": [100, -50, 200, -100, 50], "exit_price": 1,
                       "exit_time": pd.date_range("2026-01-05", periods=5)})
    d = metrics.daily_pnl(df)
    assert len(d) == 5 and d.sum() == 200
    sh = metrics.sharpe(d, 10_000)
    r = d / 10_000
    assert sh == pytest.approx(r.mean() / r.std(ddof=1) * math.sqrt(252))
    assert metrics.sortino(d, 10_000) is not None
    assert metrics.sharpe(d, 0) is None


def test_sessions_and_time_features():
    ts = pd.Timestamp("2026-09-01 13:45:00")     # UTC -> 09:45 New York
    sessions = {"NY open": (pd.Timestamp("09:30").time(), pd.Timestamp("11:00").time())}
    assert metrics.session_of(ts, "America/New_York", sessions) == "NY open"
    assert metrics.session_of(pd.Timestamp("2026-09-01 20:00:00"), "America/New_York", sessions) == "Other"
    df = pd.DataFrame({"entry_time": [ts], "exit_time": [ts + pd.Timedelta(minutes=20)],
                       "net_pnl": [10.0], "exit_price": [1.0]})
    f = metrics.add_time_features(df, "America/New_York")
    assert f["hour"].iloc[0] == 9 and f["weekday"].iloc[0] == "Tuesday"
    assert str(f["hold_bucket"].iloc[0]) == "15–30m"
