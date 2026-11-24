from dataclasses import replace
from io import BytesIO
import json
import smtplib
from zipfile import ZipFile

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


def test_master_journal_reset_requires_code_and_preserves_shared_data(draft, monkeypatch):
    from webapp import journal_replay, routes_journal

    client, app, state = draft
    monkeypatch.delenv('JOURNAL_RESEND_API_KEY', raising=False)
    monkeypatch.setenv('JOURNAL_GMAIL_ADDRESS', 'sender@example.com')
    monkeypatch.setenv('JOURNAL_GMAIL_APP_PASSWORD', 'test-password')
    monkeypatch.setattr(routes_journal, 'randbelow', lambda _: 12345)
    sent = []
    monkeypatch.setattr(routes_journal, 'send_journal_reset_code', lambda *args: sent.append(args[3:]))
    preview_url = '/api/journal/reset/preview'
    send_url = '/api/journal/reset/send-code'
    confirm_url = '/api/journal/reset/confirm'
    code = {'code': '012345', 'confirmation': 'DELETE JOURNAL'}
    assert client.get(preview_url).status_code == 401
    login(client, state, 'friend@example.com', 'friend-sub')
    past = '2020-01-01'
    assert client.put(f'/api/journal/{past}', json={'notes': 'Friend note'}).status_code == 200
    client.post('/api/logout')
    login(client, state)
    today = '2099-01-01'
    for day in (past, today):
        assert client.put(f'/api/journal/{day}', json={'notes': 'Owner note'}).status_code == 200
    image = client.post(f'/api/journal/{past}/images', files={'file': ('chart.png', picture(), 'image/png')})
    assert image.status_code == 200
    image_id = image.json()['images'][0]['id']
    assert client.delete(f'/api/journal/{past}').status_code == 200
    lab_account = client.get('/api/journal-accounts').json()[0]['id']
    database = app.state.workspaces.database('owner')
    database.log_breach(lab_account, past, 'Test rule', 2, 1)
    assert client.post('/api/journal-accounts', json={
        'name': 'Account to remove', 'starting_balance': 5000, 'account_type': 'Personal',
    }).status_code == 201
    database.set_setting(journal_replay.KEY, {'test-import': {'id': 'test-import'}})
    lab_before = client.get('/api/trades').json()
    preview = client.get(preview_url).json()
    assert (preview['entries'], preview['trash'], preview['accounts'], preview['shared_accounts'], preview['imports']) == (1, 1, 1, 1, 1)

    backup = client.get('/api/journal/reset/backup')
    assert backup.status_code == 200
    with ZipFile(BytesIO(backup.content)) as archive:
        exported = json.loads(archive.read('journal.json'))
        assert len(exported['accounts']) == 2
        assert archive.read(f'screenshots/{past}/{image_id}.webp').startswith(b'RIFF')
    assert client.post(confirm_url, json=code).status_code == 403
    with monkeypatch.context() as patch:
        def reject(*args):
            raise smtplib.SMTPAuthenticationError(535, b'private provider response')
        patch.setattr(routes_journal, 'send_journal_reset_code', reject)
        failed = client.post(send_url)
        assert failed.status_code == 503
        assert 'rejected' in failed.json()['detail']
        assert 'private provider response' not in failed.text
    assert client.post(confirm_url, json=code).status_code == 403
    assert client.post(send_url).status_code == 200
    assert sent == [('owner@example.com', '012345')]
    assert client.post(confirm_url, json={**code, 'confirmation': 'wrong'}).status_code == 422
    assert client.post(confirm_url, json={**code, 'code': '000000'}).status_code == 422
    assert client.put(f'/api/journal/{today}', json={'notes': 'Updated after code'}).status_code == 200
    assert client.post(confirm_url, json=code).status_code == 409
    assert client.post(send_url).status_code == 200
    assert client.post(confirm_url, json=code).json() == {'reset': True}
    assert client.post(confirm_url, json=code).status_code == 403
    for url in ('/api/journal', '/api/journal/trash', '/api/journal-replay'):
        assert client.get(url).json() == []
    assert [account['id'] for account in client.get('/api/journal-accounts').json()] == [lab_account]
    assert not app.state.image_storage.local_path('owner', past, image_id).exists()
    assert client.get('/api/trades').json() == lab_before
    client.post('/api/logout')
    login(client, state, 'friend@example.com', 'friend-sub')
    assert client.get(f'/api/journal/{past}').json()['notes'] == 'Friend note'


