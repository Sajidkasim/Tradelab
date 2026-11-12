"""Private Journal replay routes. Disabled provider access until explicitly authorised."""
from datetime import datetime, timedelta, timezone
from threading import BoundedSemaphore
import os
import json
import re
from fastapi import Depends, HTTPException, Request, UploadFile, File, Form, Query
from services import journal_replay as replay
from . import journal_replay_providers as providers

KEY='journal_replay_records:v1'


def mount(app, config, workspace):
    workers=BoundedSemaphore(2)

    def database(member):return app.state.workspaces.database(member['key'])

    def record(member, reference):
        db=database(member)
        if reference.startswith('lab-'):
            try:trade=db.get_trade(int(reference[4:]))
            except ValueError:trade=None
            if trade is None:raise HTTPException(404,'Trade not found in your workspace.')
            return replay.from_trade(trade)
        row=db.get_setting(KEY,{}).get(reference)
        if not row:raise HTTPException(404,'Replay trade not found in your workspace.')
        return row

    @app.get('/api/journal-replay')
    def listing(member=Depends(workspace)):
        return list(database(member).get_setting(KEY,{}).values())

    @app.post('/api/journal-replay/import')
    def import_executions(file: UploadFile=File(...), source_timezone: str=Form(''), member=Depends(workspace)):
        try:rows=replay.parse_executions(file.file.read(1024*1024+1),source_timezone)
        except Exception as exc:
            raise HTTPException(422,str(exc) if isinstance(exc,ValueError) else 'Invalid file or timezone. Choose an explicit IANA export timezone.') from None
        with app.state.workspaces.workspace_lock(member['key']):
            db=database(member)
            stored=db.get_setting(KEY,{})
            inserted=0
            for row in rows:
                if row['id'] in stored:
                    if stored[row['id']]!=row:raise HTTPException(409,'This trade ID already exists with different executions. No records changed.')
                else:stored[row['id']]=row;inserted+=1
            if len(stored)>1000 or sum(len(r['executions']) for r in stored.values())>10000:raise HTTPException(422,'Up to 1,000 trades and 10,000 executions per replay workspace.')
            if len(json.dumps(stored))>5*1024*1024:raise HTTPException(422,'Replay metadata storage limit reached (5 MB).')
            db.set_setting(KEY,stored) # one atomic settings write; no financial tables modified
            app.state.workspaces.bump(member['key'])
        return {'inserted':inserted,'skipped':len(rows)-inserted}

    @app.get('/api/journal-replay/{reference}')
    def detail(reference:str, member=Depends(workspace)):
        return record(member,reference)

    @app.get('/api/journal-replay/{reference}/candles')
    def candles(reference:str, start:int=Query(...,ge=0,le=4102444800000), member=Depends(workspace)):
        row=record(member,reference)
        provider=row['provider']
        if provider=='unavailable':raise HTTPException(422,'No verified candle mapping is configured for this broker symbol. Your imported trade is preserved; no substitute instrument was used.')
        prefix='JOURNAL_REPLAY_'+provider.upper()
        allowed={s.strip() for s in os.getenv(prefix+'_WORKSPACES','').split(',') if s.strip()}
        if os.getenv(prefix+'_APPROVED')!='1' or member['key'] not in allowed:
            raise HTTPException(503,'This candle source is not enabled for your workspace. Provider access and display permission must be configured first.')
        first=datetime.fromisoformat(row['executions'][0]['time'])
        last=datetime.fromisoformat(row['executions'][-1]['time'])
        begin=datetime.fromtimestamp(start/1000,timezone.utc)
        if not first-timedelta(days=1)<=begin<=last+timedelta(days=1):
            raise HTTPException(422,'Request a candle window around this trade.')
        end=min(begin+timedelta(minutes=750),last+timedelta(days=1),datetime.now(timezone.utc))
        retry = app.state.rate_counters.consume(f"journal-candles:{member['key']}", limit=20)
        if retry:
            raise HTTPException(429, 'Wait a minute before requesting more candle history.',
                                headers={'Retry-After': str(retry)})
        if not workers.acquire(blocking=False):raise HTTPException(429,'Candle providers are busy. Retry shortly.')
        try:
            bars=providers.validate_bars(getattr(providers,provider)(row['symbol'],begin,end)) if begin<end else []
            bars=sorted({b['time']:b for b in bars if start<=b['time']<end.timestamp()*1000}.values(),key=lambda b:b['time'])[:750]
        except Exception:
            raise HTTPException(502,'The candle provider could not supply this window. Check account access, exact contract and history coverage.') from None
        finally:workers.release()
        return {'bars':bars,'next':int(end.timestamp()*1000) if end<last+timedelta(days=1) and end<datetime.now(timezone.utc) else None,
                'provider':provider,'resolution':'1 minute','warning':'Reference candles can differ from your execution feed. Minute bars do not reproduce intraminute movement.'}
