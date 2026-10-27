"""Count-confirmed journal deletion using an exact, signed snapshot of trade IDs."""
from hashlib import sha256
import hmac
import json
from sqlalchemy import select, delete
from core.db import trades_t
from core.models import LIVE_SOURCES, BACKTEST_SOURCES

SOURCES = LIVE_SOURCES + BACKTEST_SOURCES


def fingerprint(rows):
    return sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


def snapshot_rows(connection):
    return [dict(row) for row in connection.execute(select(trades_t).where(trades_t.c.source.in_(SOURCES)).order_by(trades_t.c.id)).mappings()]


def read_snapshot(database):
    with database.engine.connect() as connection:
        rows = snapshot_rows(connection)
    return {'count': len(rows), 'fingerprint': fingerprint(rows)}


def remove_snapshot(database, expected):
    # Delete only the reviewed IDs, atomically. Any concurrent new record is
    # excluded from the delete even if written by another application instance.
    with database.engine.begin() as connection:
        rows = snapshot_rows(connection)
        if not rows or len(rows) != expected['count'] or not hmac.compare_digest(fingerprint(rows), expected['fingerprint']):
            return None
        ids = [row['id'] for row in rows]
        count = 0
        for start in range(0, len(ids), 500):
            count += connection.execute(delete(trades_t).where(trades_t.c.id.in_(ids[start:start + 500]))).rowcount
    return count
