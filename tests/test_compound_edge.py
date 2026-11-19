from datetime import date, datetime, timedelta, timezone

from tests.test_daily_journal import draft, login
from webapp import compound_edge


def test_replay_counts_engaged_time_only_and_caps(draft):
    _, app, _ = draft
    db = app.state.workspaces.root
    now = datetime(2026, 11, 10, 15, tzinfo=timezone.utc)
    compound_edge.replay_interaction(db, 'a', now)
    compound_edge.replay_interaction(db, 'a', now)
    compound_edge.replay_interaction(db, 'a', now + timedelta(minutes=10))
    compound_edge.replay_interaction(db, 'b', now + timedelta(minutes=11))
    assert not compound_edge.summary(db, now)['tasks']['replay']
    for minute in range(12, 52):
        compound_edge.replay_interaction(db, 'b', now + timedelta(minutes=minute))
    state = compound_edge.day_state(db, date(2026, 11, 10))
    assert state['replay_seconds'] == 1200
    assert compound_edge.summary(db, now)['pillars'] == [0, 0, 15]


def test_streak_skips_rest_and_market_closure(draft):
    _, app, _ = draft
    db = app.state.workspaces.root
    now = datetime(2026, 11, 25, 15, tzinfo=timezone.utc)
    compound_edge.record(db, now, checklist=True, journal=True, followed=True)
    # Thursday is Thanksgiving. Friday is the first miss. Saturday and Sunday are rest days.
    monday = now + timedelta(days=5)
    assert compound_edge.summary(db, monday)['current_streak'] == 1
    assert compound_edge.summary(db, monday + timedelta(days=1))['current_streak'] == 0
    assert compound_edge.summary(db, monday + timedelta(days=1))['longest_streak'] == 1


def test_saved_journal_counts_only_today_and_is_private(draft):
    client, app, state = draft
    login(client, state)
    day = compound_edge.today(app.state.workspaces.database('owner'))
    response = client.put(f'/api/journal/{day}', json={
        'plan': 'Wait for a retest.', 'traded_today': 'No', 'no_trade_plan': True,
    })
    assert response.status_code == 200, response.text
    assert client.get('/api/compound-edge').json()['pillars'] == [0, 40, 0]
    response = client.put(f'/api/journal/{day - timedelta(days=1)}', json={'plan': 'Old plan'})
    assert response.status_code == 200
    assert client.get('/api/compound-edge').json()['pillars'] == [0, 40, 0]
    client.cookies.clear()
    assert client.get('/api/compound-edge').status_code == 401
    login(client, state, 'friend@example.com', 'friend-sub')
    assert client.get('/api/compound-edge').json()['score'] == 0


def test_lab_reviews_require_five_distinct_trades_in_one_session(draft):
    _, app, _ = draft
    db = app.state.workspaces.root
    now = datetime(2026, 11, 10, 15, tzinfo=timezone.utc)
    for trade_id in [1, 2, 2, 3, 4]:
        compound_edge.lab_review(db, trade_id, False, True, now)
    assert not compound_edge.summary(db, now)['tasks']['lab']
    later = now + timedelta(minutes=31)
    compound_edge.lab_review(db, 5, False, True, later)
    assert not compound_edge.summary(db, later)['tasks']['lab']
    for trade_id in [1, 2, 3, 4]:
        compound_edge.lab_review(db, trade_id, False, True, later)
    assert compound_edge.summary(db, later)['pillars'] == [0, 0, 15]


def test_daily_habits_persist_reset_and_appear_in_private_aura(draft, monkeypatch):
    client, _, state = draft
    login(client, state)
    day = date(2026, 11, 10)
    monkeypatch.setattr(compound_edge, 'today', lambda *args: day)
    habit = {'id': 'a' * 32, 'label': 'Review tomorrow’s plan'}
    body = {'day': day.isoformat(), 'items': [habit], 'checklist': [habit['id']]}
    response = client.put('/api/mindset/habits', json=body)
    assert response.status_code == 200, response.text
    assert client.get('/api/mindset/habits').json() == body
    assert client.get('/api/compound-edge').json()['habits'] == {'completed': 1, 'total': 1}

    day += timedelta(days=1)
    assert client.put('/api/mindset/habits', json=body).status_code == 409
    assert client.get('/api/mindset/habits').json() == {**body, 'day': day.isoformat(), 'checklist': []}
    assert client.get('/api/compound-edge').json()['habits'] == {'completed': 0, 'total': 1}

    client.cookies.clear()
    login(client, state, 'friend@example.com', 'friend-sub')
    assert client.get('/api/mindset/habits').json()['items'] == []
