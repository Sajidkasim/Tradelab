"""Private morning prep and a daily high score for verified Bullpen teammates."""
from datetime import date, datetime, time, timedelta, timezone
from random import SystemRandom
from typing import Annotated, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import Depends, HTTPException
from itsdangerous import BadSignature, URLSafeSerializer
from pydantic import Field, ValidationError

from core import metrics, risk
from core.models import LIVE_SOURCES
from . import daily_journal
from .bullpen import _team_name
from .schemas import StrictModel

NY = ZoneInfo('America/New_York')
PREP = 'primus_mindset_prep_v1:'
ATTEMPT = 'primus_mindset_attempt_v1'
TEAM_SCORES = 'primus_mindset_team_score_v1'
DRILL_SECONDS = 60
CHECKLIST = 'primus_mindset_checklist_v1'
DEFAULT_ITEMS = [
    {'id': 'levels', 'label': 'HTF levels marked'},
    {'id': 'news', 'label': 'News checked'},
    {'id': 'charity', 'label': 'Give to charity'},
]
MAX_ITEMS = 200
ChecklistId = Annotated[str, Field(pattern=r'^(levels|news|charity|loss_limit|[a-f0-9]{32})$')]
Mode = Literal['sweep', 'memory', 'search']
Difficulty = Literal['easy', 'hard']
EASY_SEARCH_SYMBOLS = ('circle', 'square', 'diamond', 'triangle', 'star')
HARD_SEARCH_SYMBOLS = ('north-east', 'south-east', 'south-west', 'north-west')
Day = Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}$')]
AttemptId = Annotated[str, Field(pattern=r'^[a-f0-9]{32}$')]
Cell = Annotated[int, Field(strict=True, ge=0, le=24)]


class ChecklistItem(StrictModel):
    id: ChecklistId
    label: str = Field(min_length=1, max_length=120)


class MorningPrep(StrictModel):
    day: Day
    energy: Literal['', 'rested', 'tired', 'fumes']
    headspace: Literal['', 'calm', 'distracted', 'emotional']
    intention: str | None = Field(default=None, max_length=300)
    checklist: list[ChecklistId] = Field(max_length=MAX_ITEMS)
    items: list[ChecklistItem] | None = Field(default=None, max_length=MAX_ITEMS)


class AuraTurn(StrictModel):
    question: str = Field(min_length=1, max_length=400)
    answer: str = Field(min_length=1, max_length=600)


class AuraPrompt(StrictModel):
    step: Literal['follow_up', 'intention', 'question']
    reflection: str = Field(min_length=1, max_length=400)
    reply: str = Field(default='', max_length=400)
    question: str = Field(default='', max_length=300)
    focus: Literal['focus', 'patience', 'reset', 'risk'] = 'focus'
    history: list[AuraTurn] = Field(default_factory=list, max_length=4)


class AuraReply(StrictModel):
    focus: Literal['focus', 'patience', 'reset', 'risk']
    text: str = Field(min_length=1, max_length=600)


class StartDrill(StrictModel):
    day: Day
    mode: Mode
    difficulty: Difficulty = 'easy'


class DrillResponse(StrictModel):
    round: int = Field(strict=True, ge=0, lt=12)
    cells: list[Cell] = Field(default_factory=list, max_length=5)


class ScoreSubmission(StrictModel):
    attempt_id: AttemptId
    responses: list[DrillResponse] = Field(max_length=12)


class Completion(StrictModel):
    attempt_id: AttemptId | None
    day: Day | None = None
    affirmation: str | None = Field(default=None, max_length=300)


def now_utc():
    return datetime.now(timezone.utc)


def day_window(now):
    local_day = now.astimezone(NY).date()
    midnight = datetime.combine(local_day + timedelta(days=1), time.min, tzinfo=NY)
    return local_day.isoformat(), midnight.astimezone(timezone.utc).isoformat()


