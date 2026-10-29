"""Research organisation, risk completion and previewed label cleanup."""
import json
from dataclasses import asdict
import pytest
import pandas as pd
from sqlalchemy import event

from core import edge
from services import research, tag_cleanup
from tests.test_webapp import local, trade_payload, upload, labelled_fx
from tests.test_google_access import google, login, csrf


def create_test(client, name='NQ reversals · 1:3', target='1:3'):
    result = client.post('/api/studies', json={'name': name, 'target_rr': target,
        'strategy': 'Reversal', 'symbol': 'NQ', 'rules': 'Wait for the level and confirmation.'})
    assert result.status_code == 200, result.text
    return result.json()


def test_studies_assign_filter_freeze_rules_and_backup(local):
    client, app = local
    a = create_test(client)
    b = create_test(client, 'NQ reversals · 1:2', '1:2')
    for clock, pnl, study in [('09:30', 100, a), ('09:40', -50, b)]:
        response = client.post('/api/trades', json={**trade_payload(clock=clock, pnl=pnl), 'study_id': study['id']})
        assert response.status_code == 200, response.text
    rows = client.get('/api/trades').json()
    assert {row['study_id'] for row in rows} == {a['id'], b['id']}
    result = client.post('/api/results', json={'scope': 'All', 'combined': True,
        'window': 'All sessions', 'study_id': a['id']}).json()
    assert result['stats']['trades'] == 1 and result['stats']['net_pnl'] == 100
    assert result['stats']['avg_r'] == 2  # Planned 1:3 never creates recorded +3R.
    assert client.post('/api/results', json={'study_id': '0' * 32}).status_code == 422
    assert client.put('/api/studies/'+a['id'], json={**a, 'target_rr': '1:2'}).status_code == 422  # IDs cannot be submitted as editable fields.
    values = {key: a[key] for key in ('name', 'strategy', 'symbol', 'rules', 'target_rr')}
    assert client.put('/api/studies/'+a['id'], json={**values, 'target_rr': '1:2'}).status_code == 422
    assert client.put('/api/studies/'+a['id'], json={**values, 'name': 'My first test'}).status_code == 200
    before = {row['id']: row['net_pnl'] for row in rows}
    assert client.post('/api/study-assignment', json={'ids': [rows[0]['id']], 'study_id': a['id']}).status_code == 200
    assert {row['id']: row['net_pnl'] for row in client.get('/api/trades').json()} == before
    backup = client.get('/api/export/backup').json()
    assert any(item['key'] == research.KEY for item in backup['settings'])
    assert all(research.test_id(json.loads(row['tags'])) for row in backup['trades'])


def test_import_choice_is_bound_and_duplicates_do_not_move_tests(local):
    client, _ = local
    a, b = create_test(client), create_test(client, 'Second test', '1:2')
    content = labelled_fx(tags='SMT')
    first = upload(client, content, study_id=a['id']).json()
    assert first['study']['name'] == a['name']
    assert upload(client, content, 'confirm', first['preview_token'], study_id=b['id']).status_code == 409
    assert upload(client, content, 'confirm', first['preview_token'], study_id=a['id']).json()['inserted'] == 1
    second = upload(client, content, study_id=b['id'], update_labels='true').json()
    assert second['counts']['duplicates'] == 1
    assert upload(client, content, 'confirm', second['preview_token'], study_id=b['id'], update_labels='true').status_code == 200
    rows = client.get('/api/trades').json()
    assert len(rows) == 1 and rows[0]['study_id'] == a['id']
    assert sum(tag.startswith(research.PREFIX) for tag in rows[0]['tags']) == 1


def test_test_assignment_validates_complete_selection_before_writing(local):
    client, _ = local
    study = create_test(client)
    for source, clock in [('backtest', '09:30'), ('manual', '09:40')]:
        assert client.post('/api/trades', json=trade_payload(source=source, clock=clock)).status_code == 200
    before = client.get('/api/trades').json()
    assert client.post('/api/study-assignment', json={'ids': [row['id'] for row in before], 'study_id': study['id']}).status_code == 422
    assert client.get('/api/trades').json() == before
    assert client.post('/api/trades', json={**trade_payload(source='manual', clock='09:50'), 'study_id': study['id']}).status_code == 422


