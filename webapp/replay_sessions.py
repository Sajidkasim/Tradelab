"""Private replay sessions. Hosted history is explicitly enabled and read from R2."""
from copy import deepcopy
from datetime import date, datetime, timezone
from functools import lru_cache
from hashlib import sha256
import json
from pathlib import Path
import threading
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

class ActionInput(ProgressInput):
    kind:Literal['order','cancel','close','amend']
    event_id:UUID
    order:OrderInput|None=None

def _root(instrument):return 'NQ' if instrument in ('MNQ','NQ') else 'ES'
def _key(sid):
    try:return PREFIX+str(UUID(sid))
    except (ValueError,TypeError):raise HTTPException(404,'Session not found.') from None

@lru_cache(maxsize=8)
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

def projection(record,data):return project(data['markets'][record['root']]['bars'],record['spec'],record['commands'])
def snapshot(record,plan):return plan['frames'][record['cursor']-record['spec']['start_cursor']]
def summary(record,plan):
    return {k:record[k] for k in ('id','name','day','instrument','root','capital','cursor','version','created','updated')} | {
        'equity':snapshot(record,plan)['equity'],'closed':sum(t['exit_cursor']<=record['cursor'] for t in plan['trades']),
        'clock':record['clock'],'finished':record['cursor']==record['last_cursor']}

