"""Issue scoped credentials for the private Primus Bullpen."""
import base64
import hashlib
import hmac
import json
import os
import time
from uuid import NAMESPACE_URL, uuid5

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from fastapi import HTTPException, Request

TOPIC = "primus:bullpen:v1"
TEAM = ("Sajid", "Safwaan", "Mubeen", "Mustafa", "Amir")
LIFETIME = 600


def _segment(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def _sign(secret, claims):
    header = _segment(b'{"alg":"HS256","typ":"JWT"}')
    body = _segment(json.dumps(claims, separators=(",", ":")).encode())
    unsigned = header + b"." + body
    return (unsigned + b"." + _segment(hmac.digest(secret.encode(), unsigned, hashlib.sha256))).decode()


def _jaas_token(key, kid, claims):
    header = _segment(json.dumps({"alg": "RS256", "kid": kid, "typ": "JWT"}).encode())
    body = _segment(json.dumps(claims, separators=(",", ":")).encode())
    unsigned = header + b"." + body
    signature = key.sign(unsigned, padding.PKCS1v15(), hashes.SHA256())
    return (unsigned + b"." + _segment(signature)).decode()


def _team_name(email):
    email = (email or "").strip().casefold()
    matches = [name for name in TEAM if email and email == (
        os.getenv(f"BULLPEN_{name.upper()}_EMAIL") or os.getenv(f"COACH_{name.upper()}_EMAIL", "")
    ).strip().casefold()]
    return matches[0] if len(matches) == 1 else None


def mount(app, config, workspace, check_write):
    @app.get("/api/bullpen")
    def bullpen(request: Request, join: bool = False):
        if not config.google_required:
            return None
        try:
            member = workspace(request)
        except HTTPException as error:
            if error.status_code != 401:
                raise
            return None
        name = _team_name(member.get("email"))
        if not name:
            if join:
                raise HTTPException(403, "The Bullpen is reserved for the Primus team.")
            return None
        check_write(request, allow_missing_origin=True)

        realtime_secret = os.getenv("BULLPEN_SUPABASE_JWT_SECRET", "")
        app_id = os.getenv("BULLPEN_JAAS_APP_ID", "").strip()
        kid = os.getenv("BULLPEN_JAAS_KEY_ID", "").strip()
        private_pem = os.getenv("BULLPEN_JAAS_PRIVATE_KEY", "").strip().replace("\\n", "\n")
        if (os.getenv("BULLPEN_ENABLED") != "1" or len(realtime_secret) < 32
                or not app_id or not kid.startswith(app_id + "/") or not private_pem):
            return {"name": name, "configured": False}
        try:
            key = serialization.load_pem_private_key(private_pem.encode(), password=None)
        except (ValueError, TypeError):
            return {"name": name, "configured": False}
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
            return {"name": name, "configured": False}
        now = int(time.time())
        subject = str(uuid5(NAMESPACE_URL, f"{config.supabase_url}/primus-bullpen/{member['key']}"))
        expires = {"iat": now, "nbf": now - 5, "exp": now + LIFETIME}
        result = {
            "name": name, "configured": True, "topic": TOPIC,
            "url": config.supabase_url, "publishableKey": config.supabase_key,
            "token": _sign(realtime_secret, {**expires, "sub": subject, "aud": "authenticated",
                       "role": "primus_bullpen", "primus_bullpen": True}),
        }
        if join:
            version = os.getenv("BULLPEN_ROOM_VERSION", "1")
            suffix = hmac.digest(config.secret.encode(), f"primus-bullpen-room:{version}".encode(),
                                 hashlib.sha256).hex()
            room = f"PrimusLab-Bullpen-Live-{suffix}"
            result["meeting"] = {
                "appId": app_id,
                "roomName": room,
                "jwt": _jaas_token(key, kid, {
                    **expires, "aud": "jitsi", "iss": "chat", "sub": app_id, "room": room,
                    "context": {"user": {"id": subject, "name": name,
                                         "moderator": "true" if member["key"] == "owner" else "false"},
                                "features": {"recording": False, "livestreaming": False,
                                             "transcription": False, "outbound-call": False},
                                "room": {"regex": False}},
                }),
            }
        return result
