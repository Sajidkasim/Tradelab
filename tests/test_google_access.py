"""No real credentials or journals: exercise Google PKCE and account isolation."""
import base64
from dataclasses import replace
from datetime import timedelta
import hashlib
import json
from urllib.parse import parse_qs, urlsplit

import httpx
from fastapi.testclient import TestClient
import pytest
import sqlalchemy as sa

from webapp.app import create_app
from webapp.config import Settings
from webapp.google_access import LoginError, google_identity, identities, sessions
from webapp.personal_access import now_utc
from tests.test_webapp import trade_payload, upload, labelled_fx


def provider_user(email='owner@example.com', subject='owner-sub'):
    return {'id': 'supabase-test-user', 'email': email, 'email_confirmed_at': '2026-01-01T00:00:00Z',
            'identities': [{'provider': 'google', 'identity_data': {'sub': subject, 'email': email, 'email_verified': True}}]}


@pytest.fixture
def google(tmp_path):
    config = Settings(str(tmp_path / 'google.db'), 'owner@example.com', 'synthetic-session-secret-for-isolated-tests',
                      'http://127.0.0.1:8100', local=True, auth_mode='google',
                      supabase_url='https://abcdefghijklmnopqrst.supabase.co', supabase_key='synthetic-publishable-key')
    app = create_app(config)
    with TestClient(app, base_url=config.public_url, client=('127.0.0.1', 12345)) as client:
        access = app.state.workspaces.google
        access.client.close()
        state = {'user': provider_user(), 'verifiers': [], 'fail': False}
        def provider(request):
            assert request.headers['apikey'] == config.supabase_key
            if state['fail']:
                return httpx.Response(400, json={'error': 'provider-sensitive-detail'})
            if request.method == 'POST':
                body = json.loads(request.content)
                assert body['auth_code'] == 'single-use-test-code'
                state['verifiers'].append(body['code_verifier'])
                return httpx.Response(200, json={'access_token': 'synthetic-server-only-token'})
            assert request.headers['authorization'] == 'Bearer synthetic-server-only-token'
            return httpx.Response(200, json=state['user'])
        access.client = httpx.Client(transport=httpx.MockTransport(provider))
        yield client, app, state


def csrf(client):
    state = client.get('/api/session').json()
    client.headers.update({'Origin': 'http://127.0.0.1:8100', 'X-Primus-CSRF': state['csrf']})
    return state


def login(client, state, email='owner@example.com', subject='owner-sub'):
    state['user'] = provider_user(email, subject)
    csrf(client)
    started = client.post('/api/login/google')
    assert started.status_code == 200, started.text
    returned = client.get('/auth/callback?code=single-use-test-code', follow_redirects=False)
    assert returned.status_code == 303 and returned.headers['location'] == '/', returned.text
    return csrf(client)


def test_google_config_never_falls_back_to_password(google):
    client, app, _ = google
    for changes in ({'supabase_url': 'http://untrusted.test'}, {'supabase_key': ''}, {'owner_email': ''},
                    {'auth_mode': 'typo'}, {'secret': 'short'}):
        with pytest.raises(ValueError):
            replace(app.state.config, **changes).validate()
    assert not app.state.config.password_required
    notice = client.get('/privacy')
    assert notice.status_code == 200 and 'text/html' in notice.headers['content-type']
    assert 'Other members cannot view' in notice.text and 'end-to-end' in notice.text
    assert csrf(client)['auth_mode'] == 'google'
    assert client.post('/api/unlock', json={'password': 'even-the-old-password'}).status_code == 404
    for route in ('/api/trades', '/api/metadata', '/api/export/backup', '/api/export/csv'):
        assert client.get(route).status_code == 401


