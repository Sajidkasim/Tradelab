"""Data layer on SQLAlchemy Core — one codebase for a local SQLite file and a hosted Postgres.

    db = Database("data/tradelab.db")                     # local file
    db = Database(":memory:")                             # tests
    db = Database("postgresql://user:pw@host:5432/db")    # Supabase / any Postgres
    db = Database.from_env()                              # TRADELAB_DB_URL, else data/tradelab.db
    db.init()

All timestamps are stored naive UTC. JSON-ish lists (tags, rules) are stored as JSON text.
external_id is stored as NULL when empty so the UNIQUE constraint allows many blanks.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import pandas as pd
import sqlalchemy as sa
from sqlalchemy import (Boolean, Column, DateTime, Float, Integer, MetaData, String, Table, Text,
                        UniqueConstraint, func, select)
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool

from .instruments import default_instruments
from .models import Account, Instrument, InstrumentType, Setup, SetupStatus, Trade

metadata = MetaData()

accounts_t = Table(
    "accounts", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(120), nullable=False, unique=True),
    Column("starting_balance", Float, nullable=False),
    Column("daily_loss_limit", Float, nullable=False),
    Column("max_trailing_drawdown", Float, nullable=False),
    Column("max_contracts", Integer, default=5),
    Column("risk_per_trade_pct", Float, default=0.5),
    Column("consistency_target_pct", Float, default=50.0),
    Column("max_trades_per_day", Integer, default=10),
    Column("created_at", DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)),
)

instruments_t = Table(
    "instruments", metadata,
    Column("symbol", String(24), primary_key=True),
    Column("name", String(120)),
    Column("multiplier", Float, nullable=False),
    Column("tick_size", Float, nullable=False),
    Column("instrument_type", String(16), default="future"),
    Column("commission_per_contract", Float, default=0.0),
    Column("exchange", String(32), default=""),
)

setups_t = Table(
    "setups", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(120), nullable=False, unique=True),
    Column("description", Text, default=""),
    Column("instruments", Text, default="[]"),
    Column("timeframe", String(24), default=""),
    Column("rules", Text, default="[]"),
    Column("target_r", Float, default=2.0),
    Column("expected_win_rate", Float, default=0.5),
    Column("status", String(16), default="testing"),
)

trades_t = Table(
    "trades", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("account_id", Integer),
    Column("source", String(16), default="manual"),
    Column("external_id", String(120)),
    Column("symbol", String(24), nullable=False),
    Column("instrument_type", String(16), default="future"),
    Column("direction", String(8), nullable=False),
    Column("qty", Float, nullable=False),
    Column("entry_time", DateTime, nullable=False),
    Column("exit_time", DateTime),
    Column("entry_price", Float, nullable=False),
    Column("exit_price", Float),
    Column("stop_price", Float),
    Column("target_price", Float),
    Column("multiplier", Float, nullable=False, default=1.0),
    Column("fees", Float, default=0.0),
    Column("gross_pnl", Float),
    Column("net_pnl", Float),
    Column("initial_risk", Float),
    Column("r_multiple", Float),
    Column("mae", Float),
    Column("mfe", Float),
    Column("setup_id", Integer),
    Column("setup_name", String(120), default=""),
    Column("timeframe", String(24), default=""),
    Column("session", String(40), default=""),
    Column("rules_followed", Boolean),
    Column("mistake_tags", Text, default="[]"),
    Column("tags", Text, default="[]"),
    Column("confidence", Integer),
    Column("emotion", String(40), default=""),
    Column("screenshot_path", Text, default=""),
    Column("notes", Text, default=""),
    Column("created_at", DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)),
    Column("updated_at", DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)),
    UniqueConstraint("external_id", name="ux_trades_external"),
)
sa.Index("ix_trades_entry_time", trades_t.c.entry_time)
sa.Index("ix_trades_symbol", trades_t.c.symbol)

settings_t = Table("settings", metadata,
                   Column("key", String(80), primary_key=True), Column("value", Text))

mappings_t = Table("import_mappings", metadata,
                   Column("name", String(120), primary_key=True), Column("mapping", Text, nullable=False),
                   Column("created_at", DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)))

backtests_t = Table(
    "backtest_runs", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(160)), Column("strategy", String(120)), Column("symbol", String(24)),
    Column("timeframe", String(24)), Column("params", Text), Column("stats", Text), Column("equity", Text),
    Column("created_at", DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)),
)

bars_t = Table(
    "bars_cache", metadata,
    Column("symbol", String(40), primary_key=True), Column("timeframe", String(16), primary_key=True),
    Column("t", DateTime, primary_key=True),
    Column("o", Float), Column("h", Float), Column("l", Float), Column("c", Float), Column("v", Float),
)

breaches_t = Table(
    "rule_breaches", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("account_id", Integer), Column("date", String(10), nullable=False),
    Column("rule", String(40), nullable=False), Column("value", Float), Column("limit_value", Float),
    Column("note", Text, default=""),
)

_TRADE_COLS = [c.name for c in trades_t.columns if c.name not in ("id", "created_at", "updated_at")]


def _utc_naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _compute_stored_trade(t: Trade) -> None:
    """Keep imported dollar risk when no price stop was supplied.

    Price-based trades continue through the same metric formulas. Imports may
    supply risk separately (including P&L-only FX Replay rows).
    """
    from .metrics import compute_trade_fields
    supplied_risk = t.initial_risk if t.stop_price is None else None
    compute_trade_fields(t)
    if supplied_risk is not None and supplied_risk > 0:
        t.initial_risk = supplied_risk
        t.r_multiple = t.net_pnl / supplied_risk if t.net_pnl is not None else None


def make_url(target: str) -> str:
    """Path or URL -> SQLAlchemy URL. Supabase-style postgresql:// is routed through psycopg."""
    t = (target or "").strip()
    if t == ":memory:":
        return "sqlite://"
    if "://" in t:
        if t.startswith("postgres://"):
            t = "postgresql://" + t[len("postgres://"):]
        if t.startswith("postgresql://"):
            t = "postgresql+psycopg://" + t[len("postgresql://"):]
        return t
    return f"sqlite:///{t}"


