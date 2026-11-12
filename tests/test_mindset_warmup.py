from datetime import datetime, timedelta, timezone
from random import Random

import pytest

from tests.test_daily_journal import draft, login
from webapp import mindset


def test_readiness_and_new_york_calendar_boundaries():
    assert mindset.readiness('', 'emotional') is None
    assert mindset.readiness('rested', 'calm') == 'green'
    assert mindset.readiness('tired', 'distracted') == 'amber'
    assert mindset.readiness('rested', 'emotional') == 'red'
    assert mindset.readiness('fumes', 'calm') == 'red'
    assert mindset.day_window(datetime(2026, 6, 3, 3, 59, tzinfo=timezone.utc)) == (
        '2026-06-02', '2026-06-03T04:00:00+00:00')
    assert mindset.day_window(datetime(2026, 11, 12, 4, 59, tzinfo=timezone.utc)) == (
        '2026-11-11', '2026-11-12T05:00:00+00:00')


def test_drills_are_comparable_and_reject_invalid_responses():
    sweep = mindset.make_rounds('sweep', Random(13))
    assert len(sweep) == 12
    valid = [mindset.DrillResponse(round=i) for i, row in enumerate(sweep) if mindset.sweep_target(row)]
    fake = next(i for i, row in enumerate(sweep) if not mindset.sweep_target(row))
    assert len(valid) == 6
    assert mindset.score_drill('sweep', sweep, valid) == 60
    assert mindset.score_drill('sweep', sweep, valid[:3] + [mindset.DrillResponse(round=fake)]) == 20
    with pytest.raises(ValueError, match='one response'):
        mindset.score_drill('sweep', sweep, [valid[0], valid[0]])
    memory = mindset.make_rounds('memory', Random(13))
    assert mindset.score_drill('memory', memory, [mindset.DrillResponse(round=i, cells=row['cells']) for i, row in enumerate(memory)]) == 60
    with pytest.raises(ValueError, match='different cells'):
        mindset.score_drill('memory', memory, [mindset.DrillResponse(round=0, cells=[1, 1, 2, 3])])


def test_private_prep_verified_team_scores_and_daily_reset(draft, monkeypatch):
    client, app, identity = draft
    clock = [datetime(2026, 11, 12, 4, 54, tzinfo=timezone.utc)]
    monkeypatch.setattr(mindset, 'now_utc', lambda: clock[0])
    monkeypatch.setenv('BULLPEN_SAJID_EMAIL', 'owner@example.com')
    monkeypatch.setenv('BULLPEN_AMIR_EMAIL', 'teammate@example.com')
    assert client.get('/api/mindset/warmup').status_code == 401
    login(client, identity)
    before = client.get('/api/trades').json()
    state = client.get('/api/mindset/warmup').json()
    assert state['team_eligible'] is True and state['day'] == '2026-11-11'
    day = state['day']
    payload = {'day': day, 'energy': 'rested', 'headspace': 'calm',
               'intention': 'Wait for confirmation.', 'checklist': ['levels', 'news', 'charity']}
    assert client.put('/api/mindset/warmup', json={**payload, 'completed': True}).status_code == 422
    saved = client.put('/api/mindset/warmup', json=payload).json()
    assert saved['readiness'] == 'green' and saved['checklist'] == payload['checklist']
    attempt = client.post('/api/mindset/drill', json={'day': day, 'mode': 'memory'}).json()
    answers = {'attempt_id': attempt['attempt_id'], 'responses': [{'round': 0, 'cells': attempt['rounds'][0]['cells']}]}
    assert client.post('/api/mindset/complete', json={'attempt_id': attempt['attempt_id']}).status_code == 409
    assert client.post('/api/mindset/score', json=answers).status_code == 409
    clock[0] += timedelta(seconds=60)
    assert client.post('/api/mindset/score', json={**answers, 'score': 999}).status_code == 422
    assert client.post('/api/mindset/score', json={**answers, 'responses': [{'round': '0', 'cells': []}]}).status_code == 422
    assert client.post('/api/mindset/score', json=answers).json() == {'score': 10, 'max_score': 60}
    assert client.post('/api/mindset/score', json={**answers, 'responses': []}).json()['score'] == 10
    assert client.post('/api/mindset/complete', json={'attempt_id': attempt['attempt_id']}).json()['completed'] is True
    assert client.get('/api/trades').json() == before
    client.post('/api/logout')
    login(client, identity, 'teammate@example.com', 'team-sub')
    assert client.get('/api/mindset/warmup').json()['intention'] == ''
    leader = client.get('/api/mindset/high-score').json()['leader']
    assert leader == {'name': 'Sajid', 'score': 10, 'max_score': 60}
    assert client.post('/api/mindset/score', json=answers).status_code == 409
    client.post('/api/logout')
    login(client, identity, 'outside@example.com', 'outside-sub')
    assert client.get('/api/mindset/high-score').status_code == 403
    assert client.get('/api/mindset/warmup').json()['team_eligible'] is False
    client.post('/api/logout')
    login(client, identity)
    clock[0] += timedelta(minutes=5)
    assert client.get('/api/mindset/high-score').json() == {'day': '2026-11-12', 'leader': None}
    assert client.get('/api/mindset/warmup').json()['completed'] is False
    assert client.put('/api/mindset/warmup', json=payload).status_code == 409
    assert client.post('/api/mindset/score', json=answers).status_code == 409
    owner_db = app.state.workspaces.database('owner')
    assert owner_db.get_setting(mindset.PREP + day)['completed'] is True
    # A settings record from an imported backup cannot declare a trusted score.
    owner_db.set_setting(mindset.ATTEMPT, {'day':'2026-11-12', 'id':attempt['attempt_id'], 'score':60})
    assert client.post('/api/mindset/score', json=answers).status_code == 409