def test_pkce_is_browser_bound_single_use_and_does_not_expose_tokens(google):
    client, app, state = google
    csrf(client)
    assert client.post('/api/login/google', headers={'Origin': 'https://attacker.test'}).status_code == 403
    before = client.post('/api/login/google').json()
    query = parse_qs(urlsplit(before['url']).query)
    assert query['provider'] == ['google'] and query['code_challenge_method'] == ['s256']
    assert query['redirect_to'] == ['http://127.0.0.1:8100/auth/callback']
    browser_cookie = client.cookies.get('primus_session')
    payload = json.loads(base64.b64decode(browser_cookie.split('.')[0]))
    assert 'google_attempt' in payload and 'verifier' not in str(payload)
    client.cookies.clear()
    rejected = client.get('/auth/callback?code=single-use-test-code', follow_redirects=False)
    assert rejected.headers['location'] == '/?login=retry' and not state['verifiers']
    client.cookies.set('primus_session', browser_cookie)
    result = client.get('/auth/callback?code=single-use-test-code', follow_redirects=False)
    assert result.headers['location'] == '/' and result.headers['referrer-policy'] == 'no-referrer'
    verifier = state['verifiers'][0]
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    assert query['code_challenge'] == [expected]
    assert 'synthetic-server-only-token' not in result.headers['set-cookie']
    client.cookies.clear()
    client.cookies.set('primus_session', browser_cookie)
    assert client.get('/auth/callback?code=single-use-test-code', follow_redirects=False).headers['location'] == '/?login=retry'
    assert len(state['verifiers']) == 1


def test_provider_errors_and_unverified_editable_claims_fail_closed(google):
    client, app, state = google
    csrf(client)
    client.post('/api/login/google')
    state['fail'] = True
    result = client.get('/auth/callback?code=single-use-test-code', follow_redirects=False)
    assert result.headers['location'] == '/?login=retry'
    assert 'provider-sensitive-detail' not in result.text
    assert client.get('/api/trades').status_code == 401
    for user in ({'email': 'owner@example.com', 'user_metadata': {'email_verified': True, 'sub': 'owner-sub'}},
                 {**provider_user(), 'identities': [{'provider': 'email', 'identity_data': provider_user()['identities'][0]['identity_data']}]},
                 {**provider_user(), 'email': 'imposter@example.com'},
                 {**provider_user(), 'identities': [{'provider': 'google', 'identity_data': {'sub': 'owner-sub', 'email': 'owner@example.com', 'email_verified': False}}]}):
        with pytest.raises(LoginError):
            google_identity(user)
    access = app.state.workspaces.google
    attempt, _ = access.start()
    access.attempts[attempt] = ('expired-verifier', 0)
    with pytest.raises(LoginError):
        access.exchange(attempt, 'single-use-test-code')


def test_owner_binding_cannot_be_reassigned_by_email_or_configuration(google):
    client, app, state = google
    assert login(client, state)['owner'] is True
    key = app.state.workspaces.google.join(*google_identity(provider_user('OWNER@example.com')))
    assert key == 'owner'
    with pytest.raises(LoginError):
        app.state.workspaces.google.join(*google_identity(provider_user('owner@example.com', 'another-google-sub')))
    from webapp.google_access import GoogleAccess
    with pytest.raises(ValueError, match='original owner'):
        GoogleAccess(app.state.workspaces.root, replace(app.state.config, owner_email='new@example.com'))