class Database:
    def __init__(self, target: str | Path = "data/tradelab.db", echo: bool = False):
        self.target = str(target)
        self.url = make_url(self.target)
        kw: dict[str, Any] = {"echo": echo, "future": True}
        if self.url == "sqlite://":
            kw.update(connect_args={"check_same_thread": False}, poolclass=StaticPool)
        elif self.url.startswith("sqlite:///"):
            Path(self.target).parent.mkdir(parents=True, exist_ok=True)
            kw.update(connect_args={"check_same_thread": False})
        else:
            # hosted Postgres: keep connections fresh, small pool, and no server-side prepared statements
            # (Supabase's pooler and other pgbouncer-style poolers don't support them)
            kw.update(pool_pre_ping=True, pool_recycle=300, pool_size=3, max_overflow=2)
            if self.url.startswith("postgresql+psycopg"):
                kw["connect_args"] = {"prepare_threshold": None}
        self.engine: Engine = sa.create_engine(self.url, **kw)

    @classmethod
    def from_env(cls) -> "Database":
        """TRADELAB_DB_URL (env or Streamlit secrets) or a local file."""
        url = os.getenv("TRADELAB_DB_URL")
        if not url:
            try:
                import streamlit as st  # noqa: WPS433
                url = st.secrets.get("TRADELAB_DB_URL", None) if hasattr(st, "secrets") else None
            except Exception:  # noqa: BLE001
                url = None
        return cls(url or "data/tradelab.db")

    @property
    def is_sqlite(self) -> bool:
        return self.engine.dialect.name == "sqlite"

    def _upsert(self, table: Table, rows: list[dict], index_elements: list[str]) -> None:
        if not rows:
            return
        if self.is_sqlite:
            from sqlalchemy.dialects.sqlite import insert
        else:
            from sqlalchemy.dialects.postgresql import insert
        with self.engine.begin() as conn:
            for row in rows:
                stmt = insert(table).values(**row)
                update = {k: getattr(stmt.excluded, k) for k in row if k not in index_elements}
                conn.execute(stmt.on_conflict_do_update(index_elements=index_elements, set_=update))

    # ---- setup -----------------------------------------------------------
    def init(self) -> None:
        metadata.create_all(self.engine)
        self.migrate()
        if not self.instruments():
            self.upsert_instruments(default_instruments())

    def migrate(self) -> list[str]:
        """Add any column that exists in the schema above but not yet in the database.

        This is how the backend grows safely: add a Column() to a Table here, restart, and both
        SQLite and Postgres gain it (nullable, with the declared default). Returns what was added.
        Removing or retyping columns is deliberately not automated.
        """
        insp = sa.inspect(self.engine)
        added: list[str] = []
        with self.engine.begin() as conn:
            for table in metadata.sorted_tables:
                if not insp.has_table(table.name):
                    table.create(conn)
                    added.append(f"{table.name}.*")
                    continue
                existing = {c["name"] for c in insp.get_columns(table.name)}
                for col in table.columns:
                    if col.name in existing:
                        continue
                    ctype = col.type.compile(dialect=self.engine.dialect)
                    default = ""
                    if col.default is not None and col.default.is_scalar:
                        v = col.default.arg
                        default = f" DEFAULT {repr(v) if isinstance(v, str) else v}"
                    conn.execute(sa.text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {ctype}{default}'))
                    added.append(f"{table.name}.{col.name}")
        return added

    # ---- instruments -----------------------------------------------------
    def upsert_instruments(self, items: Iterable[Instrument]) -> None:
        rows = [{"symbol": i.symbol, "name": i.name, "multiplier": i.multiplier, "tick_size": i.tick_size,
                 "instrument_type": i.instrument_type.value, "commission_per_contract": i.commission_per_contract,
                 "exchange": i.exchange} for i in items]
        self._upsert(instruments_t, rows, ["symbol"])

    def instruments(self) -> dict[str, Instrument]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(instruments_t)).mappings().all()
        out = {}
        for r in rows:
            d = dict(r)
            d["instrument_type"] = InstrumentType(d.get("instrument_type") or "future")
            out[d["symbol"]] = Instrument(**d)
        return out

    def delete_instrument(self, symbol: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(instruments_t.delete().where(instruments_t.c.symbol == symbol))

    # ---- accounts --------------------------------------------------------
    def upsert_account(self, a: Account) -> int:
        d = asdict(a); d.pop("id", None)
        with self.engine.begin() as conn:
            if a.id:
                conn.execute(accounts_t.update().where(accounts_t.c.id == a.id).values(**d))
                return int(a.id)
            res = conn.execute(accounts_t.insert().values(**d))
            return int(res.inserted_primary_key[0])

    def accounts(self) -> list[Account]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(accounts_t).order_by(accounts_t.c.id)).mappings().all()
        known = Account.__dataclass_fields__
        return [Account(**{k: v for k, v in dict(r).items() if k in known}) for r in rows]

    def delete_account(self, account_id: int) -> None:
        with self.engine.begin() as conn:
            conn.execute(accounts_t.delete().where(accounts_t.c.id == account_id))

    # ---- setups ----------------------------------------------------------
    def upsert_setup(self, s: Setup) -> int:
        d = asdict(s); d.pop("id", None)
        d["instruments"] = json.dumps(d["instruments"]); d["rules"] = json.dumps(d["rules"])
        d["status"] = s.status.value if isinstance(s.status, SetupStatus) else str(s.status)
        with self.engine.begin() as conn:
            if s.id:
                conn.execute(setups_t.update().where(setups_t.c.id == s.id).values(**d))
                return int(s.id)
            res = conn.execute(setups_t.insert().values(**d))
            return int(res.inserted_primary_key[0])

    def setups(self) -> list[Setup]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(setups_t).order_by(setups_t.c.id)).mappings().all()
        out = []
        for r in rows:
            d = dict(r)
            d["instruments"] = json.loads(d["instruments"] or "[]"); d["rules"] = json.loads(d["rules"] or "[]")
            d["status"] = SetupStatus(d["status"] or "testing")
            out.append(Setup(**d))
        return out

    def delete_setup(self, setup_id: int) -> None:
        with self.engine.begin() as conn:
            conn.execute(setups_t.delete().where(setups_t.c.id == setup_id))

    # ---- trades ----------------------------------------------------------
    def _trade_row(self, t: Trade) -> dict:
        _compute_stored_trade(t)
        row = t.to_row()
        row["entry_time"] = _utc_naive(t.entry_time); row["exit_time"] = _utc_naive(t.exit_time)
        row["external_id"] = row.get("external_id") or None
        row["rules_followed"] = None if t.rules_followed is None else bool(t.rules_followed)
        return {k: row.get(k) for k in _TRADE_COLS}

    def existing_external_ids(self) -> set[str]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(trades_t.c.external_id).where(trades_t.c.external_id.isnot(None))).all()
        return {r[0] for r in rows}

    def insert_trades(self, trades: Iterable[Trade]) -> dict[str, int]:
        """Insert trades; rows whose external_id already exists are skipped."""
        existing = self.existing_external_ids()
        rows, skipped = [], 0
        for t in trades:
            row = self._trade_row(t)
            if row["external_id"] and row["external_id"] in existing:
                skipped += 1
                continue
            if row["external_id"]:
                existing.add(row["external_id"])
            rows.append(row)
        if rows:
            with self.engine.begin() as conn:
                conn.execute(trades_t.insert(), rows)
        return {"inserted": len(rows), "skipped": skipped}

    def update_trade(self, trade_id: int, **fields: Any) -> None:
        if not fields:
            return
        previous = self.get_trade(trade_id) if "stop_price" in fields else None
        for k in ("mistake_tags", "tags"):
            if k in fields and isinstance(fields[k], list):
                fields[k] = json.dumps(fields[k])
        for k in ("entry_time", "exit_time"):
            if k in fields:
                fields[k] = _utc_naive(fields[k]) if fields[k] is not None else None
        if "external_id" in fields:
            fields["external_id"] = fields["external_id"] or None
        fields["updated_at"] = _now()
        with self.engine.begin() as conn:
            conn.execute(trades_t.update().where(trades_t.c.id == trade_id).values(**fields))
        t = self.get_trade(trade_id)
        if t is not None:
            if previous is not None and previous.stop_price is not None and t.stop_price is None:
                t.initial_risk = None
            _compute_stored_trade(t)
            with self.engine.begin() as conn:
                conn.execute(trades_t.update().where(trades_t.c.id == trade_id).values(
                    gross_pnl=t.gross_pnl, net_pnl=t.net_pnl, initial_risk=t.initial_risk, r_multiple=t.r_multiple))

    def bulk_update_trade_sessions(self, updates: dict[int, str]) -> int:
        """Update only the session label for many trades in a single transaction."""
        if not updates:
            return 0
        now = _now()
        stmt = (
            trades_t.update()
            .where(trades_t.c.id == sa.bindparam("b_id"))
            .values(session=sa.bindparam("b_session"), updated_at=now)
        )
        params = [{"b_id": int(tid), "b_session": str(lbl)} for tid, lbl in updates.items()]
        with self.engine.begin() as conn:
            conn.execute(stmt, params)
        return len(params)

    def get_trade(self, trade_id: int) -> Optional[Trade]:
        with self.engine.connect() as conn:
            r = conn.execute(select(trades_t).where(trades_t.c.id == trade_id)).mappings().first()
        if r is None:
            return None
        d = dict(r)
        d["external_id"] = d.get("external_id") or ""
        return Trade.from_row(d)

    def delete_trade(self, trade_id: int) -> None:
        with self.engine.begin() as conn:
            conn.execute(trades_t.delete().where(trades_t.c.id == trade_id))

    def delete_trades_by_source(self, source: str) -> int:
        with self.engine.begin() as conn:
            res = conn.execute(trades_t.delete().where(trades_t.c.source == source))
        return int(res.rowcount or 0)

    def trades_df(self, account_id: Optional[int] = None, include_open: bool = True,
                  sources: Optional[Iterable[str]] = None) -> pd.DataFrame:
        q = select(trades_t)
        if account_id is not None:
            q = q.where(trades_t.c.account_id == account_id)
        if not include_open:
            q = q.where(trades_t.c.exit_price.isnot(None))
        if sources is not None:
            q = q.where(trades_t.c.source.in_(list(sources)))
        q = q.order_by(trades_t.c.entry_time)
        with self.engine.connect() as conn:
            df = pd.read_sql_query(q, conn)
        if df.empty:
            return df
        for col in ("entry_time", "exit_time", "created_at", "updated_at"):
            df[col] = pd.to_datetime(df[col])
        for col in ("mistake_tags", "tags"):
            df[col] = df[col].apply(lambda v: json.loads(v) if isinstance(v, str) and v else [])
        df["rules_followed"] = df["rules_followed"].map(lambda v: None if pd.isna(v) else bool(v))
        df["external_id"] = df["external_id"].fillna("")
        return df

    def count_trades(self) -> int:
        with self.engine.connect() as conn:
            return int(conn.execute(select(func.count()).select_from(trades_t)).scalar() or 0)

    # ---- settings --------------------------------------------------------
    def set_setting(self, key: str, value: Any) -> None:
        self._upsert(settings_t, [{"key": key, "value": json.dumps(value)}], ["key"])

    def get_setting(self, key: str, default: Any = None) -> Any:
        with self.engine.connect() as conn:
            r = conn.execute(select(settings_t.c.value).where(settings_t.c.key == key)).scalar()
        return json.loads(r) if r else default

    def settings_with_prefix(self, prefix: str) -> dict[str, Any]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(settings_t.c.key, settings_t.c.value).where(settings_t.c.key.like(prefix + "%"))).all()
        return {k: json.loads(v) for k, v in rows}

    # ---- import mappings -------------------------------------------------
    def save_mapping(self, name: str, mapping: dict[str, Any]) -> None:
        self._upsert(mappings_t, [{"name": name, "mapping": json.dumps(mapping)}], ["name"])

    def mappings(self) -> dict[str, dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(mappings_t.c.name, mappings_t.c.mapping)).all()
        return {n: json.loads(m) for n, m in rows}

    def delete_mapping(self, name: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(mappings_t.delete().where(mappings_t.c.name == name))

    # ---- backtest runs ---------------------------------------------------
    def save_backtest(self, name: str, strategy: str, symbol: str, timeframe: str,
                      params: dict, stats: dict, equity: list[float]) -> int:
        with self.engine.begin() as conn:
            res = conn.execute(backtests_t.insert().values(
                name=name, strategy=strategy, symbol=symbol, timeframe=timeframe,
                params=json.dumps(params, default=str), stats=json.dumps(stats, default=_json_default),
                equity=json.dumps([float(x) for x in equity])))
            return int(res.inserted_primary_key[0])

    def backtests(self) -> pd.DataFrame:
        with self.engine.connect() as conn:
            df = pd.read_sql_query(select(backtests_t).order_by(backtests_t.c.id.desc()), conn)
        for col in ("params", "stats", "equity"):
            if col in df:
                df[col] = df[col].apply(lambda v: json.loads(v) if v else None)
        return df

    def delete_backtest(self, run_id: int) -> None:
        with self.engine.begin() as conn:
            conn.execute(backtests_t.delete().where(backtests_t.c.id == run_id))

    # ---- bars cache ------------------------------------------------------
    def cache_bars(self, symbol: str, timeframe: str, bars: pd.DataFrame) -> int:
        rows = [{"symbol": symbol, "timeframe": timeframe, "t": _utc_naive(pd.Timestamp(r.t)),
                 "o": float(r.o), "h": float(r.h), "l": float(r.l), "c": float(r.c), "v": float(r.v)}
                for r in bars.itertuples(index=False)]
        self._upsert(bars_t, rows, ["symbol", "timeframe", "t"])
        return len(rows)

    def load_bars(self, symbol: str, timeframe: str, start: Optional[datetime] = None,
                  end: Optional[datetime] = None) -> pd.DataFrame:
        q = select(bars_t.c.t, bars_t.c.o, bars_t.c.h, bars_t.c.l, bars_t.c.c, bars_t.c.v).where(
            bars_t.c.symbol == symbol, bars_t.c.timeframe == timeframe)
        if start is not None:
            q = q.where(bars_t.c.t >= _utc_naive(start))
        if end is not None:
            q = q.where(bars_t.c.t <= _utc_naive(end))
        with self.engine.connect() as conn:
            df = pd.read_sql_query(q.order_by(bars_t.c.t), conn)
        if not df.empty:
            df["t"] = pd.to_datetime(df["t"])
        return df

    def cached_bar_sets(self) -> pd.DataFrame:
        q = select(bars_t.c.symbol, bars_t.c.timeframe, func.min(bars_t.c.t).label("start"),
                   func.max(bars_t.c.t).label("end"), func.count().label("bars")).group_by(
            bars_t.c.symbol, bars_t.c.timeframe)
        with self.engine.connect() as conn:
            return pd.read_sql_query(q, conn)

    # ---- rule breaches ---------------------------------------------------
    def log_breach(self, account_id: Optional[int], date: str, rule: str, value: float,
                   limit_value: float, note: str = "") -> None:
        with self.engine.begin() as conn:
            conn.execute(breaches_t.insert().values(account_id=account_id, date=str(date), rule=rule,
                                                    value=value, limit_value=limit_value, note=note))

    def breaches(self) -> pd.DataFrame:
        with self.engine.connect() as conn:
            return pd.read_sql_query(select(breaches_t).order_by(breaches_t.c.date.desc()), conn)

    # ---- portable backup -------------------------------------------------
    def export_json(self) -> str:
        """Everything except the bars cache, as one JSON string (works on any database)."""
        out: dict[str, Any] = {}
        with self.engine.connect() as conn:
            for name, table in (("accounts", accounts_t), ("instruments", instruments_t), ("setups", setups_t),
                                ("trades", trades_t), ("settings", settings_t), ("import_mappings", mappings_t),
                                ("backtest_runs", backtests_t), ("rule_breaches", breaches_t)):
                out[name] = [dict(r) for r in conn.execute(select(table)).mappings().all()]
        return json.dumps(out, default=_json_default)

    def import_json(self, payload: str, replace: bool = False) -> dict[str, int]:
        data = json.loads(payload)
        counts: dict[str, int] = {}
        tables = {"accounts": accounts_t, "instruments": instruments_t, "setups": setups_t, "trades": trades_t,
                  "settings": settings_t, "import_mappings": mappings_t, "backtest_runs": backtests_t,
                  "rule_breaches": breaches_t}
        if (not isinstance(data, dict) or not set(tables).issubset(data)
                or any(not isinstance(data[name], list) or any(not isinstance(row, dict) for row in data[name])
                       for name in tables)):
            raise ValueError("This file is not a complete PrimusLab backup; no data was changed.")
        dt_cols = {"entry_time", "exit_time", "created_at", "updated_at", "t"}
        with self.engine.begin() as conn:
            for name, table in tables.items():
                rows = data.get(name) or []
                if replace:
                    conn.execute(table.delete())
                inserted = 0
                for r in rows:
                    r = {k: v for k, v in r.items() if k in table.c}
                    for k in dt_cols & set(r):
                        r[k] = pd.to_datetime(r[k]).to_pydatetime() if r[k] else None
                    if "id" in r and not replace:
                        r.pop("id")
                    try:
                        if replace:
                            conn.execute(table.insert().values(**r))
                        else:
                            # A savepoint keeps PostgreSQL usable after a duplicate row.
                            with conn.begin_nested():
                                conn.execute(table.insert().values(**r))
                        inserted += 1
                    except sa.exc.IntegrityError as exc:
                        if replace:
                            raise ValueError(f"The backup contains an invalid {name} row; no data was changed.") from exc
                counts[name] = inserted
            if replace and not self.is_sqlite:
                # Imported IDs bypass PostgreSQL's serial generators. Advance each
                # generator before the next trade, setup, or account is created.
                schema = conn.get_execution_options().get("schema_translate_map", {}).get(None)
                for table in tables.values():
                    if "id" not in table.c:
                        continue
                    maximum = conn.scalar(select(func.max(table.c.id)))
                    qualified = f"{schema}.{table.name}" if schema else table.name
                    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence(:table_name, 'id'), :value, :used)"),
                                 {"table_name": qualified, "value": maximum or 1, "used": bool(maximum)})
        return counts

    def backup(self, dest: str | Path) -> None:
        """SQLite: a real file copy via the backup API. Otherwise: JSON export."""
        if self.is_sqlite and self.url != "sqlite://":
            import sqlite3
            src = sqlite3.connect(self.target); dst = sqlite3.connect(str(dest))
            src.backup(dst); dst.close(); src.close()
        else:
            Path(dest).write_text(self.export_json())


def _json_default(o):
    if isinstance(o, (datetime, pd.Timestamp)):
        return o.isoformat()
    if hasattr(o, "item"):
        return o.item()
    return str(o)