def test_journal_mail_retries_a_failed_smtp_connection_with_starttls(monkeypatch):
    from unittest.mock import MagicMock
    from webapp import routes_journal

    def unavailable(*args, **kwargs):
        raise ConnectionRefusedError()

    smtp = MagicMock()
    monkeypatch.setattr(smtplib, 'SMTP_SSL', unavailable)
    monkeypatch.setattr(smtplib, 'SMTP', smtp)
    routes_journal.send_journal_reset_code('gmail', 'sender@example.com', 'test-secret', 'owner@example.com', '012345')
    assert smtp.call_args.args == ('smtp.gmail.com', 587)
    connection = smtp.return_value
    assert [call[0] for call in connection.method_calls] == ['starttls', 'login', 'send_message', 'close']
    assert connection.send_message.call_args.args[0]['To'] == 'owner@example.com'


def test_master_reset_seeds_default_account_when_all_accounts_are_removed(draft, monkeypatch):
    from webapp import routes_journal

    client, _, state = draft
    login(client, state)
    monkeypatch.setattr(routes_journal, 'journal_mail_credentials', lambda: ('gmail', 'sender@example.com', 'test'))
    monkeypatch.setattr(routes_journal, 'randbelow', lambda _: 12345)
    monkeypatch.setattr(routes_journal, 'send_journal_reset_code', lambda *args: None)
    accounts = client.get('/api/journal-accounts').json()
    assert client.put(f"/api/journal-accounts/{accounts[0]['id']}", json={
        'name': 'Old account', 'starting_balance': 5000, 'account_type': 'Personal',
    }).status_code == 200
    assert client.post('/api/journal/reset/send-code').status_code == 200
    assert client.post('/api/journal/reset/confirm', json={
        'code': '012345', 'confirmation': 'DELETE JOURNAL',
    }).status_code == 200
    assert [account['name'] for account in client.get('/api/journal-accounts').json()] == ['My account']


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


def test_google_returns_to_selected_private_page_and_rejects_external_redirect(draft):
    client, app, state = draft
    csrf(client)
    assert client.post('/api/login/google?return_to=https://example.com').status_code == 422
    assert client.post('/api/login/google?return_to=//example.com').status_code == 422
    assert client.post('/api/login/google?return_to=/journal').status_code == 200
    response=client.get('/auth/callback?code=synthetic',follow_redirects=False)
    assert response.status_code == 303 and response.headers['location']=='/journal'
    csrf(client)
    assert client.get('/api/journal').status_code==200
    assert client.get('/api/trades').status_code==200


def journal_card(record_id='a'*32):
    return {'id':record_id,'symbol':'NQ','direction':'long','strategy':'Reversal at key level','time':'09:45','source':'manual','notes':'Waited for the reaction.'}


