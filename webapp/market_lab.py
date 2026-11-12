"""Small research runs through the existing core.backtest engine, not replay orders."""
from datetime import date, datetime, timezone
from typing import Literal
from uuid import uuid4
import threading
import pandas as pd
from pydantic import Field, model_validator
from fastapi import Depends, HTTPException
from .schemas import StrictModel
from .workspaces import clean
from core.backtest import BacktestConfig, run_backtest
from services.replay_engine import INSTRUMENTS
from strategies.example_orb import generate_signals

RUNS='primus_market_runs_v1'
class ScanInput(StrictModel):
    instrument:Literal['NQ','ES']='NQ'
    start:date
    end:date
    interval:Literal['1','5','15','30','60']='5'
    capital:float=Field(default=50000,gt=0,le=1000000000)
    contracts:int=Field(default=1,ge=1,le=10,strict=True)
    commission:float=Field(default=1,ge=0,le=100)
    slippage:int=Field(default=0,ge=0,le=20,strict=True)
    opening_minutes:int=Field(default=15,ge=5,le=120,strict=True)
    session_start:str=Field(default='09:30',pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    target_r:float=Field(default=2,gt=0,le=10)
    @model_validator(mode='after')
    def bounded(self):
        if not 0<=(self.end-self.start).days<=9:raise ValueError('Choose up to 10 calendar days, in date order.')
        if self.opening_minutes%int(self.interval) or self.opening_minutes<int(self.interval):raise ValueError('The opening range must be a multiple of the chart interval.')
        return self

def execute(payload,days,load_day):
    if not days or payload.start.isoformat()<days[0] or payload.end.isoformat()>days[-1]:raise ValueError('Choose dates inside the available history.')
    selected=[d for d in days if payload.start.isoformat()<=d<=payload.end.isoformat()]
    if not selected:raise ValueError('No prepared trading days in this range.')
    raw=[];contracts=set()
    for day in selected:
        market=load_day(day,payload.instrument)
        if not market or not market.get('bars'):raise ValueError('A selected trading day is missing. Choose a shorter prepared range.')
        contracts.add(market['contract']);raw.extend(market['bars'])
        if len(raw)>16000:raise ValueError('This range is too large. Choose fewer days.')
    if len(contracts)>1:raise ValueError('This range crosses a futures contract roll. Test each contract separately.')
    frame=pd.DataFrame(raw).rename(columns=dict(time='t',open='o',high='h',low='l',close='c',volume='v'))
    if frame.t.duplicated().any():raise ValueError('Duplicate candle times found; the run has been stopped.')
    frame['t']=pd.to_datetime(frame.t,unit='ms',utc=True).dt.tz_convert('America/New_York').dt.tz_localize(None)
    frame=frame.set_index('t').sort_index().resample(f'{payload.interval}min').agg({'o':'first','h':'max','l':'min','c':'last','v':'sum'}).dropna().reset_index()
    instrument=INSTRUMENTS[payload.instrument]
    cfg=BacktestConfig(symbol=payload.instrument,multiplier=instrument.multiplier,tick_size=instrument.tick_size,
                       commission_per_contract=payload.commission,slippage_ticks=payload.slippage,starting_balance=payload.capital,contracts=payload.contracts)
    params={'or_minutes':payload.opening_minutes,'session_start':payload.session_start,'target_r':payload.target_r}
    result=run_backtest(frame,generate_signals,params,cfg,strategy_name='Built-in Opening Range Breakout')
    return clean({'id':uuid4().hex,'created_at':datetime.now(timezone.utc).isoformat(),'settings':payload.model_dump(mode='json'),
                  'strategy':'Built-in Opening Range Breakout','stats':result.stats,'trading_days':len(selected),'prepared_dates':selected,
                  'candles':len(frame),'first_candle':str(frame.t.iloc[0]),'last_candle':str(frame.t.iloc[-1]),'timezone':'America/New_York',
                  'contract':next(iter(contracts))})

def mount(app,config,workspace,available_days,load_day):
    gate=threading.Lock()
    def enabled():
        if not config.local and not config.replay_enabled:raise HTTPException(404,'Historical testing is not enabled on this server.')
    @app.get('/api/market-lab')
    def catalog(member=Depends(workspace)):
        enabled();days=available_days()
        with app.state.workspaces.workspace_lock(member['key']):history=app.state.workspaces.database(member['key']).get_setting(RUNS,[])
        return {'days':days,'instruments':['NQ','ES'],'intervals':['1','5','15','30','60'],'runs':history,'max_calendar_days':10}
    @app.post('/api/market-lab/run')
    def run(payload:ScanInput,member=Depends(workspace)):
        enabled()
        if not gate.acquire(blocking=False):raise HTTPException(429,'A research run is already in progress. Try again shortly.')
        try:
            value=execute(payload,available_days(),load_day)
            with app.state.workspaces.workspace_lock(member['key']):
                db=app.state.workspaces.database(member['key']);db.set_setting(RUNS,[value,*db.get_setting(RUNS,[])][:30]);app.state.workspaces.bump(member['key'])
            return value
        finally:gate.release()
