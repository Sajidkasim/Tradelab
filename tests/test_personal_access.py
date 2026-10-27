"""Personal password access protects the existing owner journal unchanged."""
import base64
from dataclasses import replace
from datetime import timedelta
import json

import pytest
pytest.importorskip('fastapi')
pytest.importorskip('argon2')
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
import sqlalchemy as sa

from core.db import Database
from core import risk
from webapp.app import create_app
from webapp.config import Settings
from webapp.personal_access import hash_password, PasswordGate, Throttled, PersonalSessions, auth_version, sessions, now_utc
from webapp.workspaces import Workspaces

PASSWORD = 'Synthetic password for tests only'


@pytest.fixture(scope='module')
def encoded():
    return hash_password(PASSWORD)


@pytest.fixture
def personal(tmp_path, monkeypatch, encoded):
    config = Settings('postgresql://invalid.example/test', '', 'synthetic-session-secret-of-at-least-32-characters',
                      'https://primus.example', password_hash=encoded)
    monkeypatch.setattr('webapp.app.Workspaces', lambda cfg: Workspaces(replace(cfg, database=str(tmp_path / 'personal.db'))))
    app = create_app(config)
    with TestClient(app, base_url=config.public_url) as client:
        client.headers.update({'Origin': config.public_url})
        client.headers['X-Primus-CSRF'] = client.get('/api/session').json()['csrf']
        yield client, app, config


def unlock(client, password=PASSWORD):
    result = client.post('/api/unlock', json={'password': password})
    if result.status_code == 200:
        client.headers['X-Primus-CSRF'] = result.json()['csrf']
    return result


def test_password_check_throttles_and_recovers_without_changing_the_password(encoded):
    clock = [0.0]
    gate = PasswordGate(encoded, lambda: clock[0])
    for _ in range(5):
        assert gate.check('wrong password') is False
    with pytest.raises(Throttled) as exc:
        gate.check(PASSWORD)
    assert exc.value.retry_after == 60
    clock[0] = 61.0
    assert gate.check(PASSWORD) is True
    assert gate.attempts == [] or not gate.attempts


@pytest.mark.parametrize('password', ['short', 'x' * 129])
def test_password_setup_rejects_short_or_excessively_long_passwords(password):
    with pytest.raises(ValueError, match='16 and 128'):
        hash_password(password)


def test_anonymous_users_cannot_read_trade_or_backup_data(personal):
    client, _, _ = personal
    identity = client.get('/api/session').json()
    assert identity['authenticated'] is False and identity['csrf']
    for path in ('/api/trades', '/api/metadata', '/api/export/backup', '/api/export/csv'):
        assert client.get(path).status_code == 401
    assert client.get('/auth/google').status_code == 404
    assert client.get('/auth/callback').status_code == 404
    assert client.get('/api/team').status_code == 404
    assert client.get('/team').status_code == 404


def test_password_unlock_and_real_logout_revoke_the_old_cookie(personal):
    client, app, config = personal
    assert unlock(client, 'incorrect').status_code == 401
    assert unlock(client).status_code == 200
    assert client.get('/api/session').json()['authenticated'] is True
    assert client.get('/api/trades').status_code == 200
    old_cookie = client.cookies.get('primus_session')
    with app.state.workspaces.root.engine.connect() as connection:
        rows = connection.execute(sa.select(sessions)).mappings().all()
    assert len(rows) == 1 and len(rows[0]['token_hash']) == 64
    backup = client.get('/api/export/backup').text
    assert PASSWORD not in backup and config.password_hash not in backup
    assert 'primus_personal_sessions' not in backup
    assert client.post('/api/logout').status_code == 200
    client.cookies.set('primus_session', old_cookie)
    assert client.get('/api/trades').status_code == 401


