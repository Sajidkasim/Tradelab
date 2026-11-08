from io import BytesIO
import json,threading
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from core.db import Database
from webapp.replay_archive import Archive,pack,key,unpack,encode
from webapp import replay_sessions

class Store:
    def __init__(self):self.objects={}
    def add(self,value):
        digest,body=pack(value);self.objects[key(digest)]=body;return digest
    def get_object(self,**kw):return {'Body':BytesIO(self.objects[kw['Key']])}

def bundles():
    store=Store();days={}
    for d,stamp in [('2020-06-01',1590969600000),('2020-06-02',1591056000000),('2020-06-03',1591142400000)]:
        days[d]=store.add({'day':d,'markets':{root:{'contract':root+'M0','bars':[[stamp+i*60000,100+i,102+i,99+i,101+i,10] for i in range(6)]} for root in ('NQ','ES')}})
    chart=store.add({root:{'daily':[[1590969600000,100,110,90,105,100]],'4h':[[1275868800000,100,110,90,105,100],[1591142400000,100,110,90,105,100]]} for root in ('NQ','ES')})
    return store,{'version':2,'days':days,'charts':chart}

def test_archive_assembles_bounded_history_and_full_4h_without_future():
    store,manifest=bundles();archive=Archive(manifest,store,'private')
    data,signature=archive.history('2020-06-02');market=data['markets']['NQ']
    assert len(market['bars'])==6 and len(market['context'])==6
    assert len(market['four_hour_history'])==1
    assert market['four_hour_history'][0]['time']==1275868800000
    assert data['chart_context_version']==1 and len(signature)==64
    assert all(b['time']<1591056000000 for b in market['context'])
    with pytest.raises(ValueError):archive.history('2020-06-04')
    digest,body=pack({'data':'test'})
    with pytest.raises(ValueError):unpack(body,'0'*64)
    with pytest.raises(ValueError):key('../secret')


def test_hosted_full_archive_routes_need_no_local_index_and_keep_private_sessions(tmp_path,monkeypatch):
    store,manifest=bundles();path=tmp_path/'full.json';path.write_text(json.dumps(manifest))
    legacy=tmp_path/'legacy.json';legacy.write_text('{"days":{}}')
    db=Database(str(tmp_path/'test.db'));db.init()
    app=FastAPI();app.state.workspaces=SimpleNamespace(lock=threading.RLock(),database=lambda key:db,bump=lambda key:None)
    app.state.image_storage=SimpleNamespace(client=store)
    cfg=SimpleNamespace(local=False,replay_enabled=True,replay_manifest=str(legacy),replay_archive_manifest=str(path),r2_bucket='private')
    replay_sessions.mount(app,cfg,lambda:{'key':'owner'})
    with TestClient(app) as client:
        listing=client.get('/api/backtesting/sessions').json()['history']
        assert listing['indexed_days']==3
        response=client.post('/api/backtesting/sessions',json={'day':'2020-06-02','start_time':'00:03','instrument':'NQ'})
        assert response.status_code==200,response.text
        data=response.json();sid=data['session']['id']
        assert data['sample']['markets']['NQ']['four_hour_history'][0]['time']==1275868800000
        assert data['session']['next_day']=='2020-06-03'
        assert client.get('/api/backtesting/sessions/'+sid).json()['sample']==data['sample']
        response=client.post('/api/backtesting/sessions/'+sid+'/continue',json={'version':0,'cursor':5})
        assert response.status_code==200,response.text
        assert len(response.json()['sample']['markets']['NQ']['bars'])==12
        # Old v1 sessions retain their frozen prices while receiving full chart context.
        import hashlib
        base=Archive(manifest,store,'private').history('2020-06-02')[0]
        old=encode({**base,'chart_context_version':0,'markets':{root:{k:v for k,v in market.items() if k!='four_hour_history'} for root,market in base['markets'].items()}})
        digest=hashlib.sha256(old).hexdigest();store.objects[f'primus-replay/v1/{digest}.json']=old
        legacy.write_text(json.dumps({'days':{'2020-06-02':digest}}))
        created=client.post('/api/backtesting/sessions',json={'day':'2020-06-02','start_time':'00:03','instrument':'NQ'}).json()
        record=db.get_setting(replay_sessions.PREFIX+created['session']['id']);record['data_digest']=digest
        db.set_setting(replay_sessions.PREFIX+record['id'],record)
        restored=client.get('/api/backtesting/sessions/'+record['id'])
        assert restored.status_code==200,restored.text
        assert restored.json()['projection']==created['projection']
        assert restored.json()['sample']['markets']['NQ']['four_hour_history'][0]['time']==1275868800000
    db.engine.dispose()