def test_private_trades_settings_imports_deletes_results_and_backups(google):
    client, app, state = google
    # These original trades exist before anyone signs in, exactly like cutover.
    from core.models import Trade, Source
    from datetime import datetime, timezone
    original = Trade(account_id=1, symbol='NQ', direction='long', qty=1, entry_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
                     exit_time=datetime(2026, 1, 1, tzinfo=timezone.utc), entry_price=100, exit_price=101, source=Source.MANUAL)
    app.state.workspaces.root.insert_trades([original])
    login(client, state)
    owner_rows = client.get('/api/trades').json()
    assert len(owner_rows) == 1
    assert client.post('/api/trades', json=trade_payload(strategy='Owner only')).status_code == 200
    owner_meta = client.get('/api/metadata').json()
    updated = {**owner_meta['lab_settings'], 'confirmations': ['Owner private confirmation']}
    assert client.put('/api/lab-settings', json=updated).status_code == 200
    owner_backup = client.get('/api/export/backup').content
    deletion = client.post('/api/trades/deletion-preview').json()
    preview = upload(client, labelled_fx()).json()
    owner_cookie = client.cookies.get('primus_session')
    client.cookies.clear()
    assert login(client, state, 'friend@example.com', 'friend-sub')['owner'] is False
    assert client.get('/api/trades').json() == []
    assert 'Owner private confirmation' not in client.get('/api/metadata').text
    assert client.patch('/api/trades/2', json={'strategy': 'Steal', 'labels': {}, 'notes': '', 'confirmed': False}).status_code == 404
    assert client.delete('/api/trades/2').status_code == 404
    assert client.request('DELETE', '/api/trades', json={'confirmation_count': deletion['count'], 'preview_token': deletion['preview_token']}).status_code == 409
    assert upload(client, labelled_fx(), 'confirm', preview['preview_token']).status_code == 409
    assert client.post('/api/trades', json=trade_payload(strategy='Friend only', pnl=-50)).status_code == 200
    assert len(client.get('/api/trades').json()) == 1
    assert 'Owner only' not in client.get('/api/export/backup').text
    assert 'primus_google' not in client.get('/api/export/backup').text
    result = client.post('/api/results', json={'scope': 'All', 'combined': True, 'window': 'All sessions'}).json()
    assert result['stats']['trades'] == 1
    friend_preview = upload(client, labelled_fx()).json()
    assert upload(client, labelled_fx(), 'confirm', friend_preview['preview_token']).json()['inserted'] == 1
    assert upload(client, labelled_fx()).json()['counts']['duplicates'] == 1
    friend_cookie = client.cookies.get('primus_session')
    client.cookies.clear()
    client.cookies.set('primus_session', owner_cookie)
    csrf(client)
    assert client.get('/api/export/backup').content == owner_backup
    assert upload(client, labelled_fx()).json()['counts']['new'] == 1
    assert client.delete('/api/trades/1').status_code == 200
    client.cookies.clear()
    client.cookies.set('primus_session', friend_cookie)
    csrf(client)
    assert len(client.get('/api/trades').json()) == 2  # Same numeric ID remained private.
    # A third journal can restore only a backup explicitly uploaded into it.
    client.cookies.clear()
    login(client, state, 'third@example.com', 'third-sub')
    assert client.post('/api/restore', files={'file': ('backup.json', owner_backup)}).status_code == 200
    assert len(client.get('/api/trades').json()) == 2
    client.cookies.clear()
    client.cookies.set('primus_session', friend_cookie)
    csrf(client)
    assert 'Owner only' not in client.get('/api/export/backup').text


def test_revocation_expiry_and_browser_workspace_tampering(google):
    client, app, state = google
    login(client, state, 'friend@example.com', 'friend-sub')
    saved = client.cookies.get('primus_session')
    assert client.post('/api/logout').status_code == 200
    client.cookies.clear()
    client.cookies.set('primus_session', saved)
    assert client.get('/api/trades').status_code == 401
    login(client, state)
    access = app.state.workspaces.google
    with access.database.engine.begin() as connection:
        connection.execute(sessions.update().values(expires_at=now_utc() - timedelta(seconds=1)))
    assert client.get('/api/trades').status_code == 401
    # Even a validly signed legacy cookie cannot select another workspace.
    from itsdangerous import TimestampSigner
    forged = base64.b64encode(json.dumps({'key': 'owner', 'personal_token': 'x' * 48, 'csrf': 'x'}).encode())
    client.cookies.clear()
    client.cookies.set('primus_session', TimestampSigner(app.state.config.secret).sign(forged).decode())
    assert client.get('/api/trades').status_code == 401
    with pytest.raises(PermissionError):
        app.state.workspaces.database('a' * 32)


