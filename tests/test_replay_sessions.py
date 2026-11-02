from copy import deepcopy
from uuid import uuid4
import pytest
from tests.test_webapp import local
from webapp import replay_sessions

@pytest.fixture
def candles(monkeypatch,tmp_path):
    monkeypatch.setattr(replay_sessions,'ROOT',tmp_path)
    base=1275917220000 # 2010-06-07 13:27 UTC
    bars=[{'time':base+i*60000,'open':100+i,'high':102+i,'low':99+i,'close':101+i,'volume':10} for i in range(6)]
    data={'day':'2010-06-07','markets':{key:{'contract':key+'M0','bars':bars} for key in ('NQ','ES')}}
    monkeypatch.setattr(replay_sessions,'load_sample',lambda day:(deepcopy(data),'fixed-data-signature'))
    return data

def create(client):
    result=client.post('/api/backtesting/sessions',json={'name':'Test practice','day':'2010-06-07','start_time':'13:30','instrument':'MNQ','capital':50000,'commission':0.5,'slippage':0})
    assert result.status_code==200,result.text
    return result.json()

def test_sessions_create_resume_progress_and_orders_do_not_change_journal(local,candles):
    client,app=local
    before=client.get('/api/trades').json()
    created=create(client);s=created['session'];sid=s['id']
    assert s['cursor']==2 and s['spec']['start_cursor']==2
    response=client.post(f'/api/backtesting/sessions/{sid}/action',json={'version':0,'cursor':2,'kind':'order','event_id':str(uuid4()),'order':{'side':'buy','type':'market','qty':2}})
    assert response.status_code==200,response.text
    values=response.json();assert values['projection']['frames'][0]['position'] is None
    assert values['projection']['frames'][1]['position']['entry']==103
    assert client.put(f'/api/backtesting/sessions/{sid}/progress',json={'version':1,'cursor':3}).status_code==200
    reopened=client.get(f'/api/backtesting/sessions/{sid}').json()
    assert reopened['session']['cursor']==3 and reopened['session']['version']==2
    assert reopened['projection']['frames'][1]['position']['qty']==2
    assert client.get('/api/backtesting/sessions').json()['sessions'][0]['id']==sid
    assert client.get('/api/trades').json()==before
    assert client.put(f'/api/backtesting/sessions/{sid}/progress',json={'version':2,'cursor':2}).status_code==409

def test_conflicts_idempotency_missing_sessions_and_csrf(local,candles):
    client,app=local
    sid=create(client)['session']['id']
    command={'version':0,'cursor':2,'kind':'order','event_id':str(uuid4()),'order':{'side':'sell','type':'limit','price':105,'qty':1}}
    first=client.post(f'/api/backtesting/sessions/{sid}/action',json=command)
    assert first.status_code==200
    assert client.post(f'/api/backtesting/sessions/{sid}/action',json=command).json()['session']['version']==1
    assert client.put(f'/api/backtesting/sessions/{sid}/progress',json={'version':0,'cursor':3}).status_code==409
    assert client.get(f'/api/backtesting/sessions/{uuid4()}').status_code==404
    assert client.get('/api/backtesting/sessions/not-a-session').status_code==404
    client.headers.pop('X-Primus-CSRF')
    assert client.post(f'/api/backtesting/sessions/{sid}/action',json=command).status_code==403

def test_validation_does_not_save_invalid_order_and_data_changes_are_detected(local,candles,monkeypatch):
    client,app=local
    sid=create(client)['session']['id']
    invalid={'version':0,'cursor':2,'kind':'order','event_id':str(uuid4()),'order':{'side':'buy','type':'limit','price':90.1,'qty':1}}
    assert client.post(f'/api/backtesting/sessions/{sid}/action',json=invalid).status_code==422
    assert client.get(f'/api/backtesting/sessions/{sid}').json()['session']['version']==0
    monkeypatch.setattr(replay_sessions,'load_sample',lambda day:(candles,'changed-data'))
    assert client.get(f'/api/backtesting/sessions/{sid}').status_code==409

def test_missing_candles_cannot_overwrite_saved_progress(local,candles,monkeypatch):
    client,app=local
    sid=create(client)['session']['id']
    def missing(day):raise ValueError('Unavailable data')
    monkeypatch.setattr(replay_sessions,'load_sample',missing)
    response=client.put(f'/api/backtesting/sessions/{sid}/progress',json={'version':0,'cursor':3})
    assert response.status_code==422
    stored=app.state.workspaces.database('owner').get_setting(replay_sessions.PREFIX+sid)
    assert stored['cursor']==2 and stored['version']==0

