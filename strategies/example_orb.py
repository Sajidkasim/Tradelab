"""Opening Range Breakout.

Opening range = high/low of the first `or_minutes` after `session_start`.
After the range is complete, the first bar that CLOSES above the range high
signals long (stop = range low, target = entry + target_r * range height);
the first close below the range low signals short. One signal per day.

Signals are read at bar close and filled at the next bar's open by the engine.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta

import numpy as np
import pandas as pd

PARAMS = {"or_minutes": 15, "session_start": "09:30", "target_r": 2.0}
RANGES = {"or_minutes": [5, 10, 15, 30], "target_r": [1.0, 1.5, 2.0, 3.0]}


def generate_signals(bars: pd.DataFrame, params: dict) -> pd.DataFrame:
    p = {**PARAMS, **(params or {})}
    start = time.fromisoformat(str(p["session_start"]))
    or_len = timedelta(minutes=int(p["or_minutes"]))
    target_r = float(p["target_r"])

    t = pd.to_datetime(bars["t"])
    out = pd.DataFrame({"signal": 0, "stop": np.nan, "target": np.nan}, index=bars.index)
    for day, idx in bars.groupby(t.dt.date).groups.items():
        idx = list(idx)
        day_start = datetime.combine(day, start)
        or_end = day_start + or_len
        tt = t.loc[idx]
        in_or = (tt >= day_start) & (tt < or_end)
        if not in_or.any():
            continue
        or_high = bars.loc[in_or[in_or].index, "h"].max()
        or_low = bars.loc[in_or[in_or].index, "l"].min()
        rng = or_high - or_low
        if rng <= 0:
            continue
        after = tt >= or_end
        for i in after[after].index:
            c = bars.at[i, "c"]
            if c > or_high:
                out.at[i, "signal"] = 1
                out.at[i, "stop"] = or_low
                out.at[i, "target"] = c + target_r * rng
                break
            if c < or_low:
                out.at[i, "signal"] = -1
                out.at[i, "stop"] = or_high
                out.at[i, "target"] = c - target_r * rng
                break
    return out