def test_only_owner_can_list_and_block_accounts_and_old_sessions_never_revive(google):
    client, app, state = google
    assert client.get('/api/access').status_code == 401
    login(client, state)
    owner_cookie = client.cookies.get('primus_session')
    assert client.patch('/api/access/owner', json={'allowed': False}).status_code == 403
    client.cookies.clear()
    login(client, state, 'friend@example.com', 'friend-sub')
    assert client.get('/api/access').status_code == 403
    assert client.post('/api/trades', json=trade_payload(strategy='Never visible to owner')).status_code == 200
    friend_cookie = client.cookies.get('primus_session')
    # A second browser session for the same Google account.
    client.cookies.clear()
    login(client, state, 'friend@example.com', 'friend-sub')
    second_cookie = client.cookies.get('primus_session')
    client.cookies.clear()
    client.cookies.set('primus_session', owner_cookie)
    csrf(client)
    roster = client.get('/api/access').json()
    friend = next(person for person in roster if person['email'] == 'friend@example.com')
    assert friend['signed_in_sessions'] == 2 and friend['last_sign_in'].endswith('Z')
    assert friend['joined_at'] and friend['allowed'] and not friend['owner']
    assert set(friend) == {'id', 'email', 'owner', 'allowed', 'joined_at', 'last_sign_in', 'signed_in_sessions',
        'last_seen', 'user_agent', 'client_ip', 'device', 'system', 'browser', 'recently_active', 'sessions'}
    assert 'Never visible' not in str(roster) and 'subject' not in str(roster) and 'token' not in str(roster)
    key = friend['id']
    assert client.patch(f'/api/access/{key}', json={'allowed': 'false'}).status_code == 422
    assert client.patch(f'/api/access/{key}', headers={'Origin': 'https://attacker.test'}, json={'allowed': False}).status_code == 403
    assert client.patch(f'/api/access/{key}', json={'allowed': False, 'owner': True}).status_code == 422
    assert client.patch(f'/api/access/{key}', json={'allowed': False}).status_code == 200
    assert next(person for person in client.get('/api/access').json() if person['id'] == key)['signed_in_sessions'] == 0
    for cookie in (friend_cookie, second_cookie):
        client.cookies.clear()
        client.cookies.set('primus_session', cookie)
        assert client.get('/api/trades').status_code == 401
        assert client.get('/api/metadata').status_code == 401
        assert client.get('/api/export/backup').status_code == 401
        assert client.get('/api/access').status_code == 401
    csrf(client)
    state['user'] = provider_user('friend@example.com', 'friend-sub')
    client.post('/api/login/google')
    assert client.get('/auth/callback?code=single-use-test-code', follow_redirects=False).headers['location'] == '/?login=blocked'
    with pytest.raises(LoginError):
        app.state.workspaces.google.issue(key)
    client.cookies.clear()
    client.cookies.set('primus_session', owner_cookie)
    csrf(client)
    assert client.patch(f'/api/access/{key}', json={'allowed': True}).status_code == 200
    client.cookies.clear()
    client.cookies.set('primus_session', friend_cookie)
    assert client.get('/api/trades').status_code == 401
    login(client, state, 'friend@example.com', 'friend-sub')
    assert client.get('/api/trades').json()[0]['setup_name'] == 'Never visible to owner'
    assert client.patch('/api/access/owner', json={'allowed': False}).status_code == 403
    assert client.patch(f'/api/access/{key}', json={'allowed': True}).status_code == 403


def test_signed_out_session_count_and_owner_alias_email_refresh(google):
    client, app, state = google
    login(client, state)
    owner_cookie = client.cookies.get('primus_session')
    client.cookies.clear()
    login(client, state, 'friend@example.com', 'friend-sub')
    client.post('/api/logout')
    client.cookies.clear()
    client.cookies.set('primus_session', owner_cookie)
    csrf(client)
    friend = next(person for person in client.get('/api/access').json() if not person['owner'])
    assert friend['signed_in_sessions'] == 0 and friend['allowed']
    assert client.patch('/api/access/missing-account', json={'allowed': False}).status_code == 422
    # Stable Google identity, changed verified address: same private journal.
    client.cookies.clear()
    login(client, state, 'newfriend@example.com', 'friend-sub')
    client.cookies.clear()
    client.cookies.set('primus_session', owner_cookie)
    csrf(client)
    updated = next(person for person in client.get('/api/access').json() if not person['owner'])
    assert updated['id'] == friend['id'] and updated['email'] == 'newfriend@example.com'


