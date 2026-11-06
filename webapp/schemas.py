"""Only explicit journal fields can be submitted; identity comes from the session."""
from datetime import datetime, date
from typing import Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from core import edge


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class JournalAccount(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    starting_balance: Annotated[float, Field(gt=0)]
    account_type: Literal["Funded", "Eval", "Personal"]


class AccountAccess(StrictModel):
    allowed: bool = Field(strict=True)


class Labels(StrictModel):
    level: str = Field(default=edge.UNKNOWN, max_length=120)
    timeframe: str = Field(default=edge.UNKNOWN, max_length=120)
    entry_timeframe: str = Field(default=edge.UNKNOWN, max_length=120)
    condition: str = Field(default=edge.UNKNOWN, max_length=120)
    news: str = Field(default=edge.UNKNOWN, max_length=120)
    confirmations: list[str] = Field(default_factory=list, max_length=30)


class Filters(StrictModel):
    study_id: str = Field(default='', max_length=32, pattern=r'^([a-f0-9]{32}|unassigned)?$')
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
    risk_amount: float | None = Field(default=None, gt=0)
    risk_unavailable: bool | None = None
    study_id: str | None = Field(default=None, max_length=32, pattern=r'^([a-f0-9]{32})?$')


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
    journal_day: date | None = None
    journal_trade_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')


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
    timezone: Literal["Etc/GMT+4", "America/New_York", "Europe/London"] = "Etc/GMT+4"
    sessions: list[SessionWindow] = Field(min_length=1, max_length=16)
    news: list[str] = Field(min_length=1, max_length=30)
    conditions: list[str] = Field(min_length=1, max_length=30)
    confirmations: list[str] | None = Field(default=None, max_length=200)
    level_timeframes: list[str] | None = Field(default=None, max_length=200)
    entry_timeframes: list[str] | None = Field(default=None, max_length=200)


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


class Study(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    strategy: str = Field(default='', max_length=120)
    symbol: str = Field(default='', max_length=30)
    target_rr: str = Field(default='', max_length=30)
    rules: str = Field(default='', max_length=6000)
    archived: bool = False


class StudyAssignment(StrictModel):
    ids: list[int] = Field(min_length=1, max_length=2000)
    study_id: str = Field(default='', max_length=32, pattern=r'^([a-f0-9]{32})?$')


class SavedSetup(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    filters: Filters


class LabelMerge(StrictModel):
    field: Literal['strategy', 'level', 'timeframe', 'entry_timeframe', 'confirmation', 'condition', 'news']
    source: str = Field(min_length=1, max_length=120)
    target: str = Field(min_length=1, max_length=120)
    preview_token: str = Field(default='', max_length=4096)


class JournalPreferences(StrictModel):
    timezone: Literal['America/New_York', 'Europe/London']


class WelcomeSetup(JournalPreferences):
    strategies: list[str] = Field(default_factory=list, max_length=200)
    levels: list[str] = Field(default_factory=list, max_length=200)
    confirmations: list[str] = Field(default_factory=list, max_length=200)


class TourProgress(StrictModel):
    status: Literal['completed', 'skipped']


class JournalTrade(StrictModel):
    account_id: int | None = Field(default=None, gt=0)
    setup_grade: Literal['', 'A+', 'A', 'B'] = ''
    level: str = Field(default=edge.UNKNOWN, max_length=120)
    timeframe: str = Field(default=edge.UNKNOWN, max_length=120)
    entry_timeframe: str = Field(default=edge.UNKNOWN, max_length=120)
    risk_amount: float | None = Field(default=None, gt=0)
    net_pnl: float | None = None
    outcome: Literal['not_recorded', 'win', 'loss', 'breakeven'] = 'not_recorded'
    confirmations: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(default_factory=list, max_length=30)
    id: str = Field(pattern=r'^[a-f0-9]{32}$')
    symbol: str = Field(default='', max_length=30)
    direction: Literal['long', 'short', ''] = ''
    strategy: str = Field(default='', max_length=120)
    time: str = Field(default='', pattern=r'^([01][0-9]|2[0-3]):[0-5][0-9]$|^$')
    source: Literal['manual', 'backtest'] = 'manual'
    notes: str = Field(default='', max_length=6000)


class JournalTradeLink(StrictModel):
    trade_id: int | None = Field(default=None, gt=0)


class DailyEntry(StrictModel):
    plan_followed: Literal['Yes', 'Partly', 'No'] | None = None
    traded_today: Literal['Yes', 'No'] | None = None
    plan: str = Field(default='', max_length=12000)
    notes: str = Field(default='', max_length=20000)
    lesson: str = Field(default='', max_length=12000)
    mindset: Literal['Not set', 'Focused', 'Patient', 'Distracted', 'Frustrated'] = 'Not set'
    trades: list[JournalTrade] | None = Field(default=None, max_length=30)


class FeedbackInput(StrictModel):
    message: str = Field(min_length=1, max_length=2000)
