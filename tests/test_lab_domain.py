"""Section routing, trusted-host transition and fixed OAuth return paths."""
from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from webapp.app import create_app
from webapp.config import Settings


def config(tmp_path, **values):
    assets = tmp_path / 'frontend'
    assets.mkdir(exist_ok=True)
    (assets / 'assets').mkdir(exist_ok=True)
    (assets / 'index.html').write_text('<html><meta name="primus-lab-path" content=""><div id="root"></div></html>')
    (assets / 'assets' / 'test.js').write_text('window.testLoaded = true;')
    return Settings(str(tmp_path / 'test.db'), 'owner@example.com', 'synthetic-local-secret-for-domain-tests',
                    'http://127.0.0.1:8100', local=True, assets=assets, lab_path='/lab', **values)


def test_lab_routes_assets_private_apis_and_legacy_links(tmp_path):
    settings = config(tmp_path)
    with TestClient(create_app(settings), base_url=settings.public_url, client=('127.0.0.1', 1)) as client:
        assert client.get('/', follow_redirects=False).headers['location'] == '/lab'
        for path in ('/lab', '/lab/import', '/lab/tools', '/lab/trades'):
            response = client.get(path)
            assert response.status_code == 200 and 'name="primus-lab-path" content="/lab"' in response.text
            assert response.headers['cache-control'] == 'no-store'
        assert client.get('/lab/', follow_redirects=False).headers['location'] == '/lab'
        assert client.get('/import', follow_redirects=False).headers['location'] == '/lab/import'
        assert client.get('/journal', follow_redirects=False).headers['location'] == '/lab#trades'
        assert client.get('/lab/api/trades').status_code == 404
        assert client.get('/assets/test.js').status_code == 200
        assert client.get('/api/session').json()['authenticated']
        assert client.get('/api/trades').json() == []
        assert client.get('/api/export/backup').status_code == 200
        assert 'href="/lab"' in client.get('/privacy').text
        assert client.get('/calendar').status_code == 404  # Reserved for future sections.


def test_old_domain_redirect_drops_oauth_codes_and_never_forwards_writes(tmp_path):
    settings = config(tmp_path, legacy_host='primuslab-web.onrender.com', custom_host='primustrader.co.uk')
    with TestClient(create_app(settings), base_url=settings.public_url, client=('127.0.0.1', 1)) as client:
        redirect = client.get('http://primuslab-web.onrender.com/auth/callback?code=private-code&next=https://attacker.test', follow_redirects=False)
        assert redirect.headers['location'] == settings.public_url + '/lab'
        assert 'private-code' not in str(redirect.headers)
        assert redirect.headers['referrer-policy'] == 'no-referrer'
        assert client.post('http://primuslab-web.onrender.com/api/trades', json={'private': 'body'}).status_code == 409
        assert client.get('http://primustrader.co.uk/health').status_code == 200
        assert client.get('http://attacker.test/health').status_code == 400


def test_invalid_routing_settings_are_rejected(tmp_path):
    settings = config(tmp_path)
    for values in ({'lab_path': '//attacker.test'}, {'lab_path': '/lab/../../'},
                   {'custom_host': '*.co.uk'}, {'custom_host': 'https://primustrader.co.uk'},
                   {'legacy_host': 'attacker.test'}):
        with pytest.raises(ValueError):
            replace(settings, **values).validate()


def test_google_callback_returns_to_lab_for_success_and_errors(tmp_path):
    from webapp.google_access import LoginError, AccountBlocked
    settings = config(tmp_path, auth_mode='google', supabase_url='https://abcdefghijklmnopqrst.supabase.co', supabase_key='synthetic-key')
    app = create_app(settings)
    with TestClient(app, base_url=settings.public_url, client=('127.0.0.1', 1)) as client:
        access = app.state.workspaces.google
        session = client.get('/api/session').json()
        client.headers.update({'Origin': settings.public_url, 'X-Primus-CSRF': session['csrf']})
        started = client.post('/api/login/google').json()
        assert parse_qs(urlsplit(started['url']).query)['redirect_to'] == [settings.public_url + '/auth/callback']
        access.exchange = lambda attempt, code: ('owner@example.com', 'verified-test-subject')
        assert client.get('/auth/callback?code=test-code', follow_redirects=False).headers['location'] == '/lab'
        assert client.get('/api/session').json()['authenticated']
        def reject(attempt, code):
            raise LoginError()
        access.exchange = reject
        assert client.get('/auth/callback?code=test-code', follow_redirects=False).headers['location'] == '/lab?login=retry'
        def blocked(attempt, code):
            raise AccountBlocked()
        access.exchange = blocked
        assert client.get('/auth/callback?code=test-code', follow_redirects=False).headers['location'] == '/lab?login=blocked'
