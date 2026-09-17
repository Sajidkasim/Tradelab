"""Backtester on hand-built bars with known answers. Multiplier 1, tick 0.25 unless stated."""
from datetime import datetime, time, timedelta

import numpy as np
import pandas as pd
import pytest

from core.backtest import (BacktestConfig, run_backtest, sweep, plateau_check, walk_forward,
                           build_rule_strategy, load_strategies, ema, rsi, atr, vwap)


def bars(rows, start=datetime(2026, 9, 1, 9, 30), step=1):
    """rows: list of (o, h, l, c)."""
    return pd.DataFrame({"t": [start + timedelta(minutes=step * i) for i in range(len(rows))],
                         "o": [r[0] for r in rows], "h": [r[1] for r in rows],
                         "l": [r[2] for r in rows], "c": [r[3] for r in rows], "v": 100})


def signal_at(index, value=1):
    def fn(b, params):
        s = pd.Series(0, index=b.index)
        s.iloc[index] = value
        return s
    return fn


CFG = BacktestConfig(symbol="T", multiplier=1.0, tick_size=0.25, commission_per_contract=0.0,
                     slippage_ticks=0.0, starting_balance=1_000, contracts=1,
                     stop_points=5, target_points=10)


def test_signal_fills_next_bar_open_and_target_exits_at_level():
    b = bars([(100, 101, 99, 100.5),     # signal read at this close
              (100, 102, 99.5, 101),     # fill at open 100
              (101, 111, 100.5, 108),    # high 111 >= target 110 -> exit at 110
              (108, 109, 107, 108)])
    r = run_backtest(b, signal_at(0), {}, CFG)
    assert r.stats["trades"] == 1
    t = r.trades.iloc[0]
    assert t["entry_price"] == 100 and t["entry_time"] == b["t"][1]
    assert t["exit_price"] == 110 and t["exit_time"] == b["t"][2]
    assert t["net_pnl"] == pytest.approx(10.0) and t["r_multiple"] == pytest.approx(2.0)
    assert t["tags"] == ["target"]
    assert r.stats["exit_reasons"] == {"target": 1}


def test_stop_hit_first_when_both_touched_same_bar():
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 112, 94, 105)])
    r = run_backtest(b, signal_at(0), {}, CFG)
    t = r.trades.iloc[0]
    assert t["tags"] == ["stop"] and t["exit_price"] == 95 and t["net_pnl"] == pytest.approx(-5.0)


def test_gap_through_stop_fills_at_open():
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (92, 93, 90, 91)])
    r = run_backtest(b, signal_at(0), {}, CFG)
    t = r.trades.iloc[0]
    assert t["exit_price"] == 92 and t["net_pnl"] == pytest.approx(-8.0)


def test_slippage_and_commission_arithmetic():
    cfg = BacktestConfig(**{**CFG.__dict__, "slippage_ticks": 1.0, "commission_per_contract": 1.0})
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 100, 94, 96)])
    r = run_backtest(b, signal_at(0), {}, cfg)
    t = r.trades.iloc[0]
    # entry slipped to 100.25; stop at 95.25; stop exit slipped to 95.00; fee 1 -> -6.25
    assert t["entry_price"] == 100.25 and t["stop_price"] == 95.25
    assert t["exit_price"] == 95.0 and t["net_pnl"] == pytest.approx(-6.25)
    # a target is a limit order: it fills at the level, no extra slippage
    b2 = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 115, 100, 112)])
    t2 = run_backtest(b2, signal_at(0), {}, cfg).trades.iloc[0]
    assert t2["exit_price"] == 110.25 and t2["net_pnl"] == pytest.approx(9.0)


def test_short_side_mirror():
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 100.5, 89, 90)])
    r = run_backtest(b, signal_at(0, -1), {}, CFG)
    t = r.trades.iloc[0]
    assert t["direction"] == "short" and t["exit_price"] == 90 and t["net_pnl"] == pytest.approx(10.0)


def test_no_lookahead_signal_on_last_bar_never_fills():
    b = bars([(100, 101, 99, 100.5), (100, 102, 99, 101)])
    r = run_backtest(b, signal_at(1), {}, CFG)
    assert r.stats["trades"] == 0


def test_trailing_stop_ratchets_after_bar_not_during():
    cfg = BacktestConfig(**{**CFG.__dict__, "stop_points": None, "target_points": None, "trailing_points": 3})
    b = bars([(100, 101, 99, 100.5),
              (100, 100, 100, 100),      # entry 100, trail stop = 97 (from entry extreme)
              (100, 110, 100, 109),      # high 110 -> after bar, stop = 107
              (109, 109, 106, 106.5),    # low 106 <= 107 -> stop hit at 107
              ])
    r = run_backtest(b, signal_at(0), {}, cfg)
    t = r.trades.iloc[0]
    assert t["exit_price"] == 107 and t["net_pnl"] == pytest.approx(7.0) and t["tags"] == ["stop"]


def test_time_exit_and_end_of_data():
    cfg = BacktestConfig(**{**CFG.__dict__, "stop_points": None, "target_points": None, "max_bars_in_trade": 2})
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 101, 99, 102), (102, 103, 101, 103)])
    t = run_backtest(b, signal_at(0), {}, cfg).trades.iloc[0]
    assert t["tags"] == ["time"] and t["exit_price"] == 102 and t["exit_time"] == b["t"][2]
    cfg2 = BacktestConfig(**{**CFG.__dict__, "stop_points": None, "target_points": None})
    t2 = run_backtest(b, signal_at(0), {}, cfg2).trades.iloc[0]
    assert t2["tags"] == ["end_of_data"] and t2["exit_price"] == 103


