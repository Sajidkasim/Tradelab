"""HTTP-level journal, import, scope, backup and authorization regressions."""
import base64
from dataclasses import replace
import json
from pathlib import Path

import pandas as pd
import pytest
pytest.importorskip("fastapi")
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from core import metrics
from webapp.config import Settings
from webapp.app import create_app
from webapp.workspaces import Workspaces


@pytest.fixture
def local(tmp_path):
    config = Settings(str(tmp_path / "preview.db"), "owner@example.com", "test-session-secret-with-enough-characters", "http://127.0.0.1:8100", local=True)
    app = create_app(config)
    with TestClient(app, base_url=config.public_url, client=("127.0.0.1", 12345)) as client:
        identity = client.get("/api/session").json()
        client.headers.update({"X-Primus-CSRF": identity["csrf"], "Origin": config.public_url})
        yield client, app


def trade_payload(source="backtest", clock="09:30", strategy="Turtle Soup", pnl=100):
    return {"symbol": "NQ", "direction": "long", "account_id": 1, "source": source,
            "strategy": strategy, "labels": {"level": "FVG", "timeframe": "4H", "entry_timeframe": "1m", "confirmations": ["SMT", "CISD"]},
            "confirmed": True, "entry_time": f"2026-07-01T{clock}:00-04:00", "exit_time": f"2026-07-01T{clock}:00-04:00",
            "net_pnl": pnl, "risk_amount": 50, "notes": "Private observation"}


def test_weekday_filter_works_for_untagged_trades_empty_results_and_timezone_changes(local):
    from webapp import lab_settings
    client, app = local
    for day, pnl in [('2013-01-25', 100), ('2013-01-28', -50)]:
        body = {**trade_payload(pnl=pnl), 'entry_time': f'{day}T04:30:00Z', 'exit_time': f'{day}T06:30:00Z'}
        assert client.post('/api/trades', json=body).status_code == 200
    before = client.get('/api/trades').json()
    filters = {'scope': 'All', 'combined': True, 'window': 'All sessions'}
    def result(day):
        response = client.post('/api/results', json={**filters, 'weekday': day})
        assert response.status_code == 200, response.text
        return response.json()
    friday = result('Friday')
    assert friday['stats']['trades'] == 1 and friday['stats']['win_rate'] == 1
    assert friday['chart']['data'] and friday['collection_count'] == 2
    assert result('Monday')['stats']['avg_r'] == -1
    assert result('Tuesday')['chart'] is None
    assert result('All days')['stats']['trades'] == 2
    assert client.post('/api/results', json={'weekday': 'Funday'}).status_code == 422
    database = app.state.workspaces.database('owner')
    database.set_setting(lab_settings.KEY, {**lab_settings.DEFAULTS, 'timezone': 'America/New_York'})
    app.state.workspaces.bump('owner')
    assert result('Friday')['stats']['trades'] == 0
    assert result('Thursday')['stats']['trades'] == 1
    assert client.get('/api/trades').json() == before


def test_csv_weekday_mismatch_preview_roundtrip_and_reimport_preserve_financials(local):
    client, app = local
    guide = {'MONDAY': {'field': 'weekday', 'value': 'Monday'}, 'FRIDAY': {'field': 'weekday', 'value': 'Friday'}}
    assert client.put('/api/tag-mappings', json=guide).status_code == 200
    content = labelled_fx(tags='MONDAY')  # 25 January 2013 is Friday.
    preview = upload(client, content).json()
    assert any('Day tag Monday disagrees' in issue and 'Friday' in issue for issue in preview['issues'])
    assert client.get('/api/trades').json() == []
    assert upload(client, content, 'confirm', preview['preview_token']).json()['inserted'] == 1
    before = client.get('/api/trades').json()[0]
    assert 'MONDAY' in before['tags']
    assert client.post('/api/results', json={'window': 'All sessions', 'weekday': 'Monday'}).json()['stats']['trades'] == 0
    assert client.post('/api/results', json={'window': 'All sessions', 'weekday': 'Friday'}).json()['stats']['trades'] == 1
    updated = labelled_fx(tags='FRIDAY', pnl=999)
    preview = upload(client, updated, update_labels='true').json()
    assert not any('Day tag' in issue for issue in preview['issues'])
    assert upload(client, updated, 'confirm', preview['preview_token'], update_labels='true').json()['updated'] == 1
    after = client.get('/api/trades').json()[0]
    for key in ('entry_time', 'exit_time', 'net_pnl', 'r_multiple', 'initial_risk'):
        assert after[key] == before[key]
    assert 'FRIDAY' in after['tags']


