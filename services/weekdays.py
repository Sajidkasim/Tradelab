"""Entry-date categories for exploration; never alter saved timestamps."""
import pandas as pd
from core import edge

DAYS = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')


def canonical(value):
    for day in DAYS:
        if str(value).strip().casefold() == day.casefold():
            return day
    raise ValueError('Choose a weekday from Monday to Sunday.')


def entry_day(stamp, timezone):
    if pd.isna(stamp):
        return edge.UNKNOWN
    stamp = pd.Timestamp(stamp)
    stamp = stamp.tz_localize('UTC') if stamp.tzinfo is None else stamp
    return DAYS[stamp.tz_convert(timezone).weekday()]
