from dataclasses import replace
from io import BytesIO
import json

import httpx
from fastapi.testclient import TestClient
from PIL import Image
import pytest

from webapp.app import create_app
from webapp.config import Settings
from tests.test_google_access import csrf, provider_user


@pytest.fixture
def draft(tmp_path):
    config = Settings(str(tmp_path/'journal.db'), 'owner@example.com', 'synthetic-private-journal-session-secret',
        'http://127.0.0.1:8100', local=True, auth_mode='google', supabase_url='https://abcdefghijklmnopqrst.supabase.co',
        supabase_key='synthetic-key', lab_path='/lab', site_preview=True)
    app = create_app(config)
    with TestClient(app, base_url=config.public_url, client=('127.0.0.1',12345)) as client:
        state = {'user':provider_user()}
        access = app.state.workspaces.google
        access.client.close()
        access.client = httpx.Client(transport=httpx.MockTransport(lambda request:
            httpx.Response(200,json={'access_token':'synthetic'} if request.method=='POST' else state['user'])))
        yield client, app, state


def login(client, state, email='owner@example.com', subject='owner-sub'):
    state['user'] = provider_user(email, subject)
    csrf(client)
    assert client.post('/api/login/google').status_code == 200
    response = client.get('/auth/callback?code=synthetic', follow_redirects=False)
    assert response.status_code == 303 and response.headers['location'] == '/lab'
    csrf(client)


def picture():
    data = BytesIO()
    Image.new('RGB',(100,80),'green').save(data,format='PNG')
    return data.getvalue()


def test_journal_is_private_and_separate_from_lab_with_safe_images(draft):
    client, app, state = draft
    assert client.get('/').status_code == 200
    assert client.get('/journal').status_code == 200
    assert 'primus-site-preview' in client.get('/journal').text
    assert client.get('/api/journal').status_code == 401
    login(client,state)
    before = client.get('/api/trades').json()
    day = '2026-10-30'
    assert client.put(f'/api/journal/{day}',json={'plan':'A private plan','mindset':'Focused'}).status_code == 200
    assert client.put(f'/api/journal/{day}',json={'images':[{'id':'forged'}]}).status_code == 422
    assert client.put('/api/journal/not-a-date',json={}).status_code == 422
    uploaded = client.post(f'/api/journal/{day}/images',files={'file':('chart.png',picture(),'image/png')})
    assert uploaded.status_code == 200
    image_id = uploaded.json()['images'][0]['id']
    url = f'/api/journal/{day}/images/{image_id}'
    response = client.get(url)
    assert response.status_code == 200 and response.headers['content-type'] == 'image/webp'
    assert 'no-store' in response.headers['cache-control']
    with Image.open(BytesIO(response.content)) as image:
        assert image.size == (100,80) and not image.getexif()
    assert client.put(f'/api/journal/{day}',json={'notes':'The next observation'}).json()['images'][0]['id'] == image_id
    assert client.post(f'/api/journal/{day}/images',files={'file':('fake.svg',b'<svg/>','image/png')}).status_code == 422
    exported = client.get('/api/journal/export')
    assert exported.status_code == 200 and exported.json()['entries'][0]['notes'] == 'The next observation'
    assert any(row['key']=='primus_daily_entry:2026-10-30' for row in client.get('/api/export/backup').json()['settings'])
    assert client.get('/api/trades').json() == before
    client.post('/api/logout')
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/journal').json() == []
    assert client.get(url).status_code == 404
    assert client.delete(url).status_code == 404
    client.post('/api/logout')
    login(client,state)
    assert client.delete(url).status_code == 200
    assert client.get(url).status_code == 404
    assert client.get('/api/journal').json()[0]['notes'] == 'The next observation'
    client.headers['X-Primus-CSRF']='wrong'
    assert client.put(f'/api/journal/{day}',json={}).status_code == 403


def test_preview_image_limits_and_production_guard(draft):
    client, app, state = draft
    login(client,state)
    day = '2026-10-29'
    for _ in range(6):
        assert client.post(f'/api/journal/{day}/images',files={'file':('chart.png',picture(),'image/png')}).status_code == 200
    assert client.post(f'/api/journal/{day}/images',files={'file':('extra.png',picture(),'image/png')}).status_code == 422
    assert client.post('/api/journal/2026-10-28/images',files={'file':('large.png',b'x'*(8*1024*1024+1),'image/png')}).status_code == 413
    normal = create_app(replace(app.state.config,site_preview=False))
    with TestClient(normal,base_url=app.state.config.public_url,client=('127.0.0.1',12345)) as other:
        other.app.dependency_overrides[other.app.state.workspace_dependency]=lambda:{'key':'owner'}
        assert other.get('/api/journal').status_code == 404
        assert other.get('/',follow_redirects=False).headers['location']=='/lab'
    with pytest.raises(ValueError,match='local'):
        replace(app.state.config,local=False).validate()


def test_live_website_routes_and_private_notes_without_temporary_image_uploads(draft):
    _, preview, state = draft
    config = replace(preview.state.config, site_preview=False, site_enabled=True)
    with TestClient(create_app(config),base_url=config.public_url,client=('127.0.0.1',12345)) as client:
        access = client.app.state.workspaces.google
        access.client.close()
        access.client=httpx.Client(transport=httpx.MockTransport(lambda request:
            httpx.Response(200,json={'access_token':'synthetic'} if request.method=='POST' else state['user'])))
        for path in ['/', '/journal', '/lab']:
            response=client.get(path,follow_redirects=False)
            assert response.status_code == 200
            assert 'primus-site-enabled' in response.text and 'primus-site-preview' not in response.text
        assert client.get('/api/journal').status_code == 401
        login(client,state)
        day='2026-10-30'
        assert client.put(f'/api/journal/{day}',json={'plan':'Private live notes'}).status_code == 200
        assert client.get('/api/journal').json()[0]['plan']=='Private live notes'
        assert client.post(f'/api/journal/{day}/images',files={'file':('chart.png',picture(),'image/png')}).status_code==404
        client.post('/api/logout')
        login(client,state,'another@example.com','another-user')
        assert client.get('/api/journal').json()==[]