def test_manual_trade_roundtrip_core_equivalence_scope_and_update(local):
    client, app = local
    for body in (trade_payload(), trade_payload("manual", "10:30", pnl=-50)):
        response = client.post("/api/trades", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["inserted"] == 1
    assert client.post("/api/trades", json=trade_payload()).json()["skipped"] == 1
    rows = client.get("/api/trades").json()
    assert len(rows) == 2 and rows[0]["needs_tagging"] is False
    assert "screenshot_path" not in rows[0]
    for sample in ("Backtesting", "Forward testing"):
        response = client.post("/api/results", json={"scope": "All", "sample": sample, "confirmations": ["SMT", "CISD"], "detail": True})
        assert response.status_code == 200, response.text
        stats = response.json()["stats"]
        frame = app.state.workspaces.trades("owner")
        expected = metrics.summary_stats(frame[frame.source == ("backtest" if sample == "Backtesting" else "manual")])
        assert stats["trades"] == 1 and stats["win_rate"] == expected["win_rate"] and stats["avg_r"] == expected["avg_r"]
        assert response.json()["chart"]["data"]
        assert 'T09:30' in response.json()['chart']['data'][0]['x'][0] if sample == 'Backtesting' else 'T10:30' in response.json()['chart']['data'][0]['x'][0]
        assert response.json()["breakdown"]
    tid = next(row["id"] for row in rows if row["source"] == "backtest")
    response = client.patch(f"/api/trades/{tid}", json={"strategy": "My model", "labels": {"level": "IFVG", "entry_timeframe": "15s", "confirmations": ["SMT"]}, "confirmed": True, "notes": "Changed note"})
    assert response.status_code == 200
    assert response.json()["net_pnl"] == 100 and response.json()["r_multiple"] == 2
    assert response.json()["labels"]["entry_timeframe"] == "15s"
    filtered = client.post("/api/results", json={"strategy": "My model", "confirmations": ["SMT", "CISD"]}).json()
    assert filtered["stats"]["trades"] == 0
    assert client.post("/api/results", json={"strategy": "My model", "confirmations": ["SMT"]}).json()["stats"]["trades"] == 1


def fx_file():
    return pd.DataFrame({"id": [123, 124, 125], "dateStart": ["2026-07-01 13:31:00"] * 3,
                         "dateEnd": ["2026-07-01 13:40:00"] * 3, "pair": ["CME_MINI:NQ1"] * 3,
                         "rPnL": [-100, 250, 0], "side": ["sell", "buy", "buy"],
                         "status": ["closed", "closed", "open"], "entryPrice": [18000] * 3,
                         "amount": [20] * 3, "maxRiskReward": [5] * 3,
                         "tags": ['["model: Turtle Soup", "SMT"]'] * 3}).to_csv(index=False).encode()


@pytest.mark.parametrize('native', [True, False])
def test_break_even_choice_preview_confirmation_duplicates_and_remembering(local, native):
    client, _ = local
    rows = []
    for index, pnl in enumerate([0, -0.0, -.01, .01, 125]):
        if native:
            row = {'id': f'be-{index}', 'dateStart': '2026-07-01 13:30', 'dateEnd': '2026-07-01 13:40',
                   'pair': 'NQ', 'side': 'buy', 'rPnL': pnl, 'status': 'closed'}
        else:
            row = {'id': f'be-{index}', 'entry_time': '2026-07-01 13:30', 'exit_time': '2026-07-01 13:40',
                   'symbol': 'NQ', 'direction': 'buy', 'pnl': pnl}
        rows.append(row)
    content = pd.DataFrame(rows).to_csv(index=False).encode()
    options = {'include_breakeven': 'false', 'remember_profile': 'true'}
    no = upload(client, content, **options).json()
    assert no['excluded_breakeven'] == 2 and no['counts']['new'] == 3
    assert no['coverage']['total'] == 3 and {row['net_pnl'] for row in no['rows']} == {-.01, .01, 125}
    assert client.get('/api/trades').json() == []
    assert upload(client, content, 'confirm', no['preview_token'], include_breakeven='true', remember_profile='true').status_code == 409
    result = upload(client, content, 'confirm', no['preview_token'], **options).json()
    assert result == {'inserted': 3, 'skipped': 0, 'excluded_breakeven': 2}
    assert client.get('/api/metadata').json()['import_profile']['include_breakeven'] is False
    repeat = upload(client, content, **options).json()
    assert repeat['counts'] == {'new': 0, 'duplicates': 3, 'errors': 0}
    assert repeat['excluded_breakeven'] == 2
    yes = upload(client, content).json()  # Legacy clients still include zero-result trades.
    assert yes['excluded_breakeven'] == 0 and yes['counts']['new'] == 2
    assert upload(client, content, 'confirm', yes['preview_token'], include_breakeven='false').status_code == 409
    assert upload(client, content, 'confirm', yes['preview_token']).json() == {'inserted': 2, 'skipped': 3}
    saved = client.get('/api/trades').json()
    assert len(saved) == 5 and sum(row['net_pnl'] == 0 for row in saved) == 2


def test_all_break_even_preview_is_empty_and_exclusion_never_updates_existing_trades(local):
    client, _ = local
    content = labelled_fx(tags='REVERSAL AT KEY LEVEL', note='Original note', pnl=0)
    no = upload(client, content, include_breakeven='false').json()
    assert no['rows'] == [] and no['total_rows'] == 0
    assert no['excluded_breakeven'] == 1 and no['counts'] == {'new': 0, 'duplicates': 0, 'errors': 0}
    yes = upload(client, content).json()
    assert upload(client, content, 'confirm', yes['preview_token']).json()['inserted'] == 1
    before = client.get('/api/trades').json()
    guide = {'REVERSAL AT KEY LEVEL': {'field': 'strategy', 'value': 'Reversal'}}
    client.put('/api/tag-mappings', json=guide)
    updated = labelled_fx(tags='REVERSAL AT KEY LEVEL', note='Changed note', pnl=0)
    options = {'include_breakeven': 'false', 'update_labels': 'true'}
    preview = upload(client, updated, **options).json()
    assert preview['label_updates'] == [] and preview['counts']['updates'] == 0
    assert upload(client, updated, 'confirm', preview['preview_token'], **options).json() == {'inserted': 0, 'skipped': 0, 'updated': 0, 'excluded_breakeven': 1}
    assert client.get('/api/trades').json() == before


def test_break_even_exclusion_uses_closed_net_results_after_fees_not_missing_or_open(local):
    client, _ = local
    content = b'id,symbol,direction,entry_time,exit_time,entry_price,exit_price,qty,fees\nfee-loss,NQ,buy,2026-07-01 13:30,2026-07-01 13:40,18000,18000,1,5\nflat,NQ,buy,2026-07-02 13:30,2026-07-02 13:40,18000,18000,1,0\nopen,NQ,buy,2026-07-03 13:30,,18000,,1,0\n'
    preview = upload(client, content, source='csv', include_breakeven='false').json()
    assert preview['excluded_breakeven'] == 1
    assert {row['external_id'] for row in preview['rows']} == {'fee-loss', 'open'}
    assert next(row for row in preview['rows'] if row['external_id'] == 'fee-loss')['net_pnl'] == -5
    assert next(row for row in preview['rows'] if row['external_id'] == 'open')['net_pnl'] is None
    invalid = labelled_fx(pnl=0).replace(b',0,', b',,')
    missing = upload(client, invalid, include_breakeven='false').json()
    assert missing['counts']['errors'] == 1 and missing['excluded_breakeven'] == 0


def upload(client, content, action="preview", token="", **options):
    data = {"account_id": "1", "source": "fxreplay", "timezone": "UTC", "mapping": "{}", "preview_token": token, **options}
    return client.post(f"/api/import/{action}", data=data, files={"file": ("replay.csv", content, "text/csv")})


def test_fx_preview_confirm_tagging_duplicates_and_changed_options(local):
    client, app = local
    assert client.put("/api/tag-mappings", json={"model: Turtle Soup": {"field": "strategy", "value": "Turtle Soup"}, "SMT": {"field": "confirmation", "value": "SMT"}}).status_code == 200
    pv = upload(client, fx_file())
    assert pv.status_code == 200, pv.text
    preview = pv.json()
    assert preview["counts"] == {"new": 2, "duplicates": 0, "errors": 1}
    assert client.get("/api/trades").json() == []
    token = preview["preview_token"]
    assert upload(client, fx_file(), "confirm", token, timezone="America/New_York").status_code == 409
    assert upload(client, fx_file(), "confirm", "bad").status_code == 409
    assert upload(client, fx_file(), "confirm", token).json() == {"inserted": 2, "skipped": 0}
    assert upload(client, fx_file(), "confirm", token).json() == {"inserted": 0, "skipped": 2}
    rows = client.get("/api/trades").json()
    assert len(rows) == 2
    assert all(t["setup_name"] == "Turtle Soup" and t["needs_tagging"] for t in rows)
    assert all(t["r_multiple"] is None for t in rows)
    assert {t["net_pnl"] for t in rows} == {-100, 250}
    assert upload(client, fx_file()).json()["counts"]["duplicates"] == 2
    for t in rows:
        assert client.patch(f'/api/trades/{t["id"]}', json={"strategy": "Turtle Soup", "labels": {"confirmations": ["SMT"]}, "confirmed": True}).status_code == 200
    assert all(not t["needs_tagging"] for t in client.get("/api/trades").json())


def test_generic_csv_column_mapping_timezone_and_file_duplicates(local):
    client, _ = local
    content = b'Market,Side,Opened,Closed,Result,Risk\nNQ,buy,01/07/2026 09:30,01/07/2026 09:45,100,50\nNQ,buy,01/07/2026 09:30,01/07/2026 09:45,100,50\n'
    mapping = {"symbol": "Market", "direction": "Side", "entry_time": "Opened", "exit_time": "Closed", "pnl": "Result", "risk_amount": "Risk"}
    pv = upload(client, content, source="csv", timezone="America/New_York", dayfirst="true", mapping=json.dumps(mapping))
    assert pv.status_code == 200, pv.text
    assert pv.json()["counts"]["new"] == 1 and pv.json()["counts"]["duplicates"] == 1
    assert pv.json()["rows"][0]["entry_time"].startswith("2026-07-01T13:30")
    confirm = upload(client, content, "confirm", pv.json()["preview_token"], source="csv", timezone="America/New_York", dayfirst="true", mapping=json.dumps(mapping))
    assert confirm.json() == {"inserted": 1, "skipped": 1}
    assert client.get("/api/trades").json()[0]["r_multiple"] == 2


def test_fill_csv_pairs_through_core_and_rejects_unknown_multipliers(local):
    client, _ = local
    content = b'Symbol,Side,Timestamp,Price,Size,Fees,ID\nNQ,buy,2026-07-01 09:30,18000,1,2,a\nNQ,sell,2026-07-01 09:40,18005,1,2,b\n'
    mapping = {"symbol": "Symbol", "direction": "Side", "timestamp": "Timestamp", "price": "Price", "qty": "Size", "fees": "Fees", "external_id": "ID"}
    options = {"source": "csv", "timezone": "America/New_York", "mapping": json.dumps(mapping)}
    pv = upload(client, content, **options)
    assert pv.status_code == 200, pv.text
    assert pv.json()['counts']['new'] == 1 and pv.json()['rows'][0]['net_pnl'] == 96
    assert upload(client, content, 'confirm', pv.json()['preview_token'], **options).json()['inserted'] == 1
    assert upload(client, content.replace(b'NQ', b'UNKNOWN'), **options).status_code == 422


def test_invalid_backup_never_changes_the_empty_workspace(local):
    client, _ = local
    backup = client.get('/api/export/backup').json()
    backup['accounts'] = []
    assert client.post('/api/restore', files={'file': ('bad.json', json.dumps(backup).encode())}).status_code == 422
    assert client.get('/api/metadata').json()['accounts'][0]['name'] == 'My account'
    assert client.post('/api/restore', files={'file': ('bad.json', b'not a backup')}).status_code == 422
    assert client.post('/api/trades', json=trade_payload()).status_code == 200


def test_backup_restores_full_labels_and_rejects_nonempty_journal(local, tmp_path):
    client, _ = local
    client.post("/api/trades", json=trade_payload())
    backup = client.get("/api/export/backup")
    assert backup.status_code == 200 and 'attachment' in backup.headers['content-disposition']
    assert client.get("/api/export/csv").text.find("edge:entry_timeframe:1m") > 0
    assert client.post("/api/restore", files={"file": ("backup.json", backup.content)}).status_code == 409
    config = Settings(str(tmp_path / "restore.db"), "owner@example.com", "another-test-secret", "http://127.0.0.1:8100", local=True)
    with TestClient(create_app(config), base_url=config.public_url, client=("127.0.0.1", 1)) as other:
        other.headers.update({"X-Primus-CSRF": other.get("/api/session").json()["csrf"], "Origin": config.public_url})
        result = other.post("/api/restore", files={"file": ("backup.json", backup.content)})
        assert result.status_code == 200, result.text
        row = other.get("/api/trades").json()[0]
        assert row["r_multiple"] == 2 and row["labels"]["entry_timeframe"] == "1m" and row["notes"] == "Private observation"


def test_csrf_origin_payload_identity_and_invalid_upload_are_rejected(local):
    client, _ = local
    response = client.post("/api/trades", json=trade_payload(), headers={"X-Primus-CSRF": "bad"})
    assert response.status_code == 403
    assert client.post("/api/trades", json=trade_payload(), headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/trades", json={**trade_payload(), "workspace": "other"}).status_code == 422
    assert client.post("/api/trades", json={**trade_payload(), "account_id": 999}).status_code == 422
    assert client.post("/api/trades", json={**trade_payload(), "entry_time": "2026-07-01T09:30:00"}).status_code == 422
    assert upload(client, b"").status_code == 422
    assert upload(client, b"not-a-csv").status_code == 422
    assert client.get("/api/trades").json() == []
    assert client.patch('/api/trades/999', json={"strategy": "x", "labels": {}}).status_code == 404
    assert client.post('/api/results', json={'start': 'invalid date'}).status_code == 422
    assert client.post('/api/results', json={'start': '2026-07-01', 'end': '2026-07-02'}).status_code == 200


def test_local_preview_fails_closed_off_loopback(local):
    _, app = local
    with TestClient(app, base_url="http://127.0.0.1:8100", client=("192.0.2.1", 1)) as remote:
        assert remote.get('/api/session').status_code == 403


def test_production_configuration_cannot_use_local_storage_or_missing_auth(tmp_path):
    with pytest.raises(ValueError, match="PostgreSQL"):
        Settings(str(tmp_path / 'data.db'), 'owner@example.com', 'a' * 40, 'https://primus.example').validate()
    with pytest.raises(ValueError, match="personal password"):
        Settings('postgresql://invalid.example/test', 'owner@example.com', 'a' * 40, 'https://primus.example').validate()


def test_playbook_and_bulk_strategy_preserve_results_and_invalidate_reads(local):
    client, _ = local
    client.post('/api/trades', json=trade_payload())
    assert client.put('/api/playbook', json={"strategies": [" New strategy ", "New strategy"], "levels": ["My PDA"]}).status_code == 200
    assert client.get('/api/metadata').json()['playbook'] == {"strategies": ["New strategy"], "levels": ["My PDA"]}
    row = client.get('/api/trades').json()[0]
    assert client.post('/api/trades/strategy', json={"ids": [row['id']], "strategy": "New strategy"}).status_code == 200
    saved = client.get('/api/trades').json()[0]
    assert saved['setup_name'] == 'New strategy' and saved['net_pnl'] == 100 and saved['notes'] == row['notes'] and saved['labels'] == row['labels']


def test_strategy_editor_and_choices_share_a_list_and_removed_names_stay_hidden(local):
    from core.models import Setup
    client, app = local
    active = ['Displacement at key level continuation', 'Reversal at key level']
    for clock, name in [('09:30', active[0]), ('10:30', active[1]), ('11:30', 'Old strategy')]:
        assert client.post('/api/trades', json=trade_payload(clock=clock, strategy=name)).status_code == 200
    database = app.state.workspaces.database('owner')
    database.upsert_setup(Setup('Legacy model'))
    mappings = {'OLD CSV': {'field': 'strategy', 'value': 'Old mapped name'}}
    client.put('/api/tag-mappings', json=mappings)
    metadata = client.get('/api/metadata').json()
    assert metadata['playbook']['strategies'] == metadata['strategies']
    assert {'Old strategy', 'Legacy model', 'Old mapped name'}.issubset(metadata['strategies'])
    trades = client.get('/api/trades').json()
    results = client.post('/api/results', json={'scope': 'All', 'combined': True, 'window': 'All sessions'}).json()['stats']
    payload = {'strategies': active, 'levels': metadata['playbook']['levels']}
    assert client.put('/api/playbook', json=payload).json() == payload
    current = client.get('/api/metadata').json()
    assert current['strategies'] == active and current['playbook'] == payload
    assert client.get('/api/trades').json() == trades
    assert client.post('/api/results', json={'scope': 'All', 'combined': True, 'window': 'All sessions'}).json()['stats'] == results
    assert client.get('/api/metadata').json()['tag_mappings'] == mappings
    # Even a later trade with an explicitly removed name cannot resurrect it.
    client.post('/api/trades', json=trade_payload(clock='12:30', strategy='Old strategy'))
    assert client.get('/api/metadata').json()['strategies'] == active
    assert client.post('/api/results', json={'scope': 'All', 'combined': True, 'window': 'All sessions'}).json()['stats']['trades'] == 4
    # Removing is reversible; re-adding the name restores it without rewriting trades.
    restored = {**payload, 'strategies': active + ['Old strategy']}
    client.put('/api/playbook', json=restored)
    assert client.get('/api/metadata').json()['playbook'] == restored
    assert len(client.get('/api/trades').json()) == 4


def test_new_import_strategy_names_appear_in_both_lists_and_removals_survive_refresh(local):
    client, _ = local
    book = {'strategies': ['My current strategy'], 'levels': ['My level']}
    client.put('/api/playbook', json=book)
    client.put('/api/tag-mappings', json={'NEW MODEL': {'field': 'strategy', 'value': 'My next test'}})
    meta = client.get('/api/metadata').json()
    assert meta['strategies'] == meta['playbook']['strategies'] == ['My current strategy', 'My next test']
    client.put('/api/playbook', json=book)
    client.put('/api/tag-mappings', json={'NEW MODEL': {'field': 'strategy', 'value': 'My next test'}})
    assert client.get('/api/metadata').json()['strategies'] == ['My current strategy']
    client.put('/api/playbook', json={**book, 'strategies': []})
    assert client.get('/api/metadata').json()['strategies'] == []
    client.put('/api/playbook', json={**book, 'strategies': ['My next test']})
    assert client.get('/api/metadata').json()['strategies'] == ['My next test']


def test_setup_settings_share_choices_preserve_trades_and_keep_removed_labels_hidden(local):
    from webapp import lab_settings
    client, app = local
    client.post('/api/trades', json=trade_payload())
    guide = {'MACRO': {'field': 'confirmation', 'value': 'MACRO'},
             'MONTHLY': {'field': 'timeframe', 'value': 'Monthly'},
             '5S': {'field': 'entry_timeframe', 'value': '5s'}}
    client.put('/api/tag-mappings', json=guide)
    before = client.get('/api/trades').json()
    stats = client.post('/api/results', json={'window': 'All sessions'}).json()['stats']
    meta = client.get('/api/metadata').json()
    assert 'MACRO' in meta['lab_settings']['confirmations']
    assert 'Monthly' in meta['level_timeframes'] and '5s' in meta['entry_timeframes']
    payload = {**meta['lab_settings'], 'confirmations': ['SMT', 'MACRO', 'My confirmation'],
               'level_timeframes': ['Monthly', '1H'], 'entry_timeframes': ['5s', '1m']}
    response = client.put('/api/lab-settings', json=payload)
    assert response.status_code == 200, response.text
    meta = client.get('/api/metadata').json()
    for key in lab_settings.CHOICE_FIELDS:
        assert meta[key] == payload[key] == meta['lab_settings'][key]
    assert client.get('/api/trades').json() == before
    assert client.post('/api/results', json={'window': 'All sessions'}).json()['stats'] == stats
    # Old clients can update the clock without resetting the new lists.
    legacy = {key: payload[key] for key in ('timezone', 'sessions', 'news', 'conditions')}
    legacy['timezone'] = 'America/New_York'
    assert client.put('/api/lab-settings', json=legacy).status_code == 200
    meta = client.get('/api/metadata').json()
    assert meta['confirmations'] == payload['confirmations']
    assert meta['level_timeframes'] == payload['level_timeframes']
    assert 'CISD' not in meta['confirmations'] and '4H' not in meta['level_timeframes']
    # Newly taught labels remain discoverable; old removals are not resurrected.
    guide['NEW'] = {'field': 'confirmation', 'value': 'Future test'}
    client.put('/api/tag-mappings', json=guide)
    meta = client.get('/api/metadata').json()
    assert 'Future test' in meta['confirmations'] and 'CISD' not in meta['confirmations']
    restored = {**meta['lab_settings'], 'confirmations': meta['confirmations'] + ['CISD']}
    client.put('/api/lab-settings', json=restored)
    assert 'CISD' in client.get('/api/metadata').json()['confirmations']
    backup = client.get('/api/export/backup').json()
    assert any(setting['key'] == lab_settings.KEY and 'hidden_choices' in setting['value'] for setting in backup['settings'])
    assert client.get('/api/trades').json() == before


def test_delete_manual_and_imported_trades_refreshes_results_and_exports(local):
    client, app = local
    client.post('/api/trades', json=trade_payload('manual'))
    preview = upload(client, fx_file()).json()
    upload(client, fx_file(), 'confirm', preview['preview_token'])
    before = client.get('/api/trades').json()
    assert len(before) == 3
    # Prime both result scopes and the trade cache before each deletion.
    for source, scope in [('manual', 'Forward testing'), ('fxreplay', 'Backtesting')]:
        previous = client.post('/api/results', json={'scope': scope}).json()['stats']['trades']
        target = next(t for t in client.get('/api/trades').json() if t['source'] == source)
        response = client.delete(f'/api/trades/{target["id"]}')
        assert response.status_code == 200
        assert response.json() == {'deleted': target['id']}
        after = client.get('/api/trades').json()
        assert target['id'] not in [t['id'] for t in after]
        assert client.post('/api/results', json={'scope': scope}).json()['stats']['trades'] == previous - 1
        assert database_trade_ids(client) == {t['id'] for t in after}
        assert client.delete(f'/api/trades/{target["id"]}').status_code == 404
    survivor = client.get('/api/trades').json()[0]
    assert survivor == next(t for t in before if t['id'] == survivor['id'])


def database_trade_ids(client):
    return {t['id'] for t in client.get('/api/export/backup').json()['trades']}


def test_delete_requires_csrf_and_same_origin(local):
    client, app = local
    client.post('/api/trades', json=trade_payload())
    target = client.get('/api/trades').json()[0]['id']
    for headers in [{'X-Primus-CSRF': ''}, {'Origin': 'https://untrusted.example'}]:
        assert client.delete(f'/api/trades/{target}', headers=headers).status_code == 403
        assert app.state.workspaces.root.get_trade(target) is not None


def test_combined_all_uses_underlying_trades_and_keeps_missing_r_missing(local):
    client, app = local
    for body in [trade_payload(),trade_payload(clock='09:40',pnl=-50),trade_payload('manual','10:30',pnl=200)]:
        client.post('/api/trades',json=body)
    preview=upload(client,fx_file()).json()
    upload(client,fx_file(),'confirm',preview['preview_token'])
    result=client.post('/api/results',json={'scope':'All','combined':True,'window':'All sessions','detail':True}).json()
    assert result['sample']=='All'
    assert result['stats']['trades']==5 and result['stats']['win_rate']==0.6
    assert result['stats']['net_pnl']==400 and result['r_count']==3
    assert result['chart_latest']['equity']==400
    assert result['stats']['avg_r']==pytest.approx(5/3)
    assert client.post('/api/results',json={'scope':'Backtesting','combined':True}).json()['stats']['trades']==4
    assert client.post('/api/results',json={'scope':'Forward testing','combined':True}).json()['stats']['trades']==1


def test_lab_settings_persist_in_backup_and_regroup_results(local):
    from copy import deepcopy
    from webapp import lab_settings
    client,app=local
    client.post('/api/trades',json=trade_payload())
    settings=deepcopy(lab_settings.DEFAULTS)
    assert client.get('/api/metadata').json()['windows']==[s['name'] for s in settings['sessions']]
    result=client.post('/api/results',json={'window':'New York open'}).json()
    assert result['stats']['trades']==1
    settings['sessions'][3]['name']='My open'
    settings['news']=['High impact','Quiet']
    assert client.put('/api/lab-settings',json=settings).status_code==200
    assert client.post('/api/results',json={'window':'My open'}).json()['stats']['trades']==1
    assert client.get('/api/metadata').json()['news']==settings['news']
    saved=client.get('/api/export/backup').json()['settings']
    assert any(item['key']==lab_settings.KEY for item in saved)
    settings['sessions'][0]['end']='03:00'
    assert client.put('/api/lab-settings',json=settings).status_code==422
    assert client.get('/api/metadata').json()['lab_settings']['sessions'][0]['end']=='02:00'


def test_delete_all_requires_exact_fresh_snapshot_and_keeps_accounts_settings(local):
    client,app=local
    client.post('/api/trades',json=trade_payload())
    client.post('/api/trades',json=trade_payload('manual','10:30'))
    preview=client.post('/api/trades/deletion-preview').json()
    assert preview['count']==2
    def remove(count, token): return client.request('DELETE','/api/trades',json={'confirmation_count':count,'preview_token':token})
    assert remove(1,preview['preview_token']).status_code==409
    assert remove(2,'tampered').status_code==409
    assert client.request('DELETE','/api/trades',json={'confirmation_count':2,'preview_token':preview['preview_token']},headers={'X-Primus-CSRF':''}).status_code==403
    oldid=client.get('/api/trades').json()[0]['id']
    client.delete(f'/api/trades/{oldid}')
    client.post('/api/trades',json=trade_payload('manual','11:00'))
    assert remove(2,preview['preview_token']).status_code==409  # same count, different IDs
    fresh=client.post('/api/trades/deletion-preview').json()
    accounts=client.get('/api/metadata').json()['accounts']
    assert remove(2,fresh['preview_token']).json()=={'deleted':2}
    assert client.get('/api/trades').json()==[]
    assert client.post('/api/results',json={'scope':'All','combined':True}).json()['stats']['trades']==0
    assert client.get('/api/metadata').json()['accounts']==accounts
    assert client.get('/api/export/backup').json()['trades']==[]
    assert remove(2,fresh['preview_token']).status_code==409


def test_delete_all_expiry_and_transaction_rollback(local,monkeypatch):
    from itsdangerous.timed import TimestampSigner
    from webapp import trade_deletion
    client,app=local
    client.post('/api/trades',json=trade_payload())
    from itsdangerous import URLSafeTimedSerializer
    from dataclasses import replace
    from sqlalchemy import event
    from sqlalchemy.exc import SQLAlchemyError
    preview=client.post('/api/trades/deletion-preview').json()
    signer=URLSafeTimedSerializer(app.state.config.secret,salt='primus-import-preview')
    payload=signer.loads(preview['preview_token'])
    original=TimestampSigner.get_timestamp
    monkeypatch.setattr(TimestampSigner,'get_timestamp',lambda self:original(self)-1000)
    stale=signer.dumps(payload)
    monkeypatch.setattr(TimestampSigner,'get_timestamp',original)
    assert client.request('DELETE','/api/trades',json={'confirmation_count':1,'preview_token':stale}).status_code==409
    database=app.state.workspaces.root
    trade=database.get_trade(client.get('/api/trades').json()[0]['id'])
    database.insert_trades([replace(trade,id=None,external_id=f'rollback-{i}') for i in range(600)])
    app.state.workspaces.bump('owner')
    preview=client.post('/api/trades/deletion-preview').json()
    calls=[0]
    def fail_second_delete(conn,cursor,statement,parameters,context,executemany):
        if statement.startswith('DELETE FROM trades'):
            calls[0]+=1
            if calls[0]==2: raise SQLAlchemyError('Synthetic delete failure')
    event.listen(database.engine,'before_cursor_execute',fail_second_delete)
    try:
        result=client.request('DELETE','/api/trades',json={'confirmation_count':601,'preview_token':preview['preview_token']})
        assert result.status_code==503
    finally:
        event.remove(database.engine,'before_cursor_execute',fail_second_delete)
    assert len(client.get('/api/trades').json())==601


def labelled_fx(tags='CONTINUATION,HTF LEVEL 1HR FVG,CISD FVG \\', note='Export note', pnl=125):
    return pd.DataFrame([{'id':'release-labels','dateStart':'2013/01/25 17:07:59','dateEnd':'2013/01/25 19:13:55',
                         'pair':'CME_MINI:NQ1','rPnL':pnl,'side':'sell','status':'closed','tags':tags,'notes':note}]).to_csv(index=False).encode()


def test_fx_screenshot_tag_guide_is_remembered_without_importing_trades(local):
    client, _ = local
    metadata = client.get('/api/metadata').json()
    assert metadata['tag_mappings'] == {}
    guide = metadata['tag_suggestions']
    assert client.put('/api/tag-mappings', json=guide).status_code == 200
    assert client.get('/api/trades').json() == []
    assert client.get('/api/metadata').json()['tag_mappings'] == guide
    content = labelled_fx(tags='REVERSAL AT KEY LEVEL,FVG,MONTHLY,1M,CISD,15M')
    preview = upload(client, content).json()
    row = preview['rows'][0]
    assert row['setup_name'] == 'Reversal at key level'
    assert row['labels']['level'] == 'FVG' and row['labels']['timeframe'] == 'Monthly'
    assert row['labels']['entry_timeframe'] == '1m'
    assert row['labels']['confirmations'] == ['CISD']
    assert 'FVG' in preview['tags'] and 'fx-original:FVG' not in preview['tags']
    assert any('15M appears in both' in issue for issue in preview['issues'])
    assert row['net_pnl'] == 125 and row['r_multiple'] is None
    assert client.get('/api/trades').json() == []
    assert upload(client, content, 'confirm', preview['preview_token']).json()['inserted'] == 1
    saved = client.get('/api/trades').json()[0]
    assert saved['labels']['confirmations'] == ['CISD'] and saved['needs_tagging']
    assert saved['net_pnl'] == 125 and saved['r_multiple'] is None


def test_composite_export_tags_notes_and_explicit_reimport_updates(local):
    from core import edge
    from services import trade_labels
    client,app=local
    content=labelled_fx()
    preview=upload(client,content).json()
    assert preview['coverage']['notes']==1 and preview['coverage']['strategies']==0
    mappings=preview['suggestions']
    assert len(mappings['HTF LEVEL 1HR FVG']['rules'])==2
    assert client.put('/api/tag-mappings',json=mappings).status_code==200
    preview=upload(client,content).json()
    assert preview['rows'][0]['setup_name']=='Continuation'
    assert preview['rows'][0]['labels']['confirmations']==['CISD','FVG']
    assert preview['rows'][0]['labels']['timeframe']=='1H'
    assert upload(client,content,'confirm',preview['preview_token'],remember_profile='true').status_code==409
    preview=upload(client,content,remember_profile='true').json()
    assert upload(client,content,'confirm',preview['preview_token'],remember_profile='true').json()=={'inserted':1,'skipped':0}
    assert client.get('/api/metadata').json()['import_profile']['timezone']=='UTC'
    saved=client.get('/api/trades').json()[0]
    assert 'Export note' in saved['notes'] and saved['net_pnl']==125
    client.patch(f'/api/trades/{saved["id"]}',json={'strategy':'Local model','labels':{'level':'NWOG','confirmations':['SMT']},'notes':'My private local note','confirmed':True})
    updated=labelled_fx(note='New export note',pnl=9999)
    preview=upload(client,updated,update_labels='true').json()
    assert preview['counts']['updates']==1
    assert preview['label_updates'][0]['previous_strategy']=='Local model'
    result=upload(client,updated,'confirm',preview['preview_token'],update_labels='true')
    assert result.status_code==200,result.text
    assert result.json()=={'inserted':0,'skipped':0,'updated':1}
    row=client.get('/api/trades').json()[0]
    assert row['net_pnl']==125 and row['r_multiple'] is None
    assert row['setup_name']=='Continuation' and row['labels']['confirmations']==['CISD','FVG']
    assert 'My private local note' in row['notes'] and 'New export note' in row['notes']
    assert row['needs_tagging']  # changed confirmations need an explicit review
    blank=labelled_fx(tags='',note='',pnl=-1234)
    pv=upload(client,blank,update_labels='true').json()
    assert upload(client,blank,'confirm',pv['preview_token'],update_labels='true').status_code==200
    after=client.get('/api/trades').json()[0]
    assert after['setup_name']==row['setup_name'] and after['notes']==row['notes'] and after['net_pnl']==125
    pv=upload(client,content,update_labels='true').json()
    client.patch(f'/api/trades/{row["id"]}',json={'strategy':'Changed during preview','labels':{},'confirmed':False,'notes':'Keep this'})
    assert upload(client,content,'confirm',pv['preview_token'],update_labels='true').status_code==409
    assert client.get('/api/trades').json()[0]['notes']=='Keep this'


def test_label_update_preserves_all_financial_fields_and_rolls_back_new_rows(local,monkeypatch):
    from webapp import import_updates
    client,app=local
    content=b'id,symbol,direction,entry_time,exit_time,pnl,risk_amount,setup\nfinancial-proof,NQ,buy,2026-07-01 13:30,2026-07-01 13:45,100,50,Original\n'
    pv=upload(client,content,source='csv').json()
    assert upload(client,content,'confirm',pv['preview_token'],source='csv').status_code==200
    before=client.get('/api/trades').json()[0]
    changed=content.replace(b'100,50,Original',b'9000,10,New model')
    pv=upload(client,changed,source='csv',update_labels='true').json()
    assert upload(client,changed,'confirm',pv['preview_token'],source='csv',update_labels='true').status_code==200
    after=client.get('/api/trades').json()[0]
    for field in ('net_pnl','gross_pnl','r_multiple','initial_risk','qty','entry_price','exit_price','stop_price','fees','source','account_id','external_id'):
        assert after[field]==before[field],field
    assert after['r_multiple']==2 and after['setup_name']=='New model'
    # A stale update plan must roll back new inserts in the same transaction.
    database=app.state.workspaces.root
    from webapp import imports
    parsed,preview=imports.parse(changed+b'new-row,ES,buy,2026-07-01 14:00,2026-07-01 14:15,50,100,Other\n','replay.csv',database,1,'csv','UTC',False,{})
    changes,_=import_updates.plan(database,parsed,{})
    assert changes==[]
    changed_again=changed.replace(b'New model',b'Changed again')+b'new-row,ES,buy,2026-07-01 14:00,2026-07-01 14:15,50,100,Other\n'
    parsed,_=imports.parse(changed_again,'replay.csv',database,1,'csv','UTC',False,{})
    changes,_=import_updates.plan(database,parsed,{})
    database.update_trade(after['id'],notes='Concurrent note')
    with pytest.raises(ValueError,match='changed'):
        import_updates.apply(database,parsed,changes)
    assert 'new-row' not in database.existing_external_ids()


def test_import_preferences_save_without_upload_and_validate_account_and_options(local):
    client, _ = local
    preferences = {'account_id': 1, 'source': 'fxreplay', 'timezone': 'Etc/GMT+4', 'dayfirst': True, 'update_labels': False, 'include_breakeven': False}
    assert client.put('/api/import-preferences', json=preferences).json() == preferences
    assert client.get('/api/metadata').json()['import_profile'] == preferences
    assert client.get('/api/trades').json() == []
    assert client.put('/api/import-preferences', json={**preferences, 'account_id': 9999}).status_code == 422
    assert client.put('/api/import-preferences', json={**preferences, 'timezone': 'invalid'}).status_code == 422
    assert client.put('/api/import-preferences', json={**preferences, 'password': 'invalid'}).status_code == 422
    assert client.put('/api/import-preferences', json=preferences, headers={'X-Primus-CSRF': 'wrong'}).status_code == 403
    assert client.get('/api/metadata').json()['import_profile'] == preferences


def test_future_strategy_aliases_and_keep_only_tags_survive_import_and_backup(local):
    client, _ = local
    mappings = {
        'NEW MODEL': {'field': 'strategy', 'value': 'Breakout and retest'},
        'RENAMED MODEL': {'field': 'strategy', 'value': 'Breakout and retest'},
        'CISD': {'ignore': True},
        'MONTHLY': {'field': 'timeframe', 'value': 'Monthly'},
        'CUSTOM CHECK': {'field': 'confirmation', 'value': 'My custom confirmation'},
    }
    assert client.put('/api/tag-mappings', json=mappings).status_code == 200
    meta = client.get('/api/metadata').json()
    assert 'Breakout and retest' in meta['strategies']
    assert 'Monthly' in meta['timeframes']
    assert 'My custom confirmation' in meta['confirmations']
    assert client.get('/api/trades').json() == []
    content = labelled_fx(tags='RENAMED MODEL,CISD,MONTHLY,CUSTOM CHECK')
    preview = upload(client, content).json()
    assert preview['rows'][0]['setup_name'] == 'Breakout and retest'
    assert preview['rows'][0]['labels']['confirmations'] == ['My custom confirmation']
    assert upload(client, content, 'confirm', preview['preview_token']).status_code == 200
    before = client.get('/api/trades').json()
    mappings['NEW MODEL']['value'] = 'Different future meaning'
    assert client.put('/api/tag-mappings', json=mappings).status_code == 200
    assert client.get('/api/trades').json() == before
    backup = client.get('/api/export/backup').json()
    assert 'Breakout and retest' in json.dumps(backup)
    assert 'Different future meaning' in json.dumps(backup)
    assert before[0]['net_pnl'] == 125 and before[0]['r_multiple'] is None


def test_fixed_rr_preview_results_filter_and_reimport_never_overwrite_financials(local):
    from services import fixed_rr
    client, _ = local
    rule = {'field': 'target_rr', 'value': '1:3', 'full_exit': True}
    assert client.put('/api/tag-mappings', json={'1:3': rule}).status_code == 200
    data = pd.DataFrame([
        {'id': 'fixed-win', 'dateStart': '2026-07-01 13:30', 'dateEnd': '2026-07-01 13:40', 'pair': 'NQ', 'rPnL': 300, 'side': 'buy', 'status': 'closed', 'tags': '1:3'},
        {'id': 'fixed-loss', 'dateStart': '2026-07-02 13:30', 'dateEnd': '2026-07-02 13:40', 'pair': 'NQ', 'rPnL': -100, 'side': 'buy', 'status': 'closed', 'tags': '1:3'},
    ]).to_csv(index=False).encode()
    preview = upload(client, data).json()
    assert preview['tags'] == ['1:3']  # internal model markers aren't new export tags
    assert preview['rows'][0]['target_rr'] == '1:3' and preview['rows'][0]['fixed_exit']
    assert preview['rows'][0]['r_multiple'] is None
    assert upload(client, data, 'confirm', preview['preview_token']).json()['inserted'] == 2
    before = client.get('/api/trades').json()
    response = client.post('/api/results', json={'scope': 'All', 'combined': True}).json()
    assert response['stats']['net_pnl'] == 200 and response['stats']['avg_r'] is None
    assert response['fixed_rr']['avg_r'] == 1 and response['fixed_rr']['complete']
    assert client.post('/api/results', json={'target_rr': '1:2'}).json()['stats']['trades'] == 0
    assert client.post('/api/results', json={'target_rr': '1:3'}).json()['stats']['trades'] == 2
    assert client.post('/api/results', json={'target_rr': '1:0'}).status_code == 422
    assert client.get('/api/metadata').json()['target_rrs'] == ['1:3']
    # An opted-in label re-import changes the model only, never actual R/risk/P&L.
    assert client.put('/api/tag-mappings', json={'1:3': {'field': 'target_rr', 'value': '1:2', 'full_exit': True}}).status_code == 200
    preview = upload(client, data, update_labels='true').json()
    assert upload(client, data, 'confirm', preview['preview_token'], update_labels='true').json()['updated'] == 2
    after = client.get('/api/trades').json()
    for old, new in zip(before, after):
        assert new['target_rr'] == '1:2'
        for field in ('net_pnl', 'gross_pnl', 'r_multiple', 'initial_risk', 'qty', 'entry_price', 'exit_price', 'stop_price', 'fees'):
            assert old[field] == new[field]
    assert client.post('/api/results', json={'target_rr': '1:2'}).json()['fixed_rr']['avg_r'] == .5
    # Ordinary label review preserves the target marker without extra core fields.
    row = after[0]
    result = client.patch(f'/api/trades/{row["id"]}', json={'strategy': 'Reviewed model', 'labels': {}, 'notes': '', 'confirmed': True})
    assert result.json()['target_rr'] == '1:2'
    assert client.get('/api/trades').json()[0]['r_multiple'] is None


def test_csv_multiple_rr_targets_keep_their_own_filters_models_and_duplicates(local):
    client, _ = local
    ratios = ['1:2', '1:3', '1:2.2']
    mappings = {ratio: {'field': 'target_rr', 'value': ratio, 'full_exit': True} for ratio in ratios}
    assert client.put('/api/tag-mappings', json=mappings).status_code == 200
    rows = []
    for index, ratio in enumerate(ratios):
        for outcome, pnl in [('win', 400), ('loss', -200)]:
            rows.append({'id': f'multiple-rr-{index}-{outcome}', 'dateStart': f'2026-07-{index + 1:02} 13:30',
                'dateEnd': f'2026-07-{index + 1:02} 13:40', 'pair': 'NQ', 'rPnL': pnl, 'side': 'buy',
                'status': 'closed', 'tags': ratio})
    csv = pd.DataFrame(rows).to_csv(index=False).encode()
    preview = upload(client, csv).json()
    assert [row['target_rr'] for row in preview['rows']] == ['1:2', '1:2', '1:3', '1:3', '1:2.2', '1:2.2']
    assert upload(client, csv, 'confirm', preview['preview_token']).json()['inserted'] == 6
    before = client.get('/api/trades').json()
    for ratio, expected in [('1:2', .5), ('1:3', 1), ('1:2.2', .6)]:
        result = client.post('/api/results', json={'scope': 'All', 'combined': True, 'target_rr': ratio}).json()
        assert result['stats']['trades'] == 2
        assert result['stats']['net_pnl'] == 200
        assert result['stats']['avg_r'] is None  # Target tags never become recorded R.
        assert result['fixed_rr']['targets'] == [ratio]
        assert result['fixed_rr']['avg_r'] == pytest.approx(expected)
    combined = client.post('/api/results', json={'scope': 'All', 'combined': True}).json()
    assert combined['stats']['trades'] == 6
    assert combined['fixed_rr']['avg_r'] == pytest.approx(.7)
    duplicate = upload(client, csv).json()
    confirmed = upload(client, csv, 'confirm', duplicate['preview_token']).json()
    assert confirmed['inserted'] == 0
    assert client.get('/api/trades').json() == before


def test_each_rr_needs_its_own_full_exit_confirmation_and_unknown_tags_are_not_guessed(local):
    client, _ = local
    mapping = {'1:2': {'field': 'target_rr', 'value': '1:2'},
               '1:3': {'field': 'target_rr', 'value': '1:3', 'full_exit': True}}
    assert client.put('/api/tag-mappings', json=mapping).status_code == 200
    csv = pd.DataFrame([{'id': f'per-rr-confirm-{i}', 'dateStart': '2026-08-01 13:30',
        'dateEnd': '2026-08-01 13:40', 'pair': 'NQ', 'rPnL': 300, 'side': 'buy',
        'status': 'closed', 'tags': tag} for i, tag in enumerate(['1:2', '1:3', '1:4', '1:2;1:3'])]).to_csv(index=False).encode()
    preview = upload(client, csv).json()
    assert preview['rows'][0]['target_rr'] == '1:2' and not preview['rows'][0]['fixed_exit']
    assert preview['rows'][1]['target_rr'] == '1:3' and preview['rows'][1]['fixed_exit']
    assert preview['rows'][2]['target_rr'] == 'Not recorded'  # Unsaved meaning needs review.
    assert preview['rows'][3]['target_rr'] == 'Not recorded'  # Conflicting ratios need review.
    assert all(row['r_multiple'] is None for row in preview['rows'])


def test_uk_journal_clock_preserves_trades_and_filters_whole_dst_calendar_days(local):
    client, _ = local
    for index, stamp in enumerate(['2026-10-24T23:30:00Z', '2026-10-25T23:30:00Z', '2026-10-26T00:30:00Z']):
        payload = {**trade_payload(), 'entry_time': stamp, 'exit_time': stamp, 'notes': str(index)}
        assert client.post('/api/trades', json=payload).status_code == 200
    before = client.get('/api/trades').json()
    assert client.put('/api/journal-preferences', json={'timezone': 'Europe/London'}).status_code == 200
    result = client.post('/api/results', json={'scope': 'All', 'combined': True, 'window': 'All sessions', 'start': '2026-10-25', 'end': '2026-10-25'}).json()
    assert result['stats']['trades'] == 2  # A 25-hour UK day, both sides of the clock change.
    assert result['chart_latest']['time'].startswith('2026-10-25T23:30')
    assert client.get('/api/trades').json() == before
    assert client.get('/api/metadata').json()['journal_preferences']['timezone'] == 'Europe/London'
    assert client.put('/api/journal-preferences', json={'timezone': 'invalid'}).status_code == 422


def test_journal_accounts_reuse_trade_accounts_and_protect_linked_trades(local):
    client, _ = local
    original = client.get('/api/journal-accounts').json()[0]
    assert original['account_type'] == 'Personal'
    assert client.delete(f"/api/journal-accounts/{original['id']}").status_code == 409
    values = {'name': 'Evaluation', 'starting_balance': 25000, 'account_type': 'Eval'}
    response = client.post('/api/journal-accounts', json=values)
    assert response.status_code == 201, response.text
    account = response.json()
    assert client.post('/api/journal-accounts', json=values).status_code == 409
    assert client.post('/api/journal-accounts', json={**values, 'account_type': 'Other'}).status_code == 422
    url = f"/api/journal-accounts/{account['id']}"
    edited = client.put(url, json={**values, 'name': 'Funded account', 'account_type': 'Funded'})
    assert edited.json()['account_type'] == 'Funded'
    assert client.delete(url).json() == {'deleted': account['id']}
    assert client.get('/api/journal-accounts').json() == [original]
    assert client.post('/api/trades', json=trade_payload()).status_code == 200
    other = client.post('/api/journal-accounts', json=values)
    assert other.status_code == 201
    assert client.delete(f"/api/journal-accounts/{original['id']}").status_code == 409
    original_url = f"/api/journal-accounts/{original['id']}"
    original_values = {key: original[key] for key in ('name', 'starting_balance', 'account_type')}
    assert original['status'] == 'active'
    assert client.put(original_url, json={**original_values, 'status': 'blown'}).json()['status'] == 'blown'
    assert client.put(original_url, json=original_values).json()['status'] == 'blown'
    assert len(client.get('/api/trades').json()) == 1
    assert client.put(original_url, json={**original_values, 'status': 'active'}).json()['status'] == 'active'

def test_personal_trading_rules_persist_without_timezone_updates_erasing_them(local):
    client, app = local
    response = client.put('/api/journal-preferences', json={'timezone':'America/New_York','trading_rules':'Wait for my setup.\nStop after two losses.'})
    assert response.status_code == 200
    assert client.get('/api/metadata').json()['journal_preferences']['trading_rules']=='Wait for my setup.\nStop after two losses.'
    assert client.put('/api/journal-preferences',json={'timezone':'Europe/London'}).json()['trading_rules'].startswith('Wait')
    assert client.put('/api/journal-preferences',json={'timezone':'Europe/London','trading_rules':'x'*12001}).status_code==422
    assert client.put('/api/journal-preferences',json={'timezone':'Europe/London','trading_rules':''}).json()['trading_rules']==''


def test_only_hashed_build_assets_receive_immutable_cache(local):
    client, app = local
    import re
    page=client.get('/')
    asset=re.search(r'src="(/assets/[^"]+\.js)"',page.text)
    assert asset
    assert client.get(asset[1]).headers['cache-control']=='public, max-age=31536000, immutable'
    assert page.headers['cache-control']=='no-store'
    assert client.get('/api/session').headers['cache-control']=='no-store'
    assert 'immutable' not in client.get('/assets/not-found.js').headers.get('cache-control','')


def test_csv_download_neutralizes_formulas_without_changing_saved_notes(local):
    import csv,io
    client, app = local
    payload={**trade_payload(), 'notes':'=HYPERLINK("https://example.invalid","open")'}
    assert client.post('/api/trades',json=payload).status_code==200
    exported=list(csv.DictReader(io.StringIO(client.get('/api/export/csv').text)))
    assert exported[0]['notes'].startswith("'=HYPERLINK")
    assert client.get('/api/trades').json()[0]['notes']==payload['notes']


def test_security_headers_and_actual_chunked_login_limit(local):
    client,app=local
    response=client.get('/')
    assert "object-src 'none'" in response.headers['content-security-policy']
    assert 'strict-transport-security' not in response.headers
    response=client.post('/api/unlock',content=iter([b'x'*5000,b'y'*5000]),headers={'Content-Type':'application/json'})
    assert response.status_code==413


def test_readiness_checks_database_without_exposing_failure_details(local, monkeypatch):
    from sqlalchemy.exc import OperationalError

    client, app = local
    ready = client.get('/ready')
    assert ready.status_code == 200
    assert ready.json() == {'status': 'ready'}
    assert ready.headers['cache-control'] == 'no-store'

    def unavailable():
        raise OperationalError('SELECT 1', {}, OSError('private upstream details'))

    monkeypatch.setattr(app.state.workspaces.root.engine, 'connect', unavailable)
    response = client.get('/ready')
    assert response.status_code == 503
    assert response.json() == {'status': 'unavailable'}
    assert response.headers['cache-control'] == 'no-store'
    assert client.get('/health').status_code == 200


def test_readiness_times_out_without_starting_a_second_database_probe(local, monkeypatch):
    from threading import Event

    client, app = local
    release = Event()
    finished = Event()
    calls = []

    def stalled():
        calls.append(1)
        try:
            release.wait(timeout=10)
            raise OSError('database unavailable')
        finally:
            finished.set()

    monkeypatch.setattr(app.state.workspaces.root.engine, 'connect', stalled)
    try:
        assert client.get('/ready').status_code == 503
        assert not finished.is_set()
        assert client.get('/ready').status_code == 503
        assert calls == [1]
        assert client.get('/health').status_code == 200
    finally:
        release.set()
        assert finished.wait(timeout=5)


def test_chart_vision_maps_nearby_workspace_tags_and_keeps_distant_labels(local, monkeypatch):
    from io import BytesIO
    from PIL import Image
    from webapp import chart_vision

    client, _ = local
    monkeypatch.setenv('PRIMUS_VISION_CF_ACCOUNT_ID', 'a' * 32)
    monkeypatch.setenv('PRIMUS_VISION_CF_TOKEN', 'test-token')
    monkeypatch.setenv('PRIMUS_VISION_CF_FREE_ONLY', '1')
    meta = client.get('/api/metadata').json()
    confirmation = meta['confirmations'][0]
    box = {'x': .2, 'y': .4, 'width': .04, 'height': .02}
    far = {**box, 'y': .05}

    def scan(credentials, jpeg, vocabulary):
        assert credentials == ('a'*32, 'test-token')
        assert vocabulary['confirmation'] == [confirmation]
        return chart_vision.Extraction.model_validate({
            'position': {'x': .2, 'y': .2, 'width': .3, 'height': .3},
            'entry_anchor': box,
            'findings': [
                {'kind': 'asset', 'value': 'NQ1!', 'text': 'NQ1!', 'box': far},
                {'kind': 'direction', 'value': 'long', 'text': 'Long position tool', 'box': box},
                {'kind': 'confirmation', 'value': confirmation, 'text': 'MSS', 'box': box},
                {'kind': 'key_level', 'value': 'PDL', 'text': 'PDL', 'box': far},
                {'kind': 'confirmation', 'value': 'Unmapped', 'text': 'SMT', 'box': box},
            ],
        })

    monkeypatch.setattr(chart_vision, 'scan', scan)
    image = BytesIO()
    Image.new('RGB', (100, 100)).save(image, format='JPEG')
    data = {'user_tags': json.dumps([confirmation, 'Unmapped'])}
    response = client.post('/api/vision/extract', data=data, files={'image': ('chart.jpg', image.getvalue(), 'image/jpeg')})
    assert response.status_code == 200, response.text
    assert [(row['kind'], row['value']) for row in response.json()['findings']] == [
        ('asset', 'NQ'), ('direction', 'long'), ('confirmation', confirmation),
        ('visible_level', 'PDL'), ('annotation', 'SMT'),
    ]
    invalid = client.post('/api/vision/extract', data=data, files={'image': ('chart.jpg', b'invalid', 'image/jpeg')})
    assert invalid.status_code == 422
    client.headers.pop('X-Primus-CSRF')
    assert client.post('/api/vision/extract', data=data, files={'image': ('chart.jpg', image.getvalue(), 'image/jpeg')}).status_code == 403


def test_chart_label_mapping_round_trips_and_requires_a_known_confirmation(local):
    client, _ = local
    tag = client.get('/api/metadata').json()['confirmations'][0]
    response = client.put('/api/vision/aliases', json={'label': 'ChOch', 'confirmation': tag})
    assert response.status_code == 200
    assert client.get('/api/vision/aliases').json() == {'CHOCH': tag}
    assert client.put('/api/vision/aliases', json={'label': 'Other', 'confirmation': 'Unknown tag'}).status_code == 422
    assert client.put('/api/vision/aliases', json={'label': 'CHOCH', 'confirmation': None}).json() == {}
