"""Invitation-only membership and separate storage for each trader.

Existing trading tables and formulas are reused unchanged. SQLite uses one file
per teammate; Postgres uses explicitly qualified per-member schemas. The owner
keeps the original database, so existing trades do not need to be reassigned.
"""
from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.schema import CreateColumn

from core.db import Database, metadata as trading_metadata
from core.models import Account, LIVE_SOURCES, BACKTEST_SOURCES

metadata = sa.MetaData()
members = sa.Table("primus_members", metadata,
    sa.Column("key", sa.String(32), primary_key=True),
    sa.Column("slot", sa.Integer, unique=True, nullable=False),
    sa.Column("email", sa.String(254), unique=True, nullable=False),
    sa.Column("name", sa.String(120), nullable=False),
    sa.Column("subject", sa.String(64), unique=True),
    sa.Column("active", sa.Boolean, nullable=False, default=True),
    sa.Column("shared", sa.Boolean, nullable=False, default=False))


@dataclass(frozen=True)
class Identity:
    key: str
    name: str
    owner: bool = False


def verified_google(claims):
    if claims.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
        raise PermissionError("Please sign in with Google.")
    if claims.get("email_verified") is not True or not claims.get("sub"):
        raise PermissionError("A verified Google email is required.")
    email = str(claims.get("email", "")).strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise PermissionError("Google did not return a valid email.")
    subject = hashlib.sha256(f"google:{claims['sub']}".encode()).hexdigest()
    return email, subject


class MemberDatabase(Database):
    def __init__(self, root: Database, key: str):
        if not re.fullmatch(r"[a-f0-9]{32}", key):
            raise ValueError("Invalid workspace identifier")
        self.schema = None
        if root.is_sqlite:
            location = sa.engine.make_url(root.url).database
            if not location:
                raise ValueError("Team storage needs a persistent database.")
            super().__init__(Path(location).resolve().parent / "members" / f"{key}.db")
        else:
            # An explicit schema map qualifies every SELECT/UPDATE/DELETE/backup.
            # Do not depend on search_path or connection-pool session state.
            self.schema = f"primus_{key}"
            with root.engine.begin() as connection:
                connection.execute(sa.schema.CreateSchema(self.schema, if_not_exists=True))
            self.target, self.url = root.target, root.url
            self.engine = root.engine.execution_options(schema_translate_map={None: self.schema})

    def migrate(self):
        if not self.schema:
            return super().migrate()
        inspector = sa.inspect(self.engine)
        added = []
        quote = self.engine.dialect.identifier_preparer.quote
        with self.engine.begin() as connection:
            for table in trading_metadata.sorted_tables:
                existing = {c["name"] for c in inspector.get_columns(table.name, schema=self.schema)}
                for column in table.columns:
                    if column.name not in existing:
                        ddl = str(CreateColumn(column).compile(dialect=self.engine.dialect))
                        connection.exec_driver_sql(f"ALTER TABLE {quote(self.schema)}.{quote(table.name)} ADD COLUMN {ddl}")
                        added.append(f"{table.name}.{column.name}")
        return added


