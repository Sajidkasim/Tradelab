"""Pure-Python RFC 8291/8292 VAPID Web Push delivery for PrimusTrader PWA & desktop."""
from __future__ import annotations

import base64
import ipaddress
import json
import logging
import os
import secrets
import struct
import time
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
import httpx
from fastapi import Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

PUSH_SUBS_KEY = "primus_push_subs_v1"
MAX_DEVICES_PER_MEMBER = 6
DEFAULT_VAPID_SUBJECT = "mailto:alerts@primustrader.co.uk"
logger = logging.getLogger(__name__)


def _b64u_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64u_decode(text: str) -> bytes:
    cleaned = (text or "").strip()
    padding = "=" * (-len(cleaned) % 4)
    return base64.urlsafe_b64decode(cleaned + padding)


def generate_vapid_keys() -> tuple[str, str]:
    """Generate a fresh P-256 VAPID (public_key, private_key) URL-safe base64 pair."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    priv_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    pub_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return _b64u_encode(pub_bytes), _b64u_encode(priv_bytes)


def _load_vapid_private_key(raw: str) -> ec.EllipticCurvePrivateKey | None:
    cleaned = (raw or "").strip().replace("\\n", "\n")
    if not cleaned:
        return None
    if cleaned.startswith("-----BEGIN"):
        try:
            key = serialization.load_pem_private_key(cleaned.encode(), password=None)
            return key if isinstance(key, ec.EllipticCurvePrivateKey) else None
        except (ValueError, TypeError):
            return None
    try:
        scalar = _b64u_decode(cleaned)
        if len(scalar) != 32:
            return None
        return ec.derive_private_key(int.from_bytes(scalar, "big"), ec.SECP256R1())
    except (ValueError, TypeError):
        return None


def vapid_credentials() -> tuple[str, ec.EllipticCurvePrivateKey, str] | None:
    """Return (public_key_b64, private_key_obj, subject) when VAPID is configured."""
    pub = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    priv_raw = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    subject = os.getenv("VAPID_SUBJECT", "").strip() or DEFAULT_VAPID_SUBJECT
    if not pub or not priv_raw:
        return None
    try:
        pub_bytes = _b64u_decode(pub)
    except ValueError:
        return None
    if len(pub_bytes) != 65 or pub_bytes[0] != 0x04:
        return None
    priv_key = _load_vapid_private_key(priv_raw)
    if priv_key is None:
        return None
    if not (subject.startswith("mailto:") or subject.startswith("https://")):
        subject = DEFAULT_VAPID_SUBJECT
    return pub, priv_key, subject


def validate_subscription(sub: dict) -> dict:
    """Validate and normalize a browser PushSubscription JSON payload."""
    if not isinstance(sub, dict):
        raise ValueError("Invalid push subscription payload.")
    endpoint = str(sub.get("endpoint") or "").strip()
    if not endpoint or len(endpoint) > 1024:
        raise ValueError("Invalid push subscription endpoint.")
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Push subscription endpoint must use HTTPS.")
    host = parsed.hostname.lower()
    if host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local"):
        raise ValueError("Invalid push endpoint host.")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("Invalid push endpoint host.")
    except ValueError as exc:
        if "Invalid push endpoint host." in str(exc):
            raise
    keys = sub.get("keys")
    if not isinstance(keys, dict):
        raise ValueError("Missing push encryption keys.")
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    try:
        pub_bytes = _b64u_decode(p256dh)
        auth_bytes = _b64u_decode(auth)
    except ValueError as exc:
        raise ValueError("Invalid push key encoding.") from exc
    if len(pub_bytes) != 65 or pub_bytes[0] != 0x04:
        raise ValueError("Invalid p256dh push key.")
    if len(auth_bytes) != 16:
        raise ValueError("Invalid auth push secret.")
    return {
        "endpoint": endpoint,
        "keys": {"p256dh": p256dh, "auth": auth},
    }


def encrypt_payload(payload: bytes, p256dh_b64: str, auth_b64: str) -> bytes:
    """Encrypt a Web Push message using RFC 8291 + RFC 8188 aes128gcm."""
    ua_pub_bytes = _b64u_decode(p256dh_b64)
    auth_secret = _b64u_decode(auth_b64)
    ua_pub_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub_bytes)

    as_priv_key = ec.generate_private_key(ec.SECP256R1())
    as_pub_bytes = as_priv_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    salt = secrets.token_bytes(16)
    shared_secret = as_priv_key.exchange(ec.ECDH(), ua_pub_key)

    ikm = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=auth_secret,
        info=b"WebPush: info\x00" + ua_pub_bytes + as_pub_bytes,
    ).derive(shared_secret)

    cek = HKDF(
        algorithm=hashes.SHA256(),
        length=16,
        salt=salt,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(ikm)

    nonce = HKDF(
        algorithm=hashes.SHA256(),
        length=12,
        salt=salt,
        info=b"Content-Encoding: nonce\x00",
    ).derive(ikm)

    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + struct.pack("!I", 4096) + bytes([len(as_pub_bytes)]) + as_pub_bytes
    return header + ciphertext


def build_vapid_headers(
    endpoint: str,
    public_key_b64: str,
    private_key: ec.EllipticCurvePrivateKey,
    subject: str,
) -> dict[str, str]:
    """Sign an RFC 8292 VAPID ES256 JWT header for a push endpoint."""
    parsed = urlparse(endpoint)
    aud = f"{parsed.scheme}://{parsed.netloc}"
    header_b64 = _b64u_encode(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims_b64 = _b64u_encode(json.dumps({
        "aud": aud,
        "exp": int(time.time()) + 12 * 3600,
        "sub": subject,
    }, separators=(",", ":")).encode())
    unsigned = f"{header_b64}.{claims_b64}".encode("ascii")
    der_sig = private_key.sign(unsigned, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    token = f"{header_b64}.{claims_b64}.{_b64u_encode(raw_sig)}"
    return {
        "Authorization": f"vapid t={token}, k={public_key_b64}",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "300",
        "Urgency": "high",
    }


def send_web_push(
    subscription: dict,
    payload: dict,
    *,
    creds: tuple[str, ec.EllipticCurvePrivateKey, str] | None = None,
) -> tuple[bool, bool]:
    """Send one encrypted Web Push notification. Returns (delivered, expired)."""
    active = creds or vapid_credentials()
    if not active:
        return False, False
    pub_b64, priv_key, subject = active
    try:
        clean = validate_subscription(subscription)
        raw_payload = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        body = encrypt_payload(raw_payload, clean["keys"]["p256dh"], clean["keys"]["auth"])
        headers = build_vapid_headers(clean["endpoint"], pub_b64, priv_key, subject)
        response = httpx.post(
            clean["endpoint"],
            content=body,
            headers=headers,
            timeout=8,
            follow_redirects=False,
        )
        if response.status_code in (404, 410):
            return False, True
        return 200 <= response.status_code < 300, False
    except (ValueError, httpx.HTTPError) as exc:
        logger.warning("Web Push delivery failed error_type=%s", type(exc).__name__)
        return False, False


def _load_all_subscriptions(root_db) -> dict[str, list[dict]]:
    raw = root_db.get_setting(PUSH_SUBS_KEY, {})
    if not isinstance(raw, dict):
        return {}
    out: dict[str, list[dict]] = {}
    for member_key, items in raw.items():
        if isinstance(member_key, str) and isinstance(items, list):
            out[member_key] = [item for item in items if isinstance(item, dict) and item.get("endpoint")]
    return out


def send_push_to_members(
    app,
    payload: dict,
    *,
    exclude_key: str | None = None,
    only_key: str | None = None,
) -> int:
    """Deliver a Web Push alert to subscribed members and prune expired endpoints."""
    creds = vapid_credentials()
    if not creds:
        return 0
    with app.state.workspaces.workspace_lock("owner"):
        store = _load_all_subscriptions(app.state.workspaces.root)

    targets: list[tuple[str, dict]] = []
    for member_key, subs in store.items():
        if only_key is not None and member_key != only_key:
            continue
        if exclude_key is not None and member_key == exclude_key:
            continue
        for sub in subs:
            targets.append((member_key, sub))

    if not targets:
        return 0

    delivered = 0
    expired_endpoints: set[tuple[str, str]] = set()
    for member_key, sub in targets:
        ok, expired = send_web_push(sub, payload, creds=creds)
        if ok:
            delivered += 1
        elif expired:
            expired_endpoints.add((member_key, sub.get("endpoint", "")))

    if expired_endpoints:
        with app.state.workspaces.workspace_lock("owner"):
            current = _load_all_subscriptions(app.state.workspaces.root)
            for member_key, endpoint in expired_endpoints:
                if member_key in current:
                    current[member_key] = [s for s in current[member_key] if s.get("endpoint") != endpoint]
                    if not current[member_key]:
                        current.pop(member_key, None)
            app.state.workspaces.root.set_setting(PUSH_SUBS_KEY, current)
            app.state.workspaces.bump("owner")
    return delivered


def mount(app, config, workspace):
    @app.get("/api/push/config")
    def push_config(member=Depends(workspace)):
        creds = vapid_credentials()
        if not creds:
            return {"enabled": False, "public_key": None, "subscribed_count": 0}
        with app.state.workspaces.workspace_lock("owner"):
            store = _load_all_subscriptions(app.state.workspaces.root)
        mine = store.get(member["key"], [])
        return {
            "enabled": True,
            "public_key": creds[0],
            "subscribed_count": len(mine),
        }

    @app.post("/api/push/subscribe")
    async def push_subscribe(request: Request, member=Depends(workspace)):
        if not vapid_credentials():
            raise HTTPException(503, "Web Push notifications are not configured.")
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "Invalid JSON payload.") from None
        try:
            clean = validate_subscription(body)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None

        def save():
            with app.state.workspaces.workspace_lock("owner"):
                store = _load_all_subscriptions(app.state.workspaces.root)
                mine = [s for s in store.get(member["key"], []) if s.get("endpoint") != clean["endpoint"]]
                mine.append({**clean, "saved_at": int(time.time())})
                store[member["key"]] = mine[-MAX_DEVICES_PER_MEMBER:]
                app.state.workspaces.root.set_setting(PUSH_SUBS_KEY, store)
                app.state.workspaces.bump("owner")
                return len(store[member["key"]])

        count = await run_in_threadpool(save)
        return {"subscribed": True, "subscribed_count": count}

    @app.delete("/api/push/subscribe")
    async def push_unsubscribe(request: Request, member=Depends(workspace)):
        try:
            body = await request.json()
        except ValueError:
            body = {}
        endpoint = str((body or {}).get("endpoint") or "").strip()

        def remove():
            with app.state.workspaces.workspace_lock("owner"):
                store = _load_all_subscriptions(app.state.workspaces.root)
                if endpoint:
                    mine = [s for s in store.get(member["key"], []) if s.get("endpoint") != endpoint]
                    if mine:
                        store[member["key"]] = mine
                    else:
                        store.pop(member["key"], None)
                else:
                    store.pop(member["key"], None)
                app.state.workspaces.root.set_setting(PUSH_SUBS_KEY, store)
                app.state.workspaces.bump("owner")
                return len(store.get(member["key"], []))

        count = await run_in_threadpool(remove)
        return {"subscribed": count > 0, "subscribed_count": count}

    @app.post("/api/push/test")
    async def push_test(member=Depends(workspace)):
        if not vapid_credentials():
            raise HTTPException(503, "Web Push notifications are not configured.")
        delivered = await run_in_threadpool(
            send_push_to_members,
            app,
            {
                "title": "PrimusTrader Alerts Active",
                "body": "You will get lock-screen alerts when the Bullpen goes live or a TradingView alert fires.",
                "url": "/learn",
                "tag": "primus-test",
            },
            only_key=member["key"],
        )
        return {"delivered": delivered}


if __name__ == "__main__":
    pub, priv = generate_vapid_keys()
    print(f"VAPID_PUBLIC_KEY={pub}")
    print(f"VAPID_PRIVATE_KEY={priv}")
    print(f"VAPID_SUBJECT={DEFAULT_VAPID_SUBJECT}")
