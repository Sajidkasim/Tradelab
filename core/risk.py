"""Risk engine: position sizing, prop-firm rule tracking, risk of ruin, Kelly,
losing-streak odds and Monte Carlo projections.

Everything takes its limits as arguments so it works for any account.
"""
from __future__ import annotations

import math
from typing import Optional, Sequence

import numpy as np
import pandas as pd

from .instruments import dollar_risk_per_contract, ticks_between


# --------------------------------------------------------------------------
# Position sizing
# --------------------------------------------------------------------------
def position_size(entry: float, stop: float, multiplier: float, tick_size: float,
                  account_balance: float, risk_pct: Optional[float] = None,
                  risk_dollars: Optional[float] = None,
                  max_contracts: Optional[int] = None,
                  commission_per_contract: float = 0.0) -> dict:
    """Contracts to trade so a stop-out costs at most the chosen risk.

    Give either risk_pct (% of account_balance) or risk_dollars.
    """
    if risk_dollars is None:
        if risk_pct is None:
            raise ValueError("give risk_pct or risk_dollars")
        risk_dollars = account_balance * risk_pct / 100.0
    per_contract = dollar_risk_per_contract(entry, stop, multiplier) + commission_per_contract
    n = 0
    if per_contract > 0 and risk_dollars > 0:
        n = int(math.floor(risk_dollars / per_contract))
        if max_contracts is not None:
            n = min(n, max_contracts)
    return {
        "contracts": n,
        "risk_budget": risk_dollars,
        "stop_ticks": ticks_between(entry, stop, tick_size),
        "risk_per_contract": per_contract,
        "total_risk": n * per_contract,
        "risk_pct_of_account": (n * per_contract / account_balance * 100) if account_balance else None,
        "capped_by_max_contracts": (max_contracts is not None and
                                    per_contract > 0 and
                                    math.floor(risk_dollars / per_contract) > max_contracts),
    }


def risk_for_contracts(contracts: int, entry: float, stop: float, multiplier: float,
                       account_balance: float, commission_per_contract: float = 0.0) -> dict:
    """Reverse: given N contracts, what is the dollar and % risk."""
    per = dollar_risk_per_contract(entry, stop, multiplier) + commission_per_contract
    total = per * contracts
    return {"risk_per_contract": per, "total_risk": total,
            "risk_pct_of_account": (total / account_balance * 100) if account_balance else None}


# --------------------------------------------------------------------------
# Daily loss limit
# --------------------------------------------------------------------------
def daily_status(realised_today: float, daily_loss_limit: float,
                 trades_today: int = 0, max_trades_per_day: Optional[int] = None,
                 amber_at: float = 0.5, red_at: float = 0.8) -> dict:
    """Traffic-light state against the daily loss limit.

    used = fraction of the limit consumed (0 when profitable).
    """
    loss = max(0.0, -realised_today)
    used = loss / daily_loss_limit if daily_loss_limit > 0 else 0.0
    if used >= 1.0:
        state = "breached"
    elif used >= red_at:
        state = "red"
    elif used >= amber_at:
        state = "amber"
    else:
        state = "green"
    if max_trades_per_day and trades_today >= max_trades_per_day and state == "green":
        state = "amber"
    return {"state": state, "realised_today": realised_today, "loss_used": loss,
            "limit": daily_loss_limit, "used_pct": used * 100,
            "remaining": max(0.0, daily_loss_limit - loss),
            "trades_today": trades_today, "max_trades_per_day": max_trades_per_day,
            "trades_remaining": (None if not max_trades_per_day
                                 else max(0, max_trades_per_day - trades_today))}


# --------------------------------------------------------------------------
# Trailing drawdown (prop-firm "maximum loss limit")
# --------------------------------------------------------------------------
def trailing_drawdown(balances: Sequence[float], starting_balance: float,
                      max_drawdown: float, lock_at: Optional[float] = "start") -> pd.DataFrame:
    """Track a trailing drawdown threshold over a sequence of balances.

    balances   : account balance after each period (end-of-day balances for an
                 EOD-trailing rule, per-trade balances for an intraday rule).
    lock_at    : balance at which the threshold stops trailing.
                 "start" (Topstep style) = it locks once it reaches starting_balance;
                 None = it trails forever; a number = lock at that balance.
    Returns columns: balance, high_water, threshold, buffer, breached.
    """
    lock = starting_balance if lock_at == "start" else lock_at
    hwm = starting_balance
    rows = []
    threshold = starting_balance - max_drawdown
    for b in balances:
        hwm = max(hwm, b)
        if lock is None or threshold < lock:
            threshold = max(threshold, hwm - max_drawdown)
            if lock is not None:
                threshold = min(threshold, lock)
        rows.append({"balance": b, "high_water": hwm, "threshold": threshold,
                     "buffer": b - threshold, "breached": b <= threshold})
    return pd.DataFrame(rows)


