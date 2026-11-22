"""Issue scoped credentials for the private Primus Bullpen."""
import base64
import hashlib
import hmac
import json
import os
import re
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

    def _require_team(request: Request, *, write: bool = False):
        if not config.google_required or os.getenv("BULLPEN_ENABLED") != "1":
            raise HTTPException(403, "The Bullpen is unavailable.")
        member = workspace(request)
        name = _team_name(member.get("email"))
        if not name:
            raise HTTPException(403, "The Bullpen is reserved for the Primus team.")
        if write:
            check_write(request)
        return member, name

    def _cf_credentials():
        app_id = (os.getenv("BULLPEN_CF_APP_ID") or os.getenv("CLOUDFLARE_CALLS_APP_ID") or "").strip()
        token = (os.getenv("BULLPEN_CF_APP_TOKEN") or os.getenv("CLOUDFLARE_CALLS_APP_TOKEN") or "").strip()
        if not app_id or not token or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", app_id):
            return None
        return app_id, token

    async def _cf_proxy(method: str, suffix: str, payload: dict | None = None):
        creds = _cf_credentials()
        if not creds:
            raise HTTPException(503, "Cloudflare Realtime SFU is not configured.")
        app_id, token = creds
        url = f"https://rtc.live.cloudflare.com/v1/apps/{app_id}{suffix}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.request(
                    method,
                    url,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=payload if payload is not None else {},
                )
        except httpx.HTTPError:
            raise HTTPException(502, "Could not reach Cloudflare Realtime.") from None
        if response.status_code >= 400:
            raise HTTPException(502, "Cloudflare Realtime rejected the session request.")
        try:
            return response.json()
        except ValueError:
            raise HTTPException(502, "Invalid response from Cloudflare Realtime.") from None

    @app.post("/api/bullpen/sfu/sessions")
    async def sfu_new_session(request: Request):
        await run_in_threadpool(_require_team, request, write=True)
        body = await request.body()
        if len(body) > 65536:
            raise HTTPException(413, "SDP payload is too large.")
        payload = json.loads(body) if body else {}
        if not isinstance(payload, dict):
            raise HTTPException(422, "Expected JSON object.")
        return await _cf_proxy("POST", "/sessions/new", payload)

    @app.post("/api/bullpen/sfu/sessions/{session_id}/tracks")
    async def sfu_new_tracks(session_id: str, request: Request):
        member, name = await run_in_threadpool(_require_team, request, write=True)
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", session_id):
            raise HTTPException(422, "Invalid SFU session ID.")
        body = await request.body()
        if len(body) > 65536:
            raise HTTPException(413, "Track payload is too large.")
        try:
            payload = json.loads(body)
        except ValueError:
            raise HTTPException(400, "Expected JSON body.") from None
        if not isinstance(payload, dict) or not isinstance(payload.get("tracks"), list) or len(payload["tracks"]) > 16:
            raise HTTPException(422, "Invalid tracks payload.")
        if member["key"] != "owner" and any(isinstance(t, dict) and t.get("location") == "local" for t in payload["tracks"]):
            def _is_disabled():
                with app.state.workspaces.lock:
                    return name in _read_desk()["disabled"]
            if await run_in_threadpool(_is_disabled):
                raise HTTPException(403, "Your mic and screen share are disabled by the moderator.")
        return await _cf_proxy("POST", f"/sessions/{session_id}/tracks/new", payload)

    @app.put("/api/bullpen/sfu/sessions/{session_id}/renegotiate")
    async def sfu_renegotiate(session_id: str, request: Request):
        await run_in_threadpool(_require_team, request, write=True)
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", session_id):
            raise HTTPException(422, "Invalid SFU session ID.")
        body = await request.body()
        if len(body) > 65536:
            raise HTTPException(413, "Renegotiation payload is too large.")
        try:
            payload = json.loads(body)
        except ValueError:
            raise HTTPException(400, "Expected JSON body.") from None
        if not isinstance(payload, dict):
            raise HTTPException(422, "Invalid renegotiation payload.")
        return await _cf_proxy("PUT", f"/sessions/{session_id}/renegotiate", payload)

    @app.put("/api/bullpen/sfu/sessions/{session_id}/tracks/close")
    async def sfu_close_tracks(session_id: str, request: Request):
        await run_in_threadpool(_require_team, request, write=True)
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", session_id):
            raise HTTPException(422, "Invalid SFU session ID.")
        body = await request.body()
        if len(body) > 65536:
            raise HTTPException(413, "Close payload is too large.")
        try:
            payload = json.loads(body)
        except ValueError:
            raise HTTPException(400, "Expected JSON body.") from None
        if not isinstance(payload, dict):
            raise HTTPException(422, "Invalid close payload.")
        return await _cf_proxy("PUT", f"/sessions/{session_id}/tracks/close", payload)

    DESK_KEY = "primus_bullpen_desk_v1"
    LEVEL_STATUSES = ("watching", "taken", "hit", "invalidated")

    def _ny_today():
        from datetime import datetime
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date().isoformat()

    def _warmed_up_today(today):
        root = app.state.workspaces.root
        done = set()
        warmup = root.get_setting("primus_mindset_team_warmup_v1", {})
        if isinstance(warmup, dict) and warmup.get("day") == today:
            done.update(n for n in warmup.get("completed", []) if n in TEAM)
        scores = root.get_setting("primus_mindset_team_score_v1", {})
        if isinstance(scores, dict) and scores.get("day") == today and isinstance(scores.get("scores"), dict):
            done.update(n for n in scores["scores"] if n in TEAM)
        return sorted(done)

    def _read_desk():
        today = _ny_today()
        stored = app.state.workspaces.root.get_setting(DESK_KEY, {})
        warmed_up = _warmed_up_today(today)
        if not isinstance(stored, dict) or stored.get("day") != today:
            return {"day": today, "biases": {}, "levels": [], "disabled": [], "warmed_up": warmed_up}
        raw_levels = stored.get("levels") if isinstance(stored.get("levels"), list) else []
        levels = [
            {**lvl, "status": lvl.get("status") if lvl.get("status") in LEVEL_STATUSES else "watching"}
            for lvl in raw_levels if isinstance(lvl, dict)
        ]
        raw_disabled = stored.get("disabled") if isinstance(stored.get("disabled"), list) else []
        disabled = sorted({n for n in raw_disabled if n in TEAM})
        return {
            "day": today,
            "biases": stored.get("biases") if isinstance(stored.get("biases"), dict) else {},
            "levels": levels,
            "disabled": disabled,
            "warmed_up": warmed_up,
        }

    @app.get("/api/bullpen/desk")
    def get_desk(request: Request):
        _require_team(request)
        with app.state.workspaces.lock:
            return _read_desk()

    @app.put("/api/bullpen/desk")
    async def update_desk(request: Request):
        member, name = await run_in_threadpool(_require_team, request, write=True)
        is_moderator = member["key"] == "owner"
        try:
            payload = await request.json()
        except ValueError:
            raise HTTPException(400, "Expected JSON body.") from None
        if not isinstance(payload, dict):
            raise HTTPException(422, "Expected JSON object.")

        def mutate():
            with app.state.workspaces.lock:
                desk = _read_desk()
                biases = dict(desk["biases"])
                levels = list(desk["levels"])
                disabled = set(desk["disabled"])
                if not is_moderator and name in disabled:
                    raise HTTPException(403, "You have been disabled by the moderator.")
                if "set_disabled" in payload:
                    if not is_moderator:
                        raise HTTPException(403, "Only the moderator can disable or enable members.")
                    item = payload["set_disabled"]
                    if not isinstance(item, dict):
                        raise HTTPException(422, "Invalid moderation payload.")
                    target = str(item.get("name", "")).strip()
                    flag = bool(item.get("disabled"))
                    if target not in TEAM or target == name:
                        raise HTTPException(422, "Select a valid teammate to moderate.")
                    if flag:
                        disabled.add(target)
                    else:
                        disabled.discard(target)
                if "bias" in payload:
                    bias = payload["bias"]
                    if bias in (None, ""):
                        biases.pop(name, None)
                    elif bias in ("bullish", "bearish", "neutral"):
                        biases[name] = bias
                    else:
                        raise HTTPException(422, "Invalid bias value.")
                if "add_level" in payload and isinstance(payload["add_level"], dict):
                    item = payload["add_level"]
                    symbol = str(item.get("symbol", "")).strip().upper()[:12]
                    price = str(item.get("price", "")).strip()[:24]
                    label = str(item.get("label", "")).strip()[:80]
                    if not symbol or not price or not label:
                        raise HTTPException(422, "Provide symbol, price, and label.")
                    if len(levels) >= 25:
                        raise HTTPException(422, "Up to 25 shared levels per session.")
                    levels.insert(0, {
                        "id": uuid4().hex[:12], "symbol": symbol, "price": price,
                        "label": label, "author": name, "status": "watching",
                    })
                if "update_level_status" in payload and isinstance(payload["update_level_status"], dict):
                    item = payload["update_level_status"]
                    target_id = str(item.get("id", "")).strip()
                    next_status = str(item.get("status", "")).strip().lower()
                    if next_status not in LEVEL_STATUSES:
                        raise HTTPException(422, "Invalid level status.")
                    levels = [
                        {**lvl, "status": next_status} if lvl.get("id") == target_id else lvl
                        for lvl in levels
                    ]
                if "remove_level_id" in payload:
                    target = str(payload["remove_level_id"])
                    levels = [lvl for lvl in levels if lvl.get("id") != target]
                stored_doc = {
                    "day": desk["day"],
                    "biases": biases,
                    "levels": levels,
                    "disabled": sorted(disabled),
                }
                app.state.workspaces.root.set_setting(DESK_KEY, stored_doc)
                return {**stored_doc, "warmed_up": desk["warmed_up"]}

        return await run_in_threadpool(mutate)

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

        cf_creds = _cf_credentials()
        now = int(time.time())
        subject = str(uuid5(NAMESPACE_URL, f"{config.supabase_url}/primus-bullpen/{member['key']}"))
        expires = {"iat": now, "nbf": now - 5, "exp": now + LIFETIME}
        base_result = {
            "name": name, "moderator": member["key"] == "owner",
            "configured": True, "topic": TOPIC, "alertTopic": ALERT_TOPIC,
            "url": config.supabase_url, "publishableKey": config.supabase_key,
            "token": _sign(realtime_secret, {**expires, "sub": subject, "aud": "authenticated",
                       "role": "primus_bullpen", "primus_bullpen": True}),
        }
        if cf_creds is not None:
            result = {**base_result, "provider": "cloudflare"}
            if join:
                result["meeting"] = {
                    "provider": "cloudflare",
                    "iceServers": [{"urls": "stun:stun.cloudflare.com:3478"}],
                }
            return result

        app_id = os.getenv("BULLPEN_JAAS_APP_ID", "").strip()
        kid = os.getenv("BULLPEN_JAAS_KEY_ID", "").strip()
        private_pem = os.getenv("BULLPEN_JAAS_PRIVATE_KEY", "").strip().replace("\\n", "\n")
        if not app_id or not kid.startswith(app_id + "/") or not private_pem:
            return {"name": name, "configured": False}
        try:
            key = serialization.load_pem_private_key(private_pem.encode(), password=None)
        except (ValueError, TypeError):
            return {"name": name, "configured": False}
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
            return {"name": name, "configured": False}
        result = dict(base_result)
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
