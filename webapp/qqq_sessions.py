"""Regular-hours QQQ chart history from the indexed minute archive."""
from datetime import datetime, time, timedelta, timezone

from services.replay_chart_history import FIELDS, NY
from .spot_replay import connect

MINUTE = 60_000


def epoch(day, hour, minute=0):
    return int(datetime.combine(day, time(hour, minute), NY).timestamp() * 1000)


def regular_window(path, timeframe, before, cutoff, limit, after):
    calendar = timeframe in ('1D', '1W', '1M')
    # Calendar pages cover more source minutes per candle.
    limit = min(limit, {'1D': 120, '1W': 52, '1M': 24}.get(timeframe, limit))
    forward = after is not None
    edge = cutoff if forward else min(cutoff, before - 1)
    start_day = datetime.fromtimestamp((after if forward and after >= 0 else edge) / 1000, timezone.utc).astimezone(NY).date()
    with connect(path) as db:
        first, last = (db.execute(
            f'SELECT time FROM spot_bars WHERE symbol=? ORDER BY time {order} LIMIT 1', ('QQQ',)
        ).fetchone()[0] for order in ('ASC', 'DESC'))
        first_day = datetime.fromtimestamp(first / 1000, timezone.utc).astimezone(NY).date()
        last_day = datetime.fromtimestamp(min(last, edge) / 1000, timezone.utc).astimezone(NY).date()
        day = max(first_day, start_day) if forward else min(last_day, start_day)
        bars = {}
        while first_day <= day <= last_day:
            opened = epoch(day, 9, 30)
            if day.weekday() < 5:
                rows = db.execute(
                    'SELECT time,open,high,low,close,volume FROM spot_bars '
                    'WHERE symbol=? AND time>=? AND time<? ORDER BY time ' + ('ASC' if forward else 'DESC'),
                    ('QQQ', opened, min(epoch(day, 16), cutoff + 1)),
                )
                for stamp, o, h, l, c, v in rows:
                    if timeframe == '1W':
                        key = epoch(day - timedelta(days=day.weekday()), 9, 30)
                    elif timeframe == '1M':
                        key = epoch(day.replace(day=1), 9, 30)
                    elif calendar:
                        key = opened
                    else:
                        interval = int(timeframe) * MINUTE
                        key = opened + (stamp - opened) // interval * interval
                    if key >= before or (forward and key <= after):
                        continue
                    bar = bars.get(key)
                    if bar is None:
                        bars[key] = [o, h, l, c, v]
                    else:
                        if not forward:
                            bar[0] = o
                        bar[1] = max(bar[1], h)
                        bar[2] = min(bar[2], l)
                        if forward:
                            bar[3] = c
                        bar[4] += v
            next_day = day + timedelta(days=1 if forward else -1)
            if len(bars) > limit and (
                (timeframe != '1W' or next_day.isocalendar()[:2] != day.isocalendar()[:2])
                and (timeframe != '1M' or next_day.month != day.month)
            ):
                break
            day = next_day
    ordered = sorted(bars)
    selected = ordered[:limit] if forward else ordered[-limit:]
    return {'bars': [dict(zip(FIELDS, (key, *bars[key]))) for key in selected],
            'earliest': first, 'latest': last, 'replay_time': cutoff,
            'exhausted': len(ordered) <= limit, 'timezone': 'America/New_York'}
