"""Editable laboratory vocabulary and session windows; never changes saved trades."""
from datetime import time
from copy import deepcopy
import pandas as pd
from core import edge, metrics
from services import trade_labels

KEY = 'primuslab_lab_settings'
DISMISSED_ARCHIVES_KEY = 'primuslab_dismissed_archives'
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
    'confirmations': list(edge.CONFIRMATIONS),
    'level_timeframes': list(edge.TIMEFRAMES),
    'entry_timeframes': list(edge.TIMEFRAMES),
}
CHOICE_FIELDS = {'confirmations': 'confirmation', 'level_timeframes': 'timeframe',
                 'entry_timeframes': 'entry_timeframe'}
RESERVED = {'All sessions', 'New York', 'Other', 'Outside configured sessions', edge.UNKNOWN}


def validate(payload):
    if payload.get('timezone') not in ('Etc/GMT+4', 'America/New_York', 'Europe/London'):
        raise ValueError('Choose fixed UTC−4, New York or UK time.')
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
    for key in CHOICE_FIELDS:
        values = payload.get(key, DEFAULTS[key])
        if not isinstance(values, list) or len(values) > 200 or any(not isinstance(v, str) or not v.strip() or len(v.strip()) > 120 for v in values):
            raise ValueError('Use up to 200 non-empty setup labels, up to 120 characters each.')
        labels = list(dict.fromkeys(v.strip() for v in values))
        if any(value.casefold() == edge.UNKNOWN.casefold() or value.casefold().startswith('any ') for value in labels):
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


def choices(database, frame, mappings=None):
    """Discover labels once, while respecting choices explicitly hidden in settings."""
    settings = read(database)
    stored = database.get_setting(KEY, {})
    hidden = stored.get('hidden_choices', {}) if isinstance(stored, dict) else {}
    hidden = hidden if isinstance(hidden, dict) else {}
    mappings = database.get_setting(trade_labels.MAPPING_KEY, {}) if mappings is None else mappings
    labels = [edge.read_labels(tags) for tags in frame['tags']] if not frame.empty else []
    result = {}
    for key, field in CHOICE_FIELDS.items():
        used = [value for label in labels for value in label['confirmations']] if key == 'confirmations' else [label[field] for label in labels]
        removed = hidden.get(key, [])
        removed = {value for value in removed if isinstance(value, str)} if isinstance(removed, list) else set()
        candidates = settings[key] + trade_labels.mapped_values(mappings, field) + used
        result[key] = list(dict.fromkeys(value for value in candidates if value and value.strip().casefold() not in ('not recorded','unclassified') and value not in removed))
    return result


def save(database, frame, payload):
    current = choices(database, frame)
    values = validate({**read(database), **payload})
    stored = database.get_setting(KEY, {})
    previous = stored.get('hidden_choices', {}) if isinstance(stored, dict) else {}
    previous = previous if isinstance(previous, dict) else {}
    hidden = {}
    for key in CHOICE_FIELDS:
        old = previous.get(key, [])
        removed = {value for value in old if isinstance(value, str)} if isinstance(old, list) else set()
        if key in payload:
            removed.update(set(current[key]) - set(values[key]))
            removed.difference_update(values[key])
        hidden[key] = sorted(removed)
    database.set_setting(KEY, {**values, 'hidden_choices': hidden})
    restore_archive_visibility(database, {key: values[key] for key in CHOICE_FIELDS if key in payload})
    return values


def restore_archive_visibility(database, active):
    dismissed = database.get_setting(DISMISSED_ARCHIVES_KEY, {})
    updated = {field: [name for name in names if name not in active.get(field, [])]
               for field, names in dismissed.items()}
    if updated != dismissed:
        database.set_setting(DISMISSED_ARCHIVES_KEY, updated)


def archived(database, frame):
    from services.strategy_catalog import real_choice
    settings = database.get_setting(KEY, {}) or {}
    settings = settings if isinstance(settings, dict) else {}
    hidden = settings.get('hidden_choices', {})
    hidden = hidden if isinstance(hidden, dict) else {}
    active = choices(database, frame)
    return {key:sorted({value for value in hidden.get(key, []) if real_choice(value)} - set(active[key]))
            for key in CHOICE_FIELDS}


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
