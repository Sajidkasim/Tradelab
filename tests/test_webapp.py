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
from services.team import verified_google
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


def cookie(config, key, subject):
    raw = base64.b64encode(json.dumps({"key": key, "subject": subject, "csrf": "test-csrf"}).encode())
    return TimestampSigner(config.secret).sign(raw).decode()


def claims(email, subject):
    return {"iss": "https://accounts.google.com", "email": email, "email_verified": True, "sub": subject, "name": "Tester"}


@pytest.fixture
def hosted(tmp_path, monkeypatch):
    # Real hosted auth middleware, isolated SQLite data layer. No live DB or Google requests.
    config = Settings("postgresql://invalid.example/test", "owner@example.com", "hosted-test-secret-with-40-characters-long", "https://primus.example", google_id="test.apps.googleusercontent.com", google_secret="test")
    monkeypatch.setattr("webapp.app.Workspaces", lambda cfg: Workspaces(replace(cfg, database=str(tmp_path / "hosted.db"))))
    app = create_app(config)
    with TestClient(app, base_url=config.public_url) as client:
        yield client, app, config


def login(client, app, config, email, subject):
    actor = app.state.workspaces.team.join(claims(email, subject))
    _, bound = verified_google(claims(email, subject))
    client.cookies.set('primus_session', cookie(config, actor.key, bound))
    client.headers.update({"X-Primus-CSRF": "test-csrf", "Origin": config.public_url})
    return actor


def test_hosted_authentication_invitation_isolation_revocation_and_private_sharing(hosted):
    client, app, config = hosted
    assert client.get('/api/trades').status_code == 401
    assert client.get('/api/session').json()['authenticated'] is False
    with pytest.raises(PermissionError):
        app.state.workspaces.team.join(claims('stranger@example.com', 'stranger'))
    owner = login(client, app, config, 'owner@example.com', 'owner-sub')
    assert client.post('/api/trades', json=trade_payload()).status_code == 200
    response = client.post('/api/team', json={"email": "member@example.com", "name": "Member"})
    key = response.json()['key']
    member = login(client, app, config, 'member@example.com', 'member-sub')
    assert member.key == key
    assert client.get('/api/trades').json() == []
    assert client.patch('/api/trades/1', json={"strategy": "wrong", "labels": {}}).status_code == 404
    assert client.post('/api/team', json={"email": "bad@example.com", "name": "Bad"}).status_code == 403
    assert client.get('/api/team/owner/results').status_code == 403
    assert client.post('/api/trades', json=trade_payload(pnl=-50)).status_code == 200
    assert client.put('/api/sharing', json={"enabled": True}).status_code == 200
    assert 'email' not in client.get('/api/team').json()[0]
    member_cookie = cookie(config, key, verified_google(claims('member@example.com', 'member-sub'))[1])
    login(client, app, config, 'owner@example.com', 'owner-sub')
    assert client.get('/api/trades').json()[0]['net_pnl'] == 100
    shared = client.get(f'/api/team/{key}/results').json()
    assert shared['Backtesting']['net_pnl'] == -50 and 'notes' not in json.dumps(shared)
    assert client.patch(f'/api/team/{key}/active', json={"enabled": False}).status_code == 200
    client.cookies.set('primus_session', member_cookie)
    assert client.get('/api/trades').status_code == 403
    assert client.get('/api/export/backup').status_code == 403


def test_signed_session_subject_and_host_cannot_be_forged(hosted):
    client, app, config = hosted
    login(client, app, config, 'owner@example.com', 'owner-sub')
    assert client.get('/api/session').json()['authenticated'] is True
    client.cookies.set('primus_session', cookie(config, 'owner', 'wrong-subject'))
    assert client.get('/api/trades').status_code == 401
    client.cookies.set('primus_session', 'forged')
    assert client.get('/api/export/backup').status_code == 401
    assert client.get('/health', headers={'Host': 'evil.example'}).status_code == 400


def test_local_preview_fails_closed_off_loopback(local):
    _, app = local
    with TestClient(app, base_url="http://127.0.0.1:8100", client=("192.0.2.1", 1)) as remote:
        assert remote.get('/api/session').status_code == 403


def test_production_configuration_cannot_use_local_storage_or_missing_auth(tmp_path):
    with pytest.raises(ValueError, match="PostgreSQL"):
        Settings(str(tmp_path / 'data.db'), 'owner@example.com', 'a' * 40, 'https://primus.example').validate()
    with pytest.raises(ValueError, match="sign-in"):
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


def test_oauth_callback_only_binds_verified_invited_identity(hosted):
    client, app, config = hosted
    class Google:
        async def authorize_access_token(self, request):
            return {"userinfo": claims('owner@example.com', 'owner-sub')}
    app.state.oauth._clients['google'] = Google()
    result = client.get('/auth/callback', follow_redirects=False)
    assert result.status_code == 307
    assert client.get('/api/session').json()['authenticated'] is True
    class Uninvited:
        async def authorize_access_token(self, request):
            return {"userinfo": claims('unknown@example.com', 'unknown')}
    app.state.oauth._clients['google'] = Uninvited()
    assert client.get('/auth/callback', follow_redirects=False).headers['location'] == '/?login=denied'
    assert client.get('/api/session').json()['authenticated'] is False