def test_daily_trade_cards_images_and_lab_transfer_are_private_and_idempotent(draft):
    from tests.test_webapp import trade_payload
    client,app,state=draft
    login(client,state)
    day='2026-07-01';record=journal_card()
    before=client.get('/api/trades').json()
    saved=client.put(f'/api/journal/{day}',json={'notes':'Session observations','trades':[record]}).json()
    assert saved['trades'][0]['strategy']==record['strategy']
    assert client.get('/api/trades').json()==before  # Narrative alone is not a financial trade.
    assert client.put(f'/api/journal/{day}',json={'trades':[record,record]}).status_code==422
    assert client.put(f'/api/journal/{day}',json={'trades':[{**record,'lab_trade_id':999}]}).status_code==422
    assert client.post(f'/api/journal/{day}/images?trade_id={"b"*32}',files={'file':('chart.png',picture(),'image/png')}).status_code==422
    image=client.post(f'/api/journal/{day}/images?trade_id={record["id"]}',files={'file':('chart.png',picture(),'image/png')}).json()['images'][0]
    assert image['trade_id']==record['id']
    # The financial values still pass through the normal tested trade builder.
    payload={**trade_payload(source='manual'), 'journal_day':day,'journal_trade_id':record['id']}
    response=client.post('/api/trades',json=payload)
    assert response.status_code==200,response.text
    assert response.json()['inserted']==1
    linked=response.json()['journal_entry']['trades'][0]['lab_trade_id']
    assert linked is not None
    again=client.post('/api/trades',json=payload)
    assert again.status_code==200 and again.json()['inserted']==0
    assert len(client.get('/api/trades').json())==len(before)+1
    trade=next(t for t in client.get('/api/trades').json() if t['id']==linked)
    assert trade['net_pnl']==100 and trade['initial_risk']==50 and trade['r_multiple']==2
    # Notes and links survive old clients and later narrative saves.
    assert client.put(f'/api/journal/{day}',json={'plan':'Changed plan'}).json()['trades'][0]['lab_trade_id']==linked
    assert client.put(f'/api/journal/{day}',json={'trades':[record]}).json()['trades'][0]['lab_trade_id']==linked
    client.post('/api/logout');login(client,state,'stranger@example.com','stranger')
    assert client.get('/api/journal').json()==[]
    assert client.put(f'/api/journal/{day}/trades/{record["id"]}/link',json={'trade_id':linked}).status_code==422
    assert client.post('/api/trades',json=payload).status_code==422
    client.post('/api/logout');login(client,state)
    removed=client.put(f'/api/journal/{day}',json={'trades':[]}).json()
    assert removed['images'][0]['trade_id'] is None  # Chart retained as a session screenshot.
    assert client.get(f'/api/journal/{day}/images/{image["id"]}').status_code==200
    assert next(t for t in client.get('/api/trades').json() if t['id']==linked)['net_pnl']==100


def test_existing_lab_link_never_creates_or_deletes_a_trade(draft):
    from tests.test_webapp import trade_payload
    client,app,state=draft;login(client,state)
    assert client.post('/api/trades',json=trade_payload()).json()['inserted']==1
    trade=client.get('/api/trades').json()[0];day='2026-07-01';record=journal_card()
    client.put(f'/api/journal/{day}',json={'trades':[record]})
    url=f'/api/journal/{day}/trades/{record["id"]}/link'
    assert client.put(url,json={'trade_id':999999}).status_code==422
    assert client.put(url,json={'trade_id':trade['id']}).json()['trades'][0]['lab_trade_id']==trade['id']
    assert client.put(url,json={'trade_id':None}).json()['trades'][0]['lab_trade_id'] is None
    assert client.get('/api/trades').json()==[trade]
    client.headers['X-Primus-CSRF']='wrong'
    assert client.put(url,json={'trade_id':trade['id']}).status_code==403


def test_journal_outcome_and_confirmations_persist_without_generating_lab_results(draft):
    client,app,state=draft;login(client,state)
    day='2026-10-20';record=journal_card()
    selected={**record,'outcome':'win','confirmations':['SMT','CISD','Macro']}
    saved=client.put(f'/api/journal/{day}',json={'trades':[selected]}).json()
    assert saved['trades'][0]['outcome']=='win'
    assert saved['trades'][0]['confirmations']==['SMT','CISD','Macro']
    # An earlier client saving only its known fields cannot erase these choices.
    saved=client.put(f'/api/journal/{day}',json={'trades':[record]}).json()
    assert saved['trades'][0]['outcome']=='win' and saved['trades'][0]['confirmations']==['SMT','CISD','Macro']
    assert client.get('/api/trades').json()==[]
    assert client.put(f'/api/journal/{day}',json={'trades':[{**record,'outcome':'3R'}]}).status_code==422
    assert client.put(f'/api/journal/{day}',json={'trades':[{**record,'confirmations':['x'*121]}]}).status_code==422


