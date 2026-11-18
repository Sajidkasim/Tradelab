"""Core data types for TradeLab.

Everything downstream (metrics, risk, backtest, DB) works with these
dataclasses or with pandas DataFrames whose columns match their field names.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class Direction(str, Enum):
    LONG = "long"
    SHORT = "short"

    @property
    def sign(self) -> int:
        return 1 if self is Direction.LONG else -1


class InstrumentType(str, Enum):
    FUTURE = "future"
    OPTION = "option"
    SPREAD = "spread"


class Source(str, Enum):
    MANUAL = "manual"
    CSV = "csv"
    EXCEL = "excel"
    API = "api"
    DEMO = "demo"
    BACKTEST = "backtest"
    FXREPLAY = "fxreplay"


# Which sources count as real money. Backtest-style sources never mix into live stats.
LIVE_SOURCES = ("manual", "csv", "excel", "api")
BACKTEST_SOURCES = ("backtest", "fxreplay")
DEMO_SOURCES = ("demo",)


class SetupStatus(str, Enum):
    TESTING = "testing"
    LIVE = "live"
    RETIRED = "retired"


@dataclass
class Instrument:
    symbol: str
    name: str
    multiplier: float          # $ per 1.0 point of price
    tick_size: float
    instrument_type: InstrumentType = InstrumentType.FUTURE
    commission_per_contract: float = 0.0   # round-turn, per contract
    exchange: str = ""

    @property
    def tick_value(self) -> float:
        return round(self.multiplier * self.tick_size, 6)


@dataclass
class Account:
    name: str
    starting_balance: float
    daily_loss_limit: float
    max_trailing_drawdown: float
    max_contracts: int = 5
    risk_per_trade_pct: float = 0.5        # % of account
    consistency_target_pct: float = 50.0   # best day may be at most this % of total profit
    max_trades_per_day: int = 10
    id: Optional[int] = None
    account_type: str = "Personal"
    status: str = "active"


@dataclass
class Setup:
    """A trading model / setup with a rule checklist."""
    name: str
    description: str = ""
    instruments: list[str] = field(default_factory=list)
    timeframe: str = ""
    rules: list[str] = field(default_factory=list)
    target_r: float = 2.0
    expected_win_rate: float = 0.5
    status: SetupStatus = SetupStatus.TESTING
    id: Optional[int] = None


@dataclass
class Fill:
    """A single half-turn execution as returned by the broker."""
    fill_id: str
    symbol: str
    timestamp: datetime
    side: Direction              # side of THIS fill (buy=long, sell=short)
    size: float
    price: float
    fees: float = 0.0
    order_id: str = ""
    account_id: Optional[int] = None


@dataclass
class Trade:
    """One round-turn trade. Computed fields are filled by metrics.compute_trade_fields."""
    symbol: str
    direction: Direction
    qty: float
    entry_time: datetime
    entry_price: float
    exit_time: Optional[datetime] = None
    exit_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    multiplier: float = 1.0
    fees: float = 0.0
    instrument_type: InstrumentType = InstrumentType.FUTURE
    source: Source = Source.MANUAL
    external_id: str = ""
    account_id: Optional[int] = None
    setup_id: Optional[int] = None
    setup_name: str = ""
    timeframe: str = ""
    session: str = ""
    rules_followed: Optional[bool] = None
    mistake_tags: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    confidence: Optional[int] = None
    emotion: str = ""
    mae: Optional[float] = None
    mfe: Optional[float] = None
    screenshot_path: str = ""
    notes: str = ""
    # computed
    gross_pnl: Optional[float] = None
    net_pnl: Optional[float] = None
    initial_risk: Optional[float] = None
    r_multiple: Optional[float] = None
    id: Optional[int] = None
    custom_metadata: dict[str, list[str]] | None = None

    @property
    def is_open(self) -> bool:
        return self.exit_price is None

    def to_row(self) -> dict[str, Any]:
        """Flatten to a DB / DataFrame row. Lists become JSON strings, enums become values."""
        d = asdict(self)
        for k in ("direction", "instrument_type", "source"):
            v = d[k]
            d[k] = v.value if isinstance(v, Enum) else v
        d["mistake_tags"] = json.dumps(d["mistake_tags"])
        d["tags"] = json.dumps(d["tags"])
        return d

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "Trade":
        r = dict(row)
        r["direction"] = Direction(r["direction"])
        r["instrument_type"] = InstrumentType(r.get("instrument_type") or "future")
        r["source"] = Source(r.get("source") or "manual")
        for k in ("mistake_tags", "tags"):
            v = r.get(k)
            r[k] = json.loads(v) if isinstance(v, str) and v else (v or [])
        for k in ("entry_time", "exit_time"):
            v = r.get(k)
            if isinstance(v, str):
                r[k] = datetime.fromisoformat(v)
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in r.items() if k in known})