def mount(app,config,workspace):
    def database(member): return app.state.workspaces.database(member["key"])
    def local_only():
        if not config.local and not getattr(config,'replay_enabled',False):raise HTTPException(404)
    @lru_cache(maxsize=2)
    def hosted_bundle(digest):
        # Immutable prices can be shared; private session/position data is never cached here.
        from .replay_history_storage import HistoryStorage
        connection=app.state.image_storage
        return HistoryStorage(ROOT,connection.client,config.r2_bucket).read(digest)
    def history(day):
        if config.local:return load_history(day)
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
    def checked_data(record):
        try:
            old=ROOT/'replay-history'/f"{record['day']}.json"
            data,digest=(_read(str(old),old.stat().st_mtime_ns) if config.local and record.get('extended') and old.is_file() and sha256(old.read_bytes()).hexdigest()==record['data_digest'] else (history if record.get('extended') else load_sample)(record['day']))
        except (ValueError,OSError):raise HTTPException(422,'The saved candle file is unavailable. Restore the local data before reopening this session.') from None
        if digest!=record['data_digest']:raise HTTPException(409,'The candle file changed. Start a new session to use the new data.')
        if record.get('continuation_days'):
            data={**data,'markets':{root:{**market,'bars':list(market['bars'])} for root,market in data['markets'].items()}}
            for segment in record['continuation_days']:
                extra,signature=history(segment['day'])
                if signature!=segment['digest']:raise HTTPException(409,'Saved continuation candles changed. Restore the original data.')
                for root,market in data['markets'].items():
                    market['bars'].extend(extra['markets'][root]['bars'])
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
        else:available=sorted(json.loads(Path(config.replay_manifest).read_text())['days'])
        following=next((day for day in available if day>last),None)
        # Never bridge years between isolated hosted samples as an overnight gap.
        return following if following and (date.fromisoformat(following)-date.fromisoformat(last)).days<=7 else None
    def save(db,record,plan):
        data=checked_data(record)
        record['clock']=data['markets'][record['root']]['bars'][record['cursor']]['time']+60000
        record['updated']=datetime.now(timezone.utc).isoformat()
        record['summary']=summary(record,plan)
        db.set_setting(PREFIX+record['id'],record)
    @lru_cache(maxsize=2)
    def chart_context(day,stamp):
        from .replay_index import four_hour_history
        return four_hour_history(ROOT/'replay-index.db',day)
    def result(record,plan,data=None):
        index=ROOT/'replay-index.db'
        if data and config.local and index.is_file():
            context=chart_context(record['day'],index.stat().st_mtime_ns)
            data={**data,'chart_context_version':1,'markets':{root:{**market,**({'four_hour_history':context[root]} if root in context else {})} for root,market in data['markets'].items()}}
        safe={k:v for k,v in record.items() if k not in ('data_digest','commands','summary')}
        safe['next_day']=next_day(record)
        return {'session':safe,'projection':plan,**({'sample':data} if data else {})}
    def valid_cursor(record,cursor):
        if cursor<record['cursor'] or cursor>record['last_cursor']:raise HTTPException(409,'Replay only moves forward. Create a new session to restart a date.')
    @app.get('/api/backtesting/sessions')
    def sessions(member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member)
            rows=[db.get_setting(PREFIX+sid) for sid in db.get_setting(INDEX,[])]
            available=catalog()
            if not config.local:
                days=sorted(json.loads(Path(config.replay_manifest).read_text())['days'])
                if days:available.update(first_day=days[0],last_day=days[-1],sample_day=days[-1],available_days=days)
            return {'sessions':[row['summary'] for row in reversed(rows) if row and not row.get('deleted')], 'deleted':[row['summary'] for row in reversed(rows) if row and row.get('deleted')], 'history':available}
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
                plan=projection(record,data);save(db,record,plan)
                db.set_setting(INDEX,ids+[record['id']]);app.state.workspaces.bump(member['key'])
                return result(record,plan,data)
        except ValueError as e:raise HTTPException(422,str(e)) from None
    @app.delete('/api/backtesting/sessions/{sid}')
    def delete_session(sid:str,member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member);record=get_record(db,sid)
            record['deleted']=True;db.set_setting(_key(sid),record);app.state.workspaces.bump(member['key'])
            return {'deleted':True}
    @app.post('/api/backtesting/sessions/{sid}/restore')
    def restore_session(sid:str,member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member);record=db.get_setting(_key(sid))
            if not record:raise HTTPException(404,'Session not found.')
            record.pop('deleted',None);db.set_setting(_key(sid),record);app.state.workspaces.bump(member['key'])
            return {'restored':True}
    @app.get('/api/backtesting/sessions/{sid}')
    def open_session(sid:str,member=Depends(workspace)):
        local_only()
        try:
            with app.state.workspaces.lock:
                record=get_record(database(member),sid);data=checked_data(record)
                return {**result(record,projection(record,data),data),'layout':database(member).get_setting(_key(sid)+':layout',{}),'layout_secondary':database(member).get_setting(_key(sid)+':layout:secondary',{}),'journal':database(member).get_setting(_key(sid)+':journal',{})}
        except ValueError as e:raise HTTPException(422,str(e)) from None
    @app.put('/api/backtesting/sessions/{sid}/progress')
    def progress(sid:str,payload:ProgressInput,member=Depends(workspace)):
        local_only()
        with app.state.workspaces.lock:
            db=database(member);record=get_record(db,sid)
            if payload.version!=record['version']:raise HTTPException(409,'This session changed in another tab. Reopen it before continuing.')
            valid_cursor(record,payload.cursor);record['cursor']=payload.cursor;record['version']+=1
            plan=projection(record,checked_data(record));save(db,record,plan);app.state.workspaces.bump(member['key'])
            return {'session':result(record,plan)['session']}
    @app.post('/api/backtesting/sessions/{sid}/continue')
    def continue_session(sid:str,payload:ProgressInput,member=Depends(workspace)):
        local_only()
        try:
            with app.state.workspaces.lock:
                db=database(member);record=get_record(db,sid)
                if payload.version!=record['version']:raise HTTPException(409,'This session changed in another tab. Reopen it before continuing.')
                valid_cursor(record,payload.cursor)
                day=next_day(record)
                if not day:raise ValueError('No following trading day is loaded. Your position remains saved; it has not been closed.')
                data=checked_data(record);extra,digest=history(day)
                # Carry the actual contract, never a synthetic rollover price jump.
                previous=record.get('continuation_days',[])
                last_data=history(previous[-1]['day'])[0] if previous else data
                state=projection(record,data)['frames'][payload.cursor-record['spec']['start_cursor']]
                if (state['position'] or state['order']) and extra['markets'][record['root']]['contract']!=last_data['markets'][record['root']]['contract']:
                    raise ValueError('The next date changes futures contract. Close this position before starting a session in the new contract.')
                for root,market in data['markets'].items():
                    if extra['markets'][root]['bars'][0]['time']<=market['bars'][-1]['time']:
                        raise ValueError('The next candle file overlaps this session.')
                record=deepcopy(record)
                record.setdefault('continuation_days',[]).append({'day':day,'digest':digest})
                record['cursor']=payload.cursor
                combined=checked_data(record)
                record['last_cursor']=len(combined['markets'][record['root']]['bars'])-1
                record['version']+=1
                plan=projection(record,combined);save(db,record,plan);app.state.workspaces.bump(member['key'])
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
                    command['order']=payload.order.model_dump()
                record=deepcopy(record);record['commands'].append(command);record['cursor']=payload.cursor
                plan=projection(record,data);record['version']+=1;save(db,record,plan);app.state.workspaces.bump(member['key'])
                return result(record,plan)
        except ValueError as e:raise HTTPException(422,str(e)) from None

    @app.put('/api/backtesting/sessions/{sid}/layout')
    def layout(sid:str,payload:LayoutInput,pane:Literal['primary','secondary']='primary',member=Depends(workspace)):
        local_only()
        if len(json.dumps(payload.layout))>250000:raise HTTPException(422,'Chart layout is too large.')
        with app.state.workspaces.lock:
            db=database(member);get_record(db,sid)
            db.set_setting(_key(sid)+(':layout:secondary' if pane=='secondary' else ':layout'),payload.layout);app.state.workspaces.bump(member['key'])
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
