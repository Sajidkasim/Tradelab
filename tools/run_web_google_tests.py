"""Disposable browser test server. Fake provider transport exists only here."""
from contextlib import asynccontextmanager
import json
from pathlib import Path
from secrets import token_urlsafe
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
import uvicorn
from webapp.app import create_app
from webapp.config import Settings


def provider(request):
    if request.method == 'POST':
        who = json.loads(request.content)['auth_code']
        assert who in ('owner', 'friend', 'newcomer', 'tour-user')
        return httpx.Response(200, json={'access_token': who})
    who = request.headers['authorization'].removeprefix('Bearer ')
    return httpx.Response(200, json={'email': f'{who}@example.com', 'email_confirmed_at': '2026-01-01T00:00:00Z',
        'identities': [{'provider': 'google', 'identity_data': {'sub': who, 'email': f'{who}@example.com', 'email_verified': True}}]})


port = int(sys.argv[1]) if len(sys.argv)>1 else 8114
website = '--site' in sys.argv

with TemporaryDirectory(prefix='primus-google-tests-') as folder:
    config = Settings(str(Path(folder) / 'test.db'), 'owner@example.com', token_urlsafe(48), f'http://127.0.0.1:{port}',
                      local=True, auth_mode='google', supabase_url='https://abcdefghijklmnopqrst.supabase.co',
                      supabase_key='synthetic-browser-test-key', lab_path='/lab', site_enabled=website)
    app = create_app(config)
    original = app.router.lifespan_context
    @asynccontextmanager
    async def testing(application):
        async with original(application):
            access = application.state.workspaces.google
            access.client.close()
            access.client = httpx.Client(transport=httpx.MockTransport(provider))
            yield
    app.router.lifespan_context = testing
    uvicorn.run(app, host='127.0.0.1', port=port, proxy_headers=False, access_log=False)
