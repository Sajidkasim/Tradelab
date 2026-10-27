"""Explicit fixed target/stop observations use the unchanged core summary."""
import pandas as pd
import pytest
from pandas.testing import assert_frame_equal
from core import edge, metrics
from services import fixed_rr, trade_labels


def frame():
    return pd.DataFrame([
        {'source': 'fxreplay', 'tags': fixed_rr.write(['1:3'], '1:3', True), 'net_pnl': 300, 'r_multiple': None,
         'entry_time': '2026-07-01T13:30:00Z', 'exit_time': '2026-07-01T13:40:00Z', 'exit_price': 1},
        {'source': 'fxreplay', 'tags': fixed_rr.write(['1:3'], '1:3', True), 'net_pnl': -100, 'r_multiple': None,
         'entry_time': '2026-07-02T13:30:00Z', 'exit_time': '2026-07-02T13:40:00Z', 'exit_price': 1},
    ])


def test_confirmed_one_to_three_win_and_loss_average_one_r_without_mutation():
    records = frame()
    before = records.copy(deep=True)
    result = fixed_rr.summary(records)
    assert result == {'targets': ['1:3'], 'tagged': 2, 'count': 2, 'excluded': 0,
                      'complete': True, 'avg_r': 1, 'wins': 1, 'losses': 1}
    assert_frame_equal(records, before)
    assert metrics.summary_stats(records)['avg_r'] is None


@pytest.mark.parametrize('reason', ['live', 'untagged', 'target-only', 'break-even', 'open'])
def test_unqualified_rows_never_receive_assumed_r(reason):
    records = frame()
    if reason == 'live':
        records.loc[1, 'source'] = 'manual'
    elif reason == 'untagged':
        records.at[1, 'tags'] = ['1:3']
    elif reason == 'target-only':
        records.at[1, 'tags'] = fixed_rr.write([], '1:3', False)
    elif reason == 'break-even':
        records.loc[1, 'net_pnl'] = 0
    else:
        records.loc[1, 'exit_price'] = None
    result = fixed_rr.summary(records)
    assert result['avg_r'] == 3 and result['count'] == 1
    assert result['complete'] is (reason == 'open')


def test_distinct_models_and_duplicate_indexes_are_kept_independent():
    records = frame()
    records.index = [5, 5]
    records.iat[1, records.columns.get_loc('tags')] = fixed_rr.write([], '1:2', True)
    records.iat[1, records.columns.get_loc('net_pnl')] = 200
    assert fixed_rr.summary(records)['avg_r'] == 2.5
    assert fixed_rr.summary(records)['targets'] == ['1:2', '1:3']
    assert fixed_rr.summary(records.iloc[0:0])['avg_r'] is None


def test_ratio_mapping_requires_valid_target_and_explicit_full_exit_confirmation():
    assert fixed_rr.ratio('1:3.0') == ('1:3', 3)
    assert trade_labels.suggested_mapping('1:3') == {'field': 'target_rr', 'value': '1:3'}
    assert trade_labels.suggested_mapping('RR: 1:2') == {'field': 'target_rr', 'value': '1:2'}
    for value in ('3', '0:3', '1:0', '1:-3', '1:NaN', '1:101'):
        with pytest.raises(ValueError):
            fixed_rr.ratio(value)
    mappings = {'1:3': {'field': 'target_rr', 'value': '1:3'}}
    fields, issues = trade_labels.mapped_fields(['1:3'], mappings)
    assert not issues and fixed_rr.read(fields['tags']) == {'target_rr': '1:3', 'fixed_exit': False}
    mappings['1:3']['full_exit'] = True
    fields, _ = trade_labels.mapped_fields(['1:3'], mappings)
    assert fixed_rr.read(fields['tags']) == {'target_rr': '1:3', 'fixed_exit': True}
    with pytest.raises(ValueError):
        trade_labels.validate_mappings({'1:3': {'field': 'target_rr', 'value': '1:3', 'full_exit': 'yes'}})


def test_conflicting_rr_tags_do_not_guess_and_explicit_updates_replace_old_target():
    mappings = {value: {'field': 'target_rr', 'value': value, 'full_exit': True} for value in ('1:2', '1:3')}
    fields, issues = trade_labels.mapped_fields(['1:2', '1:3'], mappings)
    assert issues and fixed_rr.read(fields['tags']) == {'target_rr': edge.UNKNOWN, 'fixed_exit': False}
    combined = fixed_rr.merge(fixed_rr.write(['old-note'], '1:3', True), fixed_rr.write(['new-note'], '1:2', False))
    assert fixed_rr.read(combined) == {'target_rr': '1:2', 'fixed_exit': False}
    assert 'old-note' in combined and 'new-note' in combined