def test_journal_setup_money_clear_legacy_clients_and_linked_results_are_safe(draft):
    from tests.test_webapp import trade_payload
    client,app,state=draft;login(client,state)
    day='2026-11-01';record=journal_card()
    selected={**record,'level':'FVG','timeframe':'4H','entry_timeframe':'1m','risk_amount':50,'net_pnl':-25,'outcome':'win'}
    saved=client.put(f'/api/journal/{day}',json={'trades':[selected]}).json()['trades'][0]
    assert saved['outcome']=='loss' and saved['risk_amount']==50 and saved['net_pnl']==-25
    assert saved['level']=='FVG' and saved['timeframe']=='4H' and saved['entry_timeframe']=='1m'
    assert client.get('/api/trades').json()==[]
    assert client.put(f'/api/journal/{day}',json={'trades':[record]}).json()['trades'][0]['risk_amount']==50
    cleared=client.put(f'/api/journal/{day}',json={'trades':[{**record,'risk_amount':None,'net_pnl':None}]}).json()['trades'][0]
    assert cleared['risk_amount'] is None and cleared['net_pnl'] is None
    for value in [0,-1]:
        assert client.put(f'/api/journal/{day}',json={'trades':[{**record,'risk_amount':value}]}).status_code==422
    response=client.post('/api/trades',json={**trade_payload(), 'journal_day':day,'journal_trade_id':record['id']})
    assert response.status_code==200,response.text
    linked=response.json()['journal_entry']['trades'][0]
    assert linked['net_pnl']==100 and linked['risk_amount']==50 and linked['timeframe']=='4H'
    before=client.get('/api/trades').json()
    attempted=client.put(f'/api/journal/{day}',json={'trades':[{**record,'risk_amount':999,'net_pnl':999,'level':'Other','notes':'My personal note'}]}).json()['trades'][0]
    assert attempted['net_pnl']==100 and attempted['risk_amount']==50 and attempted['level']=='FVG'
    assert attempted['notes']=='My personal note' and attempted['lab_trade_id']==linked['lab_trade_id']
    assert client.get('/api/trades').json()==before
    client.post('/api/logout');login(client,state,'other@example.com','other-member')
    assert client.get('/api/journal').json()==[]


def test_existing_members_get_automatic_private_tags_without_migration(draft):
    from tests.test_webapp import labelled_fx, upload
    client,app,state=draft
    for email,subject,strategy in [('owner@example.com','owner-sub','Owner breakout'),('friend@example.com','friend-sub','Friend reversal')]:
        login(client,state,email,subject)
        client.put('/api/playbook',json={'strategies':[strategy],'levels':['Private key level']})
        client.post('/api/logout')
    for email,subject,strategy,other in [('owner@example.com','owner-sub','Owner breakout','Friend reversal'),('friend@example.com','friend-sub','Friend reversal','Owner breakout')]:
        login(client,state,email,subject)
        meta=client.get('/api/metadata').json()
        assert meta['tag_mappings']=={}
        assert f'Strategy: {strategy}' in meta['automatic_tags']
        assert f'Strategy: {other}' not in meta['automatic_tags']
        result=upload(client,labelled_fx(tags=strategy.upper()),account_id=str(meta['accounts'][0]['id'])).json()
        assert result['unresolved_tags']==[] and result['rows'][0]['setup_name']==strategy
        assert client.get('/api/trades').json()==[]
        client.post('/api/logout')

