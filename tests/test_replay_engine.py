import pytest
from services.replay_engine import project, validate_order

BARS=[
 {'time':0,'open':100,'high':101,'low':99,'close':100,'volume':1},
 {'time':60000,'open':101,'high':104,'low':100,'close':103,'volume':1},
 {'time':120000,'open':103,'high':106,'low':98,'close':105,'volume':1},
 {'time':180000,'open':105,'high':107,'low':104,'close':106,'volume':1},
]
SPEC={'capital':50000,'instrument':'MNQ','commission':0.5,'slippage':0,'start_cursor':0}
def command(at,**order):return {'at':at,'kind':'order','order':{'side':'buy','type':'market','qty':1,**order}}

def test_market_fills_next_open_and_micro_pnl_commissions_are_correct():
 p=project(BARS,SPEC,[command(0,qty=2),{'at':1,'kind':'close'}])
 assert p['frames'][0]['position'] is None
 assert p['frames'][1]['position']['entry']==101
 assert p['frames'][1]['equity']==50007 # $8 unrealised minus $1 entry fee
 assert p['trades'][0]['net']==6 # 2 points * $2 * 2 contracts - $2 round trip
 assert p['frames'][2]['balance']==50006

def test_stop_first_when_both_stop_target_hit_and_entry_bar_limit_ambiguity_is_conservative():
 p=project(BARS,SPEC,[command(0,stop=99,target=105)])
 assert p['trades'][0]['reason']=='stop'
 assert p['trades'][0]['exit']==99
 assert p['trades'][0]['net']==-5
 limit=project(BARS,SPEC,[command(0,type='limit',price=100,stop=99,target=102)])
 # On a limit-entry candle, the high might have happened before entry: no same-bar profit.
 assert not [t for t in limit['trades'] if t['exit_cursor']==1]

def test_sell_limit_stop_entry_gap_fill_and_standard_contract_multiplier():
 spec={**SPEC,'instrument':'NQ','commission':0}
 p=project(BARS,spec,[command(0,side='sell',type='limit',price=102),{'at':1,'kind':'close'}])
 assert p['trades'][0]['entry']==102 and p['trades'][0]['exit']==103
 assert p['trades'][0]['net']==-20
 stop=project(BARS,SPEC,[command(0,type='stop',price=100.5)])
 assert stop['frames'][1]['position']['entry']==101

def test_cancel_prevents_fill_and_snapshot_history_does_not_mutate():
 p=project(BARS,SPEC,[command(0,type='limit',price=95),{'at':1,'kind':'cancel'}])
 assert p['frames'][0]['order'] is not None
 assert p['frames'][1]['order'] is None
 assert p['trades']==[]

def test_rejects_invalid_orders_and_requires_explicit_close_before_another_entry():
 for extra in [{'qty':0},{'qty':1.5},{'price':100.1,'type':'limit'},{'stop':102},{'target':99}]:
  with pytest.raises(ValueError):validate_order({'side':'buy','type':'market','qty':1,**extra},100,SPEC)
 with pytest.raises(ValueError):project(BARS,SPEC,[command(0),command(1)])

def test_micro_es_slippage_and_short_unrealised_result():
 p=project(BARS,{**SPEC,'instrument':'MES','slippage':1},[command(0,side='sell')])
 assert p['frames'][1]['position']['entry']==100.75
 assert p['frames'][1]['unrealized']==-11.25
 assert p['frames'][1]['balance']==49999.5

def test_intrabar_stop_exit_does_not_use_an_open_before_the_entry():
 bars=[BARS[0],{'time':60000,'open':100,'high':104,'low':99,'close':103,'volume':1},BARS[2]]
 p=project(bars,SPEC,[command(0,type='stop',price=102,stop=101,target=105)])
 assert p['trades'][0]['entry']==102
 assert p['trades'][0]['exit']==101
 assert p['trades'][0]['net']==-3

def test_gap_exits_and_session_end_close_use_executable_prices():
 bars=[BARS[0],{'time':60000,'open':100,'high':102,'low':99.5,'close':101,'volume':1},
       {'time':120000,'open':97,'high':98,'low':96,'close':97.5,'volume':1}]
 stopped=project(bars,SPEC,[command(0,stop=99,target=105)])
 assert stopped['trades'][0]['exit']==97
 assert stopped['trades'][0]['reason']=='stop'
 ended=project(bars,SPEC,[command(0)])
 assert ended['trades'][0]['exit']==97.5
 assert ended['trades'][0]['reason']=='session end'
 assert ended['frames'][-1]['position'] is None


def test_bracket_amendment_only_applies_after_current_candle():
 p=project(BARS,SPEC,[command(0),{'at':1,'kind':'amend','order':{'side':'buy','type':'market','qty':1,'stop':100.5,'target':105}}])
 assert p['frames'][1]['position']['stop']==100.5
 assert p['trades'][0]['exit']==100.5
 assert p['trades'][0]['exit_cursor']==2
 with pytest.raises(ValueError):project(BARS,SPEC,[{'at':0,'kind':'amend','order':{'side':'buy','type':'market','qty':1,'stop':99}}])

def test_pending_levels_can_be_set_before_any_fill_and_survive_entry():
 commands=[command(0),{'at':0,'kind':'amend','order':{'side':'buy','type':'market','qty':1,'stop':99,'target':105}}]
 p=project(BARS,SPEC,commands)
 assert p['frames'][0]['position'] is None
 assert p['frames'][0]['order']['stop']==99
 assert p['frames'][0]['ticket']['pending'] is True
 assert p['frames'][0]['ticket']['stop_result']==-2
 assert p['frames'][1]['position']['stop']==99

def test_ticket_preview_uses_entry_direction_and_contract_size():
    from services.replay_engine import ticket_result
    assert ticket_result(20000,19990,'buy',2,'NQ')==-400
    assert ticket_result(20000,19990,'sell',2,'NQ')==400
    assert ticket_result(5000,5002,'buy',3,'ES')==300


def test_continuous_replay_keeps_position_and_pending_order_at_loaded_boundary():
    spec={**SPEC,'close_at_end':False}
    first=project(BARS,spec,[command(0)])
    assert first['trades']==[]
    assert first['frames'][-1]['position']['entry']==101
    overnight={**BARS[-1],'time':86400000,'open':110,'high':112,'low':109,'close':111}
    later=project(BARS+[overnight],spec,[command(0),{'at':3,'kind':'close'}])
    assert later['trades'][0]['reason']=='close'
    assert later['trades'][0]['exit']==110
    assert later['trades'][0]['net']==17
    pending=project(BARS,spec,[command(3)])
    assert pending['frames'][-1]['order'] is not None
    assert project(BARS+[overnight],spec,[command(3)])['frames'][-1]['position']['entry']==110


def test_continuous_replay_still_honours_overnight_gap_stop():
    spec={**SPEC,'close_at_end':False}
    overnight={**BARS[-1],'time':86400000,'open':95,'high':97,'low':94,'close':96}
    plan=project(BARS+[overnight],spec,[command(0,stop=97,target=120)])
    assert plan['trades'][0]['reason']=='stop'
    assert plan['trades'][0]['exit']==95


def test_extending_an_already_completed_legacy_session_preserves_its_recorded_exit():
    original=project(BARS,SPEC,[command(0)])
    later=[*BARS,{**BARS[-1],'time':86400000,'open':110,'close':111}]
    extended=project(later,{**SPEC,'close_at_end':False,'legacy_end_cursors':[3]},[command(0)])
    assert extended['trades']==original['trades']
    assert extended['frames'][:4]==original['frames']