def test_ny_chart_enrichment_does_not_change_saved_price_signature():
    store,manifest=bundles();before=Archive(manifest,store,'private').history('2020-06-02')
    manifest={**manifest,'charts_ny':store.add({root:[[1591048800000,100,105,99,101,50]] for root in ('NQ','ES')})}
    after=Archive(manifest,store,'private').history('2020-06-02')
    assert before[1]==after[1]
    assert before[0]['markets']['NQ']['bars']==after[0]['markets']['NQ']['bars']
    assert after[0]['ny_four_hour'] is True


def test_prefetch_can_load_a_ten_day_batch_without_saving_new_trades(tmp_path):
    store,manifest=bundles();path=tmp_path/'full.json';path.write_text(json.dumps(manifest))
    legacy=tmp_path/'legacy.json';legacy.write_text('{"days":{}}')
    db=Database(str(tmp_path/'batch.db'));db.init();app=FastAPI()
    app.state.workspaces=SimpleNamespace(lock=threading.RLock(),database=lambda key:db,bump=lambda key:None)
    app.state.image_storage=SimpleNamespace(client=store)
    cfg=SimpleNamespace(local=False,replay_enabled=True,replay_manifest=str(legacy),replay_archive_manifest=str(path),r2_bucket='private')
    replay_sessions.mount(app,cfg,lambda:{'key':'owner'})
    with TestClient(app) as client:
        initial=client.post('/api/backtesting/sessions',json={'day':'2020-06-01','start_time':'00:03','instrument':'NQ'}).json()
        sid=initial['session']['id'];url='/api/backtesting/sessions/'+sid+'/continue'
        assert client.post(url,json={'version':0,'cursor':2,'days':11}).status_code==422
        result=client.post(url,json={'version':0,'cursor':2,'days':10})
        assert result.status_code==200,result.text
        data=result.json();assert len(data['sample']['markets']['NQ']['bars'])==18
        assert data['sample']['markets']['NQ']['bars'][:6]==initial['sample']['markets']['NQ']['bars']
        assert data['session']['cursor']==initial['session']['cursor']
        assert data['projection']['trades']==[] and data['session']['next_day'] is None
    db.engine.dispose()

def test_hosted_chart_windows_are_paged_and_calendar_never_reveals_future():
    store,manifest=bundles()
    archive=Archive(manifest,store,'private');cut=1591056120000
    minute=archive.chart_window('NQ','1',cut+1,cut,2)
    assert len(minute['bars'])==2 and minute['bars'][-1]['time']==cut
    earlier=archive.chart_window('NQ','1',minute['bars'][0]['time'],cut,2)
    assert earlier['bars'][-1]['time']<minute['bars'][0]['time']
    with pytest.raises(ValueError,match='calendar bundle'):archive.chart_window('NQ','1D',cut+1,cut)
    manifest['calendar_session_hour']=17
    manifest['charts_calendar_ny']=store.add({root:[[1590962400000,100,110,90,105,100,1591048800000]] for root in ('NQ','ES')})
    result=Archive(manifest,store,'private').chart_window('NQ','1D',cut+1,cut)
    assert result['bars'][-1]['close']==103

def test_execution_reader_preserves_frozen_signature_without_chart_copies():
    store,manifest=bundles();archive=Archive(manifest,store,'private')
    old,signature=archive.history('2020-06-02');new,new_signature=archive.execution_history('2020-06-02')
    assert signature==new_signature
    for root in ('NQ','ES'):
        assert new['markets'][root]['bars']==old['markets'][root]['bars']
        assert set(new['markets'][root])=={'contract','bars'}

def test_calendar_archive_pages_are_bounded_and_legacy_boundary_is_not_mixed():
    from services.replay_chart_history import bucket
    store,manifest=bundles();cut=1591056120000;opened=bucket(cut,'1D')
    rows=[[opened-(10-i)*86400000,100,110,90,105,1,opened-(9-i)*86400000] for i in range(10)]
    pages=[]
    for start in range(0,len(rows),3):
        chunk=rows[start:start+3]
        pages.append({'first':chunk[0][0],'last':chunk[-1][0],'digest':store.add(chunk)})
    manifest['timeframe_chunks']={'NQ':{'1D':pages}}
    archive=Archive(manifest,store,'private')
    with pytest.raises(ValueError,match='17:00 New York chart calendar bundle'):
        archive.chart_window('NQ','1D',cut+1,cut,3)
    manifest['calendar_session_hour']=17
    archive=Archive(manifest,store,'private')
    recent=archive.chart_window('NQ','1D',cut+1,cut,3)
    older=archive.chart_window('NQ','1D',recent['bars'][0]['time'],cut,3)
    right=archive.chart_window('NQ','1D',cut+1,cut,3,older['bars'][-1]['time'])
    assert len(recent['bars'])==len(older['bars'])==3
    assert not recent['exhausted']
    assert right['bars']==recent['bars']
    assert recent['bars'][-1]['high']==104 # forming candle excludes future minute highs
