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
