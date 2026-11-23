"""Tests for Cloudflare Realtime TURN relay, Primax semantic memory, and edge CDN headers."""
from types import SimpleNamespace
import httpx
import pytest
from fastapi.testclient import TestClient

from core.db import Database
from tests.test_daily_journal import draft, login
from webapp import daily_journal, primax_memory
from webapp.app import create_app
from webapp.config import Settings


@pytest.fixture
def preview_client(tmp_path):
    db_path = tmp_path / "preview.db"
    config = Settings(
        str(db_path),
        "owner@example.com",
        "s" * 48,
        "http://127.0.0.1:8000",
        local=True,
        lab_path="/lab",
        site_preview=True,
    )
    app = create_app(config)
    with TestClient(app, base_url="http://127.0.0.1:8000", client=("127.0.0.1", 50000)) as client:
        session = client.get("/api/session").json()
        client.headers.update({"X-Primus-CSRF": session["csrf"], "Origin": "http://127.0.0.1:8000"})
        yield client, app


def test_bullpen_turn_relay_generates_filters_port53_caches_and_falls_back(draft, monkeypatch):
    from tests.test_daily_journal import login
    client, _app, state = draft
    monkeypatch.setenv("BULLPEN_ENABLED", "1")
    monkeypatch.setenv("BULLPEN_SAJID_EMAIL", "owner@example.com")
    monkeypatch.setenv("BULLPEN_SUPABASE_JWT_SECRET", "z" * 48)
    monkeypatch.setenv("BULLPEN_CF_APP_ID", "cf_app_test_123456")
    monkeypatch.setenv("BULLPEN_CF_APP_TOKEN", "cf_secret_token")
    monkeypatch.setenv("BULLPEN_CF_TURN_KEY_ID", "turn_key_123456")
    monkeypatch.setenv("BULLPEN_CF_TURN_API_TOKEN", "turn_api_secret")

    calls = []

    def fake_post(url, *, headers=None, json=None, timeout=None):
        calls.append((url, headers, json))
        return SimpleNamespace(
            status_code=201,
            json=lambda: {
                "iceServers": [
                    {"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]},
                    {
                        "urls": [
                            "turn:turn.cloudflare.com:3478?transport=udp",
                            "turn:turn.cloudflare.com:53?transport=udp",
                            "turns:turn.cloudflare.com:443?transport=tcp",
                        ],
                        "username": "u-test",
                        "credential": "c-test",
                    },
                ]
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    login(client, state)
    first = client.get("/api/bullpen?join=true")
    assert first.status_code == 200, first.text
    meeting = first.json()["meeting"]
    assert meeting["provider"] == "cloudflare"
    assert meeting["turnEnabled"] is True
    all_urls = [u for server in meeting["iceServers"] for u in server["urls"]]
    assert "turn:turn.cloudflare.com:3478?transport=udp" in all_urls
    assert "turns:turn.cloudflare.com:443?transport=tcp" in all_urls
    assert all(":53" not in u for u in all_urls)
    assert len(calls) == 1

    # Second join uses the 6-hour cache rather than hammering Cloudflare API.
    second = client.get("/api/bullpen?join=true")
    assert second.status_code == 200
    assert second.json()["meeting"]["turnEnabled"] is True
    assert len(calls) == 1

    # Missing TURN key cleanly falls back to STUN without failing join.
    monkeypatch.delenv("BULLPEN_CF_TURN_KEY_ID")
    fallback = client.get("/api/bullpen?join=true")
    assert fallback.status_code == 200
    fb_meeting = fallback.json()["meeting"]
    assert fb_meeting["turnEnabled"] is False
    assert fb_meeting["iceServers"] == [{"urls": "stun:stun.cloudflare.com:3478"}]


def test_primax_memory_bge_embeddings_and_caching(tmp_path, monkeypatch):
    db = Database(str(tmp_path / "mem.db"))
    db.migrate()
    daily_journal.save(db, "2026-10-14", {
        "plan": "Wait for CPI dust to settle before touching NQ.",
        "notes": "Chased the 08:30 CPI spike and got chopped up twice.",
        "lesson": "Never trade the first 15 minutes after CPI news.",
        "mindset": "Frustrated",
    })
    daily_journal.save(db, "2026-10-20", {
        "plan": "Focus on 15m FVG displacement on ES.",
        "notes": "Clean London low sweep, held calmly to 2R target.",
        "lesson": "Patience on the pullback pays.",
        "mindset": "Patient",
    })

    monkeypatch.setenv("COACH_PROVIDER", "cloudflare")
    monkeypatch.setenv("COACH_CLOUDFLARE_ACCOUNT_ID", "a" * 32)
    monkeypatch.setenv("COACH_CLOUDFLARE_API_TOKEN", "cf-token")

    embed_calls = []

    def fake_post(url, *, headers=None, json=None, timeout=None, allow_redirects=None):
        assert "/ai/run/@cf/baai/bge-small-en-v1.5" in url
        texts = json["text"]
        embed_calls.append(texts)
        vectors = []
        for t in texts:
            low = t.lower()
            if "cpi" in low or "inflation" in low or "news" in low:
                vectors.append([0.95, 0.05, 0.0])
            else:
                vectors.append([0.05, 0.95, 0.0])
        return SimpleNamespace(ok=True, json=lambda: {"success": True, "result": {"data": vectors}})

    monkeypatch.setattr(primax_memory.requests, "post", fake_post)

    # Semantic query ("inflation release") has zero exact word overlap with "CPI" yet recalls 2026-10-14!
    recalled = primax_memory.recall(db, "How did I handle the inflation release?", exclude_day="2026-11-01")
    assert recalled
    assert recalled[0]["day"] == "2026-10-14"
    assert recalled[0]["mindset"] == "Frustrated"
    assert len(embed_calls) == 1
    assert len(embed_calls[0]) == 3  # query + 2 unindexed days

    # Second recall uses cached vectors and embeds ONLY the new query.
    recalled_again = primax_memory.recall(db, "inflation release mistakes", exclude_day="2026-11-01")
    assert recalled_again[0]["day"] == "2026-10-14"
    assert len(embed_calls) == 2
    assert len(embed_calls[1]) == 1

    # Deleting a day drops its cached vector.
    primax_memory.remove_day(db, "2026-10-14")
    stored = db.get_setting(primax_memory.KEY, {})
    assert "2026-10-14" not in stored["items"]
    assert "2026-10-20" in stored["items"]
    db.engine.dispose()


def test_primax_memory_lexical_fallback_and_coach_endpoint(preview_client, monkeypatch):
    client, app = preview_client
    monkeypatch.delenv("COACH_CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("COACH_CLOUDFLARE_API_TOKEN", raising=False)

    # Seed two past journal days via the API
    r1 = client.put("/api/journal/2026-09-10", json={
        "plan": "Respect daily loss limit",
        "notes": "Revenge traded NQ after morning stop out",
        "lesson": "Walk away for 30 minutes after a red trade",
        "mindset": "Frustrated",
    })
    assert r1.status_code == 200, r1.text
    r2 = client.put("/api/journal/2026-09-12", json={
        "plan": "Wait for 9:45 open range",
        "notes": "Clean A+ setup on ES",
        "lesson": "Stick to the first setup",
        "mindset": "Patient",
    })
    assert r2.status_code == 200, r2.text

    captured = {}

    def fake_provider(brief):
        captured["recalled_memories"] = brief.get("recalled_memories")
        return "Remember 2026-09-10: walking away after a stop-out helped reset."

    from core import registry
    monkeypatch.setattr("webapp.app.load_extensions", lambda folder: {})
    monkeypatch.setitem(registry.COACH_PROVIDERS, "Primax - Trading Assistant", fake_provider)

    res = client.post(
        "/api/journal/coach?day=2026-09-15",
        json={"question": "What did I learn last time I revenge traded?", "history": []},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "2026-09-10" in body["markdown"]
    assert body["memories"]
    assert body["memories"][0]["day"] == "2026-09-10"
    assert body["memories"][0]["mindset"] == "Frustrated"
    assert captured["recalled_memories"][0]["day"] == "2026-09-10"


def test_cloudflare_cdn_cache_headers(preview_client):
    client, _app = preview_client
    api_res = client.get("/api/session")
    assert api_res.headers.get("cache-control") == "no-store"
    html_res = client.get("/")
    assert html_res.headers.get("cache-control") == "no-store"
    pwa_res = client.get("/pwa/manifest.webmanifest")
    if pwa_res.status_code == 200:
        assert pwa_res.headers.get("cache-control") == "public, max-age=86400"
