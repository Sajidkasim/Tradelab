import base64
import hashlib
import hmac
import json
import re

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from tests.test_daily_journal import draft, login
from webapp import bullpen


def claims(token, secret):
    header, body, signature = token.split(".")
    signed = hmac.digest(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256)
    assert signature == base64.urlsafe_b64encode(signed).decode().rstrip("=")
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


def test_bullpen_requires_verified_team_email_and_issues_scoped_tokens(draft, monkeypatch):
    client, _, state = draft
    realtime_secret = "r" * 32
    app_id = "vpaas-magic-cookie-test"
    kid = app_id + "/test"
    signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = signing_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    for key, value in {
        "BULLPEN_SAJID_EMAIL": "Owner@Example.com",
        "BULLPEN_ENABLED": "1",
        "BULLPEN_SUPABASE_JWT_SECRET": realtime_secret,
        "BULLPEN_JAAS_APP_ID": app_id,
        "BULLPEN_JAAS_KEY_ID": kid,
        "BULLPEN_JAAS_PRIVATE_KEY": pem,
    }.items():
        monkeypatch.setenv(key, value)
    assert client.get("/api/bullpen").json() is None
    login(client, state, "friend@example.com", "friend-sub")
    assert client.get("/api/bullpen").json() is None
    assert client.get("/api/bullpen?join=true").status_code == 403
    login(client, state)
    assert client.get("/api/bullpen", headers={"X-Primus-CSRF": ""}).status_code == 403
    presence = client.get("/api/bullpen")
    assert presence.headers["Cache-Control"] == "no-store"
    assert "meeting" not in presence.json()
    payload = client.get("/api/bullpen?join=true").json()
    assert payload["name"] == "Sajid"
    assert payload["topic"] == bullpen.TOPIC
    realtime = claims(payload["token"], realtime_secret)
    meeting = payload["meeting"]
    assert realtime["role"] == "primus_bullpen"
    assert realtime["primus_bullpen"] is True
    assert realtime["exp"] - realtime["iat"] == bullpen.LIFETIME
    assert set(meeting) == {"appId", "roomName", "jwt"}
    assert meeting["appId"] == app_id
    header, body, signature = meeting["jwt"].split(".")
    decode = lambda part: base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    signing_key.public_key().verify(decode(signature), f"{header}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256())
    assert json.loads(decode(header)) == {"alg": "RS256", "kid": kid, "typ": "JWT"}
    jaas = json.loads(decode(body))
    assert (jaas["iss"], jaas["aud"], jaas["sub"], jaas["room"]) == ("chat", "jitsi", app_id, meeting["roomName"])
    assert jaas["context"]["user"] == {"id": realtime["sub"], "name": "Sajid", "moderator": "true"}
    assert re.fullmatch(r"PrimusLab-Bullpen-Live-[a-f0-9]{64}", meeting["roomName"])
    assert client.get("/api/bullpen?join=true").json()["meeting"]["roomName"] == meeting["roomName"]
    assert "owner@example.com" not in json.dumps([realtime, meeting])
    monkeypatch.setenv("BULLPEN_ROOM_VERSION", "2")
    assert client.get("/api/bullpen?join=true").json()["meeting"]["roomName"] != meeting["roomName"]
    monkeypatch.setenv("BULLPEN_JAAS_PRIVATE_KEY", "invalid")
    assert client.get("/api/bullpen?join=true").json() == {"name": "Sajid", "configured": False}
    monkeypatch.setenv("BULLPEN_ENABLED", "0")
    assert client.get("/api/bullpen?join=true").json() == {"name": "Sajid", "configured": False}


def test_live_alert_checks_team_and_suppresses_reconnects(draft, monkeypatch):
    client, _, state = draft
    for key, value in {
        "BULLPEN_ENABLED": "1",
        "BULLPEN_SAJID_EMAIL": "owner@example.com",
        "BULLPEN_AMIR_EMAIL": "amir@example.com",
        "BULLPEN_TEAM_EMAILS": "owner@example.com, AMIR@example.com, outsider@example.com",
        "BULLPEN_GMAIL_ADDRESS": "desk@gmail.com",
        "BULLPEN_GMAIL_APP_PASSWORD": "test password",
    }.items():
        monkeypatch.setenv(key, value)
    sent = []
    monkeypatch.setattr(bullpen, "_send_live_alert", lambda *args: sent.append(args))
    login(client, state, "friend@example.com", "friend-sub")
    assert client.post("/api/alert-team").status_code == 403
    login(client, state)
    assert client.post("/api/alert-team", headers={"X-Primus-CSRF": ""}).status_code == 403
    assert client.post("/api/alert-team").json() == {"queued": True}
    assert client.post("/api/alert-team").json() == {"queued": False}
    assert sent == [("desk@gmail.com", "testpassword", ["amir@example.com"], "Sajid")]


def test_tradingview_webhook_publishes_only_valid_alerts(draft, monkeypatch):
    client, _, _ = draft
    secret = "s" * 40
    monkeypatch.setenv("BULLPEN_ENABLED", "1")
    monkeypatch.setenv("BULLPEN_TV_WEBHOOK_SECRET", secret)
    monkeypatch.setenv("BULLPEN_TV_SUPABASE_KEY", "test-server-key")
    published = []

    async def publish(self, url, **kwargs):
        published.extend(kwargs["json"]["messages"])
        return bullpen.httpx.Response(202, request=bullpen.httpx.Request("POST", url))

    monkeypatch.setattr(bullpen.httpx.AsyncClient, "post", publish)
    endpoint = "/api/tv-webhook"
    assert client.post(endpoint, json={"secret": "wrong", "text": "NQ"}).status_code == 403
    assert client.post(endpoint, json={"secret": secret, "text": ""}).status_code == 422
    assert client.post(endpoint, content="x" * 4097).status_code == 413
    assert client.post(endpoint, json={"secret": secret, "text": " NQ 15m FVG touched "}).json() == {"published": True}
    assert len(published) == 1
    alert = published[0]
    assert alert["topic"] == bullpen.ALERT_TOPIC and alert["private"] is True
    assert alert["payload"]["name"] == "System"
    assert alert["payload"]["text"] == "NQ 15m FVG touched"
    assert "secret" not in alert["payload"]


def test_cloudflare_sfu_provider_proxy_and_shared_desk(draft, monkeypatch):
    client, _, state = draft
    realtime_secret = "r" * 32
    for key, value in {
        "BULLPEN_SAJID_EMAIL": "owner@example.com",
        "BULLPEN_ENABLED": "1",
        "BULLPEN_SUPABASE_JWT_SECRET": realtime_secret,
        "BULLPEN_CF_APP_ID": "cf-app-12345678",
        "BULLPEN_CF_APP_TOKEN": "super-secret-cf-token",
    }.items():
        monkeypatch.setenv(key, value)

    proxied = []

    async def fake_request(self, method, url, **kwargs):
        proxied.append((method, url, kwargs["headers"]["Authorization"], kwargs["json"]))
        return bullpen.httpx.Response(
            200,
            json={"sessionId": "sess-12345678", "sessionDescription": {"type": "answer", "sdp": "v=0"}},
            request=bullpen.httpx.Request(method, url),
        )

    monkeypatch.setattr(bullpen.httpx.AsyncClient, "request", fake_request)

    login(client, state, "friend@example.com", "friend-sub")
    assert client.post("/api/bullpen/sfu/sessions", json={}).status_code == 403
    assert client.get("/api/bullpen/desk").status_code == 403

    login(client, state)
    joined = client.get("/api/bullpen?join=true").json()
    assert joined["provider"] == "cloudflare"
    assert joined["meeting"]["provider"] == "cloudflare"
    assert "super-secret-cf-token" not in json.dumps(joined)

    res = client.post("/api/bullpen/sfu/sessions", json={"sessionDescription": {"type": "offer", "sdp": "v=0"}})
    assert res.status_code == 200
    assert res.json()["sessionId"] == "sess-12345678"
    assert proxied[0][0] == "POST"
    assert proxied[0][1] == "https://rtc.live.cloudflare.com/v1/apps/cf-app-12345678/sessions/new"
    assert proxied[0][2] == "Bearer super-secret-cf-token"

    assert client.post("/api/bullpen/sfu/sessions/bad!id/tracks", json={"tracks": []}).status_code == 422

    # Shared desk: daily bias & key levels
    assert client.get("/api/bullpen/desk").json()["levels"] == []
    updated = client.put(
        "/api/bullpen/desk",
        json={"bias": "bullish", "add_level": {"symbol": "nq", "price": "21480", "label": "PDH"}},
    ).json()
    assert updated["biases"] == {"Sajid": "bullish"}
    assert len(updated["levels"]) == 1
    assert updated["levels"][0]["symbol"] == "NQ"
    assert updated["levels"][0]["author"] == "Sajid"

    level_id = updated["levels"][0]["id"]
    after_remove = client.put("/api/bullpen/desk", json={"remove_level_id": level_id, "bias": None}).json()
    assert after_remove["biases"] == {}
    assert after_remove["levels"] == []


def test_level_status_moderator_disable_and_warmup_sync(draft, monkeypatch):
    client, _, state = draft
    realtime_secret = "r" * 32
    for key, value in {
        "BULLPEN_SAJID_EMAIL": "owner@example.com",
        "BULLPEN_AMIR_EMAIL": "amir@example.com",
        "BULLPEN_ENABLED": "1",
        "BULLPEN_SUPABASE_JWT_SECRET": realtime_secret,
        "BULLPEN_CF_APP_ID": "cf-app-12345678",
        "BULLPEN_CF_APP_TOKEN": "super-secret-cf-token",
    }.items():
        monkeypatch.setenv(key, value)

    async def fake_request(self, method, url, **kwargs):
        return bullpen.httpx.Response(
            200,
            json={"tracks": [{"mid": "1"}]},
            request=bullpen.httpx.Request(method, url),
        )

    monkeypatch.setattr(bullpen.httpx.AsyncClient, "request", fake_request)

    # Owner is moderator
    login(client, state)
    owner_access = client.get("/api/bullpen").json()
    assert owner_access["moderator"] is True

    # Add level and cycle status
    added = client.put(
        "/api/bullpen/desk",
        json={"add_level": {"symbol": "nq", "price": "21500", "label": "4H FVG"}},
    ).json()
    lvl = added["levels"][0]
    assert lvl["status"] == "watching"

    hit = client.put(
        "/api/bullpen/desk",
        json={"update_level_status": {"id": lvl["id"], "status": "hit"}},
    ).json()
    assert hit["levels"][0]["status"] == "hit"
    assert client.put(
        "/api/bullpen/desk",
        json={"update_level_status": {"id": lvl["id"], "status": "bogus"}},
    ).status_code == 422

    # Moderator disables Amir
    disabled_res = client.put(
        "/api/bullpen/desk",
        json={"set_disabled": {"name": "Amir", "disabled": True}},
    ).json()
    assert disabled_res["disabled"] == ["Amir"]

    # Switch to Amir (non-moderator)
    login(client, state, "amir@example.com", "amir-sub")
    amir_access = client.get("/api/bullpen").json()
    assert amir_access["moderator"] is False

    # Disabled Amir cannot mutate desk or publish local SFU tracks, but CAN pull remote tracks
    assert client.put(
        "/api/bullpen/desk",
        json={"add_level": {"symbol": "ES", "price": "6000", "label": "PDH"}},
    ).status_code == 403
    assert client.put(
        "/api/bullpen/desk",
        json={"set_disabled": {"name": "Sajid", "disabled": True}},
    ).status_code == 403
    assert client.post(
        "/api/bullpen/sfu/sessions/sess-12345678/tracks",
        json={"tracks": [{"location": "local", "mid": "0", "trackName": "audio-1"}]},
    ).status_code == 403
    assert client.post(
        "/api/bullpen/sfu/sessions/sess-12345678/tracks",
        json={"tracks": [{"location": "remote", "sessionId": "other-1234", "trackName": "audio-1"}]},
    ).status_code == 200

    # Complete Mindset Warm-up as Amir -> appears in desk.warmed_up
    warmup = client.get("/api/mindset/warmup").json()
    assert client.post(
        "/api/mindset/complete",
        json={"attempt_id": None, "day": warmup["day"]},
    ).status_code == 200
    assert "Amir" in client.get("/api/bullpen/desk").json()["warmed_up"]

    # Owner re-enables Amir -> Amir can post levels again
    login(client, state)
    enabled_res = client.put(
        "/api/bullpen/desk",
        json={"set_disabled": {"name": "Amir", "disabled": False}},
    ).json()
    assert enabled_res["disabled"] == []
    login(client, state, "amir@example.com", "amir-sub")
    assert client.put(
        "/api/bullpen/desk",
        json={"add_level": {"symbol": "ES", "price": "6000", "label": "PDH"}},
    ).status_code == 200