def trailing_drawdown_from_daily(daily_pnl: pd.Series, starting_balance: float,
                                 max_drawdown: float, lock_at="start") -> pd.DataFrame:
    bal = starting_balance + daily_pnl.cumsum()
    out = trailing_drawdown(bal.values, starting_balance, max_drawdown, lock_at)
    out.index = daily_pnl.index
    return out


# --------------------------------------------------------------------------
# Consistency rule
# --------------------------------------------------------------------------
def consistency(daily_pnl: pd.Series, target_pct: float = 50.0) -> dict:
    """Best day as a share of total profit, against a target (Topstep: 50%).

    needed_profit = extra profit on OTHER days required to bring the best day
    under the target.
    """
    if daily_pnl is None or len(daily_pnl) == 0:
        return {"best_day": 0.0, "total_profit": 0.0, "best_day_pct": None,
                "compliant": True, "needed_profit": 0.0, "target_pct": target_pct}
    total = float(daily_pnl.sum())
    best = float(daily_pnl.max())
    if total <= 0 or best <= 0:
        return {"best_day": best, "total_profit": total, "best_day_pct": None,
                "compliant": total <= 0, "needed_profit": 0.0, "target_pct": target_pct}
    pct = best / total * 100
    needed = max(0.0, best / (target_pct / 100.0) - total)
    return {"best_day": best, "total_profit": total, "best_day_pct": pct,
            "compliant": pct <= target_pct, "needed_profit": needed,
            "target_pct": target_pct, "best_day_date": daily_pnl.idxmax()}


# --------------------------------------------------------------------------
# Kelly, risk of ruin, streaks
# --------------------------------------------------------------------------
def kelly_fraction(win_rate: float, payoff_ratio: float) -> dict:
    """Kelly f* = p - q/b. Returns full, half and quarter Kelly (as fractions).
    Negative means no edge: do not trade."""
    if payoff_ratio <= 0:
        return {"full": None, "half": None, "quarter": None}
    f = win_rate - (1 - win_rate) / payoff_ratio
    return {"full": f, "half": f / 2, "quarter": f / 4}


def risk_of_ruin_approx(expectancy: float, std_dev: float, capital: float) -> Optional[float]:
    """Gaussian approximation of the probability of losing `capital` when each trade
    has mean `expectancy` and standard deviation `std_dev` (both in $).

    RoR = ((1 - A) / (1 + A)) ** (capital / std_dev), A = expectancy / std_dev.
    Returns 1.0 with no edge. Treat as an estimate; the Monte Carlo version is better.
    """
    if std_dev <= 0 or capital <= 0:
        return None
    a = expectancy / std_dev
    if a <= 0:
        return 1.0
    if a >= 1:
        return 0.0
    return float(((1 - a) / (1 + a)) ** (capital / std_dev))


def losing_streak_probability(win_rate: float, streak: int, n_trades: int) -> float:
    """Probability of at least one run of `streak` consecutive losses in `n_trades`.
    Exact, by dynamic programming over the current run length."""
    if streak <= 0:
        return 1.0
    if n_trades < streak:
        return 0.0
    q = 1 - win_rate
    p = win_rate
    # state = current losing run length 0..streak-1 ; absorbing when reaching streak
    dist = np.zeros(streak)
    dist[0] = 1.0
    absorbed = 0.0
    for _ in range(n_trades):
        new = np.zeros(streak)
        new[0] = dist.sum() * p
        new[1:] = dist[:-1] * q
        absorbed += dist[-1] * q
        dist = new
    return float(absorbed)


def expected_longest_losing_streak(win_rate: float, n_trades: int) -> float:
    """Rule-of-thumb expected longest losing run: ln(n) / -ln(1 - win_rate)."""
    q = 1 - win_rate
    if q <= 0 or q >= 1 or n_trades <= 0:
        return 0.0
    return float(math.log(n_trades) / -math.log(q))


