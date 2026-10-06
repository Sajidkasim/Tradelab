from copy import deepcopy
import pandas as pd
import pytest
from core import edge
from core.db import Database
from services import import_flow, trade_labels


def native_trade():
    raw = pd.DataFrame([dict(id='tag-test',dateStart='2026-09-01T13:35:00Z',dateEnd='2026-09-01T13:45:00Z',
                             pair='CME_MINI:NQ1',rPnL=125.5,side='buy',status='closed',
                             tags='[{"name":"Strategy: Turtle Soup"},{"name":"SMT"}]')])
    trades, errors = import_flow.fx_analytics(raw, {}, None)
    assert not errors
    return trades[0]


def test_native_object_tags_are_read_without_changing_the_result():
    trade = native_trade()
    assert 'Strategy: Turtle Soup' in trade.tags and 'SMT' in trade.tags
    fields, issues = trade_labels.mapped_fields(trade.tags, {'Strategy: Turtle Soup': {'field':'strategy','value':'Turtle Soup'}})
    assert not issues and fields['setup_name'] == 'Turtle Soup'
    assert not edge.read_labels(fields['tags'])['reviewed']
    assert trade.net_pnl == 125.5 and trade.r_multiple is None


def test_conflicting_strategies_are_not_silently_guessed():
    fields, issues = trade_labels.mapped_fields(['A','B'], {'A':{'field':'strategy','value':'Alpha'},'B':{'field':'strategy','value':'Beta'}})
    assert fields['setup_name'] == '' and issues


def test_manual_strategy_and_labels_win_over_import_mapping():
    tags = edge.write_labels(['A'], level='FVG')
    fields, issues = trade_labels.mapped_fields(tags, {'A': {'field':'level','value':'NWOG'}}, 'My strategy')
    assert fields['setup_name'] == 'My strategy'
    assert edge.read_labels(fields['tags'])['level'] == 'FVG' and issues


def test_label_edit_and_bulk_strategy_keep_imported_money_and_unreviewed_status():
    db = Database(':memory:'); db.init()
    first = native_trade(); second = deepcopy(first); second.external_id += '-second'
    db.insert_trades([first,second])
    ids = db.trades_df()['id'].tolist()
    assert trade_labels.apply_strategy(db, ids, 'My custom strategy') == 2
    assert trade_labels.needs_tagging(db.trades_df()).all()
    trade = db.get_trade(ids[0])
    labels = edge.read_labels(trade.tags); labels.pop('reviewed'); labels['entry_timeframe'] = '1m'
    db.update_trade(trade.id, **trade_labels.review_fields(trade, 'My custom strategy', labels, 'Reviewed chart', True))
    saved = db.get_trade(trade.id)
    assert saved.net_pnl == 125.5 and saved.r_multiple is None and saved.initial_risk is None
    assert edge.read_labels(saved.tags)['entry_timeframe'] == '1m'
    assert list(trade_labels.needs_tagging(db.trades_df())) == [False,True]
    with pytest.raises(ValueError):
        trade_labels.apply_strategy(db, [ids[1],9999], 'Should not save')
    assert db.get_trade(ids[1]).setup_name == 'My custom strategy'


def test_unchecked_confirmation_remains_unknown_until_explicitly_reviewed():
    trade = native_trade()
    labels = {key: edge.UNKNOWN for key in edge.LABEL_KEYS}; labels['confirmations'] = []
    fields = trade_labels.review_fields(trade, '', labels, '', False)
    assert not edge.read_labels(fields['tags'])['reviewed']
    assert edge.read_labels(fields['tags'])['confirmations'] == []
    assert 'pnl-only' in fields['tags']
