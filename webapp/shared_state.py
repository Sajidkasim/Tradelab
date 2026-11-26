"""Shared multi-worker coordination state backed by the application database.

Provides SQLite and PostgreSQL (PgBouncer-safe) atomic primitives for:
- Ephemeral single-use entries with TTL and bounded active count (Google PKCE).
- Cooldown leases (Bullpen live alerts).
- Monotonic cache invalidation revisions (Workspaces.frames across workers).

All tables are hardened with RLS + REVOKE ALL on PostgreSQL via harden_tables().
"""
from __future__ import annotations

from datetime import timedelta
import json
from secrets import token_hex
from threading import RLock

import sqlalchemy as sa

from .personal_access import now_utc

metadata = sa.MetaData()

shared_state_t = sa.Table(
    "primus_shared_state",
    metadata,
    sa.Column("namespace", sa.String(40), primary_key=True),
    sa.Column("item_key", sa.String(128), primary_key=True),
    sa.Column("payload_json", sa.Text, nullable=False),
    sa.Column("expires_at", sa.DateTime, nullable=True, index=True),
    sa.Column("updated_at", sa.DateTime, nullable=False),
)


def _dialect_insert(database):
    if database.is_sqlite:
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    return insert


class CapacityExceeded(Exception):
    """Raised when an ephemeral namespace reaches its active item cap."""


class SharedState:
    """Database-backed coordination store safe for single- or multi-worker deployments."""

    def __init__(self, database):
        self.database = database
        self._lock = RLock()
        self._insert = _dialect_insert(database)
        metadata.create_all(database.engine)
        from .google_access import harden_tables

        harden_tables(database, metadata.sorted_tables)

    def put_ephemeral(
        self,
        namespace: str,
        item_key: str,
        payload: dict,
        *,
        ttl_seconds: int,
        max_items: int | None = None,
        replace_key: str | None = None,
    ) -> None:
        now = now_utc()
        expires = now + timedelta(seconds=int(ttl_seconds))
        encoded = json.dumps(payload, separators=(",", ":"))
        with self._lock, self.database.engine.begin() as conn:
            conn.execute(
                sa.delete(shared_state_t).where(
                    shared_state_t.c.namespace == namespace,
                    shared_state_t.c.expires_at.is_not(None),
                    shared_state_t.c.expires_at <= now,
                )
            )
            if replace_key:
                conn.execute(
                    sa.delete(shared_state_t).where(
                        shared_state_t.c.namespace == namespace,
                        shared_state_t.c.item_key == replace_key,
                    )
                )
            if max_items is not None:
                active = conn.scalar(
                    sa.select(sa.func.count())
                    .select_from(shared_state_t)
                    .where(
                        shared_state_t.c.namespace == namespace,
                        shared_state_t.c.item_key != item_key,
                    )
                )
                if (active or 0) >= max_items:
                    raise CapacityExceeded(f"{namespace} capacity reached")
            stmt = self._insert(shared_state_t).values(
                namespace=namespace,
                item_key=item_key,
                payload_json=encoded,
                expires_at=expires,
                updated_at=now,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["namespace", "item_key"],
                set_={
                    "payload_json": encoded,
                    "expires_at": expires,
                    "updated_at": now,
                },
            )
            conn.execute(stmt)

    def pop_ephemeral(self, namespace: str, item_key: str) -> dict | None:
        if not item_key:
            return None
        now = now_utc()
        with self._lock, self.database.engine.begin() as conn:
            row = (
                conn.execute(
                    sa.select(
                        shared_state_t.c.payload_json,
                        shared_state_t.c.expires_at,
                    ).where(
                        shared_state_t.c.namespace == namespace,
                        shared_state_t.c.item_key == item_key,
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            deleted = conn.execute(
                sa.delete(shared_state_t).where(
                    shared_state_t.c.namespace == namespace,
                    shared_state_t.c.item_key == item_key,
                )
            )
            if deleted.rowcount != 1:
                return None
            if row["expires_at"] is not None and row["expires_at"] <= now:
                return None
            try:
                return json.loads(row["payload_json"])
            except ValueError:
                return None

    def claim_cooldown(self, namespace: str, item_key: str, *, cooldown_seconds: int) -> bool:
        """Atomically claim a cooldown lease; returns False if still active."""
        now = now_utc()
        expires = now + timedelta(seconds=int(cooldown_seconds))
        encoded = json.dumps({"claimed_at": now.isoformat()}, separators=(",", ":"))
        with self._lock, self.database.engine.begin() as conn:
            conn.execute(
                sa.delete(shared_state_t).where(
                    shared_state_t.c.namespace == namespace,
                    shared_state_t.c.item_key == item_key,
                    shared_state_t.c.expires_at.is_not(None),
                    shared_state_t.c.expires_at <= now,
                )
            )
            stmt = (
                self._insert(shared_state_t)
                .values(
                    namespace=namespace,
                    item_key=item_key,
                    payload_json=encoded,
                    expires_at=expires,
                    updated_at=now,
                )
                .on_conflict_do_nothing(index_elements=["namespace", "item_key"])
            )
            result = conn.execute(stmt)
            return result.rowcount == 1

    def bump_revision(self, namespace: str, item_key: str) -> str:
        """Advance a shared revision token so other workers invalidate local caches."""
        now = now_utc()
        token = token_hex(8)
        encoded = json.dumps({"rev": token}, separators=(",", ":"))
        with self._lock, self.database.engine.begin() as conn:
            stmt = self._insert(shared_state_t).values(
                namespace=namespace,
                item_key=item_key,
                payload_json=encoded,
                expires_at=None,
                updated_at=now,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["namespace", "item_key"],
                set_={"payload_json": encoded, "expires_at": None, "updated_at": now},
            )
            conn.execute(stmt)
        return token

    def get_revision(self, namespace: str, item_key: str) -> str | None:
        with self.database.engine.connect() as conn:
            raw = conn.scalar(
                sa.select(shared_state_t.c.payload_json).where(
                    shared_state_t.c.namespace == namespace,
                    shared_state_t.c.item_key == item_key,
                )
            )
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except ValueError:
            return None
        rev = data.get("rev")
        return rev if isinstance(rev, str) else None