def test_replay_endpoints_remain_disabled_on_hosted_configuration():
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app=FastAPI()
    replay_sessions.mount(app,SimpleNamespace(local=False),lambda:{'key':'owner'})
    with TestClient(app) as client:
        sid=str(uuid4())
        assert client.get('/api/backtesting/sessions').status_code==404
        assert client.post('/api/backtesting/sessions',json={'day':'2010-06-07'}).status_code==404
        assert client.get(f'/api/backtesting/sessions/{sid}').status_code==404
        assert client.put(f'/api/backtesting/sessions/{sid}/progress',json={'version':0,'cursor':0}).status_code==404
        assert client.post(f'/api/backtesting/sessions/{sid}/action',json={'version':0,'cursor':0,'kind':'cancel','event_id':str(uuid4())}).status_code==404

def test_delete_restore_and_saved_bracket_edits(local,candles):
    client,app=local
    sid=create(client)['session']['id']
    def send(version,cursor,kind,order=None):
        return client.post(f'/api/backtesting/sessions/{sid}/action',json={'version':version,'cursor':cursor,'kind':kind,'event_id':str(uuid4()),**({'order':order} if order else {})})
    assert send(0,2,'order',{'side':'buy','qty':1}).status_code==200
    edited=send(1,3,'amend',{'side':'buy','qty':1,'stop':102.5,'target':110})
    assert edited.status_code==200,edited.text
    reopened=client.get(f'/api/backtesting/sessions/{sid}').json()
    assert reopened['projection']['frames'][1]['position']['stop']==102.5
    assert client.delete(f'/api/backtesting/sessions/{sid}').status_code==200
    assert client.get(f'/api/backtesting/sessions/{sid}').status_code==404
    listing=client.get('/api/backtesting/sessions').json()
    assert listing['sessions']==[] and listing['deleted'][0]['id']==sid
    assert client.post(f'/api/backtesting/sessions/{sid}/restore').status_code==200
    assert client.get(f'/api/backtesting/sessions/{sid}').json()['session']['version']==2


def test_layout_and_explicit_transfer_are_private_repeat_safe_and_preserve_results(local,candles):
    client,app=local;created=create(client);sid=created['session']['id']
    layout={'timeframe':'5','symbol':'NQ','drawings':{}}
    assert client.put(f'/api/backtesting/sessions/{sid}/layout',json={'layout':layout}).status_code==200
    assert client.get(f'/api/backtesting/sessions/{sid}').json()['layout']==layout
    assert client.post(f'/api/backtesting/sessions/{sid}/action',json={'version':0,'cursor':2,'kind':'order','event_id':str(uuid4()),'order':{'side':'buy','qty':2}}).status_code==200
    assert client.put(f'/api/backtesting/sessions/{sid}/progress',json={'version':1,'cursor':5}).status_code==200
    body={'destination':'both','strategy':'Replay model','entry_cursor':3}
    result=client.post(f'/api/backtesting/sessions/{sid}/export',json=body)
    assert result.status_code==200,result.text
    assert client.post(f'/api/backtesting/sessions/{sid}/export',json=body).json()==result.json()
    trades=client.get('/api/trades').json();assert len(trades)==1
    assert trades[0]['net_pnl']==10 and trades[0]['r_multiple'] is None
    from webapp.daily_journal import entry
    assert len(entry(app.state.workspaces.database('owner'),result.json()['journal_day'])['trades'])==1

def test_replay_concurrent_reads_at_5_10_25_users(local,candles):
    from concurrent.futures import ThreadPoolExecutor
    from time import perf_counter
    client,app=local;sid=create(client)['session']['id']
    for users in (5,10,25):
        start=perf_counter()
        with ThreadPoolExecutor(max_workers=users) as executor:
            statuses=list(executor.map(lambda _:client.get(f'/api/backtesting/sessions/{sid}').status_code,range(users)))
        assert statuses==[200]*users
        print(f'Local replay readers={users}, batch={perf_counter()-start:.3f}s')

from tests.test_google_access import google,login

def test_replay_layouts_and_transfers_cannot_cross_google_workspaces(google,candles):
    client,app,state=google
    login(client,state)
    sid=create(client)['session']['id']
    assert client.put(f'/api/backtesting/sessions/{sid}/layout',json={'layout':{'symbol':'NQ'}}).status_code==200
    login(client,state,'friend@example.com','different-friend-sub')
    assert client.get('/api/backtesting/sessions').json()['sessions']==[]
    assert client.get(f'/api/backtesting/sessions/{sid}').status_code==404
    assert client.put(f'/api/backtesting/sessions/{sid}/layout',json={'layout':{}}).status_code==404
    assert client.post(f'/api/backtesting/sessions/{sid}/export',json={'destination':'both','strategy':'Private','entry_cursor':3}).status_code==404

