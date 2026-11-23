"""Tests for production observability, request IDs, and PII scrubbing."""
from fastapi.testclient import TestClient

from webapp import observability
from webapp.app import create_app
from webapp.config import Settings


def test_scrub_event_removes_cookies_auth_headers_and_secrets():
    raw = {
        "request": {
            "cookies": {"primus_session": "secret-cookie"},
            "data": {"password": "hunter2"},
            "headers": {
                "Authorization": "Bearer top-secret",
                "Cookie": "primus_session=abc",
                "X-Primus-CSRF": "csrf-123",
                "User-Agent": "PrimusTest/1.0",
            },
        },
        "extra": {
            "tradelab_db_url": "postgresql://user:pass@host/db",
            "session_token": "tok",
            "safe_note": "ok",
        },
    }
    cleaned = observability.scrub_event(raw)
    assert "cookies" not in cleaned["request"]
    assert "data" not in cleaned["request"]
    assert cleaned["request"]["headers"]["Authorization"] == "[Filtered]"
    assert cleaned["request"]["headers"]["Cookie"] == "[Filtered]"
    assert cleaned["request"]["headers"]["X-Primus-CSRF"] == "[Filtered]"
    assert cleaned["request"]["headers"]["User-Agent"] == "PrimusTest/1.0"
    assert cleaned["extra"]["tradelab_db_url"] == "[Filtered]"
    assert cleaned["extra"]["session_token"] == "[Filtered]"
    assert cleaned["extra"]["safe_note"] == "ok"


def test_init_error_tracking_is_safe_noop_without_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert observability.init_error_tracking(local=False) is False
    assert observability.init_error_tracking(local=True) is False


def test_responses_include_request_id_header_and_extracted_routes_work(tmp_path):
    cfg = Settings(
        database=str(tmp_path / "obs.db"),
        owner_email="owner@example.com",
        secret="x" * 40,
        public_url="http://127.0.0.1:8100",
        local=True,
        site_preview=True,
        lab_path="/lab",
    )
    app = create_app(cfg)
    with TestClient(app, base_url="http://127.0.0.1:8100", client=("127.0.0.1", 50000)) as client:
        health = client.get("/health")
        assert health.status_code == 200
        req_id = health.headers.get("X-Request-Id", "")
        assert len(req_id) == 12

        # Extracted Matrix route still responds cleanly
        snap = client.get("/api/matrix/snapshot")
        assert snap.status_code == 200
        assert "snapshot" in snap.json()

        # Extracted Tools route still computes NQ/MNQ sizing
        matrix = client.post(
            "/api/learn/risk-matrix",
            json={"balance": 50000, "risk_percent": 1, "stop_ticks": 40},
        )
        assert matrix.status_code == 200
        assert "NQ" in matrix.json() and "MNQ" in matrix.json()

        # Extracted Journal accounts route still responds
        accounts = client.get("/api/journal-accounts")
        assert accounts.status_code == 200
        assert isinstance(accounts.json(), list)
