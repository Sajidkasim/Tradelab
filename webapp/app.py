"""Same-origin React application and private Python API. No broker write endpoints."""
from contextlib import asynccontextmanager
import hmac
import ipaddress
import json
from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import urlsplit

from authlib.integrations.starlette_client import OAuth
from authlib.integrations.base_client.errors import OAuthError
from fastapi import FastAPI, Request, Depends, HTTPException, UploadFile, File, Form
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy.exc import SQLAlchemyError
from httpx import HTTPError
from joserfc.errors import JoseError

from core import edge
from core.models import Source
from services import trade_labels
from .config import Settings, from_env
from .schemas import Filters, NewTrade, Review, Playbook, Invite, Switch, BulkStrategy
from .workspaces import Workspaces, serialise_trade, records, SCOPES
from . import imports, backups


def create_app(config: Settings | None = None):
    config = config or from_env()
    config.validate()

    @asynccontextmanager
    async def lifespan(app):
        app.state.workspaces = await run_in_threadpool(Workspaces, config)
        yield
        app.state.workspaces.close()

    app = FastAPI(title="PrimusLab", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config = config
    signer = URLSafeTimedSerializer(config.secret, salt="primus-import-preview")
    oauth = OAuth()
    if not config.local:
        oauth.register("google", client_id=config.google_id, client_secret=config.google_secret,
                       server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
                       client_kwargs={"scope": "openid email profile", "prompt": "select_account"})
    app.state.oauth = oauth
    allowed_hosts = [urlsplit(config.public_url).hostname]
    if config.local:
        allowed_hosts = ["127.0.0.1", "localhost", "[::1]"]
    app.add_middleware(SessionMiddleware, secret_key=config.secret, session_cookie="primus_session",
                       max_age=12 * 3600, same_site="lax", https_only=not config.local)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

    @app.middleware("http")
    async def security_headers(request, call_next):
        if config.local:
            try:
                loopback = ipaddress.ip_address(request.client.host).is_loopback
            except ValueError:
                loopback = False
            if not loopback:
                return JSONResponse({"detail": "Local preview is available only on this computer."}, status_code=403)
        response = await call_next(request)
        if not request.url.path.startswith("/assets/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Validation responses must never echo submitted backup or credential values.
        return JSONResponse({"detail": "Check the submitted fields.", "fields": [".".join(map(str, e["loc"])) for e in exc.errors()]}, status_code=422)

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(PermissionError)
    async def permission_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        # SQLAlchemy exception text can include the database URL and submitted records.
        return JSONResponse({"detail": "The database is unavailable. Your unsaved changes are still on this page. Please retry."}, status_code=503)

    def workspace(request: Request):
        store = request.app.state.workspaces
        if config.local:
            member = store.team.member("owner")
        else:
            key, subject = request.session.get("key"), request.session.get("subject")
            if not key or not subject:
                raise HTTPException(401, "Sign in to open your workspace.")
            member = store.team.member(key)
            if not hmac.compare_digest(member.get("subject") or "", subject):
                raise HTTPException(401, "Please sign in again.")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            token = request.headers.get("X-Primus-CSRF", "")
            if not token or not hmac.compare_digest(token, request.session.get("csrf", "")):
                raise HTTPException(403, "Refresh the page before saving.")
            origin = request.headers.get("Origin")
            if origin != config.public_url.rstrip("/"):
                raise HTTPException(403, "Saving requires the PrimusLab website.")
        return member

    # Expose dependency to tests, never an impersonation route.
    app.state.workspace_dependency = workspace

    def db(request, member):
        return request.app.state.workspaces.database(member["key"])

    @app.get("/health")
    def health():
        return {"status": "ok", "application": "PrimusLab"}

    @app.get("/api/session")
    def session(request: Request):
        try:
            member = workspace(request)
        except (PermissionError, HTTPException):
            return {"authenticated": False, "local": config.local}
        request.session.setdefault("csrf", token_urlsafe(32))
        return {"authenticated": True, "name": member["name"] if not config.local else "My workspace",
                "owner": member["slot"] == 0, "shared": member["shared"], "local": config.local,
                "csrf": request.session["csrf"]}

    @app.get("/auth/google")
    async def google_login(request: Request):
        if config.local:
            return RedirectResponse("/")
        return await app.state.oauth.google.authorize_redirect(request, config.public_url.rstrip("/") + "/auth/callback")

    @app.get("/auth/callback")
    async def google_callback(request: Request):
        if config.local:
            raise HTTPException(404)
        try:
            # Authlib validates OIDC signature, issuer, audience, expiry, state and nonce.
            token = await app.state.oauth.google.authorize_access_token(request)
            claims = token.get("userinfo")
            if not claims:
                raise PermissionError("Google did not return a verified identity.")
            identity = await run_in_threadpool(app.state.workspaces.team.join, claims)
            member = await run_in_threadpool(app.state.workspaces.team.member, identity.key)
        except (OAuthError, PermissionError, JoseError, HTTPError):
            request.session.clear()
            return RedirectResponse("/?login=denied")
        request.session.clear()
        request.session.update(key=identity.key, subject=member["subject"], csrf=token_urlsafe(32))
        return RedirectResponse("/")

    @app.post("/api/logout")
    def logout(request: Request, member=Depends(workspace)):
        request.session.clear()
        return {"ok": True}

    @app.get("/api/metadata")
    def metadata(request: Request, member=Depends(workspace)):
        return app.state.workspaces.metadata(member["key"])

    @app.get("/api/trades")
    def trades(request: Request, member=Depends(workspace)):
        frame = app.state.workspaces.trades(member["key"]).sort_values("entry_time", ascending=False)
        frame = frame.drop(columns=["screenshot_path"], errors="ignore")
        if not frame.empty:
            frame["labels"] = frame["tags"].map(edge.read_labels)
            frame["needs_tagging"] = trade_labels.needs_tagging(frame)
        return records(frame)

    @app.post("/api/results")
    def results(filters: Filters, request: Request, member=Depends(workspace)):
        return app.state.workspaces.results(member["key"], filters)

    @app.post("/api/trades")
    def add_trade(payload: NewTrade, request: Request, member=Depends(workspace)):
        database = db(request, member)
        if payload.account_id not in {a.id for a in database.accounts()}:
            raise ValueError("Choose an account in your workspace.")
        if payload.entry_time.tzinfo is None or payload.exit_time.tzinfo is None:
            raise ValueError("Trade times require an explicit time zone.")
        labels = edge.write_labels(**payload.labels.model_dump())
        if not payload.confirmed:
            labels.remove("edge:reviewed")
        values = payload.model_dump(exclude={"labels", "confirmed"})
        values['source'] = Source(values['source'])
        trade = edge.build_trade(instruments=database.instruments(), tags=labels, **values)
        with app.state.workspaces.lock:
            result = database.insert_trades([trade])
            app.state.workspaces.bump(member["key"])
        return result

    @app.patch("/api/trades/{trade_id}")
    def review(trade_id: int, payload: Review, request: Request, member=Depends(workspace)):
        database = db(request, member)
        with app.state.workspaces.lock:
            trade = database.get_trade(trade_id)
            if trade is None:
                raise HTTPException(404, "This trade is no longer available.")
            fields = trade_labels.review_fields(trade, payload.strategy, payload.labels.model_dump(), payload.notes, payload.confirmed)
            database.update_trade(trade_id, **fields)
            app.state.workspaces.bump(member["key"])
            return serialise_trade(database.get_trade(trade_id))

    @app.post("/api/trades/strategy")
    def bulk_strategy(payload: BulkStrategy, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            count = trade_labels.apply_strategy(db(request, member), payload.ids, payload.strategy)
            app.state.workspaces.bump(member["key"])
        return {"updated": count}

    @app.put("/api/playbook")
    def playbook(payload: Playbook, request: Request, member=Depends(workspace)):
        if any(len(value) > 120 for value in payload.strategies + payload.levels):
            raise ValueError("Keep strategy and level names under 120 characters.")
        book = edge.playbook(payload.model_dump())
        db(request, member).set_setting(edge.PLAYBOOK_KEY, book)
        app.state.workspaces.bump(member["key"])
        return book

    @app.put("/api/tag-mappings")
    async def tag_mappings(request: Request, member=Depends(workspace)):
        if len(await request.body()) > 100000:
            raise HTTPException(413, "Too many tag mappings.")
        payload = await request.json()
        if not isinstance(payload, dict) or len(payload) > 200:
            raise ValueError("Choose up to 200 tag mappings.")
        for tag, rule in payload.items():
            if not isinstance(rule, dict) or rule.get("field") not in trade_labels.FIELDS or not isinstance(rule.get("value"), str) or not 0 < len(rule["value"]) <= 120 or len(tag) > 200:
                raise ValueError("Each tag needs a field and a short value.")
        await run_in_threadpool(db(request, member).set_setting, trade_labels.MAPPING_KEY, payload)
        app.state.workspaces.bump(member["key"])
        return {"ok": True}

    @app.post("/api/import/{action}")
    async def import_file(action: str, request: Request, file: UploadFile = File(...), account_id: int = Form(...),
                          source: str = Form("fxreplay"), timezone: str = Form("UTC"), dayfirst: bool = Form(False),
                          mapping: str = Form("{}"), preview_token: str = Form(""), member=Depends(workspace)):
        if action not in ("preview", "confirm"):
            raise HTTPException(404)
        content = await file.read(imports.MAX_UPLOAD + 1)
        if len(content) > imports.MAX_UPLOAD:
            raise HTTPException(413, "Choose a file smaller than 5 MB.")
        filename = file.filename or "trades.csv"
        try:
            columns = json.loads(mapping)
        except json.JSONDecodeError:
            raise ValueError("Check the column mapping.") from None
        fingerprint = imports.digest(content, filename, account_id, source, timezone, dayfirst, columns)
        if action == "confirm":
            try:
                approval = signer.loads(preview_token, max_age=900)
            except (BadSignature, SignatureExpired):
                raise HTTPException(409, "Preview the file again before importing.") from None
            if approval != [member["key"], fingerprint]:
                raise HTTPException(409, "File or import options changed. Preview again.")
        def operation():
            with app.state.workspaces.lock:
                database = db(request, member)
                parsed, preview = imports.parse(content, filename, database, account_id, source, timezone, dayfirst, columns)
                if action == "confirm":
                    result = database.insert_trades(parsed)
                    app.state.workspaces.bump(member["key"])
                    return result
                preview["preview_token"] = signer.dumps([member["key"], fingerprint])
                return preview
        return await run_in_threadpool(operation)

    @app.get("/api/export/{kind}")
    def export(kind: str, request: Request, member=Depends(workspace)):
        database = db(request, member)
        if kind == "backup":
            content, media, name = database.export_json(), "application/json", "primuslab-backup.json"
        elif kind == "csv":
            # Complete label/notes history in UTC; screenshots remain separate files.
            content, media, name = database.trades_df(sources=SCOPES["All"]).drop(columns=["screenshot_path"], errors="ignore").to_csv(index=False), "text/csv", "primuslab-trades.csv"
        else:
            raise HTTPException(404)
        return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.post("/api/restore")
    async def restore(request: Request, file: UploadFile = File(...), member=Depends(workspace)):
        content = await file.read(imports.MAX_UPLOAD + 1)
        if len(content) > imports.MAX_UPLOAD:
            raise HTTPException(413, "Choose a backup smaller than 5 MB.")
        def operation():
            with app.state.workspaces.lock:
                database = db(request, member)
                if database.count_trades():
                    raise HTTPException(409, "Restore is available only in an empty journal. Download a backup before migrating an existing journal.")
                result = database.import_json(backups.validate(content.decode("utf-8")), replace=True)
                app.state.workspaces.bump(member["key"])
                return result
        return await run_in_threadpool(operation)

    @app.get("/api/team")
    def roster(request: Request, member=Depends(workspace)):
        return app.state.workspaces.team.roster(member["key"])

    @app.post("/api/team")
    def invite(payload: Invite, request: Request, member=Depends(workspace)):
        key = app.state.workspaces.team.invite(member["key"], payload.email, payload.name)
        app.state.workspaces.bump(member["key"])
        return {"key": key}

    @app.patch("/api/team/{key}/active")
    def active(key: str, payload: Switch, request: Request, member=Depends(workspace)):
        app.state.workspaces.team.set_active(member["key"], key, payload.enabled)
        app.state.workspaces.bump(member["key"])
        return {"ok": True}

    @app.put("/api/sharing")
    def sharing(payload: Switch, request: Request, member=Depends(workspace)):
        app.state.workspaces.team.set_sharing(member["key"], payload.enabled)
        app.state.workspaces.bump(member["key"])
        return {"ok": True}

    @app.get("/api/team/{key}/results")
    def shared_results(key: str, request: Request, member=Depends(workspace)):
        from core import metrics
        frame = app.state.workspaces.team.shared_results(member["key"], key)
        from .workspaces import clean
        return {name: clean(metrics.summary_stats(frame[frame["source"].isin(sources)])) for name, sources in SCOPES.items() if name != "All"}

    if (config.assets / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=config.assets / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        if path.startswith(("api/", "auth/")):
            raise HTTPException(404)
        index = config.assets / "index.html"
        if not index.is_file():
            raise HTTPException(503, "Build the frontend before starting PrimusLab.")
        return FileResponse(index)

    return app
