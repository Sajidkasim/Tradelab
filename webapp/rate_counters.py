"""Persistent rolling limits for server-defined identities."""
from math import ceil
from time import time

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .google_access import harden_tables

metadata = sa.MetaData()
counters = sa.Table(
    'primus_rate_counters', metadata,
    sa.Column('key', sa.String(150), primary_key=True),
    sa.Column('attempts', sa.JSON, nullable=False),
)


class RateCounters:
    def __init__(self, database, clock=time):
        self.engine = database.engine
        self.clock = clock
        metadata.create_all(self.engine)
        harden_tables(database, (counters,))

    def consume(self, key, *, limit, window=60):
        """Reserve an attempt, returning a Retry-After value when over quota."""
        insert = sqlite_insert if self.engine.dialect.name == 'sqlite' else pg_insert
        with self.engine.begin() as connection:
            # The write starts a SQLite write transaction before reading the counter.
            connection.execute(insert(counters).values(key=key, attempts=[]).on_conflict_do_nothing())
            query = sa.select(counters.c.attempts).where(counters.c.key == key).with_for_update()
            now = self.clock()
            attempts = [stamp for stamp in connection.scalar(query) if stamp > now - window]
            if len(attempts) >= limit:
                return max(1, ceil(window - (now - attempts[0])))
            connection.execute(counters.update().where(counters.c.key == key).values(attempts=[*attempts, now]))
        return None

    def clear(self, key):
        with self.engine.begin() as connection:
            connection.execute(counters.delete().where(counters.c.key == key))
