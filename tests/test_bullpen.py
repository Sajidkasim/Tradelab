import base64
import hashlib
import hmac
import json

from tests.test_daily_journal import draft, login
from webapp import bullpen


def claims(token, secret):
    header, body, signature = token.split(".")
    signed = hmac.digest(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256)
    assert signature == base64.urlsafe_b64encode(signed).decode().rstrip("=")
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


def test_bullpen_requires_verified_team_email_and_issues_scoped_tokens(draft, monkeypatch):
    client, _, state = draft
    jitsi_secret = "j" * 32
    realtime_secret = "r" * 32
    for key, value in {
        "BULLPEN_SAJID_EMAIL": "Owner@Example.com",
        "BULLPEN_ENABLED": "1",
        "BULLPEN_JITSI_DOMAIN": "meet.example.com",
        "BULLPEN_JITSI_APP_ID": "primus",
        "BULLPEN_JITSI_APP_SECRET": jitsi_secret,
        "BULLPEN_SUPABASE_JWT_SECRET": realtime_secret,
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
    meeting = claims(payload["meeting"]["jwt"], jitsi_secret)
    assert realtime["role"] == "primus_bullpen"
    assert realtime["primus_bullpen"] is True
    assert realtime["exp"] - realtime["iat"] == bullpen.LIFETIME
    assert meeting["room"] == bullpen.ROOM
    assert meeting["context"]["user"] == {"id": realtime["sub"], "name": "Sajid"}
    assert "owner@example.com" not in json.dumps([realtime, meeting])
    monkeypatch.setenv("BULLPEN_JITSI_DOMAIN", "meet.jit.si")
    assert client.get("/api/bullpen?join=true").json() == {"name": "Sajid", "configured": False}