@pytest.mark.parametrize('amounts,expected,status', [([150,-50],100,'win'),([50,-150],-100,'loss'),([50,-50],0,'breakeven'),([0],0,'breakeven'),([10,None],None,'not_recorded'),([],None,'not_recorded')])
def test_calendar_day_total_uses_recorded_pnl_and_grades_stay_private(draft,amounts,expected,status):
    from uuid import uuid4
    client,app,state=draft
    login(client,state)
    cards=[{'id':uuid4().hex,'net_pnl':amount,'setup_grade':['A+','A','B'][i%3]} for i,amount in enumerate(amounts)]
    result=client.put('/api/journal/2026-11-03',json={'trades':cards})
    assert result.status_code==200,result.text
    value=result.json()
    assert value['day_result']['net_pnl']==expected
    assert value['day_result']['outcome']==status
    assert [card['setup_grade'] for card in value['trades']]==[card['setup_grade'] for card in cards]
    listed=client.get('/api/journal').json()[0]
    assert listed['day_result']==value['day_result']
    assert client.get('/api/trades').json()==[]
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/journal').json()==[]


def test_invalid_journal_grade_is_rejected(draft):
    from uuid import uuid4
    client,app,state=draft
    login(client,state)
    assert client.put('/api/journal/2026-11-03',json={'trades':[{'id':uuid4().hex,'setup_grade':'C'}]}).status_code==422


def test_traded_today_is_optional_and_preserved_on_partial_updates(draft):
    client, _, state = draft
    login(client, state)
    url = "/api/journal/2026-11-06"
    assert client.put(url, json={}).json()["traded_today"] is None
    for answer in ("Yes", "No"):
        assert client.put(url, json={"traded_today": answer}).json()["traded_today"] == answer
        assert client.put(url, json={"notes": "Saved separately"}).json()["traded_today"] == answer
    assert client.put(url, json={"traded_today": None}).json()["traded_today"] is None
    assert client.put(url, json={"traded_today": "Maybe"}).status_code == 422


def test_shared_journal_card_counts_combined_result_once(draft):
    client, _, state = draft
    login(client, state)
    day = '2026-08-19'
    accounts = []
    for name in ('Copy One', 'Copy Two', 'Copy Three'):
        response = client.post('/api/journal-accounts', json={'name': name, 'starting_balance': 50000, 'account_type': 'Eval'})
        assert response.status_code == 201
        accounts.append(response.json()['id'])
    card = {'id': 'f'*32, 'account_ids': [*accounts, accounts[0]], 'net_pnl': 90, 'notes': 'One shared review.'}
    response = client.put(f'/api/journal/{day}', json={'trades': [card]})
    assert response.status_code == 200
    entry = response.json()
    assert entry['trades'][0]['account_ids'] == accounts
    assert entry['day_result']['net_pnl'] == 90
    assert entry['trade_results'] == [{'account_id': None, 'account_ids': accounts, 'net_pnl': 90}]
    assert client.delete(f'/api/journal-accounts/{accounts[1]}').status_code == 409
    status = client.put(f'/api/journal-accounts/{accounts[1]}', json={
        'name': 'Copy Two', 'starting_balance': 50000, 'account_type': 'Eval', 'status': 'blown',
    })
    assert status.status_code == 200
    assert status.json()['status'] == 'blown'
    saved = client.put(f'/api/journal/{day}', json={'trades': [{**card, 'notes': 'Updated review.'}]})
    assert saved.status_code == 200
    assert saved.json()['trades'][0]['account_ids'] == accounts
    invalid = {**card, 'account_ids': [999999]}
    assert client.put(f'/api/journal/{day}', json={'trades': [invalid]}).status_code == 422
    assert client.get('/api/journal').json()[0]['trades'][0]['account_ids'] == accounts


