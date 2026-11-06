"""Finite Traditional pivots from Primus's existing New York daily candles."""
from datetime import datetime, timedelta

from services.replay_chart_history import NY, bucket


def daily_segments(completed, cutoff, periods=2):
    opened = bucket(cutoff, "1D")
    rows = [row for row in completed if row[0] < opened and row[6] <= cutoff + 60_000]
    starts = [row[0] for row in rows] + [opened]
    # Advance in New York wall time to keep the boundary stable across DST.
    next_open = datetime.fromtimestamp(opened / 1000, NY) + timedelta(days=1)
    ends = [min(row[6], following) for row, following in zip(rows, starts[1:])]
    ends.append(int(next_open.timestamp() * 1000))
    result = []
    for index in range(max(1, len(starts) - periods), len(starts)):
        _, _, high, low, close, *_ = rows[index - 1]
        p = (high + low + close) / 3
        span = high - low
        result.append({"start": starts[index], "end": ends[index], "levels": {
            "P": p, "R1": 2*p-low, "S1": 2*p-high, "R2": p+span, "S2": p-span,
            "R3": 2*p+high-2*low, "S3": 2*p-2*high+low,
            "R4": 3*p+high-3*low, "S4": 3*p-3*high+low,
            "R5": 4*p+high-4*low, "S5": 4*p-4*high+low,
        }})
    return result
