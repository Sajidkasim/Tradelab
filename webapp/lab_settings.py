"""Editable laboratory vocabulary and session windows; never changes saved trades."""
from datetime import time
from copy import deepcopy
import pandas as pd
from core import edge, metrics

KEY = 'primuslab_lab_settings'
DEFAULTS = {
    'timezone': 'Etc/GMT+4',
    'sessions': [
        {'name': 'Asia', 'start': '20:00', 'end': '02:00'},
        {'name': 'London', 'start': '02:00', 'end': '07:00'},
        {'name': 'New York pre-market', 'start': '07:00', 'end': '09:30'},
        {'name': 'New York open', 'start': '09:30', 'end': '12:00'},
        {'name': 'Lunch', 'start': '12:00', 'end': '13:30'},
        {'name': 'Afternoon', 'start': '13:30', 'end': '16:00'},
    ],
    'news': list(edge.NEWS),
    'conditions': list(edge.CONDITIONS),
}
RESERVED = {'All sessions', 'New York', 'Other', 'Outside configured sessions', edge.UNKNOWN}


def validate(payload):
    if payload.get('timezone') not in ('Etc/GMT+4', 'America/New_York'):
        raise ValueError('Choose fixed UTC−4 or the New York clock.')
    sessions = payload.get('sessions')
    if not isinstance(sessions, list) or not 1 <= len(sessions) <= 16:
        raise ValueError('Add between 1 and 16 session windows.')
    occupied, names, cleaned = set(), set(), []
    for item in sessions:
        name = str(item.get('name', '')).strip()
        if not name or len(name) > 80 or name.casefold() in names or name.casefold() in {value.casefold() for value in RESERVED}:
            raise ValueError('Give each session a unique name of up to 80 characters.')
        names.add(name.casefold())
        try:
            start, end = time.fromisoformat(item['start']), time.fromisoformat(item['end'])
            if start.second or end.second or start.microsecond or end.microsecond or start.tzinfo or end.tzinfo:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise ValueError('Use a valid start and end time for each session.') from None
        a, b = start.hour * 60 + start.minute, end.hour * 60 + end.minute
        if a == b:
            raise ValueError('A session must have different start and end times.')
        minutes = set(range(a, b)) if a < b else set(range(a, 1440)) | set(range(b))
        if minutes & occupied:
            raise ValueError('Session windows overlap. Adjust their start or end times.')
        occupied |= minutes
        cleaned.append({'name': name, 'start': start.strftime('%H:%M'), 'end': end.strftime('%H:%M')})
    result = {'timezone': payload['timezone'], 'sessions': cleaned}
    for key in ('news', 'conditions'):
        values = payload.get(key)
        if not isinstance(values, list) or not 1 <= len(values) <= 30 or any(not isinstance(v, str) or not v.strip() or len(v.strip()) > 120 for v in values):
            raise ValueError('Use between 1 and 30 non-empty labels, up to 120 characters each.')
        labels = list(dict.fromkeys(v.strip() for v in values))
        if edge.UNKNOWN in labels or any(v.startswith('Any ') for v in labels):
            raise ValueError('Not recorded and Any are provided automatically; leave them out of your lists.')
        result[key] = labels
    return result


def read(database):
    stored = database.get_setting(KEY)
    if stored is None:
        return deepcopy(DEFAULTS)
    try:
        return validate(stored)
    except (ValueError, AttributeError):
        return deepcopy(DEFAULTS)


def session_of(stamp, settings):
    if pd.isna(stamp):
        return edge.UNKNOWN
    stamp = pd.Timestamp(stamp)
    stamp = (stamp.tz_localize('UTC') if stamp.tzinfo is None else stamp.tz_convert('UTC')).floor('min')
    for item in settings['sessions']:
        start, end = time.fromisoformat(item['start']), time.fromisoformat(item['end'])
        # core.session_of handles ordinary intervals. Split overnight windows
        # into two intervals, then display their shared configured name.
        if start < end:
            windows = {'match': (start, end)}
            matched = metrics.session_of(stamp, settings['timezone'], windows) == 'match'
        else:
            windows = {'late': (start, time.max), 'early': (time.min, end)}
            matched = metrics.session_of(stamp, settings['timezone'], windows) in ('late', 'early')
        if matched:
            return item['name']
    return 'Outside configured sessions'