def test_custom_fields_follow_journal_trade_into_lab(draft):
    from tests.test_webapp import trade_payload

    client, app, state = draft
    login(client, state)
    response = client.post('/api/lab-settings/custom-fields', json={
        'name': 'Indicator', 'type': 'dropdown', 'options': ['Present', 'Absent'],
    })
    field_id = response.json()['id']
    choices = {field_id: ['Present']}
    day = '2026-07-01'
    record = journal_card()
    response = client.put(f'/api/journal/{day}', json={'trades': [{**record, 'custom_fields': choices}]})
    assert response.status_code == 200, response.text
    assert response.json()['trades'][0]['custom_fields'] == choices
    assert client.get('/api/trades').json() == []

    response = client.post('/api/trades', json={
        **trade_payload(), 'journal_day': day, 'journal_trade_id': record['id'], 'custom_fields': choices,
    })
    assert response.status_code == 200, response.text
    linked = response.json()['journal_entry']['trades'][0]
    assert linked['custom_fields'] == choices
    response = client.patch(f"/api/trades/{linked['lab_trade_id']}", json={
        'strategy': 'Reversal', 'labels': {}, 'custom_fields': {field_id: ['Absent']},
    })
    assert response.status_code == 200, response.text
    entry = next(row for row in client.get('/api/journal').json() if row['day'] == day)
    assert entry['trades'][0]['custom_fields'] == {field_id: ['Absent']}


def test_custom_field_definitions_are_private(draft):
    from tests.test_webapp import trade_payload

    client, _, state = draft
    login(client, state)
    response = client.post('/api/lab-settings/custom-fields', json={
        'name': 'Private indicator', 'type': 'dropdown', 'options': ['Present'],
    })
    assert response.status_code == 201, response.text
    field_id = response.json()['id']

    client.cookies.clear()
    login(client, state, 'friend@example.com', 'friend-sub')
    assert client.get('/api/metadata').json()['custom_trade_fields'] == []
    assert client.delete(f'/api/lab-settings/custom-fields/{field_id}').status_code == 404
    response = client.post('/api/trades', json={**trade_payload(), 'custom_fields': {field_id: ['Present']}})
    assert response.status_code == 422
    assert client.get('/api/trades').json() == []


