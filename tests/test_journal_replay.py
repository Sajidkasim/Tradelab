"""Synthetic fixtures only; never insert into the user's journal."""
from datetime import datetime, timezone
import lzma
import struct
import pytest
from services.journal_replay import parse_executions, utc, instrument
from webapp.journal_replay_providers import decode_candles
from tests.test_daily_journal import draft, login

CSV=b'trade_id,execution_id,symbol,timestamp,side,quantity,price,role\nt1,a,EURUSD,2024-05-15T08:30:00-04:00,buy,1,1.08,entry\nt1,b,EURUSD,2024-05-15T09:00:00-04:00,sell,0.5,1.09,exit\nt1,c,EURUSD,2024-05-15T09:15:00-04:00,sell,0.5,1.10,exit\n'

def test_timezones_and_contracts():
    assert utc('2024-05-15 08:30','America/New_York').startswith('2024-05-15T12:30')
    assert utc('2024-01-15 08:30','America/New_York').startswith('2024-01-15T13:30')
    with pytest.raises(ValueError):utc('2024-05-15 08:30')
    with pytest.raises(Exception):utc('2024-11-03 01:30','America/New_York')
    with pytest.raises(Exception):utc('2024-03-10 02:30','America/New_York')
    assert instrument('CON.F.US.NQ.Z26')==('projectx','CON.F.US.NQ.Z26')
    with pytest.raises(ValueError):instrument('NQ')
    with pytest.raises(ValueError):instrument('NAS100')


def test_partial_executions_and_duplicate_ids():
    row=parse_executions(CSV,'')[0]
    assert len(row['executions'])==3
    assert row['executions'][1]['quantity']=='0.5'
    assert row['executions'][0]['time']=='2024-05-15T12:30:00+00:00'
    assert len(parse_executions(CSV+CSV.splitlines()[-1]+b'\n','')[0]['executions'])==3
    with pytest.raises(ValueError):parse_executions(CSV+CSV.splitlines()[-1].replace(b'1.10',b'1.11')+b'\n','')


def test_duka_decoder():
    day=datetime(2024,5,15,tzinfo=timezone.utc)
    data=lzma.compress(struct.pack('>5If',60,108000,108100,107900,108200,12.0))
    bar=decode_candles(data,day,'EURUSD')[0]
    assert bar['time']==int(day.timestamp()*1000)+60000
    assert bar['open']==1.08 and bar['close']==1.081 and bar['low']==1.079
    with pytest.raises(ValueError):decode_candles(lzma.compress(b'bad'),day,'EURUSD')


def test_private_import_atomic_duplicates_and_provider_gate(draft,monkeypatch):
    client,app,state=draft
    assert client.get('/api/journal-replay').status_code==401
    login(client,state)
    before=client.get('/api/trades').json()
    def upload(content=CSV):return client.post('/api/journal-replay/import',files={'file':('execution.csv',content,'text/csv')},data={'source_timezone':''})
    assert upload().json()=={'inserted':1,'skipped':0}
    assert upload().json()=={'inserted':0,'skipped':1}
    assert upload(CSV.replace(b'1.10',b'1.11')).status_code==409
    row=client.get('/api/journal-replay').json()[0]
    url='/api/journal-replay/'+row['id']
    assert client.get(url).json()['executions'][-1]['price']=='1.10'
    start=1715774400000
    assert client.get(url+'/candles',params={'start':start}).status_code==503
    monkeypatch.setenv('JOURNAL_REPLAY_DUKASCOPY_APPROVED','1')
    monkeypatch.setenv('JOURNAL_REPLAY_DUKASCOPY_WORKSPACES','owner')
    monkeypatch.setattr('webapp.journal_replay_providers.dukascopy',lambda *a:[{'time':start,'open':1,'high':1,'low':1,'close':1,'volume':0}])
    response=client.get(url+'/candles',params={'start':start})
    assert response.status_code==200 and len(response.json()['bars'])==1
    assert client.get(url+'/candles',params={'start':0}).status_code==422
    monkeypatch.setattr('webapp.journal_replay_providers.dukascopy',lambda *a:[])
    assert client.get(url+'/candles',params={'start':start}).json()['bars']==[]
    monkeypatch.setattr('webapp.journal_replay_providers.dukascopy',lambda *a:[{'time':start,'open':float('nan'),'high':1,'low':1,'close':1,'volume':0}])
    assert client.get(url+'/candles',params={'start':start}).status_code==502
    assert client.get('/api/trades').json()==before
    client.post('/api/logout')
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/journal-replay').json()==[]
    assert client.get(url).status_code==404
    assert client.get(url+'/candles',params={'start':start}).status_code==404


