"""Lab vocabulary is the import vocabulary, with conservative typo handling."""
from copy import deepcopy
import pytest
from core import edge
from services.import_tag_catalog import Catalog, normal, near, for_database
from services import trade_labels
from webapp import lab_settings
from tests.test_webapp import local, labelled_fx, upload


def catalogue(overrides=None):
    return Catalog({'strategy':['Breakout and retest', 'Reversal at key level'],
                    'level':['FVG', 'Order block'], 'confirmation':['FVG', 'CISD', 'SMT'],
                    'timeframe':['4H', '15m'], 'entry_timeframe':['15m', '2m'],
                    'news':['FOMC', 'CPI'], 'condition':['Trending']}, overrides or {})


@pytest.mark.parametrize('tag,field,value', [
    (' BREAKOUT   AND RETEST ', 'strategy', 'Breakout and retest'),
    ('breakout_and_retest', 'strategy', 'Breakout and retest'),
    ('breakout and reetst', 'strategy', 'Breakout and retest'),
    ('REVERSL AT KEY LEVEL', 'strategy', 'Reversal at key level'),
    ('cids', 'confirmation', 'CISD'),
    ('S M T', 'confirmation', 'SMT'),
    ('4 hr', 'timeframe', '4H'),
    ('entry time frame : 2 MINUTES', 'entry_timeframe', '2m'),
    ('key level timefrmae: 15 M', 'timeframe', '15m'),
    ('confluence: fvg', 'confirmation', 'FVG'),
    ('key level: FVG', 'level', 'FVG'),
    ('cpi', 'news', 'CPI'),
    ('trendign', 'condition', 'Trending'),
])
def test_saved_choices_match_caps_spaces_and_clear_spelling_errors(tag, field, value):
    result, status = catalogue().resolve(tag)
    assert result == {'field':field, 'value':value}
    assert status in ('automatic', 'spelling')


def test_ambiguous_names_nearby_strategies_and_numeric_typos_are_not_guessed():
    for tag in ['FVG', '15m', 'MSS', '5H', 'completely unfamiliar']:
        assert catalogue().resolve(tag)[0] is None
    close = Catalog({'strategy':['Breakout test', 'Breakout best']}, {})
    assert close.resolve('Breakout rest')[0] is None
    assert normal('1:2.5') != normal('1:25')
    assert normal('1:2') == normal(' 1 : 2 ')
    assert catalogue().resolve('1:2')[0] is None
    assert near('212m', '122m') is False
    assert catalogue().resolve('x' * 10000) == (None, 'unknown')


def test_explicit_overrides_and_keep_only_win_but_conflicting_variants_need_review():
    custom = catalogue({'FVG':{'field':'level','value':'FVG'}, 'SMT':{'ignore':True}})
    assert custom.resolve(' f v g ')[0] == {'field':'level','value':'FVG'}
    assert custom.resolve('smt')[0] == {'ignore':True}
    conflict = catalogue({'FVG':{'field':'level','value':'FVG'}, 'f v g':{'field':'confirmation','value':'FVG'}})
    assert conflict.resolve('fvg') == (None, 'ambiguous')
    assert conflict.resolve('FVG')[0]['field'] == 'level'  # Exact override remains explicit.


def test_import_uses_settings_without_extra_mapping_and_keeps_results_and_raw_tags(local):
    client, app = local
    assert client.put('/api/playbook',json={'strategies':['Breakout and retest'], 'levels':['My weekly level']}).status_code == 200
    settings = deepcopy(lab_settings.DEFAULTS)
    settings.update(confirmations=['Volume reaction'], level_timeframes=['2H'], entry_timeframes=['30s'])
    assert client.put('/api/lab-settings',json=settings).status_code == 200
    meta = client.get('/api/metadata').json()
    assert meta['tag_mappings'] == {} and 'Strategy: Breakout and retest' in meta['automatic_tags']
    raw_tags = ['breakout and reetst','MY WEEKLY LEVEL','2 hr','30 S','volume  reaction']
    content = labelled_fx(tags=','.join(raw_tags),pnl=-125)
    preview = upload(client,content).json()
    assert preview['unresolved_tags'] == []
    row = preview['rows'][0]
    assert row['setup_name'] == 'Breakout and retest'
    assert row['labels']['level'] == 'My weekly level'
    assert row['labels']['timeframe'] == '2H' and row['labels']['entry_timeframe'] == '30s'
    assert row['labels']['confirmations'] == ['Volume reaction']
    assert row['net_pnl'] == -125 and row['r_multiple'] is None
    assert client.get('/api/trades').json() == []  # Preview is read-only.
    assert upload(client,content,'confirm',preview['preview_token']).json()['inserted'] == 1
    saved = client.get('/api/trades').json()[0]
    assert all(tag in saved['tags'] for tag in raw_tags)
    assert saved['labels']['reviewed'] is False
    assert saved['net_pnl'] == -125 and saved['initial_risk'] is None and saved['r_multiple'] is None
    again = upload(client,content).json()
    assert again['counts']['duplicates'] == 1 and again['unresolved_tags'] == []
    assert upload(client,content,'confirm',again['preview_token']).json()['inserted'] == 0


def test_shared_tags_ask_once_and_settings_changes_invalidate_preview(local):
    client, app = local
    content = labelled_fx(tags='FVG,15m')
    preview = upload(client,content).json()
    assert preview['unresolved_tags'] == ['15m','FVG']
    assert preview['rows'][0]['labels']['confirmations'] == []
    assert client.put('/api/tag-mappings',json={'FVG':{'field':'level','value':'FVG'},'15m':{'field':'timeframe','value':'15m'}}).status_code == 200
    assert upload(client,content,'confirm',preview['preview_token']).status_code == 409
    preview = upload(client,content).json()
    assert preview['unresolved_tags'] == []
    assert preview['rows'][0]['labels']['level'] == 'FVG'
    assert preview['rows'][0]['labels']['timeframe'] == '15m'
    settings = deepcopy(lab_settings.DEFAULTS);settings['entry_timeframes'] += ['2m']
    client.put('/api/lab-settings',json=settings)
    assert upload(client,content,'confirm',preview['preview_token']).status_code == 409


def test_hidden_and_other_workspace_choices_are_not_reintroduced(local):
    from core.db import Database
    from services import strategy_catalog
    client, app = local
    db = app.state.workspaces.database('owner')
    frame = db.trades_df()
    strategy_catalog.save(db, frame, {'strategies':['Private setup'], 'levels':['Private level']})
    assert for_database(db).resolve('private setup')[0]['value'] == 'Private setup'
    strategy_catalog.save(db, frame, {'strategies':[], 'levels':[]})
    assert for_database(db).resolve('private setup')[0] is None
    other = Database(':memory:');other.init()
    assert for_database(other).resolve('private setup')[0] is None
    assert db.get_setting(trade_labels.MAPPING_KEY,{}) == {}
