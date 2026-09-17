"""Realistic demo data so the app is explorable before any real import.

seed_demo_trades(n=200) -> list[Trade] across three setups with different edges,
sessions, mistakes and confidence ratings. Deterministic for a given seed.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np

from .instruments import instrument_map, round_to_tick
from .models import Direction, Source, Trade

SETUPS = {
    # name: (win_rate, avg_win_R, avg_loss_R, share)
    "ORB":            (0.48, 2.1, 1.0, 0.40),
    "VWAP reclaim":   (0.58, 1.4, 1.0, 0.35),
    "Failed breakdown": (0.40, 2.8, 1.0, 0.25),
}
MISTAKES = ["chased entry", "moved stop", "oversized", "no setup", "revenge trade", "early exit"]


def seed_demo_trades(n: int = 200, seed: int = 7, start: datetime | None = None,
                     account_id: int | None = 1) -> list[Trade]:
    rng = np.random.default_rng(seed)
    inst = instrument_map()
    symbols = ["MES", "MNQ", "ES", "MES", "MNQ"]
    # ~1.5 trades per weekday, so n trades span roughly n * 7/5 / 1.5 days; end a few days ago
    span_days = int(n * 7 / 5 / 1.5) + 5
    start = start or (datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
                      - timedelta(days=span_days))
    names = list(SETUPS)
    shares = np.array([SETUPS[k][3] for k in names]); shares /= shares.sum()
    trades: list[Trade] = []
    day = start
    i = 0
    while i < n:
        day += timedelta(days=1)
        if day.weekday() >= 5:
            continue
        for _ in range(int(rng.integers(0, 4))):
            if i >= n:
                break
            setup = names[rng.choice(len(names), p=shares)]
            wr, aw, al, _ = SETUPS[setup]
            sym = symbols[int(rng.integers(0, len(symbols)))]
            ins = inst[sym]
            direction = Direction.LONG if rng.random() < 0.55 else Direction.SHORT
            # entry between 13:30 and 20:00 UTC (US session), skewed to the open
            minute = int(np.clip(rng.gamma(2.0, 45), 0, 390))
            entry_time = day.replace(hour=13, minute=30) + timedelta(minutes=minute)
            hold = int(np.clip(rng.lognormal(3.2, 0.7), 2, 300))
            exit_time = entry_time + timedelta(minutes=hold)
            base = {"MES": 5400, "ES": 5400, "MNQ": 19000}[sym] + rng.normal(0, 60)
            entry = round_to_tick(base, ins.tick_size)
            stop_pts = round_to_tick(max(ins.tick_size * 4, abs(rng.normal(8 if "N" in sym else 4, 2))), ins.tick_size)
            qty = int(rng.integers(1, 4)) if sym.startswith("M") else 1
            rules = rng.random() < 0.8
            mistakes = []
            if not rules or rng.random() < 0.12:
                mistakes = list(rng.choice(MISTAKES, size=int(rng.integers(1, 3)), replace=False))
            eff_wr = wr - (0.15 if mistakes else 0.0)
            win = rng.random() < eff_wr
            r = abs(rng.normal(aw, 0.6)) if win else -abs(rng.normal(al, 0.25))
            if not win and "moved stop" in mistakes:
                r *= 1.8
            exit_pts = r * stop_pts
            exit_price = round_to_tick(entry + exit_pts * direction.sign, ins.tick_size)
            stop_price = round_to_tick(entry - stop_pts * direction.sign, ins.tick_size)
            target_price = round_to_tick(entry + aw * stop_pts * direction.sign, ins.tick_size)
            t = Trade(
                symbol=sym, direction=direction, qty=qty, entry_time=entry_time,
                exit_time=exit_time, entry_price=entry, exit_price=exit_price,
                stop_price=stop_price, target_price=target_price, multiplier=ins.multiplier,
                fees=ins.commission_per_contract * qty, source=Source.DEMO,
                external_id=f"demo-{seed}-{i}", account_id=account_id, setup_name=setup,
                timeframe="5m" if setup != "ORB" else "1m",
                rules_followed=rules, mistake_tags=mistakes,
                confidence=int(np.clip(round(rng.normal(3.6 if win else 3.0, 0.9)), 1, 5)),
                notes="", tags=[],
            )
            trades.append(t)
            i += 1
    from .metrics import compute_trade_fields, assign_sessions  # noqa: F401
    for t in trades:
        compute_trade_fields(t)
        from .metrics import session_of
        t.session = session_of(t.entry_time, "America/New_York",
                               {"Pre-market": (datetime.min.time(), datetime.strptime("09:30", "%H:%M").time()),
                                "NY open": (datetime.strptime("09:30", "%H:%M").time(), datetime.strptime("11:00", "%H:%M").time()),
                                "Midday": (datetime.strptime("11:00", "%H:%M").time(), datetime.strptime("14:00", "%H:%M").time()),
                                "Power hour": (datetime.strptime("14:00", "%H:%M").time(), datetime.strptime("16:00", "%H:%M").time())})
    return trades
