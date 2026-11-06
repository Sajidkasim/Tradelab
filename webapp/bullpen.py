"""Issue scoped credentials for the private Primus Bullpen."""
import base64
import hashlib
import hmac
import json
import os
import time
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException, Request

JITSI_DOMAIN = "meet.jit.si"
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
        if os.getenv("BULLPEN_ENABLED") != "1" or len(realtime_secret) < 32:
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
            result["meeting"] = {
                "domain": JITSI_DOMAIN,
                "roomName": f"PrimusLab-Bullpen-Live-{suffix}",
            }
        return result
