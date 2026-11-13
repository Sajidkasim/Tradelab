"""Private, local Dukascopy bid candle archive, separate from futures."""
import json
import sqlite3
from contextlib import closing
from datetime import date, datetime, timezone
from hashlib import sha256

from services.replay_chart_history import FIELDS, aggregate, bucket

SYMBOLS = ('EURUSD', 'GBPUSD', 'XAUUSD')
TIMEFRAMES = ('5', '15', '30', '60', '240', '1D', '1W', '1M')
DAY_MS = 86400000
FILENAME = 'dukascopy-replay.db'


def connect(path):
    return closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True))


def coverage(path, symbol):
    if not path.is_file():
        return []
    with connect(path) as db:
        return [row[0] for row in db.execute(
            'SELECT day FROM spot_days WHERE symbol=? AND count>0 ORDER BY day', (symbol,))]


def history(path, symbol, day):
    if not path.is_file():
        raise ValueError('Import Dukascopy candles into the local archive first.')
    with connect(path) as db:
        start = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()) * 1000
        rows = db.execute('SELECT time,open,high,low,close,volume FROM spot_bars '
                          'WHERE symbol=? AND time>=? AND time<? ORDER BY time',
                          (symbol, start, start + DAY_MS)).fetchall()
    if not rows:
        raise ValueError(f'No Dukascopy candles are available for {symbol} on {day}.')
    return {'day': day, 'history_version': 1, 'markets': {
        symbol: {'contract': symbol, 'bars': [dict(zip(FIELDS, row)) for row in rows]}
    }}, sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()


def start_time(path, symbol, day):
    data, _ = history(path, symbol, day)
    bars = data['markets'][symbol]['bars']
    # Keep the normal start when coverage extends past it; otherwise pick a
    # start after the first bar closes with room to replay.
    midnight = bars[0]['time'] // DAY_MS * DAY_MS
    normal = midnight + (13 * 60 + 30) * 60000
    first_close = bars[0]['time'] + 60000
    stamp = normal if first_close <= normal < bars[-1]['time'] + 60000 else first_close
    return datetime.fromtimestamp(stamp / 1000, timezone.utc).strftime('%H:%M')


def window(path, symbol, tf, before, cutoff, limit, after):
    end = min(before - 1, cutoff)
    with connect(path) as db:
        exhausted = None
        def bound(order):
            return db.execute(f'SELECT time FROM spot_bars WHERE symbol=? ORDER BY time {order} LIMIT 1',
                              (symbol,)).fetchone()[0]
        first, last = bound('ASC'), bound('DESC')
        if tf == '1':
            rows = db.execute(
                'SELECT time,open,high,low,close,volume FROM spot_bars '
                'WHERE symbol=? AND time>? AND time<=? ORDER BY time '
                + ('ASC' if after is not None else 'DESC') + ' LIMIT ?',
                (symbol, after if after is not None else -1, end, limit + 1)).fetchall()
            selected = sorted(rows[:limit])
        elif tf not in TIMEFRAMES:
            # Custom intraday intervals use a bounded, indexed minute scan.
            from_time = max(first, bucket(end, tf) - int(tf) * 60000 * (limit + 8))
            if after is not None:
                from_time = max(first, after + 1)
                end = min(end, from_time + int(tf) * 60000 * (limit + 8))
            minutes = db.execute('SELECT time,open,high,low,close,volume FROM spot_bars '
                                 'WHERE symbol=? AND time>=? AND time<=? ORDER BY time',
                                 (symbol, from_time, end))
            rows = [row for row in aggregate(minutes, tf) if after is None or row[0] > after]
            selected = rows[:limit] if after is not None else rows[-limit:]
            exhausted = len(rows) <= limit and (end >= cutoff if after is not None else from_time <= first)
        else:
            opened = bucket(end, tf)
            if opened is None:
                opened = end

            where = 'symbol=? AND tf=? AND time<? AND time>? AND end<=?'
            params = (symbol, tf, min(before, opened), after if after is not None else -1, cutoff + 60000, limit + 1)
            rows = db.execute('SELECT time,open,high,low,close,volume FROM spot_chart WHERE '
                              + where + ' ORDER BY time ' + ('ASC' if after is not None else 'DESC') + ' LIMIT ?', params).fetchall()
            if (after is None or opened > after) and len(rows) <= limit:
                tail = db.execute('SELECT time,open,high,low,close,volume FROM spot_bars '
                                  'WHERE symbol=? AND time>=? AND time<=? ORDER BY time',
                                  (symbol, opened, end))
                rows.extend(aggregate(tail, tf))
            rows.sort(key=lambda row: row[0])
            selected = rows[:limit] if after is not None else rows[-limit:]
    return {'bars': [dict(zip(FIELDS, row)) for row in selected], 'earliest': first,
            'latest': last, 'replay_time': cutoff, 'exhausted': len(rows) <= limit if exhausted is None else exhausted,
            'timezone': 'America/New_York'}
