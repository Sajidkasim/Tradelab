"""Issue scoped credentials for the private Primus Bullpen."""
import base64
import hashlib
import hmac
import json
import os
import re
import logging
from email.message import EmailMessage
from email.utils import parseaddr
from threading import Lock
import time
from uuid import NAMESPACE_URL, uuid4, uuid5

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

import httpx
from fastapi import BackgroundTasks, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from .bullpen_feed import MacroFeed
from .mail_delivery import send_gmail
from . import webpush

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


def _alert_mail_credentials():
    resend_key = os.getenv("BULLPEN_RESEND_API_KEY", "").strip()
    resend_sender = os.getenv("BULLPEN_RESEND_FROM", "").strip()
    domain = parseaddr(resend_sender)[1].rpartition("@")[2].casefold()
    if resend_key and domain and domain != "resend.dev":
        return "resend", resend_sender, resend_key
    sender = os.getenv("BULLPEN_GMAIL_ADDRESS", "").strip()
    password = "".join(os.getenv("BULLPEN_GMAIL_APP_PASSWORD", "").split())
    if sender and password:
        return "gmail", sender, password
    return None


def _discord_webhook_url() -> str | None:
    url = os.getenv("BULLPEN_DISCORD_WEBHOOK_URL", "").strip()
    if url.startswith(("https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/")):
        return url
    return None


def _telegram_credentials() -> tuple[str, str] | None:
    token = os.getenv("BULLPEN_TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("BULLPEN_TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return None
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,80}", token):
        return None
    if not re.fullmatch(r"(?:-?\d{5,20}|@[A-Za-z0-9_]{4,64})", chat_id):
        return None
    return token, chat_id


def _send_chat_webhook_alerts(title: str, body: str, link: str = "") -> None:
    """Deliver instant team alerts to configured Discord and/or Telegram webhooks."""
    logger = logging.getLogger(__name__)
    discord_url = _discord_webhook_url()
    if discord_url:
        content = f"**{title}**\n{body}" + (f"\n{link}" if link else "")
        try:
            resp = httpx.post(
                discord_url,
                json={"content": content[:1900], "username": "PrimusTrader Desk"},
                timeout=5,
                follow_redirects=False,
            )
            resp.raise_for_status()
        except httpx.HTTPError as error:
            logger.warning("Bullpen Discord alert failed error_type=%s", type(error).__name__)

    telegram = _telegram_credentials()
    if telegram:
        token, chat_id = telegram
        text = f"{title}\n{body}" + (f"\n{link}" if link else "")
        try:
            resp = httpx.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text[:3900], "disable_web_page_preview": True},
                timeout=5,
                follow_redirects=False,
            )
            resp.raise_for_status()
        except httpx.HTTPError as error:
            logger.warning("Bullpen Telegram alert failed error_type=%s", type(error).__name__)


