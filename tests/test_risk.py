"""Risk engine with hand-computed answers. Account: Topstep-style $50K, $1,000 DLL, $2,000 MLL."""
import numpy as np
import pandas as pd
import pytest

from core import risk


def test_position_size_mes():
    # MES: 4-point stop = 16 ticks = $20 per contract. $100 risk -> 5 contracts.
    r = risk.position_size(entry=5000, stop=4996, multiplier=5, tick_size=0.25,
                           account_balance=50_000, risk_dollars=100)
    assert r["contracts"] == 5 and r["stop_ticks"] == 16 and r["total_risk"] == 100
    # with $1 commission per contract, each contract costs $21 -> 4 contracts
    r = risk.position_size(5000, 4996, 5, 0.25, 50_000, risk_dollars=100, commission_per_contract=1.0)
    assert r["contracts"] == 4 and r["total_risk"] == pytest.approx(84.0)
    # percent of account: 0.5% of 50k = $250 -> 12, capped at 5
    r = risk.position_size(5000, 4996, 5, 0.25, 50_000, risk_pct=0.5, max_contracts=5)
    assert r["contracts"] == 5 and r["capped_by_max_contracts"] is True
    assert r["risk_budget"] == 250
    # short side works the same (stop above entry)
    r = risk.position_size(5000, 5004, 5, 0.25, 50_000, risk_dollars=100)
    assert r["contracts"] == 5
    # a stop at entry gives zero contracts, not a crash
    assert risk.position_size(5000, 5000, 5, 0.25, 50_000, risk_dollars=100)["contracts"] == 0
    rv = risk.risk_for_contracts(3, 5000, 4996, 5, 50_000)
    assert rv["total_risk"] == 60 and rv["risk_pct_of_account"] == pytest.approx(0.12)


def test_daily_status_states():
    assert risk.daily_status(250, 1000)["state"] == "green"
    assert risk.daily_status(-400, 1000)["state"] == "green"
    assert risk.daily_status(-500, 1000)["state"] == "amber"
    assert risk.daily_status(-800, 1000)["state"] == "red"
    assert risk.daily_status(-1000, 1000)["state"] == "breached"
    s = risk.daily_status(-300, 1000, trades_today=10, max_trades_per_day=10)
    assert s["state"] == "amber" and s["trades_remaining"] == 0 and s["remaining"] == 700


def test_trailing_drawdown_topstep_style_lock():
    # $50K, MLL $2,000: threshold starts 48,000, trails the high-water mark, locks at 50,000
    bal = [50_500, 51_000, 50_200, 52_500, 50_400, 49_900]
    td = risk.trailing_drawdown(bal, 50_000, 2_000, lock_at="start")
    assert list(td["threshold"]) == [48_500, 49_000, 49_000, 50_000, 50_000, 50_000]
    assert list(td["buffer"]) == [2_000, 2_000, 1_200, 2_500, 400, -100]
    assert list(td["breached"]) == [False, False, False, False, False, True]
    # never-locking variant keeps trailing
    td2 = risk.trailing_drawdown(bal, 50_000, 2_000, lock_at=None)
    assert td2["threshold"].iloc[3] == 50_500
    # from a daily P&L series
    daily = pd.Series([500, 500, -800], index=pd.date_range("2026-09-01", periods=3))
    td3 = risk.trailing_drawdown_from_daily(daily, 50_000, 2_000)
    assert td3["balance"].iloc[-1] == 50_200 and td3["threshold"].iloc[-1] == 49_000


def test_consistency_rule():
    daily = pd.Series([300, 900, 200], index=pd.date_range("2026-09-01", periods=3))
    c = risk.consistency(daily, 50)
    assert c["best_day"] == 900 and c["total_profit"] == 1400
    assert c["best_day_pct"] == pytest.approx(64.2857, abs=1e-3)
    assert c["compliant"] is False
    assert c["needed_profit"] == pytest.approx(400.0)      # 900 / 0.5 - 1400
    ok = risk.consistency(pd.Series([300, 300, 300]), 50)
    assert ok["compliant"] is True and ok["needed_profit"] == 0
    assert risk.consistency(pd.Series(dtype=float))["compliant"] is True


def test_kelly_and_risk_of_ruin():
    k = risk.kelly_fraction(0.5, 2.0)
    assert k["full"] == pytest.approx(0.25) and k["quarter"] == pytest.approx(0.0625)
    assert risk.kelly_fraction(0.4, 1.0)["full"] < 0               # no edge
    assert risk.risk_of_ruin_approx(0, 100, 1000) == 1.0
    assert risk.risk_of_ruin_approx(150, 100, 1000) == 0.0
    ror = risk.risk_of_ruin_approx(20, 100, 1000)                  # A = 0.2, units = 10
    assert ror == pytest.approx(((0.8) / (1.2)) ** 10)
    assert risk.risk_of_ruin_approx(20, 100, 2000) < ror           # more capital, less ruin


def test_losing_streak_probability_exact():
    assert risk.losing_streak_probability(0.5, 1, 1) == pytest.approx(0.5)
    assert risk.losing_streak_probability(0.5, 2, 2) == pytest.approx(0.25)
    assert risk.losing_streak_probability(0.5, 2, 3) == pytest.approx(3 / 8)   # LLL, LLW, WLL
    assert risk.losing_streak_probability(0.5, 5, 3) == 0.0
    p100 = risk.losing_streak_probability(0.45, 6, 100)
    assert 0.5 < p100 < 0.95                                        # a 6-loss run is likely over 100 trades
    assert risk.expected_longest_losing_streak(0.5, 100) == pytest.approx(np.log(100) / np.log(2))


def test_monte_carlo_bounds():
    always_win = [50.0] * 20
    mc = risk.monte_carlo(always_win, n_trades=50, n_sims=200, starting_balance=50_000, max_drawdown=2_000)
    assert mc["prob_profit"] == 1.0 and mc["prob_breach"] == 0.0
    assert mc["final_pnl_pct"][50] == pytest.approx(2500.0)
    always_lose = [-500.0] * 20
    mc2 = risk.monte_carlo(always_lose, n_trades=10, n_sims=100, starting_balance=50_000, max_drawdown=2_000)
    assert mc2["prob_breach"] == 1.0 and mc2["max_dd_pct"][50] == pytest.approx(5000.0)
    mixed = risk.monte_carlo([100, -50, 200, -100, 50, -50], n_trades=100, n_sims=500,
                             starting_balance=50_000, max_drawdown=2_000, seed=1)
    assert mixed["final_pnl_pct"][5] <= mixed["final_pnl_pct"][50] <= mixed["final_pnl_pct"][95]
    assert mixed["paths"].shape == (200, 100)
    assert risk.monte_carlo([], 10)["prob_breach"] is None


def test_what_if_and_breaches():
    w = risk.what_if(0.5, 200, 100, n_trades=50, starting_balance=50_000, max_drawdown=2_000, n_sims=300)
    assert w["prob_profit"] > 0.9
    daily = pd.Series([-1_200, 300, -900, -1_000],
                      index=pd.date_range("2026-09-01", periods=4))
    b = risk.find_breaches(daily, 50_000, 1_000, 2_000)
    assert (b["rule"] == "daily_loss_limit").sum() == 2               # -1,200 and -1,000
    assert (b["rule"] == "trailing_drawdown").sum() >= 1              # balance 47,200 < 48,000
