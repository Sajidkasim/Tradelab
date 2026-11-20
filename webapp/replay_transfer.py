"""Explicit, repeat-safe replay transfer. Existing DB code computes recorded trade values."""
from datetime import datetime,timezone
from uuid import uuid5,NAMESPACE_URL
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from core.models import Trade,Direction,Source
from services.replay_engine import INSTRUMENTS
from . import custom_trade_fields,daily_journal,journal_preferences

def transfer(db,record,trade,destination,strategy,setup=None):
    from core import edge
    research=setup if setup is not None else db.get_setting('primus_replay:'+record['id']+':journal',{})
    labels=edge.write_labels(['primus:replay'],level=research.get('level',''),timeframe=research.get('timeframe',''),condition=research.get('condition',''),news=research.get('news',''),entry_timeframe=research.get('entry_timeframe','Not recorded'),confirmations=[x.strip() for x in research.get('checklist',[]) if x.strip()])
    selected = research.get('custom_fields')
    if setup is None and selected:
        active = {field['id'] for field in custom_trade_fields.definitions(db)}
        selected = {key: value for key, value in selected.items() if key in active}
    custom_metadata = custom_trade_fields.merge({}, db, selected)
    external=f"replay:{record['id']}:{trade['entry_cursor']}"
    card_id=uuid5(NAMESPACE_URL,external).hex
    entry=datetime.fromtimestamp(trade['entry_time']/1000,timezone.utc)
    end=datetime.fromtimestamp(trade['exit_time']/1000,timezone.utc)
    local=entry.astimezone(ZoneInfo(journal_preferences.read(db)['timezone']));day=local.date().isoformat()
    journal=daily_journal.entry(db,day)
    if destination in ('journal','both') and len(journal['trades'])>=30 and not any(c['id']==card_id for c in journal['trades']):raise HTTPException(422,'This Journal day already has 30 trades.')
    existing = db.get_trade_by_external_id(external)
    lab_id = int(existing.id) if existing is not None and existing.id is not None else None
    if destination in ('lab','both') and lab_id is None:
        instrument=INSTRUMENTS[record['instrument']];stop=trade.get('original_stop')
        if stop is not None and (trade['entry']-stop)*(1 if trade['side']=='buy' else -1)<=0:stop=None
        t=Trade(symbol=record['instrument'],direction=Direction.LONG if trade['side']=='buy' else Direction.SHORT,qty=trade['qty'],entry_time=entry,exit_time=end,entry_price=trade['entry'],exit_price=trade['exit'],stop_price=stop,multiplier=instrument.multiplier,fees=trade['fees'],source=Source.BACKTEST,external_id=external,account_id=db.accounts()[0].id,setup_name=strategy.strip(),tags=labels,notes=f"Replay session: {record['name']}. Simulated fills; {trade['reason']}.\n{research.get('notes','')}")
        t.custom_metadata = custom_metadata
        db.insert_trades([t])
        saved_trade = db.get_trade_by_external_id(external)
        lab_id = int(saved_trade.id) if saved_trade is not None and saved_trade.id is not None else None
    if destination in ('journal','both'):
        cards=[c for c in journal['trades'] if c['id']!=card_id]
        old=next((c for c in journal['trades'] if c['id']==card_id),{})
        card={**old,'id':card_id,'symbol':record['instrument'],'direction':'long' if trade['side']=='buy' else 'short','strategy':strategy.strip(),'time':local.strftime('%H:%M'),'source':'backtest','notes':old.get('notes',research.get('notes') or f"Replay: {record['name']}"),'net_pnl':trade['net'],'outcome':daily_journal.outcome(trade['net']),'level':research.get('level') or 'Not recorded','timeframe':research.get('timeframe') or 'Not recorded','entry_timeframe':research.get('entry_timeframe') or 'Not recorded','risk_amount':None,'confirmations':old.get('confirmations',research.get('checklist',[])),'lab_trade_id':lab_id}
        if not lab_id:
            card['custom_fields'] = custom_trade_fields.merge(old.get('custom_fields') or {}, db, selected)
        if lab_id:card.update(daily_journal.trade_snapshot(db,lab_id) or {})
        daily_journal.save(db,day,{'trades':cards+[card]})
    return {'lab_trade_id':lab_id,'journal_day':day if destination in ('journal','both') else None}
