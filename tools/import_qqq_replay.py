"""Build an indexed QQQ comparison archive from a Databento XNAS.ITCH export."""
import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import databento

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.import_dukascopy_replay import SCHEMA
from webapp.spot_replay import TIMEFRAMES
from services.replay_chart_history import bucket


def minutes(store):
    pending = None
    last_second = -1
    missing_prices = 0
    for chunk in store.to_df(count=250_000):
        if not chunk.symbol.eq('QQQ').fillna(False).all():
            raise ValueError('Expected only mapped QQQ records.')
        stamps = chunk.index.as_unit('ms').asi8
        if len(stamps) and (stamps[0] <= last_second or not chunk.index.is_monotonic_increasing or chunk.index.has_duplicates):
            raise ValueError('Expected strictly increasing QQQ timestamps.')
        if len(stamps):
            last_second = stamps[-1]
        # The source occasionally has volume records with undefined prices.
        # They cannot establish an OHLC candle.
        valid = chunk[['open', 'high', 'low', 'close']].notna().all(axis=1).to_numpy()
        missing_prices += int((~valid).sum())
        grouped = chunk[valid].groupby(stamps[valid] // 60000 * 60000).agg(
            {'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'})
        for row in grouped.itertuples(name=None):
            t, o, h, l, c, v = row
            if pending and pending[0] == t:
                pending = (t, pending[1], max(h, pending[2]), min(l, pending[3]), c, v + pending[5])
            else:
                if pending:
                    yield ('QQQ', *pending)
                pending = row
    if pending:
        yield ('QQQ', *pending)
    print(f'Skipped {missing_prices:,} seconds with undefined OHLC')


def chart_rows(db, tf):
    current = None
    for t, o, h, l, c, v in db.execute('SELECT time,open,high,low,close,volume FROM spot_bars ORDER BY time'):
        opened = bucket(t, tf)
        if opened is None:
            continue
        if current is None or opened != current[0]:
            if current is not None:
                yield ('QQQ', tf, *current)
            current = [opened, o, h, l, c, v, t + 60000]
        else:
            current[2:] = [max(h, current[2]), min(l, current[3]), c, current[5] + v, t + 60000]
    if current is not None:
        yield ('QQQ', tf, *current)


def build(source, target):
    store = databento.DBNStore.from_file(source)
    if str(store.metadata.dataset) != 'XNAS.ITCH' or str(store.metadata.schema) != 'ohlcv-1s' or list(store.metadata.symbols) != ['QQQ']:
        raise ValueError('Expected an XNAS.ITCH QQQ OHLCV-1s export.')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise FileExistsError(target)
    with TemporaryDirectory(dir=target.parent) as folder:
        temporary = Path(folder) / target.name
        with sqlite3.connect(temporary) as db:
            db.executescript(SCHEMA)
            db.executemany('INSERT INTO spot_bars VALUES (?,?,?,?,?,?,?)', minutes(store))
            counts = db.execute('SELECT time/86400000, count(*) FROM spot_bars GROUP BY time/86400000').fetchall()
            if not counts:
                raise ValueError('The export contains no QQQ bars.')
            db.executemany('INSERT INTO spot_days VALUES (?,?,?)', (
                ('QQQ', datetime.fromtimestamp(day * 86400, timezone.utc).date().isoformat(), count)
                for day, count in counts))
            for tf in TIMEFRAMES:
                db.executemany('INSERT INTO spot_chart VALUES (?,?,?,?,?,?,?,?,?)', chart_rows(db, tf))
            print(f'{sum(count for _, count in counts):,} minute bars on {len(counts):,} UTC dates')
        target.hardlink_to(temporary)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--db', type=Path, default=Path('data/private/qqq-replay.db'))
    args = parser.parse_args()
    build(args.source, args.db)