# --------------------------------------------------------------------------
# Monte Carlo
# --------------------------------------------------------------------------
def monte_carlo(trade_pnls: Sequence[float], n_trades: int, n_sims: int = 2000,
                starting_balance: float = 0.0, max_drawdown: Optional[float] = None,
                lock_at="start", seed: Optional[int] = 42) -> dict:
    """Bootstrap the trade distribution to project outcomes.

    Resamples `n_trades` outcomes with replacement from `trade_pnls`, `n_sims` times.
    Returns percentiles of final P&L and max drawdown, and the probability of
    breaching a trailing drawdown of `max_drawdown` (per-trade check).
    """
    pnls = np.asarray(list(trade_pnls), dtype=float)
    if pnls.size == 0 or n_trades <= 0:
        return {"final_pnl_pct": {}, "max_dd_pct": {}, "prob_breach": None,
                "prob_profit": None, "paths": None}
    rng = np.random.default_rng(seed)
    samples = rng.choice(pnls, size=(n_sims, n_trades), replace=True)
    equity = np.cumsum(samples, axis=1)
    balance = starting_balance + equity
    # max drawdown per path (from running peak including the start)
    with_start = np.concatenate([np.full((n_sims, 1), starting_balance), balance], axis=1)
    peaks = np.maximum.accumulate(with_start, axis=1)
    dd = (peaks - with_start).max(axis=1)
    final = equity[:, -1]

    prob_breach = None
    if max_drawdown is not None:
        lock = starting_balance if lock_at == "start" else lock_at
        thr = np.full(n_sims, starting_balance - max_drawdown)
        hwm = np.full(n_sims, starting_balance)
        breached = np.zeros(n_sims, dtype=bool)
        for i in range(n_trades):
            b = balance[:, i]
            hwm = np.maximum(hwm, b)
            new_thr = hwm - max_drawdown
            if lock is not None:
                new_thr = np.minimum(new_thr, lock)
            thr = np.maximum(thr, new_thr)
            breached |= b <= thr
        prob_breach = float(breached.mean())

    pct = [5, 25, 50, 75, 95]
    return {
        "final_pnl_pct": {p: float(np.percentile(final, p)) for p in pct},
        "max_dd_pct": {p: float(np.percentile(dd, p)) for p in pct},
        "prob_breach": prob_breach,
        "prob_profit": float((final > 0).mean()),
        "worst_5pct_drawdown": float(np.percentile(dd, 95)),
        "paths": equity[: min(n_sims, 200)],   # a sample of paths for plotting
        "n_sims": n_sims, "n_trades": n_trades,
    }


def what_if(win_rate: float, avg_win: float, avg_loss: float, n_trades: int,
            starting_balance: float, max_drawdown: Optional[float] = None,
            n_sims: int = 2000, seed: Optional[int] = 42) -> dict:
    """Project outcomes from a hypothetical win rate and win/loss sizes
    (e.g. sliders for risk per trade). Uses monte_carlo under the hood."""
    rng = np.random.default_rng(seed)
    # build a synthetic outcome distribution with the requested moments
    n = 1000
    wins = int(round(n * win_rate))
    synthetic = np.r_[np.full(wins, avg_win), np.full(n - wins, -abs(avg_loss))]
    rng.shuffle(synthetic)
    return monte_carlo(synthetic, n_trades, n_sims, starting_balance, max_drawdown, seed=seed)


# --------------------------------------------------------------------------
# Historical rule breaches
# --------------------------------------------------------------------------
def find_breaches(daily_pnl: pd.Series, starting_balance: float,
                  daily_loss_limit: float, max_drawdown: float,
                  lock_at="start") -> pd.DataFrame:
    """Which past days broke the daily loss limit or the trailing drawdown."""
    rows = []
    if daily_pnl is None or len(daily_pnl) == 0:
        return pd.DataFrame(columns=["date", "rule", "value", "limit"])
    for d, v in daily_pnl.items():
        if v <= -daily_loss_limit:
            rows.append({"date": d, "rule": "daily_loss_limit", "value": float(v),
                         "limit": -daily_loss_limit})
    td = trailing_drawdown_from_daily(daily_pnl, starting_balance, max_drawdown, lock_at)
    for d, r in td[td["breached"]].iterrows():
        rows.append({"date": d, "rule": "trailing_drawdown", "value": float(r["balance"]),
                     "limit": float(r["threshold"])})
    return pd.DataFrame(rows, columns=["date", "rule", "value", "limit"])
