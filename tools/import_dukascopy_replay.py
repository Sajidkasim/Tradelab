"""Import official Dukascopy 1-minute bid CSV exports into local Backtesting."""
import argparse
import csv
import math
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.replay_chart_history import bucket
from webapp.spot_replay import FILENAME, SYMBOLS, TIMEFRAMES

SCHEMA = """
CREATE TABLE IF NOT EXISTS spot_bars (
 symbol TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL,
 PRIMARY KEY(symbol,time)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS spot_days (
 symbol TEXT, day TEXT, count INTEGER, PRIMARY KEY(symbol,day)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS spot_chart (
 symbol TEXT, tf TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL,
 volume REAL, end INTEGER, PRIMARY KEY(symbol,tf,time)
) WITHOUT ROWID;
"""


def parse(row):
    row = {key.strip().lower(): value for key, value in row.items() if key}
    stamp = next((row[key] for key in ('gmt time', 'utc time', 'etc/utc', 'utc', 'time', 'timestamp') if key in row), None)
    if not stamp:
        raise ValueError('Expected a UTC/GMT timestamp column.')
    stamp = stamp.strip().removesuffix(' GMT')
    try:
        clock = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    except ValueError:
        clock = datetime.strptime(stamp.split('.')[0] if stamp[:4].isdigit() else stamp[:19],
                                  '%Y-%m-%d %H:%M:%S' if stamp[:4].isdigit() else '%d.%m.%Y %H:%M:%S')
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    clock = clock.astimezone(timezone.utc)
    prices = [float(row[key]) for key in ('open', 'high', 'low', 'close', 'volume')]
    o, h, l, c, v = prices
    if (clock.second or clock.microsecond or not all(map(math.isfinite, prices))
            or l <= 0 or l > min(o, c) or h < max(o, c) or v < 0):
        raise ValueError(f'Invalid one-minute candle at {clock.isoformat()}.')
    return int(clock.timestamp()) * 1000, *prices


def import_files(database, symbol, files):
    with sqlite3.connect(database) as db:
        db.executescript(SCHEMA)
        touched = set()
        for file in files:
            with open(file, encoding='utf-8-sig', newline='') as source:
                reader = csv.DictReader(source)
                for row in reader:
                    try:
                        candle = parse(row)
                    except (ValueError, KeyError, TypeError) as exc:
                        raise ValueError(f'{file}:{reader.line_num}: {exc}') from exc
                    previous = db.execute('SELECT open,high,low,close,volume FROM spot_bars WHERE symbol=? AND time=?',
                                          (symbol, candle[0])).fetchone()
                    if previous is not None:
                        if previous != candle[1:]:
                            raise ValueError(f'{file}:{reader.line_num}: conflicting saved candle.')
                        continue
                    db.execute('INSERT INTO spot_bars VALUES (?,?,?,?,?,?,?)', (symbol, *candle))
                    touched.add(candle[0] // 86400000 * 86400000)
        for start in sorted(touched):
            day = datetime.fromtimestamp(start / 1000, timezone.utc).date().isoformat()
            count = db.execute('SELECT count(*) FROM spot_bars WHERE symbol=? AND time>=? AND time<?',
                               (symbol, start, start + 86400000)).fetchone()[0]
            db.execute('INSERT OR REPLACE INTO spot_days VALUES (?,?,?)', (symbol, day, count))
        if not touched:
            return
        for tf in TIMEFRAMES:
            db.execute('DELETE FROM spot_chart WHERE symbol=? AND tf=?', (symbol, tf))
            current = None
            for t, o, h, l, c, v in db.execute(
                'SELECT time,open,high,low,close,volume FROM spot_bars WHERE symbol=? ORDER BY time', (symbol,)
            ):
                opened = bucket(t, tf)
                if opened is None:
                    continue
                if current is None or opened != current[0]:
                    if current is not None:
                        db.execute('INSERT INTO spot_chart VALUES (?,?,?,?,?,?,?,?,?)', (symbol, tf, *current))
                    current = [opened, o, h, l, c, v, t + 60000]
                else:
                    current[2:] = [max(h, current[2]), min(l, current[3]), c, current[5] + v, t + 60000]
            if current is not None:
                db.execute('INSERT INTO spot_chart VALUES (?,?,?,?,?,?,?,?,?)', (symbol, tf, *current))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('symbol', choices=SYMBOLS)
    parser.add_argument('files', nargs='+', type=Path, help='Official UTC/GMT bid OHLCV CSV exports')
    parser.add_argument('--db', type=Path, default=Path(__file__).resolve().parents[1] / 'data/private' / FILENAME)
    args = parser.parse_args()
    try:
        import_files(args.db, args.symbol, args.files)
    except (ValueError, OSError, sqlite3.Error) as exc:
        parser.exit(1, f'{exc}\n')
    from webapp.spot_replay import coverage
    days = coverage(args.db, args.symbol)
    print(f'{args.symbol}: {len(days)} UTC dates' + (f' ({days[0]} to {days[-1]})' if days else ''))


if __name__ == '__main__':
    main()
