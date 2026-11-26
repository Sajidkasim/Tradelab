"""Regression tests for free-service upgrades: Web Push, Discord/Telegram webhooks, US Treasury Fiscal Data, and Groq Whisper."""
import base64
import json
import secrets
from datetime import date, timedelta

import httpx
import pytest
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from tests.test_daily_journal import draft, login
from tools import refresh_matrix
from webapp import bullpen, daily_journal, webpush


def _fake_browser_subscription(endpoint="https://fcm.googleapis.com/fcm/send/test-token-123"):
    ua_key = ec.generate_private_key(ec.SECP256R1())
    pub_bytes = ua_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return {
        "endpoint": endpoint,
        "keys": {
            "p256dh": base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("ascii"),
            "auth": base64.urlsafe_b64encode(secrets.token_bytes(16)).rstrip(b"=").decode("ascii"),
        },
    }


def test_webpush_keygen_encryption_headers_and_ssrf_validation():
    pub_b64, priv_b64 = webpush.generate_vapid_keys()
    assert len(webpush._b64u_decode(pub_b64)) == 65
    assert len(webpush._b64u_decode(priv_b64)) == 32

    sub = _fake_browser_subscription()
    clean = webpush.validate_subscription(sub)
    assert clean["endpoint"] == sub["endpoint"]

    # Reject insecure HTTP, loopback, private IPs, and bad key lengths
    with pytest.raises(ValueError):
        webpush.validate_subscription({**sub, "endpoint": "http://fcm.googleapis.com/fcm/send/1"})
    with pytest.raises(ValueError):
        webpush.validate_subscription({**sub, "endpoint": "https://127.0.0.1/push"})
    with pytest.raises(ValueError):
        webpush.validate_subscription({**sub, "endpoint": "https://192.168.1.5/push"})
    with pytest.raises(ValueError):
        webpush.validate_subscription({**sub, "keys": {"p256dh": "short", "auth": sub["keys"]["auth"]}})

    ciphertext = webpush.encrypt_payload(b'{"title":"Test"}', clean["keys"]["p256dh"], clean["keys"]["auth"])
    # RFC 8188 header is 16 (salt) + 4 (rs) + 1 (idlen=65) + 65 (as_pub) = 86 bytes + AES-GCM tag (16) + payload + 1
    assert len(ciphertext) > 100
    assert ciphertext[20] == 65

    priv_key = webpush._load_vapid_private_key(priv_b64)
    headers = webpush.build_vapid_headers(clean["endpoint"], pub_b64, priv_key, "mailto:alerts@primustrader.co.uk")
    assert headers["Content-Encoding"] == "aes128gcm"
    assert headers["Authorization"].startswith("vapid t=")
    assert f", k={pub_b64}" in headers["Authorization"]


