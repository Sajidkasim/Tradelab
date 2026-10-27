"""Only explicit journal fields can be submitted; identity comes from the session."""
from datetime import datetime, date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from core import edge


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Labels(StrictModel):
    level: str = Field(default=edge.UNKNOWN, max_length=120)
    timeframe: str = Field(default=edge.UNKNOWN, max_length=120)
    entry_timeframe: str = Field(default=edge.UNKNOWN, max_length=120)
    condition: str = Field(default=edge.UNKNOWN, max_length=120)
    news: str = Field(default=edge.UNKNOWN, max_length=120)
    confirmations: list[str] = Field(default_factory=list, max_length=30)


class Filters(StrictModel):
    scope: Literal["Backtesting", "Forward testing", "All"] = "Backtesting"
    sample: Literal["Backtesting", "Forward testing"] = "Backtesting"
    combined: bool = False
    account_id: int | None = None
    start: date | None = None
    end: date | None = None
    strategy: str = "All strategies"
    direction: Literal["Both", "long", "short"] = "Both"
    level: str = "Any level"
    timeframe: str = "Any timeframe"
    entry_timeframe: str = "Any timeframe"
    target_rr: str = "Any RR"
    weekday: Literal["All days", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] = "All days"
    confirmations: list[str] = Field(default_factory=list, max_length=30)
    news: str = "Any news status"
    condition: str = "Any condition"
    window: str = "New York"
    symbol: str = "All markets"
    mode: Literal["light", "dark"] = "light"
    comparison: Literal["setup_name", "edge_level", "edge_confirmation_set", "direction", "edge_window", "edge_news", "edge_entry_timeframe", "edge_timeframe"] = "setup_name"
    detail: bool = False


class Review(StrictModel):
    strategy: str = Field(max_length=120)
    labels: Labels
    notes: str = Field(default="", max_length=20000)
    confirmed: bool = False


class NewTrade(Review):
    symbol: str = Field(max_length=30)
    direction: Literal["long", "short"]
    account_id: int
    source: Literal["backtest", "manual"]
    entry_time: datetime
    exit_time: datetime
    net_pnl: float | None = None
    risk_amount: float | None = Field(default=None, gt=0)
    entry_price: float | None = Field(default=None, gt=0)
    exit_price: float | None = Field(default=None, gt=0)
    stop_price: float | None = Field(default=None, gt=0)
    target_price: float | None = Field(default=None, gt=0)
    qty: float = Field(default=1, gt=0)
    fees: float = Field(default=0, ge=0)
    rules_followed: bool | None = None


class Playbook(StrictModel):
    strategies: list[str] = Field(max_length=200)
    levels: list[str] = Field(max_length=200)


class Unlock(StrictModel):
    password: SecretStr = Field(min_length=1, max_length=1024)


class BulkStrategy(StrictModel):
    ids: list[int] = Field(min_length=1, max_length=2000)
    strategy: str = Field(min_length=1, max_length=120)


class PositionSize(StrictModel):
    symbol: str = Field(max_length=30)
    account_id: int
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    risk_dollars: float = Field(gt=0)


class SessionWindow(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")


class LabSettings(StrictModel):
    timezone: Literal["Etc/GMT+4", "America/New_York"] = "Etc/GMT+4"
    sessions: list[SessionWindow] = Field(min_length=1, max_length=16)
    news: list[str] = Field(min_length=1, max_length=30)
    conditions: list[str] = Field(min_length=1, max_length=30)


class DeleteAllTrades(StrictModel):
    confirmation_count: int = Field(gt=0, strict=True)
    preview_token: str = Field(min_length=1, max_length=2048)


class ImportPreferences(StrictModel):
    account_id: int
    source: Literal['fxreplay', 'backtest', 'csv', 'excel']
    timezone: Literal['UTC', 'Etc/GMT+4', 'America/New_York', 'Europe/London']
    dayfirst: bool = False
    update_labels: bool = False
    include_breakeven: bool = True