def test_saved_filters_are_private_settings_portable_and_validated(local):
    client, _ = local
    filters = {'scope': 'All', 'level': 'FVG', 'confirmations': ['SMT', 'CISD'], 'window': 'London', 'weekday': 'Monday'}
    result = client.post('/api/saved-setups', json={'name': 'My London setup', 'filters': filters})
    assert result.status_code == 200, result.text
    item = result.json()
    assert item['filters']['confirmations'] == ['SMT', 'CISD'] and 'study_id' not in item['filters']
    assert client.get('/api/metadata').json()['saved_setups'][0] == item
    assert client.post('/api/saved-setups', json={'name': 'my london setup', 'filters': filters}).status_code == 422
    assert client.post('/api/saved-setups', json={'name': 'Bad account', 'filters': {'account_id': 999}}).status_code == 422
    assert client.post('/api/saved-setups', json={'name': 'Bad fields', 'filters': {'workspace': 'owner'}}).status_code == 422
    assert client.delete('/api/saved-setups/'+item['id']).status_code == 200
    assert client.get('/api/metadata').json()['saved_setups'] == []


def test_missing_risk_completion_uses_core_and_preserves_imported_dollars(local):
    client, _ = local
    content = labelled_fx(pnl=300, tags='SMT')
    preview = upload(client, content).json()
    assert upload(client, content, 'confirm', preview['preview_token']).status_code == 200
    old = client.get('/api/trades').json()[0]
    assert {issue['field'] for issue in old['review_issues']} == {'strategy', 'confirmations', 'risk'}
    body = {'strategy': 'Reversal', 'labels': {'confirmations': ['SMT']}, 'confirmed': True,
            'notes': old['notes'], 'risk_amount': 100, 'risk_unavailable': False}
    response = client.patch('/api/trades/'+str(old['id']), json=body)
    assert response.status_code == 200, response.text
    new = response.json()
    assert new['net_pnl'] == old['net_pnl'] == 300 and new['r_multiple'] == 3 and new['initial_risk'] == 100
    assert new['review_issues'] == [] and not new['needs_review']
    assert new['entry_time'] == old['entry_time'] and new['external_id'] == old['external_id']
    assert client.patch('/api/trades/'+str(old['id']), json={**body, 'risk_amount': -1}).status_code == 422
    assert client.patch('/api/trades/'+str(old['id']), json={**body, 'risk_unavailable': True}).status_code == 422


def test_risk_unavailable_does_not_invent_R_and_price_based_risk_is_protected(local):
    client, _ = local
    content = labelled_fx(tags='SMT')
    preview = upload(client, content).json()
    upload(client, content, 'confirm', preview['preview_token'])
    row = client.get('/api/trades').json()[0]
    response = client.patch('/api/trades/'+str(row['id']), json={'strategy': 'Reversal', 'labels': {},
        'confirmed': True, 'notes': '', 'risk_unavailable': True})
    assert response.status_code == 200 and response.json()['r_multiple'] is None
    assert response.json()['review_issues'] == []
    price = {**trade_payload(clock='11:00'), 'net_pnl': None, 'risk_amount': None,
             'entry_price': 18000, 'exit_price': 18010, 'stop_price': 17995}
    assert client.post('/api/trades', json=price).status_code == 200
    trade = client.get('/api/trades').json()[0]
    assert client.patch('/api/trades/'+str(trade['id']), json={'strategy': 'Reversal', 'labels': {}, 'risk_amount': 50}).status_code == 422


def test_cleanup_preview_merges_labels_mappings_and_saved_filters_without_financial_changes(local):
    client, app = local
    for clock, confirmation in [('09:30', 'Second sweep'), ('09:40', 'Second Sweep')]:
        body = trade_payload(clock=clock)
        body['labels']['confirmations'] = [confirmation, 'SMT']
        assert client.post('/api/trades', json=body).status_code == 200
    mapping = {'SECOND SWEEP': {'field': 'confirmation', 'value': 'Second Sweep'}}
    assert client.put('/api/tag-mappings', json=mapping).status_code == 200
    client.post('/api/saved-setups', json={'name': 'Sweep test', 'filters': {'confirmations': ['Second Sweep']}})
    before = {row['id']: row for row in client.get('/api/trades').json()}
    choices = client.get('/api/label-cleanup').json()
    assert any(item['field'] == 'confirmation' and len(item['values']) == 2 for item in choices['duplicates'])
    body = {'field': 'confirmation', 'source': 'Second Sweep', 'target': 'Second sweep'}
    preview = client.post('/api/label-cleanup/preview', json=body).json()
    assert preview['count'] == 1 and len(client.get('/api/metadata').json()['confirmations']) > 0
    assert client.get('/api/trades').json() == list(before.values())
    result = client.post('/api/label-cleanup/apply', json={**body, 'preview_token': preview['preview_token']})
    assert result.status_code == 200, result.text
    after = client.get('/api/trades').json()
    for row in after:
        assert row['labels']['confirmations'] == ['SMT', 'Second sweep']
        for key in ('net_pnl', 'gross_pnl', 'initial_risk', 'r_multiple', 'entry_time', 'exit_time', 'external_id', 'notes'):
            assert row[key] == before[row['id']][key]
    meta = client.get('/api/metadata').json()
    assert 'Second Sweep' not in meta['confirmations']
    assert meta['tag_mappings']['SECOND SWEEP']['value'] == 'Second sweep'
    assert meta['saved_setups'][0]['filters']['confirmations'] == ['Second sweep']
    # Saving an old spelling again still uses the approved canonical name.
    assert client.put('/api/tag-mappings', json=mapping).status_code == 200
    assert client.get('/api/metadata').json()['tag_mappings']['SECOND SWEEP']['value'] == 'Second sweep'