def test_webpush_routes_subscribe_test_and_prune_410(draft, monkeypatch):
    client, _, state = draft
    pub_b64, priv_b64 = webpush.generate_vapid_keys()
    monkeypatch.setenv("VAPID_PUBLIC_KEY", pub_b64)
    monkeypatch.setenv("VAPID_PRIVATE_KEY", priv_b64)

    login(client, state)
    cfg = client.get("/api/push/config")
    assert cfg.status_code == 200
    assert cfg.json() == {"enabled": True, "public_key": pub_b64, "subscribed_count": 0}

    sub = _fake_browser_subscription()
    saved = client.post("/api/push/subscribe", json=sub)
    assert saved.status_code == 200
    assert saved.json() == {"subscribed": True, "subscribed_count": 1}

    sent_calls = []

    def fake_post(url, *, content=None, headers=None, timeout=None, follow_redirects=None):
        sent_calls.append((url, headers, len(content or b"")))
        return httpx.Response(201, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    tested = client.post("/api/push/test")
    assert tested.status_code == 200
    assert tested.json() == {"delivered": 1}
    assert len(sent_calls) == 1
    assert sent_calls[0][0] == sub["endpoint"]

    # Simulate an expired browser push endpoint (HTTP 410) and verify automatic pruning
    def fake_post_410(url, **kwargs):
        return httpx.Response(410, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post_410)
    expired_res = client.post("/api/push/test")
    assert expired_res.status_code == 200
    assert expired_res.json() == {"delivered": 0}
    assert client.get("/api/push/config").json()["subscribed_count"] == 0


def test_bullpen_discord_and_telegram_webhook_validation_and_dispatch(draft, monkeypatch):
    client, _, state = draft
    monkeypatch.setenv("BULLPEN_SAJID_EMAIL", "owner@example.com")
    monkeypatch.setenv("BULLPEN_ENABLED", "1")

    # Non-Discord URL must be rejected by SSRF allowlist
    monkeypatch.setenv("BULLPEN_DISCORD_WEBHOOK_URL", "https://evil.example/api/webhooks/1/abc")
    assert bullpen._discord_webhook_url() is None

    discord_url = "https://discord.com/api/webhooks/1234567890/token_value_here"
    tg_token = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345"
    tg_chat = "-1001234567890"
    monkeypatch.setenv("BULLPEN_DISCORD_WEBHOOK_URL", discord_url)
    monkeypatch.setenv("BULLPEN_TELEGRAM_BOT_TOKEN", tg_token)
    monkeypatch.setenv("BULLPEN_TELEGRAM_CHAT_ID", tg_chat)
    assert bullpen._discord_webhook_url() == discord_url
    assert bullpen._telegram_credentials() == (tg_token, tg_chat)

    posted = []

    def fake_post(url, *, json=None, timeout=None, follow_redirects=None):
        posted.append((url, json))
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)

    login(client, state)
    res = client.post("/api/alert-team")
    assert res.status_code == 202
    assert res.json() == {"queued": True}
    assert any(url == discord_url and "Sajid" in body["content"] for url, body in posted)
    assert any(
        url == f"https://api.telegram.org/bot{tg_token}/sendMessage" and body["chat_id"] == tg_chat
        for url, body in posted
    )


def test_treasury_tga_and_auctions_refresh_and_deduplication(monkeypatch):
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    next_week = (date.today() + timedelta(days=6)).isoformat()

    class FakeResp:
        def __init__(self, payload, ok=True, status_code=200):
            self._payload = payload
            self.ok = ok
            self.status_code = status_code

        def json(self):
            return self._payload

    def fake_get(url, params=None, headers=None, timeout=None):
        if "operating_cash_balance" in url:
            return FakeResp({
                "data": [
                    {"record_date": "2026-04-10", "open_today_bal": "740000"},
                    {"record_date": "2026-04-09", "open_today_bal": "748000"},
                    {"record_date": "2026-04-08", "open_today_bal": "752000"},
                    {"record_date": "2026-04-07", "open_today_bal": "758000"},
                    {"record_date": "2026-04-06", "open_today_bal": "761000"},
                    {"record_date": "2026-04-03", "open_today_bal": "765000"},
                ]
            })
        if "upcoming_auctions" in url:
            return FakeResp({
                "data": [
                    {
                        "record_date": tomorrow,
                        "security_type": "Note",
                        "security_term": "10-Year",
                        "offering_amt": "42000000000",
                    },
                    {
                        "record_date": next_week,
                        "security_type": "Bond",
                        "security_term": "30-Year",
                        "offering_amt": "25000000000",
                    },
                    {
                        "record_date": "2020-01-01",
                        "security_type": "Note",
                        "security_term": "10-Year",
                        "offering_amt": "38000000000",
                    },
                ]
            })
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(requests, "get", fake_get)

    snapshot = {"calendar": [{"date": "2026-04-12", "event": "US CPI", "source": "FMP"}]}
    assert refresh_matrix.refresh_treasury(snapshot) is True
    tga = snapshot["treasury"]["tga"]
    assert tga["balanceB"] == 740.0
    assert tga["delta5dB"] == -25.0
    assert tga["impulse"] == "Liquidity Tailwind"
    assert len(snapshot["treasury"]["auctions"]) == 2
    assert snapshot["treasury"]["auctions"][0]["amount"] == "$42B"

    # Running a second refresh must not duplicate US Treasury calendar rows
    assert refresh_matrix.refresh_treasury(snapshot) is True
    treasury_cal = [ev for ev in snapshot["calendar"] if ev.get("source") == "US Treasury"]
    assert len(treasury_cal) == 2
    assert any("10-Year" in ev["event"] and "$42B" in ev["event"] for ev in treasury_cal)