def test_account_details_migrate_existing_auth_tables_without_reassigning_owner(google, tmp_path):
    from core.db import Database
    from webapp.google_access import GoogleAccess
    _, app, _ = google
    root = Database(str(tmp_path / 'old-auth.db'))
    root.init()
    old = sa.Table(identities.name, sa.MetaData(), sa.Column('key', sa.String(32), primary_key=True),
        sa.Column('subject', sa.String(64), unique=True), sa.Column('owner_email', sa.String(254)),
        sa.Column('active', sa.Boolean, nullable=False))
    old.create(root.engine)
    old_sessions = sa.Table(sessions.name, sa.MetaData(), sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('key', sa.String(32)), sa.Column('version', sa.String(64)), sa.Column('expires_at', sa.DateTime))
    old_sessions.create(root.engine)
    old_token = 'synthetic-old-browser-session-' + 'x' * 32
    with root.engine.begin() as connection:
        connection.execute(old.insert().values(key='owner', subject='old-bound-subject', owner_email='owner@example.com', active=True))
        connection.execute(old_sessions.insert().values(token_hash=hashlib.sha256(old_token.encode()).hexdigest(), key='owner',
            version=app.state.workspaces.google.version, expires_at=now_utc() + timedelta(days=1)))
    access = GoogleAccess(root, app.state.config)
    try:
        assert {'email', 'joined_at', 'last_sign_in'} <= {column['name'] for column in sa.inspect(root.engine).get_columns(identities.name)}
        assert access.people()[0]['email'] == 'owner@example.com'
        assert {'created_at', 'last_seen', 'user_agent', 'client_ip'} <= {column['name'] for column in sa.inspect(root.engine).get_columns(sessions.name)}
        assert access.member(old_token, user_agent='Firefox/142', client_ip='127.0.0.1')['key'] == 'owner'
        assert access.people()[0]['browser'] == 'Firefox'
        assert access.join('owner@example.com', 'old-bound-subject') == 'owner'
        with pytest.raises(LoginError):
            access.join('owner@example.com', 'different-subject')
    finally:
        access.close()
        root.engine.dispose()



def test_activity_updates_device_metadata_without_trusting_forwarded_addresses(google, monkeypatch):
    client, app, state = google
    client.headers['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1'
    client.headers['X-Forwarded-For'] = '8.8.8.8'
    assert client.post('/api/activity').status_code == 401
    login(client, state)
    roster = client.get('/api/access')
    assert roster.headers['cache-control'] == 'no-store'
    person = roster.json()[0]
    assert (person['device'], person['system'], person['browser']) == ('Phone', 'iOS', 'Safari')
    assert person['client_ip'] == '127.0.0.1'  # Never accepts a spoofed forwarding header.
    assert person['recently_active'] and len(person['sessions']) == 1
    assert set(person['sessions'][0]) == {'last_seen', 'user_agent', 'client_ip', 'device', 'system', 'browser', 'started_at', 'expires_at'}
    first = person['last_seen']
    future = now_utc() + timedelta(minutes=3)
    monkeypatch.setattr('webapp.google_access.now_utc', lambda: future)
    assert app.state.workspaces.google.people()[0]['recently_active'] is False
    client.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0) Chrome/142.0.0.0 Safari/537.36'
    assert client.post('/api/activity', headers={'Origin': 'https://attacker.test'}).status_code == 403
    assert client.post('/api/activity').status_code == 200
    refreshed = client.get('/api/access').json()[0]
    assert refreshed['last_seen'] != first
    assert refreshed['recently_active'] and refreshed['system'] == 'Windows' and refreshed['browser'] == 'Chrome'
    assert client.get('/privacy').status_code == 200
    assert b'Wi-Fi names' in client.get('/privacy').content
    assert client.post('/api/logout').status_code == 200
    assert app.state.workspaces.google.people()[0]['sessions'] == []


def test_connection_details_are_bounded_and_browser_hints_are_not_claimed_as_exact_models():
    from webapp.google_access import connection_details, device_details
    assert len(connection_details('x' * 2000, 'not-an-ip')['user_agent']) == 512
    assert connection_details(None, 'not-an-ip')['client_ip'] is None
    assert device_details(None) == {'device': 'Unknown', 'system': 'Unknown', 'browser': 'Unknown'}
    assert device_details('Android Chrome/142 Mobile')['device'] == 'Phone'
    assert device_details('Android Chrome/142')['device'] == 'Tablet'