def test_session_flat_and_no_entries_outside_session():
    cfg = BacktestConfig(**{**CFG.__dict__, "stop_points": None, "target_points": None,
                            "session_start": time(9, 30), "session_end": time(9, 33)})
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 101, 99, 104),   # 9:30, 9:31, 9:32
              (104, 105, 103, 105), (105, 106, 104, 106)])                        # 9:33, 9:34 out of session
    r = run_backtest(b, signal_at(0), {}, cfg)
    t = r.trades.iloc[0]
    assert t["tags"] == ["session_end"] and t["exit_price"] == 104 and t["exit_time"] == b["t"][2]
    r2 = run_backtest(b, signal_at(2), {}, cfg)      # would fill at 9:33 -> outside session
    assert r2.stats["trades"] == 0


def test_risk_based_sizing_uses_stop_distance():
    cfg = BacktestConfig(**{**CFG.__dict__, "multiplier": 5.0, "risk_dollars": 100, "max_contracts": 10,
                            "stop_points": 4, "target_points": 8})
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 109, 100, 108)])
    t = run_backtest(b, signal_at(0), {}, cfg).trades.iloc[0]
    assert t["qty"] == 5                       # $100 / (4 pts * $5) = 5
    assert t["net_pnl"] == pytest.approx(8 * 5 * 5)


def test_flip_closes_and_reverses():
    cfg = BacktestConfig(**{**CFG.__dict__, "stop_points": None, "target_points": None})
    def fn(b, p):
        s = pd.Series(0, index=b.index); s.iloc[0] = 1; s.iloc[2] = -1; return s
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 101, 99, 103), (103, 103, 103, 103), (103, 104, 98, 99)])
    r = run_backtest(b, fn, {}, cfg)
    assert r.stats["trades"] == 2
    assert list(r.trades["direction"]) == ["long", "short"]
    assert r.trades.iloc[0]["tags"] == ["flip"] and r.trades.iloc[0]["exit_price"] == 103
    assert r.trades.iloc[1]["net_pnl"] == pytest.approx(4.0)


def test_equity_marks_to_market_each_bar():
    b = bars([(100, 101, 99, 100.5), (100, 100, 100, 100), (100, 103, 100, 103), (103, 104, 102, 104)])
    cfg = BacktestConfig(**{**CFG.__dict__, "stop_points": None, "target_points": None})
    r = run_backtest(b, signal_at(0), {}, cfg)
    assert list(r.equity["equity"]) == [1000, 1000, 1003, 1004]


def test_sweep_walk_forward_and_plateau():
    rng = np.random.default_rng(0)
    n = 600
    px = 100 + np.cumsum(rng.normal(0, 0.5, n))
    b = pd.DataFrame({"t": pd.date_range("2026-01-05 09:30", periods=n, freq="1min"),
                      "o": px, "c": px + rng.normal(0, 0.1, n)})
    b["h"] = b[["o", "c"]].max(axis=1) + 0.2; b["l"] = b[["o", "c"]].min(axis=1) - 0.2; b["v"] = 1
    strat = build_rule_strategy([{"type": "ma_cross", "fast": 5, "slow": 20}])
    def param_strat(bars_, params):
        return build_rule_strategy([{"type": "ma_cross", "fast": params["fast"], "slow": params["slow"]}])(bars_, params)
    cfg = BacktestConfig(**{**CFG.__dict__, "stop_points": 2, "target_points": 4})
    res = sweep(b, param_strat, {"fast": [3, 5, 8], "slow": [15, 20, 30]}, cfg)
    assert len(res) == 9 and {"fast", "slow", "expectancy", "trades"} <= set(res.columns)
    pc = plateau_check(res, "fast", "slow", "expectancy")
    assert "verdict" in pc
    wf = walk_forward(b, param_strat, {"fast": [3, 5], "slow": [15, 20]}, cfg, n_windows=2, min_trades=1)
    assert len(wf["windows"]) == 2 and "oos_stats" in wf
    assert run_backtest(b, strat, {}, cfg).stats["trades"] > 0


def test_indicators_and_plugin_loading(tmp_path):
    s = pd.Series(np.arange(1, 31, dtype=float))
    assert ema(s, 5).iloc[-1] > ema(s, 20).iloc[-1]
    r = rsi(s, 14).dropna()
    assert (r > 99).all()                       # monotonic rise -> RSI ~ 100
    b = bars([(100, 101, 99, 100)] * 20)
    assert atr(b, 14).dropna().iloc[-1] == pytest.approx(2.0)
    assert vwap(b).iloc[-1] == pytest.approx(100.0)
    (tmp_path / "good.py").write_text("PARAMS={'n':1}\ndef generate_signals(b,p):\n    import pandas as pd\n    return pd.Series(0,index=b.index)\n")
    (tmp_path / "bad.py").write_text("raise RuntimeError('boom')\n")
    found = load_strategies(tmp_path)
    assert "good" in found and found["good"]["params"] == {"n": 1}
    assert "error" in found["bad"]
    orb = load_strategies("strategies")
    assert "example_orb" in orb and orb["example_orb"]["params"]["or_minutes"] == 15
