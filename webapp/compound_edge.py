"""Private habit scoring through the existing authenticated workspace."""
from datetime import date, datetime, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field

from . import journal_preferences

START = 'primus_compound_edge_start'
PREFIX = 'primus_compound_edge_day:'
REST_DAYS = 'primus_compound_edge_rest_days'
# NYSE full closures: https://www.nyse.com/trade/hours-calendars
HOLIDAYS = frozenset({
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
    '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19',
    '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
})


def today(db, now=None):
    zone = ZoneInfo(journal_preferences.read(db)['timezone'])
    return (now or datetime.now(timezone.utc)).astimezone(zone).date()


def day_state(db, day):
    return db.get_setting(PREFIX + day.isoformat(), {})


def record(db, now=None, **evidence):
    day = today(db, now)
    state = day_state(db, day)
    updated = {**state, **evidence}
    if updated != state:
        db.set_setting(PREFIX + day.isoformat(), updated)
        if not db.get_setting(START):
            db.set_setting(START, day.isoformat())


def journal_saved(db, day, entry):
    if day != today(db):
        return
    followed = entry.get('plan_followed') == 'Yes'
    record(db, journal=bool(entry.get('plan', '').strip()), followed=followed,
           no_trade=bool(entry.get('no_trade_plan') and entry.get('traded_today') == 'No'
                         and not entry.get('trades')))


def replay_interaction(db, sid, now=None):
    now = now or datetime.now(timezone.utc)
    state = day_state(db, today(db, now))
    if state.get('replay_seconds', 0) >= 1200:
        return
    stamp = int(now.timestamp())
    last = state.get('last_replay', {})
    elapsed = stamp - last.get('stamp', stamp)
    if last and elapsed <= 0:
        return
    # Only time bracketed by actual interactions in the same replay session.
    seconds = elapsed if last.get('session') == sid and elapsed <= 75 else 0
    record(db, now, replay_seconds=min(1200, state.get('replay_seconds', 0) + seconds),
           last_replay={'session': sid, 'stamp': stamp})


def lab_review(db, trade_id, note_saved, reviewed, now=None):
    now = now or datetime.now(timezone.utc)
    state = day_state(db, today(db, now))
    if state.get('lab'):
        return
    if note_saved:
        record(db, now, lab=True)
    elif reviewed:
        stamp = int(now.timestamp())
        batch = state.get('review_batch', {})
        trades = batch.get('ids', []) if 0 <= stamp - batch.get('started', 0) <= 1800 else []
        if trade_id not in trades:
            ids = [*trades, trade_id]
            record(db, now, lab=len(ids) >= 5,
                   review_batch={'started': batch['started'] if trades else stamp, 'ids': ids})


def score(state):
    tasks = {
        'checklist': bool(state.get('checklist')), 'mindset': bool(state.get('mindset')),
        'journal': bool(state.get('journal')), 'plan': bool(state.get('followed') or state.get('no_trade')),
        'replay': state.get('replay_seconds', 0) >= 1200, 'lab': bool(state.get('lab')),
    }
    pillars = [15 * (tasks['checklist'] + tasks['mindset']),
               20 * (tasks['journal'] + tasks['plan']), 15 * (tasks['replay'] + tasks['lab'])]
    return tasks, pillars, sum(pillars)


def summary(db, now=None, joined_at=None):
    day = today(db, now)
    recorded_start = date.fromisoformat(db.get_setting(START) or day.isoformat())
    joined_day = today(db, joined_at.replace(tzinfo=timezone.utc)) if joined_at else day
    start = min(day, joined_day, recorded_start)
    rest_days = db.get_setting(REST_DAYS, [6, 7])
    holidays = HOLIDAYS | set(db.get_setting('primus_compound_edge_holidays', []))
    stored = db.settings_with_prefix(PREFIX)
    current = longest = missed = kept = 0
    rows = []
    for offset in range(max(0, (day - start).days) + 1):
        at = min(day, start + timedelta(days=offset))
        key = at.isoformat()
        tasks, pillars, total = score(stored.get(PREFIX + key, {}))
        off = at.isoweekday() in rest_days or key in holidays
        if not off:
            if total >= 50:
                current += 1
                longest = max(longest, current)
                missed = 0
                kept += int(at.year == day.year)
            elif at < day:
                missed += 1
                if missed >= 2:
                    current = 0
        if offset >= (day - start).days - 364:
            rows.append({'date': key, 'pillars': pillars, 'score': total, 'off': off})
    return {'today': day.isoformat(), 'days': rows, 'tasks': tasks, 'rest_days': rest_days,
            'pillars': pillars, 'score': total, 'current_streak': current,
            'longest_streak': longest, 'days_kept': kept}


class RestDays(BaseModel):
    model_config = ConfigDict(extra='forbid')
    days: list[Annotated[int, Field(strict=True, ge=1, le=7)]] = Field(max_length=7)


def mount(app, workspace):
    @app.get('/api/compound-edge')
    def read(member=Depends(workspace)):
        workspaces = app.state.workspaces
        with workspaces.workspace_lock(member['key']):
            return summary(workspaces.database(member['key']), joined_at=member.get('joined_at'))

    @app.put('/api/compound-edge/rest-days')
    def save_rest_days(payload: RestDays, member=Depends(workspace)):
        workspaces = app.state.workspaces
        with workspaces.workspace_lock(member['key']):
            db = workspaces.database(member['key'])
            db.set_setting(REST_DAYS, sorted(set(payload.days)))
            return summary(db, joined_at=member.get('joined_at'))