def test_unlock_origin_csrf_input_redaction_and_rate_limit(personal):
    client, _, _ = personal
    assert client.post('/api/unlock', json={'password': PASSWORD}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/unlock', json={'password': PASSWORD}, headers={'X-Primus-CSRF': 'bad'}).status_code == 403
    large = 'synthetic-do-not-echo-' * 100
    response = client.post('/api/unlock', json={'password': large})
    assert response.status_code == 422 and large not in response.text
    response = client.post('/api/unlock', content=b'x' * 9000, headers={'Content-Type': 'application/json'})
    assert response.status_code == 413
    for _ in range(5):
        response = unlock(client, 'incorrect')
        assert response.status_code == 401 and 'incorrect' not in response.text
    response = unlock(client)
    assert response.status_code == 429 and int(response.headers['Retry-After']) > 0


def test_old_google_and_unregistered_session_cookies_cannot_open_the_journal(personal):
    client, _, config = personal
    for data in ({'key': 'owner', 'subject': 'old-google-subject'}, {'key': 'teammate', 'personal_token': 'x' * 64}):
        cookie = TimestampSigner(config.secret).sign(base64.b64encode(json.dumps(data).encode())).decode()
        client.cookies.set('primus_session', cookie)
        assert client.get('/api/trades').status_code == 401
    client.cookies.set('primus_session', 'forged')
    assert client.get('/api/export/backup').status_code == 401
    assert client.get('/health', headers={'Host': 'evil.example'}).status_code == 400


def test_sessions_expire_and_password_rotation_invalidates_them(tmp_path, encoded):
    db = Database(tmp_path / 'sessions.db'); db.init()
    registry = PersonalSessions(db, auth_version(encoded, 'test-secret'))
    token = registry.issue()
    assert registry.valid(token)
    rotated = PersonalSessions(db, auth_version(encoded, 'rotated-secret'))
    assert not rotated.valid(token)
    with db.engine.begin() as connection:
        connection.execute(sessions.update().values(expires_at=now_utc() - timedelta(seconds=1)))
    assert not registry.valid(token)


def test_owner_storage_is_kept_and_teammate_storage_cannot_be_selected(personal):
    client, app, _ = personal
    # Existing root data remains in the same tables; no team selector exists.
    database = app.state.workspaces.root
    database.set_setting('owner-note', 'existing personal data')
    assert unlock(client).status_code == 200
    assert json.loads(client.get('/api/export/backup').text)['settings'][0]['key'] == 'owner-note'
    with pytest.raises(PermissionError, match='personal'):
        app.state.workspaces.database('a' * 32)


def test_position_size_calls_existing_core_and_stays_private(personal):
    client, app, _ = personal
    payload = {'symbol': 'NQ', 'account_id': 1, 'entry': 18000, 'stop': 17995, 'risk_dollars': 250}
    assert client.post('/api/tools/position-size', json=payload).status_code == 401
    unlock(client)
    response = client.post('/api/tools/position-size', json=payload)
    assert response.status_code == 200, response.text
    db = app.state.workspaces.root
    instrument, account = db.instruments()['NQ'], db.accounts()[0]
    expected = risk.position_size(18000, 17995, instrument.multiplier, instrument.tick_size,
                                  account.starting_balance, risk_dollars=250, max_contracts=account.max_contracts,
                                  commission_per_contract=instrument.commission_per_contract)
    assert response.json() == expected
    assert client.post('/api/tools/position-size', json={**payload, 'account_id': 999}).status_code == 422
    assert client.post('/api/tools/position-size', json={**payload, 'stop': 18000}).status_code == 422


def test_user_password_helper_saves_only_a_private_hash_and_never_prints_it(tmp_path, monkeypatch, capsys):
    from tools import set_personal_password as setup
    from dotenv import dotenv_values
    monkeypatch.setattr(setup, 'ROOT', tmp_path)
    monkeypatch.setattr(setup.getpass, 'getpass', lambda prompt: PASSWORD)
    setup.main()
    path = tmp_path / 'data/private/personal-login.env'
    config = dotenv_values(path)
    assert config['PRIMUSLAB_PASSWORD_HASH'].startswith('$argon2id$')
    assert PasswordGate(config['PRIMUSLAB_PASSWORD_HASH']).check(PASSWORD)
    assert len(config['PRIMUSLAB_SESSION_SECRET']) >= 32
    assert path.stat().st_mode & 0o777 == 0o600
    assert PASSWORD not in path.read_text()
    output = capsys.readouterr().out
    assert PASSWORD not in output and config['PRIMUSLAB_PASSWORD_HASH'] not in output


def test_user_password_helper_preserves_existing_configuration_on_cancel(tmp_path, monkeypatch):
    from tools import set_personal_password as setup
    path = tmp_path / 'data/private/personal-login.env'
    path.parent.mkdir(parents=True)
    path.write_text('previous configuration')
    monkeypatch.setattr(setup, 'ROOT', tmp_path)
    monkeypatch.setattr(setup.getpass, 'getpass', lambda prompt: PASSWORD)
    monkeypatch.setattr('builtins.input', lambda prompt: 'cancel')
    setup.main()
    assert path.read_text() == 'previous configuration'


@pytest.mark.parametrize('first_pair, message', [
    (('too short', 'too short'), 'between 16 and 128'),
    ((PASSWORD, 'different confirmation'), 'do not match'),
])
def test_password_helper_allows_correction_without_closing(tmp_path, monkeypatch, capsys, first_pair, message):
    from tools import set_personal_password as setup
    from dotenv import dotenv_values
    answers = iter((*first_pair, PASSWORD, PASSWORD))
    monkeypatch.setattr(setup, 'ROOT', tmp_path)
    monkeypatch.setattr(setup.getpass, 'getpass', lambda prompt: next(answers))
    setup.main()
    values = dotenv_values(tmp_path / 'data/private/personal-login.env')
    assert PasswordGate(values['PRIMUSLAB_PASSWORD_HASH']).check(PASSWORD)
    output = capsys.readouterr().out
    assert message in output and 'PASSWORD SAVED.' in output
    assert PASSWORD not in output and 'too short' not in output


def test_delete_is_private_when_journal_is_locked(personal):
    client, app, _ = personal
    assert client.delete('/api/trades/1').status_code == 401


def test_release_writes_stay_private(personal):
    client, app, _ = personal
    assert client.post('/api/trades/deletion-preview').status_code==401
    assert client.request('DELETE','/api/trades',json={'confirmation_count':1,'preview_token':'x'}).status_code==401
    from webapp.lab_settings import DEFAULTS
    assert client.put('/api/lab-settings',json=DEFAULTS).status_code==401
