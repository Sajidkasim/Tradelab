"""Multi-worker coordination tests for webapp.shared_state."""
from datetime import timedelta
import httpx
import pytest
import sqlalchemy as sa

from core import edge
from core.db import Database
from core.models import Source
from webapp.config import Settings
from webapp.google_access import GoogleAccess, LoginError
from webapp.personal_access import now_utc
from webapp.shared_state import CapacityExceeded, SharedState, shared_state_t
from webapp.workspaces import Workspaces


def _google_config(db_path):
    return Settings(
        database=str(db_path),
        owner_email="owner@example.com",
        secret="shared-state-test-secret-with-plenty-of-entropy",
        public_url="https://primustrader.co.uk",
        supabase_url="https://example.supabase.co",
        supabase_key="anon-test-key",
    )


def test_google_pkce_completes_across_separate_workers_and_is_single_use(tmp_path):
    db_path = tmp_path / "pkce.db"
    config = _google_config(db_path)

    worker_a_db = Database(db_path)
    worker_a_db.init()
    worker_b_db = Database(db_path)
    worker_b_db.init()

    worker_a = GoogleAccess(worker_a_db, config)
    worker_b = GoogleAccess(worker_b_db, config)
    seen_verifiers = []

    def handler(request: httpx.Request):
        if request.url.path.endswith("/auth/v1/token"):
            import json
            body = json.loads(request.content.decode())
            seen_verifiers.append(body["code_verifier"])
            return httpx.Response(200, json={"access_token": "tok-123"})
        if request.url.path.endswith("/auth/v1/user"):
            return httpx.Response(
                200,
                json={
                    "email": "owner@example.com",
                    "email_confirmed_at": "2026-01-01T00:00:00Z",
                    "identities": [
                        {
                            "provider": "google",
                            "identity_data": {
                                "email": "owner@example.com",
                                "email_verified": True,
                                "sub": "google-sub-1",
                            },
                        }
                    ],
                },
            )
        return httpx.Response(404)

    worker_b.client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        attempt, _ = worker_a.start()
        assert attempt not in worker_b.attempts
        email, subject = worker_b.exchange(attempt, "oauth-code-1")
        assert email == "owner@example.com"
        assert subject
        assert len(seen_verifiers) == 1
        # Second consumption must fail closed across both workers.
        with pytest.raises(LoginError):
            worker_b.exchange(attempt, "oauth-code-1")
        with pytest.raises(LoginError):
            worker_a.exchange(attempt, "oauth-code-1")
    finally:
        worker_a.close()
        worker_b.close()
        worker_a_db.engine.dispose()
        worker_b_db.engine.dispose()


def test_workspace_bump_invalidates_other_worker_frame_cache_immediately(tmp_path):
    db_path = tmp_path / "workspaces.db"
    config = Settings(
        database=str(db_path),
        owner_email="owner@example.com",
        secret="shared-state-workspace-secret-with-enough-length",
        public_url="http://127.0.0.1:8100",
        local=True,
    )
    worker_a = Workspaces(config)
    worker_b = Workspaces(config)
    try:
        assert len(worker_a.trades("owner")) == 0
        # Worker B writes a trade and calls bump().
        acct_id = worker_b.database("owner").accounts()[0].id
        trade = edge.build_trade(
            symbol="MNQ",
            direction="long",
            source=Source.BACKTEST,
            strategy="ORB",
            account_id=acct_id,
            entry_time="2026-11-26T14:30:00Z",
            exit_time="2026-11-26T14:40:00Z",
            instruments=worker_b.database("owner").instruments(),
            tags=[],
            net_pnl=250.0,
            risk_amount=100.0,
        )
        worker_b.database("owner").insert_trades([trade])
        worker_b.bump("owner")
        # Worker A must immediately observe the new trade via shared workspace_rev.
        assert len(worker_a.trades("owner")) == 1
    finally:
        worker_a.close()
        worker_b.close()


def test_shared_cooldown_and_ephemeral_capacity_across_workers(tmp_path):
    db_path = tmp_path / "coord.db"
    db_a = Database(db_path)
    db_a.init()
    db_b = Database(db_path)
    db_b.init()
    state_a = SharedState(db_a)
    state_b = SharedState(db_b)
    try:
        assert state_a.claim_cooldown("bullpen_alert", "Sajid", cooldown_seconds=900) is True
        assert state_b.claim_cooldown("bullpen_alert", "Sajid", cooldown_seconds=900) is False
        # Force expiry in DB; Worker B should then be able to claim again.
        with db_a.engine.begin() as conn:
            conn.execute(
                shared_state_t.update()
                .where(
                    shared_state_t.c.namespace == "bullpen_alert",
                    shared_state_t.c.item_key == "Sajid",
                )
                .values(expires_at=now_utc() - timedelta(seconds=1))
            )
        assert state_b.claim_cooldown("bullpen_alert", "Sajid", cooldown_seconds=900) is True

        state_a.put_ephemeral("cap_test", "k1", {"v": 1}, ttl_seconds=60, max_items=2)
        state_b.put_ephemeral("cap_test", "k2", {"v": 2}, ttl_seconds=60, max_items=2)
        with pytest.raises(CapacityExceeded):
            state_a.put_ephemeral("cap_test", "k3", {"v": 3}, ttl_seconds=60, max_items=2)
        assert state_b.pop_ephemeral("cap_test", "k1") == {"v": 1}
        assert state_a.pop_ephemeral("cap_test", "k1") is None
        state_a.put_ephemeral("cap_test", "k3", {"v": 3}, ttl_seconds=60, max_items=2)
        assert state_b.pop_ephemeral("cap_test", "k3") == {"v": 3}
    finally:
        db_a.engine.dispose()
        db_b.engine.dispose()