def test_journal_equity_defaults_to_active_accounts_and_tracks_prop_ledger(draft, monkeypatch):
    from unittest.mock import MagicMock
    from uuid import uuid4
    from webapp import daily_journal

    client, _, state = draft
    login(client, state)

    default_acct = client.get('/api/journal-accounts').json()[0]
    default_start = default_acct['starting_balance']

    funded = client.post('/api/journal-accounts', json={
        'name': 'Apex Funded #1',
        'starting_balance': 50000,
        'account_type': 'Funded',
        'firm': 'Apex',
        'fee_paid': 150,
        'payouts_total': 2000,
    }).json()
    passed = client.post('/api/journal-accounts', json={
        'name': 'Topstep Eval Passed',
        'starting_balance': 50000,
        'account_type': 'Eval',
        'status': 'passed',
        'firm': 'Topstep',
        'fee_paid': 100,
    }).json()
    blown = client.post('/api/journal-accounts', json={
        'name': 'Blown Eval #1',
        'starting_balance': 50000,
        'account_type': 'Eval',
        'status': 'blown',
        'firm': 'Apex',
        'fee_paid': 50,
    }).json()
    assert passed['closed_at'] is not None
    assert blown['closed_at'] is not None

    # Save 2 days: one with active + blown + partial copy-trade, one with off-plan loss
    day1 = '2026-09-07'  # Monday
    day2 = '2026-09-08'  # Tuesday
    r1 = client.put(f'/api/journal/{day1}', json={
        'plan': 'Wait for NY open sweep',
        'plan_followed': 'Yes',
        'mindset': 'Focused',
        'trades': [
            {'id': uuid4().hex, 'symbol': 'NQ', 'account_id': funded['id'], 'net_pnl': 600},
            {'id': uuid4().hex, 'symbol': 'NQ', 'account_id': blown['id'], 'net_pnl': -2000},
            {'id': uuid4().hex, 'symbol': 'ES', 'account_ids': [funded['id'], blown['id']], 'net_pnl': 200},
        ],
    })
    assert r1.status_code == 200, r1.text
    r2 = client.put(f'/api/journal/{day2}', json={
        'lesson': 'Overtraded lunch chop',
        'plan_followed': 'No',
        'mindset': 'Frustrated',
        'trades': [
            {'id': uuid4().hex, 'symbol': 'NQ', 'account_id': funded['id'], 'net_pnl': -250},
        ],
    })
    assert r2.status_code == 200, r2.text

    # Active equity excludes blown & passed starting balances and blown-only trades
    eq_active = client.get('/api/journal/equity?scope=active').json()
    assert eq_active['starting_balance'] == default_start + 50000
    assert eq_active['net_pnl'] == 450.0  # 600 + 100 (half of copy trade) - 250
    assert eq_active['split_estimated'] is True
    assert eq_active['counts'] == {'active': 2, 'passed': 1, 'blown': 1, 'total': 4}
    assert eq_active['prop_ledger'] == {'fees_total': 300.0, 'payouts_total': 2000.0, 'net_roi': 1700.0}
    assert eq_active['insights']['plan']['Yes']['net_pnl'] == 700.0
    assert eq_active['insights']['plan']['No']['net_pnl'] == -250.0
    assert eq_active['insights']['mindset']['Focused']['net_pnl'] == 700.0
    assert eq_active['insights']['weekdays']['Mon']['net_pnl'] == 700.0

    # Blown equity isolates the blown account cleanly
    eq_blown = client.get('/api/journal/equity?scope=blown').json()
    assert eq_blown['starting_balance'] == 50000
    assert eq_blown['net_pnl'] == -1900.0  # -2000 + 100 (half of copy trade)

    # Lightweight summary + single-day fetch
    summary = client.get('/api/journal/summary').json()
    assert len(summary) == 2
    assert summary[0]['day'] == day2
    assert summary[0]['preview'] == 'Overtraded lunch chop'
    assert summary[1]['symbols'] == ['NQ', 'ES']
    single = client.get(f'/api/journal/{day1}').json()
    assert single['plan'] == 'Wait for NY open sweep'

    # Copy-trade account presets
    preset_id = uuid4().hex
    saved_presets = client.put('/api/journal-accounts/presets', json={
        'presets': [{'id': preset_id, 'name': 'Funded Pair', 'account_ids': [default_acct['id'], funded['id']]}],
    })
    assert saved_presets.status_code == 200
    assert client.get('/api/journal-accounts/presets').json()['presets'][0]['name'] == 'Funded Pair'

    # Voice-to-Journal Whisper transcription: 503 when unconfigured, 200 when Cloudflare mocked
    monkeypatch.delenv('COACH_CLOUDFLARE_ACCOUNT_ID', raising=False)
    monkeypatch.delenv('COACH_CLOUDFLARE_API_TOKEN', raising=False)
    assert client.post('/api/journal/transcribe', files={'file': ('clip.webm', b'webmdata', 'audio/webm')}).status_code == 503

    monkeypatch.setenv('COACH_CLOUDFLARE_ACCOUNT_ID', 'a' * 32)
    monkeypatch.setenv('COACH_CLOUDFLARE_API_TOKEN', 'secret-token')
    fake_resp = MagicMock(ok=True)
    fake_resp.json.return_value = {'result': {'text': 'Waited for London sweep and took NQ long.'}}
    monkeypatch.setattr('requests.post', lambda *args, **kwargs: fake_resp)
    transcribed = client.post('/api/journal/transcribe', files={'file': ('clip.webm', b'webmdata', 'audio/webm')})
    assert transcribed.status_code == 200
    assert transcribed.json() == {'text': 'Waited for London sweep and took NQ long.'}
    assert daily_journal.voice_transcribe_enabled() is True
