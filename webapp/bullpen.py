"""Issue scoped credentials for the private Primus Bullpen."""
import base64
import hashlib
import hmac
import json
import os
import logging
import smtplib
import ssl
from email.message import EmailMessage
from threading import Lock
import time
from uuid import NAMESPACE_URL, uuid4, uuid5

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

import httpx
from fastapi import BackgroundTasks, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .bullpen_feed import MacroFeed

TOPIC = "primus:bullpen:v1"
ALERT_TOPIC = "primus:bullpen:alerts:v1"
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


def _send_live_alert(sender, password, recipients, name):
    message = EmailMessage()
    message["From"] = sender
    message["To"] = "undisclosed-recipients:;"
    message["Subject"] = f"🔴 {name} is live in the NQ Bullpen"
    message.set_content(f"{name} is live in the NQ Bullpen. Open Learn in PrimusLab to join.")
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10,
                              context=ssl.create_default_context()) as smtp:
            smtp.login(sender, password)
            refused = smtp.send_message(message, from_addr=sender, to_addrs=recipients)
            if refused:
                logging.getLogger(__name__).warning("Bullpen email refused for %d recipients", len(refused))
    except OSError as error:
        logging.getLogger(__name__).warning("Bullpen email failed (%s)", type(error).__name__)


def mount(app, config, workspace, check_write):
    macro_feed = MacroFeed()

    @app.get("/api/bullpen/macro-feed")
    async def read_macro_feed(request: Request):
        if not config.google_required or os.getenv("BULLPEN_ENABLED") != "1":
            raise HTTPException(403, "The Bullpen is unavailable.")
        member = await run_in_threadpool(workspace, request)
        if not _team_name(member.get("email")):
            raise HTTPException(403, "The Bullpen is reserved for the Primus team.")
        return await macro_feed.read()

    alert_lock = Lock()
    last_alert = {}

    @app.post("/api/alert-team", status_code=202)
    def alert_team(request: Request, background_tasks: BackgroundTasks):
        if not config.google_required or os.getenv("BULLPEN_ENABLED") != "1":
            raise HTTPException(403, "The Bullpen is unavailable.")
        member = workspace(request)
        email = (member.get("email") or "").strip().casefold()
        name = _team_name(email)
        if not name:
            raise HTTPException(403, "The Bullpen is reserved for the Primus team.")

        sender = os.getenv("BULLPEN_GMAIL_ADDRESS", "").strip()
        password = "".join(os.getenv("BULLPEN_GMAIL_APP_PASSWORD", "").split())
        configured_emails = os.getenv("BULLPEN_TEAM_EMAILS", "").casefold().split(",")
        recipients = sorted({address for value in configured_emails
                             if (address := value.strip()) != email and _team_name(address)})
        if not (sender and password and recipients):
            return {"queued": False}
        with alert_lock:
            now = time.monotonic()
            if now - last_alert.get(name, float("-inf")) < 900:
                return {"queued": False}
            last_alert[name] = now
        background_tasks.add_task(_send_live_alert, sender, password, recipients, name)
        return {"queued": True}

    @app.post("/api/tv-webhook")
    async def tradingview_webhook(request: Request):
        secret = os.getenv("BULLPEN_TV_WEBHOOK_SECRET", "")
        service_key = os.getenv("BULLPEN_TV_SUPABASE_KEY", "")
        if os.getenv("BULLPEN_ENABLED") != "1" or len(secret) < 32 or not service_key or not config.supabase_url:
            raise HTTPException(503, "TradingView alerts are unavailable.")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 4096:
                raise HTTPException(413, "Alert payload is too large.")
            body.extend(chunk)
        try:
            payload = json.loads(body)
        except (ValueError, RecursionError):
            raise HTTPException(400, "Expected a JSON alert.") from None
        supplied = payload.get("secret") if isinstance(payload, dict) else None
        if not isinstance(supplied, str) or not hmac.compare_digest(supplied.encode(), secret.encode()):
            raise HTTPException(403, "Invalid webhook credentials.")
        message = payload.get("text")
        if not isinstance(message, str) or not 1 <= len(message.strip()) <= 400:
            raise HTTPException(422, "Alert text must contain 1 to 400 characters.")
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                response = await client.post(
                    f"{config.supabase_url.rstrip('/')}/realtime/v1/api/broadcast",
                    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
                    json={"messages": [{"topic": ALERT_TOPIC, "event": "alert", "private": True,
                                        "payload": {"name": "System", "id": str(uuid4()),
                                                    "text": message.strip()}}]},
                )
                response.raise_for_status()
        except httpx.HTTPError:
            raise HTTPException(502, "Could not publish the TradingView alert.") from None
        return {"published": True}

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
            "name": name, "configured": True, "topic": TOPIC, "alertTopic": ALERT_TOPIC,
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