def _send_live_alert(provider, sender, secret, recipients, name):
    subject = f"🔴 {name} is live in the NQ Bullpen"
    content = f"{name} is live in the NQ Bullpen. Open Learn in PrimusLab to join."
    logger = logging.getLogger(__name__)
    try:
        if provider == "resend":
            response = httpx.post(
                "https://api.resend.com/emails/batch",
                headers={"Authorization": f"Bearer {secret}"},
                json=[{"from": sender, "to": [recipient], "subject": subject, "text": content}
                      for recipient in recipients],
                timeout=10,
            )
            response.raise_for_status()
        else:
            message = EmailMessage()
            message["From"] = sender
            message["To"] = "undisclosed-recipients:;"
            message["Subject"] = subject
            message.set_content(content)
            refused = send_gmail(message, sender, secret, recipients)
            if refused:
                logger.warning("Bullpen email refused for %d recipients", len(refused))
    except httpx.HTTPStatusError as error:
        logger.warning("Bullpen email failed provider=%s status=%d", provider, error.response.status_code)
    except (OSError, ValueError, httpx.RequestError) as error:
        logger.warning("Bullpen email failed provider=%s error_type=%s", provider, type(error).__name__)


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

    @app.post("/api/alert-team", status_code=202)
    def alert_team(request: Request, background_tasks: BackgroundTasks):
        if not config.google_required or os.getenv("BULLPEN_ENABLED") != "1":
            raise HTTPException(403, "The Bullpen is unavailable.")
        member = workspace(request)
        email = (member.get("email") or "").strip().casefold()
        name = _team_name(email)
        if not name:
            raise HTTPException(403, "The Bullpen is reserved for the Primus team.")

        credentials = _alert_mail_credentials()
        configured_emails = os.getenv("BULLPEN_TEAM_EMAILS", "").casefold().split(",")
        recipients = sorted({address for value in configured_emails
                             if (address := value.strip()) != email and _team_name(address)})
        mail_ready = bool(credentials and recipients)
        webhook_ready = bool(_discord_webhook_url() or _telegram_credentials())
        push_ready = bool(webpush.vapid_credentials())
        if not (mail_ready or webhook_ready or push_ready):
            return {"queued": False}
        if not app.state.workspaces.shared_state.claim_cooldown(
            "bullpen_alert", name, cooldown_seconds=900
        ):
            return {"queued": False}
        if mail_ready:
            background_tasks.add_task(_send_live_alert, *credentials, recipients, name)
        join_url = f"{config.public_url.rstrip('/')}/learn"
        if webhook_ready:
            background_tasks.add_task(
                _send_chat_webhook_alerts,
                f"🔴 {name} is live in the Bullpen",
                f"{name} just opened the Primus Trading Floor.",
                join_url,
            )
        if push_ready:
            background_tasks.add_task(
                webpush.send_push_to_members,
                app,
                {
                    "title": f"🔴 {name} is live in the Bullpen",
                    "body": "Tap to join the Primus Trading Floor.",
                    "url": "/learn",
                    "tag": "primus-bullpen-live",
                },
                exclude_key=member["key"],
            )
        return {"queued": True}

    @app.post("/api/tv-webhook")
    async def tradingview_webhook(request: Request, background_tasks: BackgroundTasks):
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
        clean_text = message.strip()
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                response = await client.post(
                    f"{config.supabase_url.rstrip('/')}/realtime/v1/api/broadcast",
                    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
                    json={"messages": [{"topic": ALERT_TOPIC, "event": "alert", "private": True,
                                        "payload": {"name": "System", "id": str(uuid4()),
                                                    "text": clean_text}}]},
                )
                response.raise_for_status()
        except httpx.HTTPError:
            raise HTTPException(502, "Could not publish the TradingView alert.") from None
        if _discord_webhook_url() or _telegram_credentials():
            background_tasks.add_task(
                _send_chat_webhook_alerts,
                "📈 TradingView Alert",
                clean_text,
                f"{config.public_url.rstrip('/')}/learn",
            )
        if webpush.vapid_credentials():
            background_tasks.add_task(
                webpush.send_push_to_members,
                app,
                {
                    "title": "📈 TradingView Alert",
                    "body": clean_text,
                    "url": "/learn",
                    "tag": "primus-tv-alert",
                },
            )
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

    def _cf_turn_credentials():
        key_id = (os.getenv("BULLPEN_CF_TURN_KEY_ID") or os.getenv("CLOUDFLARE_TURN_KEY_ID") or "").strip()
        token = (os.getenv("BULLPEN_CF_TURN_API_TOKEN") or os.getenv("CLOUDFLARE_TURN_API_TOKEN") or "").strip()
        if not key_id or not token or not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", key_id):
            return None
        return key_id, token

    turn_cache: dict[str, object] = {"expires": 0.0, "servers": None}

    def _cf_ice_servers() -> tuple[list[dict], bool]:
        fallback = [{"urls": "stun:stun.cloudflare.com:3478"}]
        creds = _cf_turn_credentials()
        if not creds:
            return fallback, False
        now = time.time()
        cached = turn_cache.get("servers")
        if isinstance(cached, list) and now < float(turn_cache.get("expires") or 0):
            return cached, True
        key_id, token = creds
        url = f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
        try:
            response = httpx.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"ttl": 86400},
                timeout=5,
            )
            if response.status_code >= 400:
                return fallback, False
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return fallback, False
        raw_servers = payload.get("iceServers") if isinstance(payload, dict) else None
        if not isinstance(raw_servers, list) or not raw_servers:
            return fallback, False
        cleaned = []
        for entry in raw_servers:
            if not isinstance(entry, dict):
                continue
            urls = entry.get("urls")
            if isinstance(urls, str):
                urls = [urls]
            if not isinstance(urls, list):
                continue
            # Browsers block port 53 for WebRTC TURN and hang waiting for timeout.
            safe_urls = [u for u in urls if isinstance(u, str) and ":53?" not in u and not u.endswith(":53")]
            if not safe_urls:
                continue
            server = {"urls": safe_urls}
            if isinstance(entry.get("username"), str) and isinstance(entry.get("credential"), str):
                server["username"] = entry["username"]
                server["credential"] = entry["credential"]
            cleaned.append(server)
        if not cleaned:
            return fallback, False
        turn_cache["servers"] = cleaned
        turn_cache["expires"] = now + 6 * 3600
        return cleaned, True

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
                ice_servers, turn_enabled = _cf_ice_servers()
                result["meeting"] = {
                    "provider": "cloudflare",
                    "iceServers": ice_servers,
                    "turnEnabled": turn_enabled,
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