def test_new_journal_welcome_is_blank_private_persistent_and_does_not_reset_owner(google):
    client, app, state = google
    login(client, state)
    owner = client.get('/api/metadata').json()
    assert owner['journal_preferences']['welcome_pending'] is False
    client.put('/api/playbook', json={'strategies': ['Owner only'], 'levels': ['Owner private level']})
    owner_before = client.get('/api/metadata').json()
    client.post('/api/logout')
    login(client, state, 'new@example.com', 'new-user')
    fresh = client.get('/api/metadata').json()
    assert fresh['journal_preferences']['welcome_pending'] is True
    assert fresh['strategies'] == [] and fresh['playbook']['levels'] == []
    assert fresh['confirmations'] == [] and fresh['tag_mappings'] == {}
    assert fresh['tag_suggestions'] == [] and client.get('/api/trades').json() == []
    invalid = client.put('/api/welcome', json={'timezone': 'Europe/London', 'levels': ['x' * 121]})
    assert invalid.status_code == 422
    assert client.get('/api/metadata').json()['playbook']['levels'] == []
    setup = {'timezone': 'Europe/London', 'strategies': ['My breakout'], 'levels': ['My level'], 'confirmations': ['My confirmation']}
    assert client.put('/api/welcome', json=setup).status_code == 200
    configured = client.get('/api/metadata').json()
    assert configured['journal_preferences']['timezone'] == 'Europe/London'
    assert configured['journal_preferences']['welcome_pending'] is False
    assert configured['strategies'] == ['My breakout']
    assert configured['playbook']['levels'] == ['My level']
    assert configured['confirmations'] == ['My confirmation']
    assert client.put('/api/welcome', json=setup).status_code == 409
    client.post('/api/logout')
    login(client, state, 'new@example.com', 'new-user')
    assert client.get('/api/metadata').json()['journal_preferences'] == configured['journal_preferences']
    client.post('/api/logout')
    login(client, state)
    assert client.get('/api/metadata').json() == owner_before


def test_optional_tour_progress_is_private_and_keeps_clock_and_trades(google):
    client, _, state = google
    login(client, state)
    owner_before = client.get('/api/metadata').json()
    assert owner_before['journal_preferences']['tour_status'] == 'pending'
    client.post('/api/logout')
    login(client, state, 'tour@example.com', 'tour-user')
    preferences = client.get('/api/metadata').json()['journal_preferences']
    assert preferences['welcome_pending'] and preferences['tour_status'] == 'pending'
    assert client.put('/api/welcome', json={'timezone':'Europe/London'}).status_code == 200
    assert client.post('/api/trades', json=trade_payload()).status_code == 200
    trades_before = client.get('/api/trades').json()
    assert client.put('/api/tour', json={'status':'invalid'}).status_code == 422
    assert client.put('/api/tour', json={'status':'skipped'}).json() == {'status':'skipped'}
    assert client.get('/api/metadata').json()['journal_preferences']['timezone'] == 'Europe/London'
    assert client.put('/api/tour', json={'status':'completed'}).json() == {'status':'completed'}
    # Skipping a later replay does not erase a completed tour.
    assert client.put('/api/tour', json={'status':'skipped'}).json() == {'status':'completed'}
    assert client.get('/api/trades').json() == trades_before
    client.post('/api/logout')
    login(client, state, 'tour@example.com', 'tour-user')
    assert client.get('/api/metadata').json()['journal_preferences']['tour_status'] == 'completed'
    client.post('/api/logout')
    login(client, state)
    assert client.get('/api/metadata').json() == owner_before
    client.post('/api/logout')
    assert client.put('/api/tour', json={'status':'completed'}).status_code == 401


def test_existing_labs_receive_current_guide_once_without_resetting_settings(google):
    from webapp import journal_preferences
    client, app, state = google
    database = app.state.workspaces.root
    legacy = {'timezone':'Europe/London', 'welcome_pending':False, 'personal_setup':False, 'tour_status':'completed'}
    database.set_setting(journal_preferences.KEY, legacy)
    login(client, state)
    preferences = client.get('/api/metadata').json()['journal_preferences']
    assert preferences['tour_status'] == 'pending'
    assert preferences['timezone'] == 'Europe/London'
    assert preferences['welcome_pending'] is False
    # Reading the rollout state does not rewrite existing settings.
    assert database.get_setting(journal_preferences.KEY) == legacy
    assert client.post('/api/trades', json=trade_payload()).status_code == 200
    trades = client.get('/api/trades').json()
    assert client.put('/api/tour', json={'status':'skipped'}).status_code == 200
    client.post('/api/logout')
    login(client, state)
    preferences = client.get('/api/metadata').json()['journal_preferences']
    assert preferences['tour_status'] == 'skipped'
    assert preferences['tour_version'] == journal_preferences.TOUR_VERSION
    assert preferences['timezone'] == 'Europe/London'
    assert client.get('/api/trades').json() == trades
