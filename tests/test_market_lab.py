from datetime import date
import pytest
from pydantic import ValidationError
from webapp.market_lab import ScanInput,execute,RUNS
from tests.test_google_access import google,login
from webapp import replay_sessions


def prices(day,root):
    from datetime import datetime,timezone
    start=int(datetime.fromisoformat(day+'T14:30:00').replace(tzinfo=timezone.utc).timestamp()*1000)
    return {'contract':root+'Z6','bars':[{'time':start+i*60000,'open':100+i/10,'high':101+i/10,'low':99+i/10,'close':100.5+i/10,'volume':100} for i in range(60)]}

def test_market_lab_uses_existing_engine_bounded_data_and_private_summaries(google,monkeypatch):
    client,app,state=google;login(client,state)
    # The sample fallback exposes only prepared dates, with no external data calls.
    monkeypatch.setattr(replay_sessions,'ROOT',app.state.config.assets.parent/'nonexistent')
    from webapp import market_lab
    original=market_lab.execute
    monkeypatch.setattr(market_lab,'execute',lambda payload,days,loader:original(payload,['2026-11-02'],prices))
    payload={'start':'2026-11-02','end':'2026-11-02','interval':'5'}
    before=client.get('/api/trades').json()
    reply=client.post('/api/market-lab/run',json=payload)
    assert reply.status_code==200,reply.text
    run=reply.json();assert run['candles']==12 and run['stats']['trades']>=1
    assert run['strategy']=='Built-in Opening Range Breakout'
    assert 'bars' not in run and 'trades' not in run
    assert client.get('/api/market-lab').json()['runs'][0]['id']==run['id']
    assert client.get('/api/trades').json()==before
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/market-lab').json()['runs']==[]
    for changes in ({'end':'2026-11-20'},{'interval':'240'},{'instrument':'CL'},{'contracts':100},{'opening_minutes':16}):
        assert client.post('/api/market-lab/run',json={**payload,**changes}).status_code==422


def test_scan_date_bounds_missing_data_and_contract_rolls():
    payload=ScanInput(start=date(2026,11,2),end=date(2026,11,3))
    with pytest.raises(ValueError,match='inside'):execute(payload,['2026-11-03'],prices)
    with pytest.raises(ValueError,match='missing'):execute(payload,['2026-11-02','2026-11-03'],lambda *args:None)
    def roll(day,root):return {**prices(day,root),'contract':day}
    with pytest.raises(ValueError,match='contract roll'):execute(payload,['2026-11-02','2026-11-03'],roll)
    with pytest.raises(ValidationError):ScanInput(start=date(2026,11,3),end=date(2026,11,2))


def test_research_results_match_core_directly():
    import pandas as pd
    from core.backtest import run_backtest,BacktestConfig
    from strategies.example_orb import generate_signals
    payload=ScanInput(start=date(2026,11,2),end=date(2026,11,2),interval='1')
    result=execute(payload,['2026-11-02'],prices)
    raw=prices('2026-11-02','NQ')['bars'];frame=pd.DataFrame(raw).rename(columns=dict(time='t',open='o',high='h',low='l',close='c',volume='v'))
    frame.t=pd.to_datetime(frame.t,unit='ms',utc=True).dt.tz_convert('America/New_York').dt.tz_localize(None)
    direct=run_backtest(frame,generate_signals,{'or_minutes':15,'session_start':'09:30','target_r':2},BacktestConfig(symbol='NQ',multiplier=20,tick_size=.25,commission_per_contract=1,slippage_ticks=0))
    assert result['stats']['net_pnl']==direct.stats['net_pnl']
    assert result['stats']['trades']==direct.stats['trades']
