"""Production observability: request IDs, structured slow/error logging, and optional Sentry/Honeybadger hooks.

Never logs request bodies, cookies, authorization headers, CSRF tokens, or database credentials.
"""
from __future__ import annotations

import logging
import os
import time
from uuid import uuid4

logger = logging.getLogger("primustrader.http")

SENSITIVE_HEADER_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-primus-csrf",
    "x-api-key",
    "proxy-authorization",
}
SENSITIVE_BODY_FRAGMENTS = ("password", "secret", "token", "dsn", "key", "tradelab_db_url")
SLOW_API_MS = 1500.0

_sentry_active = False


def scrub_event(event: dict, _hint: dict | None = None) -> dict:
    """Strip cookies, auth headers, and secret-like fields before leaving the process."""
    if not isinstance(event, dict):
        return event
    req = event.get("request")
    if isinstance(req, dict):
        req.pop("cookies", None)
        req.pop("data", None)
        headers = req.get("headers")
        if isinstance(headers, dict):
            req["headers"] = {
                k: "[Filtered]" if str(k).lower() in SENSITIVE_HEADER_KEYS else v
                for k, v in headers.items()
            }
    extra = event.get("extra")
    if isinstance(extra, dict):
        event["extra"] = {
            k: "[Filtered]" if any(frag in str(k).lower() for frag in SENSITIVE_BODY_FRAGMENTS) else v
            for k, v in extra.items()
        }
    return event


def init_error_tracking(*, local: bool = False) -> bool:
    """Optionally initialize Sentry when SENTRY_DSN is configured in production."""
    global _sentry_active
    _sentry_active = False
    dsn = (os.getenv("SENTRY_DSN") or "").strip()
    if local or not dsn:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
    except ImportError:
        logger.warning("SENTRY_DSN is set, but sentry-sdk is not installed; skipping Sentry setup.")
        return False

    try:
        rate = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.05"))
    except ValueError:
        rate = 0.05
    rate = max(0.0, min(1.0, rate))

    sentry_sdk.init(
        dsn=dsn,
        environment=(os.getenv("SENTRY_ENVIRONMENT") or "production").strip(),
        traces_sample_rate=rate,
        send_default_pii=False,
        before_send=scrub_event,
        integrations=[FastApiIntegration()],
    )
    _sentry_active = True
    logger.info("Sentry error tracking initialized (environment=%s)", os.getenv("SENTRY_ENVIRONMENT", "production"))
    return True


def capture_exception(exc: BaseException, *, request_id: str = "", path: str = "") -> None:
    """Log exception type safely (never raw DB URLs/payloads) and forward to Sentry if enabled."""
    logger.error(
        "handled_exception type=%s path=%s request_id=%s",
        type(exc).__name__,
        path or "-",
        request_id or "-",
    )
    if _sentry_active:
        try:
            import sentry_sdk
            with sentry_sdk.push_scope() as scope:
                if request_id:
                    scope.set_tag("request_id", request_id)
                if path:
                    scope.set_tag("route_path", path)
                sentry_sdk.capture_exception(exc)
        except Exception:
            pass


def mount_request_logging(app) -> None:
    """Attach X-Request-Id and structured latency/error logging middleware."""

    @app.middleware("http")
    async def request_observability(request, call_next):
        request_id = uuid4().hex[:12]
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            logger.error(
                "unhandled_error method=%s path=%s duration_ms=%.1f type=%s request_id=%s",
                request.method,
                request.url.path,
                elapsed_ms,
                type(exc).__name__,
                request_id,
            )
            if _sentry_active:
                try:
                    import sentry_sdk
                    sentry_sdk.capture_exception(exc)
                except Exception:
                    pass
            raise

        elapsed_ms = (time.perf_counter() - started) * 1000.0
        response.headers["X-Request-Id"] = request_id
        path = request.url.path
        status = response.status_code

        if status >= 500:
            logger.error(
                "http_error method=%s path=%s status=%d duration_ms=%.1f request_id=%s",
                request.method,
                path,
                status,
                elapsed_ms,
                request_id,
            )
        elif path.startswith("/api/") and (elapsed_ms >= SLOW_API_MS or (status >= 400 and status != 401)):
            logger.warning(
                "api_notice method=%s path=%s status=%d duration_ms=%.1f request_id=%s",
                request.method,
                path,
                status,
                elapsed_ms,
                request_id,
            )
        return response