def aura_context(database, frame, day):
    """Only confirmed outcomes and limit hits leave the workspace as coaching context."""
    end = pd.Timestamp(day)
    start = end - pd.Timedelta(days=30)
    yesterday = end - pd.Timedelta(days=1)
    live = metrics.closed(frame.loc[frame['source'].isin(LIVE_SOURCES)])
    if not live.empty:
        live['exit_time'] = pd.to_datetime(live['exit_time'], utc=True).dt.tz_convert(NY).dt.tz_localize(None)
        live = live.loc[live['exit_time'].ge(start) & live['exit_time'].lt(end)]
    outcomes = {date.date().isoformat(): daily_journal.outcome(total)
                for date, total in metrics.daily_pnl(live).items()}
    for row in database.settings_with_prefix(daily_journal.PREFIX).values():
        if isinstance(row, dict) and start.date().isoformat() <= row.get('day', '') < day and not row.get('deleted_at'):
            result = daily_journal.with_day_result(database, row)['day_result']['outcome']
            if result != 'not_recorded':
                outcomes[row['day']] = result
    green_days = 0
    for date in sorted(outcomes, reverse=True):
        if outcomes[date] != 'win':
            break
        green_days += 1

    hit_limit = False
    if not live.empty:
        prior = live.loc[live['exit_time'].dt.normalize().eq(yesterday)]
        for account in database.accounts():
            if account.daily_loss_limit <= 0:
                continue
            totals = metrics.daily_pnl(prior.loc[prior['account_id'].eq(account.id)])
            breaches = risk.find_breaches(totals, account.starting_balance,
                                          account.daily_loss_limit, account.max_trailing_drawdown)
            if breaches['rule'].eq('daily_loss_limit').any():
                hit_limit = True
                break
    return {'yesterday': outcomes.get(yesterday.date().isoformat(), 'not_recorded'),
            'daily_loss_limit_hit': hit_limit, 'green_days': green_days}


def aura_opening(context):
    if context['daily_loss_limit_hit']:
        return 'You hit your daily loss limit yesterday. If the urge to win it back shows up today, what will make you step away?'
    if context['yesterday'] == 'loss':
        return 'Yesterday was a red day. Decide what would make you stop and reassess before the next entry.'
    if context['green_days'] >= 2:
        return (f"You’ve had {context['green_days']} green trading days in a row. "
                'Name the entry condition that still has to be there, even if the setup looks obvious.')
    return 'Before you look at a chart, choose one situation that could pull you off plan and one action you’ll take when it happens.'


def readiness(energy, headspace):
    if not energy or not headspace:
        return None
    if energy == 'fumes' or headspace == 'emotional':
        return 'red'
    if energy == 'tired' or headspace == 'distracted':
        return 'amber'
    return 'green'


def sweep_target(round_data):
    _, sweep, reclaim, confirm = round_data['candles']
    return (sweep['low'] < round_data['level']
            and reclaim['close'] > round_data['level']
            and confirm['close'] > round_data['delivery'])


def make_rounds(mode, rng=None, *, difficulty='easy'):
    rng = rng or SystemRandom()
    grid_size = 5 if difficulty == 'hard' else 4
    cell_count = grid_size ** 2
    if mode == 'memory':
        pattern_size = 5 if difficulty == 'hard' else 4
        return [{'cells': sorted(rng.sample(range(cell_count), pattern_size)), 'grid_size': grid_size}
                for _ in range(6)]
    if mode == 'search':
        palette = HARD_SEARCH_SYMBOLS if difficulty == 'hard' else EASY_SEARCH_SYMBOLS
        rounds = []
        for _ in range(6):
            target = rng.choice(palette)
            distractors = [symbol for symbol in palette if symbol != target]
            symbols = rng.choices(distractors, k=cell_count)
            symbols[rng.randrange(cell_count)] = target
            rounds.append({'target': target, 'symbols': symbols, 'grid_size': grid_size})
        return rounds

    patterns = ['valid'] * 6 + ['no_sweep', 'no_reclaim', 'no_delivery'] * 2
    rng.shuffle(patterns)
    rounds = []
    for pattern in patterns:
        level = rng.randint(35, 48)
        delivery = level + rng.randint(12, 19)
        sweep_low = level + 1 if pattern == 'no_sweep' else level - rng.randint(5, 13)
        reclaim_close = level - 2 if pattern == 'no_reclaim' else level + rng.randint(3, 7)
        confirm_close = delivery - 2 if pattern == 'no_delivery' else delivery + rng.randint(3, 8)

        def candle(open_price, close, low=None):
            return {'open': open_price, 'close': close,
                    'low': min(open_price, close) - 2 if low is None else low,
                    'high': max(open_price, close) + 3}

        rounds.append({'level': level, 'delivery': delivery, 'candles': [
            candle(delivery, level + 7), candle(level + 7, level + 3, sweep_low),
            candle(level + 3, reclaim_close), candle(reclaim_close, confirm_close),
        ]})
    return rounds


