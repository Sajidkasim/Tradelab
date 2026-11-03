"""Private replay sessions. Hosted history is explicitly enabled and read from R2."""
from copy import deepcopy
from contextvars import ContextVar
from .byte_cache import ByteCache,byte_cache
COMPACT_WIRE=ContextVar("compact_replay_wire",default=False)
from .replay_timing import timed
from datetime import date, datetime, timezone
from functools import lru_cache
from hashlib import sha256
import json
from pathlib import Path
import threading
import asyncio
from fastapi.responses import JSONResponse
from typing import Literal
from uuid import UUID, uuid4
from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from services.replay_engine import project, INSTRUMENTS

ROOT=Path(__file__).resolve().parents[1]/'data/private'
INDEX='primus_replay_sessions'
PREFIX='primus_replay:'
DATA_LOCK=threading.RLock()

class SessionInput(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    name:str=Field(default='',max_length=80)
    day:date
    start_time:str=Field(default='13:30',pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    instrument:Literal['MNQ','NQ','MES','ES']='MNQ'
    capital:float=Field(default=50000,gt=0,le=1000000000)
    commission:float=Field(default=0.5,ge=0,le=100)
    slippage:int=Field(default=0,ge=0,le=20,strict=True)

class BulkDeleteInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    ids:list[UUID]=Field(min_length=1,max_length=100)
    confirmation:str=Field(max_length=80)

DEFAULTS='primus_replay_chart_defaults'
DEFAULT_FIELDS={'config','studies','timeframe','clockZone','clockDisplayVersion','watermark','minuteWatermarks','shortcuts','sessionRanges','drawingTemplates','drawingDefaults','drawingFavorites','drawingToolFavorites'}
def chart_defaults(db):return db.get_setting(DEFAULTS,{})

class OrderInput(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    side:Literal['buy','sell']
    type:Literal['market','limit','stop']='market'
    qty:int=Field(default=1,ge=1,le=50,strict=True)
    price:float|None=None
    stop:float|None=None
    target:float|None=None

class ProgressInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version:int=Field(ge=0)
    cursor:int=Field(ge=0)

class ContinueInput(ProgressInput):
    days:int=Field(default=1,ge=1,le=10,strict=True)

class PurgeInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirmation:str=Field(max_length=80)

class ActionInput(ProgressInput):
    kind:Literal['order','cancel','close','amend']
    event_id:UUID
    order:OrderInput|None=None

def _root(instrument):return 'NQ' if instrument in ('MNQ','NQ') else 'ES'
def _key(sid):
    try:return PREFIX+str(UUID(sid))
    except (ValueError,TypeError):raise HTTPException(404,'Session not found.') from None

@byte_cache(8*1024*1024,entries=2)
def _read(path,stamp):
    content=Path(path).read_bytes()
    return json.loads(content),sha256(content).hexdigest()

def catalog():
    sample=ROOT/'backtesting-preview.json'
    config=ROOT/'replay-source.json'
    current=json.loads(sample.read_text()) if sample.is_file() else {}
    source=json.loads(config.read_text()) if config.is_file() else {}
    day=source.get('preview_day',current.get('day','2010-06-07'))
    indexed={}
    if (ROOT/'replay-index.db').is_file():
        from .replay_index import days
        available=days(ROOT/'replay-index.db')
        if available:indexed={'indexed_days':len(available),'first_day':available[0],'last_day':available[-1]}
    return {**{'first_day':source.get('first_day',day),'last_day':source.get('last_day',day),'sample_day':day,
            'instruments':[{'symbol':k,'name':v.name,'multiplier':v.multiplier,'tick_size':v.tick_size,'commission':v.commission_per_contract/2} for k,v in INSTRUMENTS.items() if k in ('NQ','ES')]},**indexed}

def load_sample(day):
    # Only a validated ISO date can become a filename; never accept a path from the browser.
    day=date.fromisoformat(day).isoformat()
    with DATA_LOCK:
        sample=ROOT/'backtesting-preview.json'
        if sample.is_file() and _read(str(sample),sample.stat().st_mtime_ns)[0].get('day')==day:
            return _read(str(sample),sample.stat().st_mtime_ns)
        target=ROOT/'replay-days'/f'{day}.json'
        if not target.is_file():
            config=ROOT/'replay-source.json'
            if not config.is_file():raise ValueError('This date is not prepared locally yet. Choose the loaded sample day.')
            source=json.loads(config.read_text())
            if not source['first_day']<=day<=source['last_day']:raise ValueError('Choose a date inside the available history.')
            try:
                from tools.prepare_replay_sample import prepare
                prepare(Path(source['source']),day,target)
            except ImportError:raise ValueError('Install requirements-replay.txt on this Mac to prepare another date.') from None
            except ValueError as e:raise ValueError('No usable candles for this date. Try a trading weekday.') from e
        return _read(str(target),target.stat().st_mtime_ns)

def load_history(day):
    if (ROOT/'replay-index.db').is_file():
        from .replay_index import load
        target=ROOT/'replay-index-days'/f'{date.fromisoformat(day).isoformat()}.json'
        with DATA_LOCK:
            if not target.is_file():
                data=load(ROOT/'replay-index.db',day);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(data,separators=(',',':')))
            return _read(str(target),target.stat().st_mtime_ns)
    base,digest=load_sample(day)
    config=ROOT/'replay-source.json'
    if base.get('source')!='Databento GLBX.MDP3' or not config.is_file():return base,digest
    target=ROOT/'replay-history'/f'{day}.json'
    with DATA_LOCK:
        if not target.is_file():
            from tools.prepare_replay_history import prepare
            prepare(Path(json.loads(config.read_text())['source']),day,target)
        return _read(str(target),target.stat().st_mtime_ns)

class LayoutInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    layout:dict

class TicketPreviewInput(ProgressInput):
    price:float=Field(gt=0,allow_inf_nan=False)

class JournalInput(BaseModel):
    strategy:str=Field(default='',max_length=120)
    level:str=Field(default='',max_length=120)
    timeframe:str=Field(default='',max_length=120)
    entry_timeframe:str=Field(default='',max_length=120)
    condition:str=Field(default='',max_length=120)
    news:str=Field(default='',max_length=120)
    checklist:list[str]=Field(default_factory=list,max_length=30)
    notes:str=Field(default='',max_length=10000)

class ExportInput(BaseModel):
    destination:Literal['lab','journal','both']='both'
    strategy:str=Field(min_length=1,max_length=120)
    entry_cursor:int=Field(ge=0)
    setup:JournalInput|None=None

@timed("projection + SL/TP hit checks")
def projection(record,data):return project(data['markets'][record['root']]['bars'],record['spec'],record['commands'],compact=True)
def snapshot(record,plan):return plan['frames'][record['cursor']-record['spec']['start_cursor']]
def summary(record,plan):
    return {k:record[k] for k in ('id','name','day','instrument','root','capital','cursor','version','created','updated')} | {
        'equity':snapshot(record,plan)['equity'],'closed':sum(t['exit_cursor']<=record['cursor'] for t in plan['trades']),
        'clock':record['clock'],'finished':record['cursor']==record['last_cursor']}

def mount(app,config,workspace):
    replay_gate=asyncio.Semaphore(1)
    @app.middleware('http')
    async def replay_wire(request,call_next):
        heavy='/api/backtesting/sessions' in request.url.path and not any(part in request.url.path for part in ('/chart-history','/layout','/journal'))
        if heavy:
            try:await asyncio.wait_for(replay_gate.acquire(),timeout=15)
            except asyncio.TimeoutError:return JSONResponse({'detail':'Replay is busy. Please retry shortly.'},status_code=503,headers={'Retry-After':'1'})
        token=COMPACT_WIRE.set(request.headers.get('X-Primus-Replay-Wire')=='columns-v1')
        try:return await call_next(request)
        finally:
            COMPACT_WIRE.reset(token)
            if heavy:replay_gate.release()
    def database(member): return app.state.workspaces.database(member["key"])
    def local_only():
        if not config.local and not getattr(config,'replay_enabled',False):raise HTTPException(404)
    @byte_cache(8*1024*1024,entries=1)
    def hosted_bundle(digest):
        # Immutable prices can be shared; private session/position data is never cached here.
        from .replay_history_storage import HistoryStorage
        connection=app.state.image_storage
        return HistoryStorage(ROOT,connection.client,config.r2_bucket).read(digest)
    @lru_cache(maxsize=1)
    def archive():
        path=Path(getattr(config,'replay_archive_manifest',''))
        if config.local or not path.is_file():return None
        from .replay_archive import Archive
        return Archive(json.loads(path.read_text()),app.state.image_storage.client,config.r2_bucket)
    def available_manifest():
        return archive().manifest if archive() else json.loads(Path(config.replay_manifest).read_text())
    def history(day):
        if config.local:return load_history(day)
        if archive():return archive().execution_history(day) if COMPACT_WIRE.get() else archive().history(day)
        manifest=json.loads(Path(config.replay_manifest).read_text())
        digest=manifest['days'].get(day)
        if not digest:raise HTTPException(422,'This date is not available on the server.')
        return hosted_bundle(digest),digest
    def get_record(db,sid):
        value=db.get_setting(_key(sid))
        if not value or value.get('deleted'):raise HTTPException(404,'Session not found.')
        # Keep old finalised exits at their original cursor when extending history.
        if 'close_at_end' not in value['spec']:
            if value['cursor']==value['last_cursor']:
                value['spec']['legacy_end_cursors']=[value['last_cursor']]
            value['spec']['close_at_end']=False
        return value
    price_cache=ByteCache(12*1024*1024,entries=2)
    @timed("read + parse history")
    def checked_data(record):
        index=ROOT/'replay-index.db'
        cacheable=not config.local or (index.is_file() and index.stat().st_size>1024)
        stamp=index.stat().st_mtime_ns if index.is_file() else 0
        identity=(record['day'],record['data_digest'],record.get('extended'),tuple((p['day'],p['digest']) for p in record.get('continuation_days',[])),stamp,COMPACT_WIRE.get())
        cached=price_cache.get(identity) if cacheable else None
        if cached is not None:return cached
        try:
            old=ROOT/'replay-history'/f"{record['day']}.json"
            data,digest=(_read(str(old),old.stat().st_mtime_ns) if config.local and record.get('extended') and old.is_file() and sha256(old.read_bytes()).hexdigest()==record['data_digest'] else (history if record.get('extended') else load_sample)(record['day']))
        except (ValueError,OSError):raise HTTPException(422,'The saved candle file is unavailable. Restore the local data before reopening this session.') from None
        if digest!=record['data_digest'] and not config.local:
            legacy=json.loads(Path(config.replay_manifest).read_text())['days'].get(record['day'])
            if legacy==record['data_digest']:data,digest=hosted_bundle(legacy),legacy
        if digest!=record['data_digest']:raise HTTPException(409,'The candle file changed. Start a new session to use the new data.')
        if COMPACT_WIRE.get():data={**data,'markets':{root:{'contract':market['contract'],'bars':market['bars']} for root,market in data['markets'].items()}}
        if record.get('continuation_days'):
            data={**data,'markets':{root:{**market,'bars':list(market['bars'])} for root,market in data['markets'].items()}}
            for segment in record['continuation_days']:
                extra,signature=history(segment['day'])
                if signature!=segment['digest']:raise HTTPException(409,'Saved continuation candles changed. Restore the original data.')
                for root,market in data['markets'].items():
                    market['bars'].extend(extra['markets'][root]['bars'])
        if cacheable:price_cache.put(identity,data)
        return data

    @lru_cache(maxsize=2)
    def indexed_dates(path,stamp):
        from .replay_index import days
        return days(Path(path))

    def next_day(record):
        if record['spec'].get('close_at_end',True):return None
        last=record.get('continuation_days',[{'day':record['day']}])[-1]['day']
        index=ROOT/'replay-index.db'
        if config.local:
            available=indexed_dates(str(index),index.stat().st_mtime_ns) if index.is_file() else []
        else:available=sorted(available_manifest()['days'])
        following=next((day for day in available if day>last),None)
        # Never bridge years between isolated hosted samples as an overnight gap.
        return following if following and (date.fromisoformat(following)-date.fromisoformat(last)).days<=7 else None
    @timed("save session including history read")
    def save(db,record,plan,data=None):
        if data is None:data=checked_data(record)
        record['clock']=data['markets'][record['root']]['bars'][record['cursor']]['time']+60000
        record['updated']=datetime.now(timezone.utc).isoformat()
        record['summary']=summary(record,plan)
        db.set_setting(PREFIX+record['id'],record)
    @byte_cache(4*1024*1024,entries=1)
    def chart_context(day,stamp):
        from .replay_index import four_hour_history
        return four_hour_history(ROOT/'replay-index.db',day)
    def result(record,plan,data=None,include_projection=True):
        if include_projection and not COMPACT_WIRE.get() and len(plan['frames'])>20000:
            raise HTTPException(409,'Refresh this page to load the memory-efficient replay version. Your saved session is unchanged.')
        index=ROOT/'replay-index.db'
        if data and not COMPACT_WIRE.get() and config.local and index.is_file():
            context=chart_context(record['day'],index.stat().st_mtime_ns)
            data={**data,'chart_context_version':2,'markets':{root:{**market,**({'four_hour_history_ny':context[root]} if root in context else {})} for root,market in data['markets'].items()}}
        if data and not COMPACT_WIRE.get() and not config.local and archive():
            context=archive().history(record['day'])[0]
            data={**data,'chart_context_version':2 if context.get('ny_four_hour') else 1,'markets':{root:{**market,**({'four_hour_history_ny':context['markets'][root]['four_hour_history_ny']} if context.get('ny_four_hour') else {'four_hour_history':context['markets'][root]['four_hour_history']})} for root,market in data['markets'].items()}}
        safe={k:v for k,v in record.items() if k not in ('data_digest','commands','summary')}
        safe['next_day']=next_day(record)
        safe['tick_size']=INSTRUMENTS[record['instrument']].tick_size
        safe['multiplier']=INSTRUMENTS[record['instrument']].multiplier
        wire_plan={**plan,'frames':plan['frames'].wire() if COMPACT_WIRE.get() else list(plan['frames'])} if include_projection else None
        return {'session':safe,'projection':wire_plan,**({'sample':data} if data else {})}
    def valid_cursor(record,cursor):
        if cursor<record['cursor'] or cursor>record['last_cursor']:raise HTTPException(409,'Replay only moves forward. Create a new session to restart a date.')
    @app.get('/api/backtesting/sessions')
    def sessions(member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member)
            # Discard each command log after reading its small summary. Retaining all
            # full records at once needlessly multiplies memory for long sessions.
            active=[];deleted=[]
            for sid in reversed(db.get_setting(INDEX,[])):
                row=db.get_setting(_key(sid))
                if row:(deleted if row.get('deleted') else active).append(row['summary'])
            available=catalog()
            if not config.local:
                days=sorted(available_manifest()['days'])
                if days:available.update(first_day=days[0],last_day=days[-1],sample_day=next((d for d in reversed(days) if date.fromisoformat(d).weekday()<5),days[-1]),available_days=days,**({'indexed_days':len(days)} if archive() else {}))
            return {'sessions':active, 'deleted':deleted, 'history':available}
    @app.post('/api/backtesting/sessions')
    def create(payload:SessionInput,member=Depends(workspace)):
        local_only()
        try:
            data,digest=history(payload.day.isoformat())
            root=_root(payload.instrument);bars=data['markets'][root]['bars']
            stamp=int(datetime.fromisoformat(f'{payload.day}T{payload.start_time}:00+00:00').timestamp()*1000)
            eligible=[i for i,b in enumerate(bars) if b['time']+60000<=stamp]
            if not eligible:raise ValueError('Choose a start time after the first available candle closes, or another date.')
            cursor=eligible[-1]
            if cursor>=len(bars)-1:raise ValueError('Choose an earlier start time; no candles remain to replay.')
            with app.state.workspaces.lock:
                db=database(member);ids=db.get_setting(INDEX,[])
                if len(ids)>=100:raise ValueError('This Beta supports up to 100 saved sessions.')
                now=datetime.now(timezone.utc).isoformat()
                record={'id':str(uuid4()),'name':payload.name.strip() or f'{root} · {payload.day}', 'day':payload.day.isoformat(),
                        'extended':bool(data.get('history_version')),'instrument':payload.instrument,'root':root,'capital':round(payload.capital,2),'spec':{'capital':round(payload.capital,2),
                        'instrument':payload.instrument,'commission':payload.commission,'slippage':payload.slippage,'start_cursor':cursor,'close_at_end':False},
                        'cursor':cursor,'last_cursor':len(bars)-1,'version':0,'commands':[],'data_digest':digest,'clock':stamp,'created':now,'updated':now}
                plan=projection(record,data);save(db,record,plan,data)
                db.set_setting(INDEX,ids+[record['id']]);app.state.workspaces.bump(member['key'])
                return {**result(record,plan,data),'layout':chart_defaults(db),'layout_secondary':chart_defaults(db)}
        except ValueError as e:raise HTTPException(422,str(e)) from None
    def remove_records(db,ids):
        from sqlalchemy import select
        from core.db import settings_t
        keys=[_key(sid) for sid in ids]
        with db.engine.begin() as connection:
            records={key:json.loads(value) for key,value in connection.execute(select(settings_t.c.key,settings_t.c.value).where(settings_t.c.key.in_(keys)).with_for_update())}
            if len(records)!=len(keys):raise HTTPException(404,'Session not found. Refresh your sessions before deleting.')
            raw=connection.execute(select(settings_t.c.value).where(settings_t.c.key==INDEX).with_for_update()).scalar()
            saved_ids=json.loads(raw) if raw else []
            names=[key+suffix for key in keys for suffix in ('',':layout',':layout:secondary',':journal')]
            connection.execute(settings_t.delete().where(settings_t.c.key.in_(names)))
            connection.execute(settings_t.update().where(settings_t.c.key==INDEX).values(value=json.dumps([sid for sid in saved_ids if sid not in ids])))
    @app.post('/api/backtesting/sessions/delete')
    def bulk_delete(payload:BulkDeleteInput,member=Depends(workspace)):
        local_only();ids=[str(sid) for sid in payload.ids]
        if len(set(ids))!=len(ids) or payload.confirmation!=f'DELETE {len(ids)}':raise HTTPException(422,'Type DELETE followed by the exact number of sessions.')
        with app.state.workspaces.lock:
            remove_records(database(member),ids);app.state.workspaces.bump(member['key'])
        return {'permanently_deleted':len(ids)}
    @app.delete('/api/backtesting/sessions/{sid}')
    def delete_session(sid:str,payload:PurgeInput,member=Depends(workspace)):
        return purge_session(sid,payload,member)
    @app.delete('/api/backtesting/sessions/{sid}/permanent')
    def purge_session(sid:str,payload:PurgeInput,member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member);record=db.get_setting(_key(sid))
            if not record:raise HTTPException(404,'Session not found.')
            if payload.confirmation!=record['name']:raise HTTPException(422,'Type the session name exactly to confirm permanent deletion.')
            remove_records(db,[record['id']]);app.state.workspaces.bump(member['key'])
        return {'permanently_deleted':True}
    @app.get('/api/backtesting/chart-defaults')
    def get_chart_defaults(member=Depends(workspace)):
        local_only();return chart_defaults(database(member))
    @app.put('/api/backtesting/chart-defaults')
    def set_chart_defaults(payload:LayoutInput,member=Depends(workspace)):
        local_only()
        if len(json.dumps(payload.layout))>250000 or set(payload.layout)-DEFAULT_FIELDS:raise HTTPException(422,'Choose chart preferences only, within the layout size limit.')
        with app.state.workspaces.lock:
            database(member).set_setting(DEFAULTS,payload.layout);app.state.workspaces.bump(member['key'])
        return {'saved':True}
    @app.get('/api/backtesting/sessions/{sid}/layouts')
    def session_layouts(sid:str,member=Depends(workspace)):
        local_only();db=database(member);get_record(db,sid)
        return {'layout':db.get_setting(_key(sid)+':layout',{}),'layout_secondary':db.get_setting(_key(sid)+':layout:secondary',{})}
    @app.get('/api/backtesting/sessions/{sid}')
    def open_session(sid:str,member=Depends(workspace)):
        local_only()
        try:
            with app.state.workspaces.lock:
                record=get_record(database(member),sid);data=checked_data(record)
                return {**result(record,projection(record,data),data),'layout':database(member).get_setting(_key(sid)+':layout',chart_defaults(database(member))),'layout_secondary':database(member).get_setting(_key(sid)+':layout:secondary',chart_defaults(database(member))),'journal':database(member).get_setting(_key(sid)+':journal',{})}
        except ValueError as e:raise HTTPException(422,str(e)) from None
    @app.put('/api/backtesting/sessions/{sid}/progress')
    def progress(sid:str,payload:ProgressInput,member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member);record=get_record(db,sid)
            if payload.version!=record['version']:raise HTTPException(409,'This session changed in another tab. Reopen it before continuing.')
            valid_cursor(record,payload.cursor);record['cursor']=payload.cursor;record['version']+=1
            data=checked_data(record);plan=projection(record,data);save(db,record,plan,data);app.state.workspaces.bump(member['key'])
            return {'session':result(record,plan,include_projection=False)['session']}
    @app.post('/api/backtesting/sessions/{sid}/continue')
    def continue_session(sid:str,payload:ContinueInput,member=Depends(workspace)):
        local_only()
        try:
            with app.state.workspaces.lock:
                db=database(member);record=get_record(db,sid)
                if payload.version!=record['version']:raise HTTPException(409,'This session changed in another tab. Reopen it before continuing.')
                valid_cursor(record,payload.cursor)
                record=deepcopy(record);combined=checked_data(record)
                state=projection(record,combined)['frames'][payload.cursor-record['spec']['start_cursor']]
                previous=record.get('continuation_days',[])
                last_data=history(previous[-1]['day'])[0] if previous else combined
                added=0
                for _ in range(payload.days):
                    day=next_day(record)
                    if not day:break
                    extra,digest=history(day)
                    if (state['position'] or state['order']) and extra['markets'][record['root']]['contract']!=last_data['markets'][record['root']]['contract']:
                        if added:break
                        raise ValueError('The next date changes futures contract. Close this position before starting a session in the new contract.')
                    if any(extra['markets'][root]['bars'][0]['time']<=market['bars'][-1]['time'] for root,market in combined['markets'].items()):
                        raise ValueError('The next candle file overlaps this session.')
                    combined={**combined,'markets':{root:{**market,'bars':[*market['bars'],*extra['markets'][root]['bars']]} for root,market in combined['markets'].items()}}
                    record.setdefault('continuation_days',[]).append({'day':day,'digest':digest})
                    last_data=extra;added+=1
                if not added:raise ValueError('No following trading day is loaded. Your position remains saved; it has not been closed.')
                record['cursor']=payload.cursor
                record['last_cursor']=len(combined['markets'][record['root']]['bars'])-1
                record['version']+=1
                plan=projection(record,combined);save(db,record,plan,combined);app.state.workspaces.bump(member['key'])
                return result(record,plan,combined)
        except ValueError as e:raise HTTPException(422,str(e)) from None
    @app.post('/api/backtesting/sessions/{sid}/action')
    def action(sid:str,payload:ActionInput,member=Depends(workspace)):
        local_only()
        try:
            with app.state.workspaces.lock:
                db=database(member);record=get_record(db,sid);data=checked_data(record)
                if any(c.get('event_id')==str(payload.event_id) for c in record['commands']):return result(record,projection(record,data))
                if payload.version!=record['version']:raise HTTPException(409,'This session changed in another tab. Reopen it before continuing.')
                valid_cursor(record,payload.cursor)
                if len(record['commands'])>=2000:raise ValueError('This session has reached its practice-action limit.')
                command={'at':payload.cursor,'kind':payload.kind,'event_id':str(payload.event_id)}
                if payload.kind in ('order','amend'):
                    if not payload.order:raise ValueError('Choose an order.')
                    command['order']=payload.order.model_dump(exclude_unset=payload.kind=='amend')
                record=deepcopy(record);record['commands'].append(command);record['cursor']=payload.cursor
                plan=projection(record,data);record['version']+=1;save(db,record,plan,data);app.state.workspaces.bump(member['key'])
                return result(record,plan)
        except ValueError as e:raise HTTPException(422,str(e)) from None

    @app.put('/api/backtesting/sessions/{sid}/layout')
    def layout(sid:str,payload:LayoutInput,pane:Literal['primary','secondary']='primary',defaults:bool=True,member=Depends(workspace)):
        local_only()
        if len(json.dumps(payload.layout))>250000:raise HTTPException(422,'Chart layout is too large.')
        with app.state.workspaces.lock:
            db=database(member);get_record(db,sid)
            db.set_setting(_key(sid)+(':layout:secondary' if pane=='secondary' else ':layout'),payload.layout)
            if defaults:db.set_setting(DEFAULTS,{key:value for key,value in payload.layout.items() if key in DEFAULT_FIELDS})
            app.state.workspaces.bump(member['key'])
        return {'saved':True}
    @app.post('/api/backtesting/sessions/{sid}/export')
    def export(sid:str,payload:ExportInput,member=Depends(workspace)):
        local_only()
        from .replay_transfer import transfer
        with app.state.workspaces.lock:
            db=database(member);record=get_record(db,sid)
            plan=projection(record,checked_data(record))
            trade=next((t for t in plan['trades'] if t['entry_cursor']==payload.entry_cursor and t['exit_cursor']<=record['cursor']),None)
            if not trade:raise HTTPException(422,'Save progress after this trade closes before sending it.')
            result=transfer(db,record,trade,payload.destination,payload.strategy,payload.setup.model_dump() if payload.setup else None)
            app.state.workspaces.bump(member['key']);return result

    @app.get('/api/backtesting/sessions/{sid}/chart-history')
    def chart_history(sid:str,root:Literal['NQ','ES'],timeframe:str,cursor:int,before:int|None=None,after:int|None=None,limit:int=750,member=Depends(workspace)):
        local_only()
        if timeframe not in ('1D','1W','1M') and (not timeframe.isdigit() or not 1<=int(timeframe)<=720):raise HTTPException(422,'Unsupported timeframe.')
        if not 1<=limit<=1000:raise HTTPException(422,'Choose a page size between 1 and 1000.')
        # Authorise the session under the workspace lock; read public price files outside it.
        with app.state.workspaces.lock:
            record=get_record(database(member),sid)
            if not record['spec']['start_cursor']<=cursor<=record['last_cursor']:raise HTTPException(422,'Invalid replay cursor.')
            data=checked_data(record)
            cutoff=data['markets'][record['root']]['bars'][cursor]['time']
        edge=min(before if before is not None else cutoff+1,cutoff+1)
        index=ROOT/'replay-index.db'
        try:
            if config.local and index.is_file():
                from .replay_chart_windows import window
                return window(str(index),index.stat().st_mtime_ns,root,timeframe,edge,cutoff,limit,after)
            if archive():return archive().chart_window(root,timeframe,edge,cutoff,limit,after)
            raise ValueError('Full chart history has not been configured on this server.')
        except (ValueError,OSError) as exc:raise HTTPException(422,str(exc)) from None

    @app.post('/api/backtesting/sessions/{sid}/ticket-preview')
    def ticket_preview(sid:str,payload:TicketPreviewInput,member=Depends(workspace)):
        local_only()
        from services.replay_engine import ticket_result
        with app.state.workspaces.lock:
            record=get_record(database(member),sid);valid_cursor(record,payload.cursor)
            plan=projection(record,checked_data(record));ticket=plan['frames'][payload.cursor-record['spec']['start_cursor']]['ticket']
            if not ticket:raise HTTPException(422,'No active ticket.')
            return {'amount':ticket_result(ticket['reference'],payload.price,ticket['side'],ticket['qty'],record['instrument'])}
    @app.put('/api/backtesting/sessions/{sid}/journal')
    def journal(sid:str,payload:JournalInput,member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member);get_record(db,sid);db.set_setting(_key(sid)+':journal',payload.model_dump());app.state.workspaces.bump(member['key'])
        return {'saved':True}