def test_groq_whisper_fast_path_and_cloudflare_fallback(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("COACH_CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("COACH_CLOUDFLARE_API_TOKEN", raising=False)
    assert daily_journal.voice_transcribe_enabled() is False

    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_key_123")
    assert daily_journal.voice_transcribe_enabled() is True

    calls = []

    class FakeResp:
        def __init__(self, ok, payload):
            self.ok = ok
            self._payload = payload

        def json(self):
            return self._payload

    def fake_post_groq(url, headers=None, files=None, data=None, timeout=None, allow_redirects=None):
        calls.append((url, files, data))
        return FakeResp(True, {"text": "  Swept London low on NQ for +2R  "})

    monkeypatch.setattr(requests, "post", fake_post_groq)
    text = daily_journal.transcribe_audio(b"fake-mp4-bytes", filename="voice-note.mp4", content_type="audio/mp4")
    assert text == "Swept London low on NQ for +2R"
    assert calls[0][0] == daily_journal.GROQ_TRANSCRIBE_URL
    assert calls[0][1]["file"][0] == "voice-note.mp4"
    assert calls[0][1]["file"][2] == "audio/mp4"
    assert "FVG" in calls[0][2]["prompt"]

    # If Groq fails and Cloudflare Workers AI is configured, fall back seamlessly
    monkeypatch.setenv("COACH_CLOUDFLARE_ACCOUNT_ID", "a" * 32)
    monkeypatch.setenv("COACH_CLOUDFLARE_API_TOKEN", "cf-token-123")

    def fake_post_fallback(url, **kwargs):
        if "api.groq.com" in url:
            return FakeResp(False, {})
        return FakeResp(True, {"result": {"text": "Cloudflare fallback transcript"}})

    monkeypatch.setattr(requests, "post", fake_post_fallback)
    assert daily_journal.transcribe_audio(b"fake-webm-bytes") == "Cloudflare fallback transcript"


def test_metrics_return_distribution_buckets_r_multiples_and_empty_frames():
    import pandas as pd
    from core import metrics

    empty = metrics.return_distribution(pd.DataFrame())
    assert empty["unit"] == "R"
    assert empty["total"] == 0
    assert len(empty["buckets"]) == 9
    assert all(b["count"] == 0 for b in empty["buckets"])

    df = pd.DataFrame([
        {"exit_price": 100.0, "net_pnl": -200.0, "r_multiple": -1.0},
        {"exit_price": 105.0, "net_pnl": 200.0, "r_multiple": 1.0},
        {"exit_price": 110.0, "net_pnl": 400.0, "r_multiple": 2.0},
        {"exit_price": 115.0, "net_pnl": 700.0, "r_multiple": 3.5},
    ])
    dist = metrics.return_distribution(df)
    assert dist["unit"] == "R"
    assert dist["total"] == 4
    assert dist["mean"] == pytest.approx(1.375)
    by_label = {b["label"]: b["count"] for b in dist["buckets"]}
    assert by_label["−1R"] == 1
    assert by_label["+1R"] == 1
    assert by_label["+2R"] == 1
    assert by_label["+3R+"] == 1