def test_custom_checklist_carries_forward_and_skip_does_not_publish_a_score(draft, monkeypatch):
    client, _, identity = draft
    clock = [datetime(2026, 11, 12, 4, 59, tzinfo=timezone.utc)]
    monkeypatch.setattr(mindset, 'now_utc', lambda: clock[0])
    monkeypatch.setenv('BULLPEN_SAJID_EMAIL', 'owner@example.com')
    login(client, identity)
    day = '2026-11-11'
    items = [{'id': 'a'*32, 'label': 'Check overnight levels'}]
    payload = {'day':day, 'energy':'rested', 'headspace':'calm', 'intention':'', 'items':items, 'checklist':['a'*32]}
    assert client.put('/api/mindset/warmup', json={**payload, 'checklist':['b'*32]}).status_code == 422
    saved = client.put('/api/mindset/warmup', json=payload).json()
    assert saved['items'] == items and saved['checklist'] == ['a'*32]
    assert client.post('/api/mindset/complete', json={'day':day, 'attempt_id':None}).json()['completed'] is True
    assert client.get('/api/mindset/high-score').json()['leader'] is None
    clock[0] += timedelta(minutes=1)
    tomorrow = client.get('/api/mindset/warmup').json()
    assert tomorrow['items'] == items and tomorrow['checklist'] == []
    assert tomorrow['energy'] == '' and tomorrow['completed'] is False
    assert client.post('/api/mindset/complete', json={'day':day, 'attempt_id':None}).status_code == 409


def test_aura_has_no_persistent_check_in_routes(draft):
    client, _, identity = draft
    login(client, identity)
    assert client.get('/api/mindset/check-ins').status_code == 404
    assert client.put('/api/mindset/check-in', json={}).status_code in (404, 405)


def test_charity_replaces_only_the_old_default_template(draft):
    client, app, identity = draft
    login(client, identity)
    db = app.state.workspaces.database('owner')
    old = [*mindset.DEFAULT_ITEMS[:2], {'id':'loss_limit', 'label':'Daily loss limit set'}]
    db.set_setting(mindset.CHECKLIST, old)
    assert client.get('/api/mindset/warmup').json()['items'][-1] == {'id':'charity', 'label':'Give to charity'}
    custom = [*old[:2], {'id':'loss_limit', 'label':'My own risk rule'}]
    db.set_setting(mindset.CHECKLIST, custom)
    assert client.get('/api/mindset/warmup').json()['items'] == custom


