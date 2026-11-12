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


def test_aura_approval_and_history_are_private(draft, monkeypatch):
    client, _, identity = draft
    monkeypatch.setattr(mindset, 'now_utc', lambda: datetime(2026, 11, 12, 15, tzinfo=timezone.utc))
    assert client.get('/api/mindset/check-ins').status_code == 401
    login(client, identity)
    payload = {'day':'2026-11-12', 'focus':'patience', 'intention':'Wait for the close.'}
    assert client.put('/api/mindset/check-in', json={**payload, 'transcript':'private draft'}).status_code == 422
    assert client.put('/api/mindset/check-in', json=payload).json()['intention'] == payload['intention']
    assert client.put('/api/mindset/warmup', json={'day':payload['day'], 'energy':'', 'headspace':'', 'checklist':['levels']}).json()['intention'] == payload['intention']
    assert client.get('/api/mindset/check-ins').json() == [payload]
    client.post('/api/logout')
    login(client, identity, 'friend@example.com', 'friend-sub')
    assert client.get('/api/mindset/check-ins').json() == []


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


def test_aura_ai_uses_configured_provider_without_journal_context(draft, monkeypatch):
    import json
    from extensions import ai_coach

    client, _, identity = draft
    payload = {'step':'follow_up', 'reflection':'I feel tempted to chase.'}
    assert client.post('/api/mindset/check-in/reflect', json=payload).status_code == 401
    login(client, identity)
    monkeypatch.setenv('COACH_PROVIDER', 'cloudflare')
    monkeypatch.setenv('COACH_CLOUDFLARE_ACCOUNT_ID', 'a'*32)
    monkeypatch.setenv('COACH_CLOUDFLARE_API_TOKEN', 'synthetic-token')

    class Response:
        ok = True
        def json(self):
            return {'result':{'response':json.dumps({'focus':'patience', 'text':'What would help you wait for confirmation?'})}}

    def post(url, **kwargs):
        assert url.startswith('https://api.cloudflare.com/')
        assert json.loads(kwargs['json']['messages'][-1]['content']) == {
            **payload, 'focus':'focus', 'reply':'', 'question':'',
        }
        return Response()

    monkeypatch.setattr(ai_coach.requests, 'post', post)
    reply = client.post('/api/mindset/check-in/reflect', json=payload)
    assert reply.status_code == 200
    assert reply.json() == {'focus':'patience', 'text':'What would help you wait for confirmation?'}
    assert client.get('/api/mindset/check-ins').json() == []