def test_cleanup_rejects_stale_or_changed_preview(local):
    client, _ = local
    client.post('/api/trades', json=trade_payload())
    body = {'field': 'level', 'source': 'FVG', 'target': 'Fair value gap'}
    preview = client.post('/api/label-cleanup/preview', json=body).json()
    client.post('/api/trades', json=trade_payload(clock='11:00'))
    response = client.post('/api/label-cleanup/apply', json={**body, 'preview_token': preview['preview_token']})
    assert response.status_code == 409
    assert all(row['labels']['level'] == 'FVG' for row in client.get('/api/trades').json())


def test_research_features_and_cleanup_tokens_stay_private_between_google_accounts(google):
    client, app, state = google
    login(client, state)
    study = create_test(client)
    client.post('/api/trades', json={**trade_payload(), 'study_id': study['id']})
    favorite = client.post('/api/saved-setups', json={'name': 'Owner private filters', 'filters': {'level': 'FVG'}}).json()
    merge = {'field': 'level', 'source': 'FVG', 'target': 'Owner renamed level'}
    preview = client.post('/api/label-cleanup/preview', json=merge).json()
    owner_cookie = client.cookies.get('primus_session')
    owner_backup = client.get('/api/export/backup').content
    client.cookies.clear()
    login(client, state, 'friend@example.com', 'friend-sub')
    assert client.get('/api/metadata').json()['studies'] == []
    assert client.get('/api/metadata').json()['saved_setups'] == []
    assert client.post('/api/trades', json={**trade_payload(), 'study_id': study['id']}).status_code == 422
    assert client.delete('/api/saved-setups/'+favorite['id']).status_code == 422
    assert client.post('/api/label-cleanup/apply', json={**merge, 'preview_token': preview['preview_token']}).status_code == 409
    assert client.get('/api/trades').json() == []
    # Portable JSON restores the test membership and saved filters into an empty journal.
    result = client.post('/api/restore', files={'file': ('backup.json', owner_backup)})
    assert result.status_code == 200, result.text
    assert client.get('/api/metadata').json()['studies'][0]['id'] == study['id']
    assert client.get('/api/trades').json()[0]['study_id'] == study['id']
    assert client.get('/api/metadata').json()['saved_setups'][0]['name'] == 'Owner private filters'
    client.cookies.clear(); client.cookies.set('primus_session', owner_cookie); csrf(client)
    assert client.get('/api/export/backup').content == owner_backup


def test_large_import_into_a_test_does_not_query_settings_once_per_trade(local):
    client, app = local
    study = create_test(client)
    content = pd.DataFrame([{'id': f'batch-{index}', 'dateStart': '2026-07-01 13:30',
        'dateEnd': '2026-07-01 13:40', 'pair': 'NQ', 'side': 'buy', 'status': 'closed',
        'rPnL': 300, 'tags': 'SMT'} for index in range(1000)]).to_csv(index=False).encode()
    queries = []
    engine = app.state.workspaces.database('owner').engine
    def count(*args):
        queries.append(1)
    event.listen(engine, 'before_cursor_execute', count)
    try:
        preview = upload(client, content, study_id=study['id'])
        assert preview.status_code == 200, preview.text
        assert preview.json()['counts']['new'] == 1000
        assert len(queries) < 30
    finally:
        event.remove(engine, 'before_cursor_execute', count)
