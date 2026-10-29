"""Private research collections and saved filters, using portable settings/tags.

No trade results or financial assumptions are created by a collection's rules.
"""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from core import edge
from core.models import BACKTEST_SOURCES, Trade
from . import fixed_rr

KEY = 'primuslab_research'
PREFIX = 'lab:test:'


def read(database):
    stored = database.get_setting(KEY, {})
    return {'studies': deepcopy(stored.get('studies', [])),
            'saved_setups': deepcopy(stored.get('saved_setups', []))}


def test_id(tags):
    return next((tag[len(PREFIX):] for tag in edge.tag_list(tags) if tag.startswith(PREFIX)), '')


def write_test(tags, study_id):
    kept = [tag for tag in edge.tag_list(tags) if not tag.startswith(PREFIX)]
    return kept + ([PREFIX + study_id] if study_id else [])


def get_test(database, study_id, *, active=False):
    if not study_id:
        return None
    study = next((item for item in read(database)['studies'] if item['id'] == study_id), None)
    if study is None or (active and study.get('archived')):
        raise ValueError('Choose an available test from your journal.')
    return study


def attach(database, trade, study_id, *, study=None):
    study = get_test(database, study_id, active=True) if study is None else study
    if study and trade.source not in BACKTEST_SOURCES:
        raise ValueError('Tests hold backtesting trades. Keep live trades in your live history.')
    trade.tags = write_test(trade.tags, study_id)
    return trade


def catalogue(database, frame):
    data = read(database)
    ids = frame['tags'].map(test_id) if not frame.empty else []
    for item in data['studies']:
        item['trade_count'] = int((ids == item['id']).sum()) if len(ids) else 0
    return data


def save_test(database, payload, study_id=None):
    data = read(database)
    name = payload['name'].strip()
    if not name:
        raise ValueError('Give this test a name.')
    if any(item['name'].casefold() == name.casefold() and item['id'] != study_id
           for item in data['studies']):
        raise ValueError('A test already uses that name. Choose another name.')
    target = fixed_rr.ratio(payload['target_rr'])[0] if payload.get('target_rr', '').strip() else ''
    values = {key: str(payload.get(key, '')).strip() for key in ('strategy', 'symbol', 'rules')}
    values.update(name=name, target_rr=target)
    if study_id:
        current = get_test(database, study_id)
        used = database.trades_df()
        occupied = not used.empty and used['tags'].map(test_id).eq(study_id).any()
        if occupied and any(current.get(key, '') != values[key] for key in ('strategy', 'symbol', 'rules', 'target_rr')):
            raise ValueError('This test has trades. Create a new test to change its rules or target.')
        current.update(values, archived=payload.get('archived', False))
        data['studies'] = [current if item['id'] == study_id else item for item in data['studies']]
    else:
        if len(data['studies']) >= 200:
            raise ValueError('Keep up to 200 tests in one journal.')
        current = {**values, 'id': uuid4().hex, 'archived': False,
                   'created_at': datetime.now(timezone.utc).isoformat()}
        data['studies'].append(current)
    database.set_setting(KEY, data)
    return current


def assign(database, ids, study_id):
    ids = list(dict.fromkeys(ids))
    frame = database.trades_df()
    selected = frame.loc[frame['id'].isin(ids)] if not frame.empty else frame
    if len(selected) != len(ids):
        raise ValueError('A selected trade is no longer available. Refresh first.')
    study = get_test(database, study_id, active=True)
    trades = [Trade.from_row(row) for row in selected.to_dict('records')]
    for trade in trades:
        attach(database, trade, study_id, study=study)
    # Validate the complete selection before updating any trade.
    from .tag_cleanup import write_changes
    write_changes(database, [{'id': trade.id, 'tags': trade.tags} for trade in trades], {})
    return len(trades)


def save_setup(database, name, filters):
    data = read(database)
    name = name.strip()
    if not name:
        raise ValueError('Name this saved setup.')
    if any(item['name'].casefold() == name.casefold() for item in data['saved_setups']):
        raise ValueError('That saved setup name is already in use.')
    if len(data['saved_setups']) >= 100:
        raise ValueError('Keep up to 100 saved setups.')
    item = {'id': uuid4().hex, 'name': name, 'filters': filters}
    data['saved_setups'].append(item)
    database.set_setting(KEY, data)
    return item


def remove_setup(database, setup_id):
    data = read(database)
    remaining = [item for item in data['saved_setups'] if item['id'] != setup_id]
    if len(remaining) == len(data['saved_setups']):
        raise ValueError('This saved setup is no longer available.')
    data['saved_setups'] = remaining
    database.set_setting(KEY, data)