@pytest.mark.parametrize('reply_format, empty_first', [
    ('legacy', False), ('chat', False), ('chat', True), ('empty', True),
])
def test_aura_ai_uses_configured_provider_without_raw_journal_data(draft, monkeypatch, reply_format, empty_first):
    import json
    from extensions import ai_coach

    from webapp import daily_journal

    client, app, identity = draft
    monkeypatch.setattr(mindset, 'now_utc', lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc))
    payload = {'step':'question', 'reflection':'How do I wait for confirmation?',
               'history':[{'question':'I feel tempted to chase.', 'answer':'Wait for your setup.'}]}
    assert client.post('/api/mindset/check-in/reflect', json=payload).status_code == 401
    login(client, identity)
    daily_journal.save(app.state.workspaces.database('owner'), '2026-11-11',
                       {'notes':'private journal notes', 'trades':[{'net_pnl':-50}]})
    monkeypatch.setenv('COACH_PROVIDER', 'cloudflare')
    monkeypatch.setenv('COACH_CLOUDFLARE_ACCOUNT_ID', 'a'*32)
    monkeypatch.setenv('COACH_CLOUDFLARE_API_TOKEN', 'synthetic-token')

    answer = {'focus':'patience', 'text':'What would help you wait for confirmation?'}
    text = json.dumps(answer)
    calls = 0

    class Response:
        ok = True

        def __init__(self, result):
            self.result = result

        def json(self):
            return {'success': True, 'result': self.result}

    def post(url, **kwargs):
        nonlocal calls
        calls += 1
        assert url.startswith('https://api.cloudflare.com/')
        assert kwargs['json']['max_tokens'] == 300 * calls
        system = kwargs['json']['messages'][0]['content']
        assert '"yesterday": "loss"' in system
        assert '"daily_loss_limit_hit": false' in system
        assert 'private journal notes' not in str(kwargs['json'])
        assert json.loads(kwargs['json']['messages'][-1]['content']) == {
            'step':payload['step'], 'reflection':payload['reflection'], 'recent_chat':payload['history'],
            'focus':'focus', 'reply':'', 'question':'',
        }
        if reply_format == 'empty' or (empty_first and calls == 1):
            return Response({'choices': [{'message': {'content': None, 'reasoning_content': 'internal'}}]})
        if reply_format == 'chat':
            return Response({'choices': [{'message': {'content': text}}]})
        return Response({'response': text})

    monkeypatch.setattr(ai_coach.requests, 'post', post)
    reply = client.post('/api/mindset/check-in/reflect', json=payload)
    assert calls == (2 if empty_first else 1)
    if reply_format == 'empty':
        assert reply.status_code == 502
        assert 'Your text is still here' in reply.json()['detail']
    else:
        assert reply.status_code == 200
        assert reply.json() == answer
    assert app.state.workspaces.database('owner').settings_with_prefix(mindset.PREP) == {}
    assert client.post('/api/mindset/check-in/reflect', json={**payload, 'history': payload['history'] * 5}).status_code == 422


def test_aura_opening_uses_private_results_and_checks_actual_limits(draft, monkeypatch):
    from tests.test_webapp import trade_payload
    from webapp import daily_journal

    client, app, identity = draft
    monkeypatch.setattr(mindset, 'now_utc', lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc))
    endpoint = '/api/mindset/check-in/opening'
    assert client.get(endpoint).status_code == 401
    login(client, identity)
    database = app.state.workspaces.database('owner')
    for day in ('2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11'):
        daily_journal.save(database, day, {'trades':[{'net_pnl':50}]})
    assert '4 green trading days' in client.get(endpoint).json()['text']
    daily_journal.save(database, '2026-11-11', {'trades':[{'net_pnl':-50}]})
    assert 'Yesterday was a red day' in client.get(endpoint).json()['text']
    payload = {**trade_payload(source='manual', pnl=-1000),
               'entry_time':'2026-11-11T23:45:00-05:00', 'exit_time':'2026-11-11T23:50:00-05:00'}
    assert client.post('/api/trades', json=payload).status_code == 200
    assert 'hit your daily loss limit yesterday' in client.get(endpoint).json()['text']
    client.post('/api/logout')
    login(client, identity, 'friend@example.com', 'friend-sub')
    assert 'Before you look at a chart' in client.get(endpoint).json()['text']