def test_saved_lab_trade_storage_timezone_and_no_fabricated_partials():
    from core.models import Trade, Direction
    from services.journal_replay import from_trade
    trade=Trade(symbol='CON.F.US.NQ.Z26',direction=Direction.LONG,qty=2,
                entry_time=datetime(2026,11,2,14,30),entry_price=20000,
                exit_time=datetime(2026,11,2,15,0),exit_price=20010)
    row=from_trade(trade)
    assert row['executions'][0]['time']=='2026-11-02T14:30:00+00:00'
    assert len(row['executions'])==2 and 'Aggregate' in row['warning']
    assert row['symbol']=='CON.F.US.NQ.Z26'
    assert trade.net_pnl is None

# Anonymised fixtures matching the supplied schemas; no real account/ticket data.
TOPSTEP=b'Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,TradeDuration,Commissions\nsynthetic-1,MNQZ6,11/10/2026 15:23:22 +00:00,11/10/2026 15:24:05 +00:00,20000.250000,20001.500000,0.72,2.50,1,Long,11/10/2026 00:00:00 -06:00,00:00:43,0.50\n'
FTMO=b'Ticket,Open,Type,Volume,Symbol,Price,SL,TP,Close,Price,Swap,Commissions,Profit,Pips,Trade duration in seconds,MAE Pip,MAE,MAE Time,MFE Pip,MFE,MFE Time\nsynthetic-2,2026-06-05 18:23:30,buy,1,XAUUSD,2300.1200,0,0,2026-06-05 18:23:39,2301.3400,0,-2,10,12,9,-1,2299,2026-06-05 18:23:38,2,2302,2026-06-05 18:23:30\n'


def test_topstep_native_contract_date_and_original_money_preserved():
    row=parse_executions(TOPSTEP,'')[0]
    assert row['symbol']=='CON.F.US.MNQ.Z26'
    assert row['executions'][0]['time']=='2026-11-10T15:23:22+00:00'
    assert row['executions'][0]['price']=='20000.250000'
    assert row['executions'][1]['price']=='20001.500000'
    original=dict(zip(row['original_report_row']['columns'],row['original_report_row']['values']))
    assert original['PnL']=='2.50' and original['Fees']=='0.72' and original['Commissions']=='0.50'
    assert len(row['executions'])==2


def test_ftmo_native_duplicate_price_columns_and_timezone_guard():
    with pytest.raises(ValueError,match='website export has no timezone'):parse_executions(FTMO,'')
    # Explicit synthetic test timezone; not a claim about the user's export clock.
    row=parse_executions(FTMO,'Etc/GMT-3')[0]
    assert row['executions'][0]['time']=='2026-06-05T15:23:30+00:00'
    assert row['executions'][0]['price']=='2300.1200'
    assert row['executions'][1]['price']=='2301.3400'
    assert row['original_report_row']['columns'].count('Price')==2
    assert row['provider']=='dukascopy'
    unsupported=parse_executions(FTMO.replace(b'XAUUSD',b'US100.cash'),'UTC')[0]
    assert unsupported['provider']=='unavailable' and unsupported['symbol']=='US100.cash'
    assert len(unsupported['executions'])==2


def test_native_import_atomic_and_repeat_safe(draft):
    client,app,state=draft
    login(client,state)
    def upload(content,zone=''):
        return client.post('/api/journal-replay/import',files={'file':('native.csv',content,'text/csv')},data={'source_timezone':zone})
    assert upload(TOPSTEP).json()=={'inserted':1,'skipped':0}
    assert upload(TOPSTEP).json()=={'inserted':0,'skipped':1}
    assert upload(FTMO).status_code==422
    assert len(client.get('/api/journal-replay').json())==1
    assert upload(FTMO,'UTC').json()=={'inserted':1,'skipped':0}
    assert len(client.get('/api/journal-replay').json())==2


def test_ftmo_platform_clock_seasonal_offsets():
    assert utc('2026-06-05 18:23:30','FTMO_MT5')=='2026-06-05T15:23:30+00:00'
    assert utc('2026-11-10 18:23:30','FTMO_MT5')=='2026-11-10T16:23:30+00:00'
    assert utc('2026-03-16 18:23:30','FTMO_MT5')=='2026-03-16T15:23:30+00:00'
    assert utc('2026-10-28 18:23:30','FTMO_MT5')=='2026-10-28T15:23:30+00:00'
    with pytest.raises(ValueError):utc('2026-11-01 08:30:00','FTMO_MT5')
    with pytest.raises(ValueError):utc('2026-03-08 09:30:00','FTMO_MT5')
