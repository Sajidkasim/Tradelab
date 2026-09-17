"""Instrument reference data and tick helpers.

Multiplier = dollars per 1.0 point of price movement per contract.
Tick value = multiplier * tick_size.
"""
from __future__ import annotations

import math

from .models import Instrument, InstrumentType

# symbol: (name, multiplier, tick_size, default round-turn commission per contract)
_SEED = {
    "ES":  ("E-mini S&P 500",            50.0,    0.25,    4.00),
    "MES": ("Micro E-mini S&P 500",       5.0,    0.25,    1.00),
    "NQ":  ("E-mini Nasdaq-100",         20.0,    0.25,    4.00),
    "MNQ": ("Micro E-mini Nasdaq-100",    2.0,    0.25,    1.00),
    "YM":  ("E-mini Dow",                 5.0,    1.00,    4.00),
    "MYM": ("Micro E-mini Dow",           0.5,    1.00,    1.00),
    "RTY": ("E-mini Russell 2000",       50.0,    0.10,    4.00),
    "M2K": ("Micro E-mini Russell 2000",  5.0,    0.10,    1.00),
    "CL":  ("Crude Oil",               1000.0,    0.01,    4.00),
    "MCL": ("Micro Crude Oil",          100.0,    0.01,    1.00),
    "GC":  ("Gold",                     100.0,    0.10,    4.00),
    "MGC": ("Micro Gold",                10.0,    0.10,    1.00),
    "6E":  ("Euro FX",               125000.0, 0.00005,    4.00),
}


def default_instruments() -> list[Instrument]:
    out = [
        Instrument(symbol=s, name=n, multiplier=m, tick_size=t,
                   commission_per_contract=c, exchange="CME")
        for s, (n, m, t, c) in _SEED.items()
    ]
    out.append(Instrument(symbol="OPT", name="Equity option (per contract)",
                          multiplier=100.0, tick_size=0.01,
                          instrument_type=InstrumentType.OPTION,
                          commission_per_contract=0.65))
    return out


def instrument_map() -> dict[str, Instrument]:
    return {i.symbol: i for i in default_instruments()}


def round_to_tick(price: float, tick_size: float) -> float:
    """Round a price to the nearest valid tick."""
    if tick_size <= 0:
        return price
    ticks = round(price / tick_size)
    return round(ticks * tick_size, 10)


def ticks_between(a: float, b: float, tick_size: float) -> float:
    """Number of ticks between two prices (absolute)."""
    if tick_size <= 0:
        return 0.0
    return abs(a - b) / tick_size


def dollar_risk_per_contract(entry: float, stop: float, multiplier: float) -> float:
    return abs(entry - stop) * multiplier


def contracts_for_risk(risk_dollars: float, entry: float, stop: float,
                       multiplier: float, max_contracts: int | None = None) -> int:
    """How many contracts can be traded so that a stop-out loses at most risk_dollars."""
    per = dollar_risk_per_contract(entry, stop, multiplier)
    if per <= 0 or risk_dollars <= 0:
        return 0
    n = int(math.floor(risk_dollars / per))
    if max_contracts is not None:
        n = min(n, max_contracts)
    return max(n, 0)
