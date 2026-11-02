"""Explicit, repeat-safe replay transfer. Existing DB code computes recorded trade values."""
from datetime import datetime,timezone
from uuid import uuid5,NAMESPACE_URL
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from core.models import Trade,Direction,Source
from services.replay_engine import INSTRUMENTS
from . import daily_journal,journal_preferences

def transfer(db,record,trade,destination,strategy):
    external=f"replay:{record['id']}:{trade['entry_cursor']}"
    card_id=uuid5(NAMESPACE_URL,external).hex
    entry=datetime.fromtimestamp(trade['entry_time']/1000,timezone.utc)
    end=datetime.fromtimestamp(trade['exit_time']/1000,timezone.utc)
    local=entry.astimezone(ZoneInfo(journal_preferences.read(db)['timezone']));day=local.date().isoformat()
    journal=daily_journal.entry(db,day)
    if destination in ('journal','both') and len(journal['trades'])>=30 and not any(c['id']==card_id for c in journal['trades']):raise HTTPException(422,'This Journal day already has 30 trades.')
    frame=db.trades_df();matches=frame[frame.external_id==external] if not frame.empty else frame
    lab_id=int(matches.iloc[0].id) if not matches.empty else None
    if destination in ('lab','both') and lab_id is None:
        instrument=INSTRUMENTS[record['instrument']];stop=trade.get('original_stop')
        if stop is not None and (trade['entry']-stop)*(1 if trade['side']=='buy' else -1)<=0:stop=None
        t=Trade(symbol=record['instrument'],direction=Direction.LONG if trade['side']=='buy' else Direction.SHORT,qty=trade['qty'],entry_time=entry,exit_time=end,entry_price=trade['entry'],exit_price=trade['exit'],stop_price=stop,multiplier=instrument.multiplier,fees=trade['fees'],source=Source.BACKTEST,external_id=external,account_id=db.accounts()[0].id,setup_name=strategy.strip(),tags=['primus:replay'],notes=f"Replay session: {record['name']}. Simulated fills; {trade['reason']}.")
        db.insert_trades([t]);lab_id=int(db.trades_df().query('external_id == @external').iloc[0].id)
    if destination in ('journal','both'):
        cards=[c for c in journal['trades'] if c['id']!=card_id]
        old=next((c for c in journal['trades'] if c['id']==card_id),{})
        card={**old,'id':card_id,'symbol':record['instrument'],'direction':'long' if trade['side']=='buy' else 'short','strategy':strategy.strip(),'time':local.strftime('%H:%M'),'source':'backtest','notes':old.get('notes',f"Replay: {record['name']}"),'net_pnl':trade['net'],'outcome':daily_journal.outcome(trade['net']),'level':'Not recorded','timeframe':'Not recorded','entry_timeframe':'Not recorded','risk_amount':None,'confirmations':old.get('confirmations',[]),'lab_trade_id':lab_id}
        if lab_id:card.update(daily_journal.trade_snapshot(db,lab_id) or {})
        daily_journal.save(db,day,{'trades':cards+[card]})
    return {'lab_trade_id':lab_id,'journal_day':day if destination in ('journal','both') else None}