class Team:
    def __init__(self, root: Database, owner_email: str):
        self.root = root
        self.owner_email = owner_email.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", self.owner_email):
            raise ValueError("Set PRIMUSLAB_OWNER_EMAIL to the workspace owner's Google email.")
        metadata.create_all(root.engine)
        insert = (__import__("sqlalchemy.dialects.sqlite", fromlist=["insert"]).insert if root.is_sqlite else
                  __import__("sqlalchemy.dialects.postgresql", fromlist=["insert"]).insert)
        with root.engine.begin() as conn:
            conn.execute(insert(members).values(key="owner", slot=0, email=self.owner_email,
                                               name="Workspace owner", active=True, shared=False)
                         .on_conflict_do_nothing(index_elements=["key"]))
            configured = conn.execute(sa.select(members.c.email).where(members.c.key == "owner")).scalar_one()
            if configured != self.owner_email:
                raise ValueError("The owner email differs from this database's configured owner.")

    def member(self, key):
        with self.root.engine.connect() as conn:
            row = conn.execute(sa.select(members).where(members.c.key == key, members.c.active.is_(True))).mappings().first()
        if row is None:
            raise PermissionError("This workspace membership is no longer active.")
        return dict(row)

    def join(self, claims):
        email, subject = verified_google(claims)
        with self.root.engine.begin() as conn:
            row = conn.execute(sa.select(members).where(members.c.email == email, members.c.active.is_(True))).mappings().first()
            if row is None or row["subject"] not in (None, subject):
                raise PermissionError("This Google account has not been invited to PrimusLab.")
            name = str(claims.get("name") or row["name"])[:120] if row["key"] == "owner" else row["name"]
            if row["subject"] != subject or row["name"] != name:
                result = conn.execute(members.update().where(members.c.key == row["key"],
                                      sa.or_(members.c.subject.is_(None), members.c.subject == subject))
                                      .values(subject=subject, name=name))
                if result.rowcount != 1:
                    raise PermissionError("This invitation belongs to another Google account.")
        return Identity(row["key"], name, row["slot"] == 0)

    def invite(self, actor, email, name):
        if self.member(actor)["slot"] != 0:
            raise PermissionError("Only the workspace owner can add teammates.")
        email, name = email.strip().lower(), name.strip()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not name or len(name) > 120:
            raise ValueError("Enter a name and a valid Google email.")
        with self.root.engine.begin() as conn:
            occupied = set(conn.execute(sa.select(members.c.slot)).scalars())
            slot = next((slot for slot in range(1, 5) if slot not in occupied), None)
            if slot is None:
                raise ValueError("This workspace has five members. Reactivate an existing teammate instead.")
            key = uuid4().hex
            try:
                conn.execute(members.insert().values(key=key, slot=slot, email=email, name=name, active=True, shared=False))
            except sa.exc.IntegrityError as exc:
                raise ValueError("That email already has an invitation, or a seat was just taken. Refresh the team list.") from exc
        return key

    def set_active(self, actor, target, active):
        if self.member(actor)["slot"] != 0 or target == "owner":
            raise PermissionError("Only the owner can change teammate access.")
        with self.root.engine.begin() as conn:
            conn.execute(members.update().where(members.c.key == target).values(active=bool(active), shared=False))

    def roster(self, actor):
        owner = self.member(actor)["slot"] == 0
        with self.root.engine.connect() as conn:
            rows = conn.execute(sa.select(members).order_by(members.c.slot)).mappings().all()
        fields = ("key", "name", "active", "shared") + (("email",) if owner else ())
        return [{**{k: r[k] for k in fields}, "joined": bool(r["subject"])} for r in rows if owner or r["active"]]

    def set_sharing(self, actor, enabled):
        self.member(actor)
        with self.root.engine.begin() as conn:
            conn.execute(members.update().where(members.c.key == actor).values(shared=bool(enabled)))

    def database(self, actor):
        self.member(actor)
        db = self.root if actor == "owner" else MemberDatabase(self.root, actor)
        db.init()
        if not db.accounts():
            db.upsert_account(Account("My account", 50000, 1000, 2000))
        return db

    def shared_results(self, actor, target):
        self.member(actor)
        target_member = self.member(target)
        if not target_member["shared"]:
            raise PermissionError("This teammate is keeping their results private.")
        db = self.database(target)
        try:
            frame = db.trades_df(sources=LIVE_SOURCES + BACKTEST_SOURCES)
        finally:
            if db is not self.root and db.is_sqlite:
                db.engine.dispose()
        # No trade notes, screenshots, account names, identifiers or free-form tags.
        columns = ["symbol", "direction", "source", "setup_name", "entry_time", "exit_time", "exit_price",
                   "net_pnl", "gross_pnl", "fees", "r_multiple", "qty", "initial_risk"]
        return frame[[c for c in columns if c in frame]].copy()