@pytest.mark.parametrize('difficulty, grid_size, pattern_size', [('easy', 4, 4), ('hard', 5, 5)])
def test_focus_game_rounds_and_scores(difficulty, grid_size, pattern_size):
    memory = mindset.make_rounds('memory', Random(5), difficulty=difficulty)
    assert len(memory) == 6
    assert all(row['grid_size'] == grid_size and len(row['cells']) == pattern_size for row in memory)
    answers = [mindset.DrillResponse(round=i, cells=row['cells']) for i, row in enumerate(memory)]
    assert mindset.score_drill('memory', memory, answers) == 60

    search = mindset.make_rounds('search', Random(8), difficulty=difficulty)
    assert len(search) == 6
    assert all(len(row['symbols']) == grid_size ** 2 and row['symbols'].count(row['target']) == 1 for row in search)
    matches = [mindset.DrillResponse(round=i, cells=[row['symbols'].index(row['target'])])
               for i, row in enumerate(search)]
    assert mindset.score_drill('search', search, matches) == 60
    wrong = (matches[0].cells[0] + 1) % (grid_size ** 2)
    assert mindset.score_drill('search', search, [mindset.DrillResponse(round=0, cells=[wrong])]) == 0
    with pytest.raises(ValueError, match='one tile'):
        mindset.score_drill('search', search, [mindset.DrillResponse(round=0, cells=[0, 1])])


def test_hard_search_attempt_scores_after_a_minute(draft, monkeypatch):
    client, _, identity = draft
    clock = [datetime(2026, 11, 12, 15, tzinfo=timezone.utc)]
    monkeypatch.setattr(mindset, 'now_utc', lambda: clock[0])
    login(client, identity)
    start = {'day': '2026-11-12', 'mode': 'search', 'difficulty': 'hard'}
    assert client.post('/api/mindset/drill', json={**start, 'difficulty': 'advanced'}).status_code == 422
    attempt = client.post('/api/mindset/drill', json=start).json()
    assert attempt['duration'] == 60
    assert all(row['grid_size'] == 5 for row in attempt['rounds'])
    first = attempt['rounds'][0]
    answer = {'attempt_id': attempt['attempt_id'],
              'responses': [{'round': 0, 'cells': [first['symbols'].index(first['target'])]}]}
    clock[0] += timedelta(seconds=59)
    assert client.post('/api/mindset/score', json=answer).status_code == 409
    clock[0] += timedelta(seconds=1)
    assert client.post('/api/mindset/score', json=answer).json() == {'score': 10, 'max_score': 60}


def test_journal_checklist_uses_the_saved_date_and_template(draft, monkeypatch):
    client, _, identity = draft
    now = [datetime(2026, 11, 12, 15, tzinfo=timezone.utc)]
    monkeypatch.setattr(mindset, 'now_utc', lambda: now[0])
    path = '/api/mindset/checklist/2026-11-12'
    assert client.get(path).status_code == 401
    login(client, identity)
    assert client.get(path).json()['items'] == []
    payload = {'day':'2026-11-12', 'energy':'', 'headspace':'', 'checklist':['levels'],
               'items':[{'id':'levels', 'label':'Mark my levels'}]}
    assert client.put('/api/mindset/warmup', json=payload).status_code == 200
    now[0] += timedelta(days=1)
    assert client.put('/api/mindset/warmup', json={**payload, 'day':'2026-11-13', 'checklist':[],
                       'items':[{'id':'levels', 'label':'Review my levels'}]}).status_code == 200
    assert client.get(path).json() == {'day':'2026-11-12',
                                      'items':[{'id':'levels', 'label':'Mark my levels', 'checked':True}]}
    client.post('/api/logout')
    login(client, identity, 'friend@example.com', 'friend-sub')
    assert client.get(path).json()['items'] == []