def score_drill(mode, rounds, responses):
    points = 0
    answered = set()
    for response in responses:
        index, cells = response.round, response.cells
        if index >= len(rounds) or index in answered:
            raise ValueError('Send at most one response for each round in this drill.')
        answered.add(index)
        if mode == 'sweep':
            if cells:
                raise ValueError('Sweep responses do not contain grid cells.')
            points += 10 if sweep_target(rounds[index]) else -10
        elif mode == 'search':
            row = rounds[index]
            if len(cells) != 1 or not 0 <= cells[0] < len(row['symbols']):
                raise ValueError('Choose one tile on the Visual Search grid.')
            points += 10 if row['symbols'][cells[0]] == row['target'] else 0
        else:
            row = rounds[index]
            pattern_size = len(row['cells'])
            if len(cells) != pattern_size or len(set(cells)) != pattern_size:
                raise ValueError(f'Choose {pattern_size} different cells for a memory answer.')
            if any(not 0 <= cell < row.get('grid_size', 4) ** 2 for cell in cells):
                raise ValueError('Choose tiles on the Pattern Match grid.')
            points += 10 if sorted(cells) == row['cells'] else 0
    return max(0, points)


def mount(app, config, workspace):
    signer = URLSafeSerializer(config.secret, salt='primus-mindset-drill-v1')

    def workspaces():
        return app.state.workspaces

    def database(member):
        return workspaces().database(member['key'])

    def team_name(member):
        return _team_name(member.get('email')) if config.google_required else None

    def prep(db, day):
        return {'energy': '', 'headspace': '', 'intention': '', 'checklist': [],
                'completed': False, **db.get_setting(PREP + day, {})}

    def checklist_items(db):
        saved = db.get_setting(CHECKLIST, DEFAULT_ITEMS)
        previous_default = [*DEFAULT_ITEMS[:2], {'id': 'loss_limit', 'label': 'Daily loss limit set'}]
        return DEFAULT_ITEMS if saved == previous_default else saved

    def view(db, member, day, reset):
        state = prep(db, day)
        state.pop('checklist_items', None)
        items = checklist_items(db)
        checked = [item['id'] for item in items if item['id'] in state['checklist']]
        return {'day': day, 'resets_at': reset, 'team_eligible': bool(team_name(member)),
                **state, 'items': items, 'checklist': checked,
                'readiness': readiness(state['energy'], state['headspace'])}

    def current_attempt(db, member, now, attempt_id):
        day, _ = day_window(now)
        saved = db.get_setting(ATTEMPT, '')
        try:
            attempt = signer.loads(saved) if isinstance(saved, str) else {}
        except BadSignature:
            attempt = {}
        if (attempt.get('id') != attempt_id or attempt.get('day') != day
                or attempt.get('workspace') != member['key']):
            raise HTTPException(409, 'This drill has expired. Start a new warm-up for today.')
        return attempt

    @app.get('/api/mindset/warmup')
    def get_warmup(member=Depends(workspace)):
        day, reset = day_window(now_utc())
        with workspaces().lock:
            return view(database(member), member, day, reset)

    @app.get('/api/mindset/checklist/{day}')
    def saved_checklist(day: date, member=Depends(workspace)):
        day_key = day.isoformat()
        with workspaces().lock:
            db = database(member)
            saved = db.get_setting(PREP + day_key, {})
            if 'checklist_items' not in saved and not saved.get('checklist'):
                return {'day': day_key, 'items': []}
            items = saved.get('checklist_items')
            if items is None:
                items = checklist_items(db)
            checked = set(saved.get('checklist', []))
            return {'day': day_key, 'items': [
                {**item, 'checked': item['id'] in checked} for item in items
            ]}

    @app.put('/api/mindset/warmup')
    def save_warmup(payload: MorningPrep, member=Depends(workspace)):
        day, reset = day_window(now_utc())
        if payload.day != day:
            raise HTTPException(409, 'A new day has started in New York. Reload morning prep before saving.')
        with workspaces().lock:
            db = database(member)
            items = checklist_items(db)
            if payload.items is not None:
                items = [{'id': item.id, 'label': item.label.strip()} for item in payload.items]
            ids = [item['id'] for item in items]
            if len(set(ids)) != len(ids) or any(not item['label'] for item in items):
                raise ValueError('Give each checklist item its own ID and a label.')
            if any(item not in ids for item in payload.checklist):
                raise ValueError('Check only items on your saved checklist.')
            value = {**prep(db, day), **payload.model_dump(exclude={'day', 'items'}, exclude_none=True)}
            value['checklist'] = [item for item in ids if item in payload.checklist]
            value['checklist_items'] = items
            if payload.items is not None:
                db.set_setting(CHECKLIST, items)
            db.set_setting(PREP + day, value)
            workspaces().bump(member['key'])
            return view(db, member, day, reset)

    def current_aura_context(member):
        day, _ = day_window(now_utc())
        return aura_context(database(member), workspaces().trades(member['key']), day)

    @app.get('/api/mindset/check-in/opening')
    def check_in_opening(member=Depends(workspace)):
        context = current_aura_context(member)
        suggestions = ['Help me stop chasing', 'Pressure-test my entry rules', 'Plan my reset after a loss']
        if context['daily_loss_limit_hit'] or context['yesterday'] == 'loss':
            suggestions = ['Help me reset after yesterday', 'Plan a response to revenge trading', 'Define my walk-away trigger']
        elif context['green_days'] >= 2:
            suggestions = ['Pressure-test my entry rules', 'Spot signs I’m forcing a trade', 'Plan what to do if I miss an entry']
        return {'text': aura_opening(context), 'suggestions': suggestions}

    @app.post('/api/mindset/check-in/reflect')
    def reflect(payload: AuraPrompt, member=Depends(workspace)):
        from extensions.ai_coach import aura_check_in

        if payload.step == 'intention' and len(payload.reflection.strip()) < 10:
            raise HTTPException(422, 'Write at least 10 characters before asking Aura for a rule.')
        raw = aura_check_in(payload.model_dump(), current_aura_context(member)).strip()
        if raw.startswith('```json') and raw.endswith('```'):
            raw = raw[7:-3].strip()
        try:
            return AuraReply.model_validate_json(raw)
        except ValidationError:
            raise HTTPException(502, 'Aura returned an unreadable reply. Try again.') from None

    @app.post('/api/mindset/drill')
    def start_drill(payload: StartDrill, member=Depends(workspace)):
        now = now_utc()
        day, _ = day_window(now)
        if payload.day != day:
            raise HTTPException(409, 'A new day has started in New York. Start today’s warm-up.')
        attempt = {'id': uuid4().hex, 'day': day, 'mode': payload.mode,
                   'started_at': now.timestamp(), 'rounds': make_rounds(payload.mode, difficulty=payload.difficulty),
                   'workspace': member['key']}
        with workspaces().lock:
            database(member).set_setting(ATTEMPT, signer.dumps(attempt))
            workspaces().bump(member['key'])
        return {'attempt_id': attempt['id'], 'duration': DRILL_SECONDS, 'rounds': attempt['rounds']}

    @app.post('/api/mindset/score')
    def submit_score(payload: ScoreSubmission, member=Depends(workspace)):
        with workspaces().lock:
            now = now_utc()
            db = database(member)
            attempt = current_attempt(db, member, now, payload.attempt_id)
            if 'score' not in attempt:
                elapsed = now.timestamp() - attempt['started_at']
                if elapsed < DRILL_SECONDS:
                    raise HTTPException(409, 'Finish the 60-second drill before submitting.')
                if elapsed > 900:
                    raise HTTPException(409, 'This drill has expired. Start a new warm-up.')
                attempt['score'] = score_drill(attempt['mode'], attempt['rounds'], payload.responses)
                db.set_setting(ATTEMPT, signer.dumps(attempt))
                workspaces().bump(member['key'])
            score = attempt['score']
            name = team_name(member)
            if name:
                root = workspaces().root
                board = root.get_setting(TEAM_SCORES, {})
                scores = board.get('scores', {}) if board.get('day') == attempt['day'] else {}
                if name not in scores or score > scores[name]:
                    root.set_setting(TEAM_SCORES, {'day': attempt['day'], 'scores': {**scores, name: score}})
            return {'score': score, 'max_score': 60}

    @app.post('/api/mindset/complete')
    def complete(payload: Completion, member=Depends(workspace)):
        with workspaces().lock:
            now = now_utc()
            day, reset = day_window(now)
            db = database(member)
            if payload.day is not None and payload.day != day:
                raise HTTPException(409, 'A new day has started in New York. Open today’s warm-up.')
            if payload.attempt_id is not None:
                attempt = current_attempt(db, member, now, payload.attempt_id)
                if 'score' not in attempt:
                    raise HTTPException(409, 'Submit or skip your drill before completing the warm-up.')
            elif payload.day is None:
                raise HTTPException(422, 'Include today’s warm-up date when skipping the drill.')
            value = {**prep(db, day), 'completed': True}
            if payload.affirmation is not None:
                value['affirmation'] = payload.affirmation.strip()
            db.set_setting(PREP + day, value)
            workspaces().bump(member['key'])
            return view(db, member, day, reset)

    @app.get('/api/mindset/high-score')
    def high_score(member=Depends(workspace)):
        if not team_name(member):
            raise HTTPException(403, 'Today’s high score is reserved for verified Bullpen teammates.')
        day, _ = day_window(now_utc())
        with workspaces().lock:
            board = workspaces().root.get_setting(TEAM_SCORES, {})
            scores = board.get('scores', {}) if board.get('day') == day else {}
            if not scores:
                return {'day': day, 'leader': None}
            name, score = min(scores.items(), key=lambda item: (-item[1], item[0]))
            return {'day': day, 'leader': {'name': name, 'score': score, 'max_score': 60}}