def test_hosted_replay_uses_private_bundles_without_local_files_and_caches_only_prices(tmp_path,candles,monkeypatch):
    import json,hashlib,threading
    from io import BytesIO
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from core.db import Database
    candles['history_version']=1
    content=json.dumps(candles).encode();digest=hashlib.sha256(content).hexdigest()
    manifest=tmp_path/'manifest.json';manifest.write_text(json.dumps({'days':{'2010-06-07':digest}}))
    db=Database(str(tmp_path/'host-test.db'));db.init();reads=[]
    class Storage:
        def get_object(self,**kw):
            assert kw['Bucket']=='private-test'
            assert kw['Key']==f'primus-replay/v1/{digest}.json'
            reads.append(kw['Key']);return {'Body':BytesIO(content)}
    app=FastAPI();app.state.workspaces=SimpleNamespace(lock=threading.RLock(),database=lambda key:db,bump=lambda key:None)
    app.state.image_storage=SimpleNamespace(client=Storage())
    replay_sessions.mount(app,SimpleNamespace(local=False,replay_enabled=True,replay_manifest=str(manifest),r2_bucket='private-test'),lambda:{'key':'owner'})
    def no_local(day):raise AssertionError('Hosted replay must not use Mac candle files')
    monkeypatch.setattr(replay_sessions,'load_sample',no_local)
    with TestClient(app) as client:
        listing=client.get('/api/backtesting/sessions').json()
        assert listing['history']['available_days']==['2010-06-07']
        sid=create(client)['session']['id']
        assert client.get(f'/api/backtesting/sessions/{sid}').status_code==200
        assert client.put(f'/api/backtesting/sessions/{sid}/progress',json={'version':0,'cursor':3}).status_code==200
        assert len(reads)==1
        assert client.post('/api/backtesting/sessions',json={'day':'2013-01-25'}).status_code==422
    db.engine.dispose()

def test_replay_research_and_two_layouts_save_separately(local,candles):
    client,app=local;sid=create(client)['session']['id']
    root=f'/api/backtesting/sessions/{sid}'
    assert client.put(root+'/layout',json={'layout':{'split':True,'timeframe':'240'}}).status_code==200
    assert client.put(root+'/layout?pane=secondary',json={'layout':{'symbol':'ES','timeframe':'15'}}).status_code==200
    assert client.put(root+'/journal',json={'strategy':'Reversal','entry_timeframe':'5m','checklist':['SMT'],'notes':'Patient entry'}).status_code==200
    data=client.get(root).json()
    assert data['layout']['timeframe']=='240'
    assert data['layout_secondary']['symbol']=='ES'
    assert data['journal']['notes']=='Patient entry'
    assert client.post(root+'/action',json={'version':0,'cursor':2,'kind':'order','event_id':str(uuid4()),'order':{'side':'buy','qty':2}}).status_code==200
    assert client.post(root+'/ticket-preview',json={'version':1,'cursor':2,'price':100}).json()['amount']==-12

def test_lab_setup_overrides_follow_export_without_changing_session_defaults(local,candles):
    from core import edge
    from webapp import daily_journal
    client,app=local;sid=create(client)['session']['id'];root=f'/api/backtesting/sessions/{sid}'
    defaults={'strategy':'Default','level':'Order block','timeframe':'4H','entry_timeframe':'1m','checklist':[],'notes':'Session defaults'}
    assert client.put(root+'/journal',json=defaults).status_code==200
    assert client.post(root+'/action',json={'version':0,'cursor':2,'kind':'order','event_id':str(uuid4()),'order':{'side':'buy','qty':2}}).status_code==200
    assert client.put(root+'/progress',json={'version':1,'cursor':5}).status_code==200
    setup={'strategy':'Reversal','level':'FVG','timeframe':'1H','entry_timeframe':'5m','checklist':['SMT','CISD'],'notes':'This trade only','news':'CPI','condition':'Trending'}
    payload={'destination':'both','strategy':'Reversal','entry_cursor':3,'setup':setup}
    reply=client.post(root+'/export',json=payload);assert reply.status_code==200,reply.text
    frame=app.state.workspaces.database('owner').trades_df();trade=frame.iloc[0]
    labels=edge.read_labels(trade.tags)
    assert labels['level']=='FVG' and labels['timeframe']=='1H' and labels['entry_timeframe']=='5m'
    assert set(labels['confirmations'])=={'SMT','CISD'}
    assert trade.net_pnl==10 and 'This trade only' in trade.notes
    card=daily_journal.entry(app.state.workspaces.database('owner'),reply.json()['journal_day'])['trades'][0]
    assert card['level']=='FVG' and card['entry_timeframe']=='5m' and card['strategy']=='Reversal'
    assert client.get(root).json()['journal']['level']=='Order block'
    assert client.post(root+'/export',json=payload).json()==reply.json()
    assert len(client.get('/api/trades').json())==1
