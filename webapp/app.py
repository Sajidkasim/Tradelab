"""Same-origin React application and private Python API. No broker write endpoints."""
from contextlib import asynccontextmanager
import hmac
import ipaddress
import json
from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Depends, HTTPException, UploadFile, File, Form
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy.exc import SQLAlchemyError

from core import edge
from core.models import Source
from services import trade_labels
from .config import Settings, from_env
from .schemas import Filters, NewTrade, Review, Playbook, BulkStrategy, Unlock, PositionSize
from .workspaces import Workspaces, serialise_trade, records, SCOPES
from . import imports, backups
from .personal_access import PasswordGate, PersonalSessions, Throttled, auth_version, SESSION_SECONDS


def create_app(config: Settings | None = None):
    config = config or from_env()
    config.validate()

    @asynccontextmanager
    async def lifespan(app):
        app.state.workspaces = await run_in_threadpool(Workspaces, config)
        if config.password_required:
            app.state.personal_sessions = await run_in_threadpool(PersonalSessions, app.state.workspaces.root, auth_version(config.password_hash, config.secret))
        yield
        app.state.workspaces.close()

    app = FastAPI(title="PrimusLab", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config = config
    signer = URLSafeTimedSerializer(config.secret, salt="primus-import-preview")
    app.state.password_gate = PasswordGate(config.password_hash) if config.password_required else None
    allowed_hosts = [urlsplit(config.public_url).hostname]
    if config.local:
        allowed_hosts = ["127.0.0.1", "localhost", "[::1]"]
    app.add_middleware(SessionMiddleware, secret_key=config.secret, session_cookie="primus_session",
                       max_age=SESSION_SECONDS, same_site="lax", https_only=not config.local)
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
        if request.url.path == '/api/unlock':
            try:
                oversized = int(request.headers.get('Content-Length', '0')) > 8192
            except ValueError:
                oversized = True
            if oversized:
                return JSONResponse({'detail': 'Password request is too large.'}, status_code=413)
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

    def check_write(request):
        token = request.headers.get("X-Primus-CSRF", "")
        if not token or not hmac.compare_digest(token, request.session.get("csrf", "")):
            raise HTTPException(403, "Refresh the page before saving.")
        if request.headers.get("Origin") != config.public_url.rstrip("/"):
            raise HTTPException(403, "Saving requires the PrimusLab website.")

    def workspace(request: Request):
        if config.password_required and not request.app.state.personal_sessions.valid(request.session.get('personal_token')):
            raise HTTPException(401, 'Unlock your journal to continue.')
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            check_write(request)
        # A single owner; neither request bodies nor cookies can select a trader.
        return {'key': 'owner', 'name': 'My journal', 'slot': 0}

    # Expose dependency to tests, never an impersonation route.
    app.state.workspace_dependency = workspace

    def db(request, member):
        return request.app.state.workspaces.database(member["key"])

    @app.get("/health")
    def health():
        return {"status": "ok", "application": "PrimusLab"}

    @app.get("/api/session")
    def session(request: Request):
        request.session.setdefault('csrf', token_urlsafe(32))
        try:
            member = workspace(request)
        except (PermissionError, HTTPException):
            return {'authenticated': False, 'local': config.local, 'csrf': request.session['csrf']}
        return {'authenticated': True, 'name': 'My journal', 'owner': True, 'local': config.local, 'can_lock': config.password_required,
                'csrf': request.session['csrf']}

    @app.post('/api/unlock')
    async def unlock(payload: Unlock, request: Request):
        check_write(request)
        if config.password_required:
            try:
                accepted = await run_in_threadpool(app.state.password_gate.check, payload.password.get_secret_value())
            except Throttled as exc:
                raise HTTPException(429, 'Too many attempts. Please wait a minute and try again.', headers={'Retry-After': str(exc.retry_after)}) from None
            if not accepted:
                raise HTTPException(401, 'That password did not unlock your journal.')
            token = await run_in_threadpool(app.state.personal_sessions.issue)
            request.session.clear()
            request.session['personal_token'] = token
            app.state.workspaces.bump('owner')
        request.session['csrf'] = token_urlsafe(32)
        return {'ok': True, 'csrf': request.session['csrf']}

    @app.post("/api/logout")
    def logout(request: Request, member=Depends(workspace)):
        if config.password_required:
            app.state.personal_sessions.revoke(request.session.get('personal_token'))
            app.state.workspaces.bump('owner')
        request.session.clear()
        return {"ok": True}

    @app.get("/api/metadata")
    def metadata(request: Request, member=Depends(workspace)):
        return app.state.workspaces.metadata(member["key"])

    @app.post('/api/tools/position-size')
    def position_size(payload: PositionSize, request: Request, member=Depends(workspace)):
        from core import risk
        from .workspaces import clean
        database = db(request, member)
        account = next((item for item in database.accounts() if item.id == payload.account_id), None)
        instrument = database.instruments().get(payload.symbol)
        if account is None or instrument is None:
            raise ValueError('Choose an account and market from your journal.')
        if payload.entry == payload.stop:
            raise ValueError('Entry and stop must be different prices.')
        return clean(risk.position_size(payload.entry, payload.stop, instrument.multiplier, instrument.tick_size,
                                       account.starting_balance, risk_dollars=payload.risk_dollars,
                                       max_contracts=account.max_contracts,
                                       commission_per_contract=instrument.commission_per_contract))

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

    if (config.assets / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=config.assets / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        if path.startswith(("api/", "auth/")) or path == "team":
            raise HTTPException(404)
        index = config.assets / "index.html"
        if not index.is_file():
            raise HTTPException(503, "Build the frontend before starting PrimusLab.")
        return FileResponse(index)

    return app
