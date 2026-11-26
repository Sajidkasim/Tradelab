"""Same-origin React application and private Python API. No broker write endpoints."""
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal
from dataclasses import asdict, replace
import hmac
import ipaddress
import json
import os
from pathlib import Path
from secrets import token_urlsafe
from threading import Lock
import time
from urllib.parse import urlsplit

from anyio import move_on_after, to_thread
from fastapi import FastAPI, Request, Body, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse, Response, RedirectResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from starlette.concurrency import run_in_threadpool
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from core import edge
from core.models import Account, Source
from core.registry import COACH_PROVIDERS, load_extensions
from .schemas import ArchivedChoice, CustomFieldId, CustomTradeField, JournalAccount, JournalAccountPresets
from services import trade_labels, fixed_rr, strategy_catalog, research, review as trade_review, tag_cleanup
from .config import Settings, from_env
from .image_storage import ImageStorage, StorageUnavailable
from .schemas import Filters, NewTrade, Review, Playbook, BulkStrategy, Unlock, PositionSize, LabSettings, DeleteAllTrades, ImportPreferences, AccountAccess, Study, StudyAssignment, SavedSetup, LabelMerge, JournalPreferences, WelcomeSetup, TourProgress, DailyEntry, JournalTradeLink, FeedbackInput
from .workspaces import Workspaces, serialise_trade, records, SCOPES
from . import observability
from . import custom_trade_fields, daily_journal, lab_settings, trade_deletion, journal_preferences, release_notes
from .request_limits import RequestLimits
from .rate_counters import RateCounters
from .personal_access import PasswordGate, PersonalSessions, Throttled, auth_version, SESSION_SECONDS
from .google_access import LoginError, AccountBlocked


def create_app(config: Settings | None = None):
    config = config or from_env()
    config.validate()
    observability.init_error_tracking(local=config.local)

    @asynccontextmanager
    async def lifespan(app):
        app.state.image_storage = ImageStorage(config)
        app.state.spot_archive = None
        app.state.qqq_archive = None
        if not config.local and config.replay_enabled and config.r2_ready:
            from .spot_archive import MANIFEST, restore
            app.state.spot_archive = await run_in_threadpool(
                restore, app.state.image_storage.client, config.r2_bucket)
            app.state.qqq_archive = await run_in_threadpool(
                restore, app.state.image_storage.client, config.r2_bucket,
                manifest_path=MANIFEST.with_name('qqq_archive_manifest.json'),
                prefix='primus-replay/qqq/v1/')
        app.state.workspaces = await run_in_threadpool(Workspaces, config)
        app.state.rate_counters = await run_in_threadpool(RateCounters, app.state.workspaces.root)
        if config.password_required:
            app.state.password_gate = PasswordGate(config.password_hash, counters=app.state.rate_counters)
            app.state.personal_sessions = await run_in_threadpool(PersonalSessions, app.state.workspaces.root, auth_version(config.password_hash, config.secret))
        yield
        app.state.workspaces.close()
        app.state.image_storage.close()

    app = FastAPI(title="PrimusLab", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config = config
    readiness_lock = Lock()
    signer = URLSafeTimedSerializer(config.secret, salt="primus-import-preview")
    allowed_hosts = [urlsplit(config.public_url).hostname]
    if config.local:
        allowed_hosts = ["127.0.0.1", "localhost", "[::1]"]
    if config.legacy_host:
        allowed_hosts.append(config.legacy_host)
    if config.custom_host:
        allowed_hosts.append(config.custom_host)
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=3)
    app.add_middleware(SessionMiddleware, secret_key=config.secret, session_cookie="primus_session",
                       max_age=SESSION_SECONDS, same_site="lax", https_only=not config.local)
    app.add_middleware(RequestLimits)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    observability.mount_request_logging(app)

    @app.middleware("http")
    async def security_headers(request, call_next):
        if config.legacy_host and request.url.hostname == config.legacy_host and request.url.hostname != urlsplit(config.public_url).hostname:
            # Never forward a POST body, credential or OAuth code to a new host.
            if request.method not in ('GET', 'HEAD'):
                return JSONResponse({'detail': 'Open the new PrimusLab address before saving.'}, status_code=409)
            return RedirectResponse(config.public_url.rstrip('/') + (config.lab_path or '/'), status_code=302,
                                    headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})
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
        if request.url.path.startswith('/assets/') and response.status_code == 200:
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        elif request.url.path.startswith('/pwa/') and response.status_code == 200:
            response.headers['Cache-Control'] = 'public, max-age=86400'
        else:
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer" if request.url.path.startswith('/auth/') else "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers['Content-Security-Policy'] = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        if not config.local:response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    def client_ip(request: Request) -> str | None:
        if not config.local:
            cf_ip = (request.headers.get("cf-connecting-ip") or "").strip()
            if cf_ip:
                try:
                    return str(ipaddress.ip_address(cf_ip))
                except ValueError:
                    pass
        return request.client.host if request.client else None

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Validation responses must never echo submitted backup or credential values.
        return JSONResponse({"detail": "Check the submitted fields.", "fields": [".".join(map(str, e["loc"])) for e in exc.errors()]}, status_code=422)

    @app.exception_handler(StorageUnavailable)
    async def storage_error(request, exc):
        observability.capture_exception(exc, request_id=getattr(request.state, "request_id", ""), path=request.url.path)
        return JSONResponse({'detail':'Screenshot storage is temporarily unavailable. Your saved notes are safe; please retry.'},status_code=503)

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(PermissionError)
    async def permission_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        # SQLAlchemy exception text can include the database URL and submitted records.
        observability.capture_exception(exc, request_id=getattr(request.state, "request_id", ""), path=request.url.path)
        return JSONResponse({"detail": "The database is unavailable. Your unsaved changes are still on this page. Please retry."}, status_code=503)

    def check_write(request, *, allow_missing_origin=False):
        token = request.headers.get("X-Primus-CSRF", "")
        if not token or not hmac.compare_digest(token, request.session.get("csrf", "")):
            raise HTTPException(403, "Refresh the page before saving.")
        origin = request.headers.get("Origin")
        if origin != config.public_url.rstrip("/") and not (allow_missing_origin and origin is None):
            raise HTTPException(403, "Saving requires the PrimusLab website.")

    def workspace(request: Request):
        if config.google_required:
            try:
                member = request.app.state.workspaces.google.member(request.session.get('google_token'),
                    user_agent=request.headers.get('user-agent'), client_ip=client_ip(request))
            except LoginError:
                raise HTTPException(401, 'Sign in to your lab to continue.') from None
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                check_write(request)
            return member
        if config.password_required and not request.app.state.personal_sessions.valid(request.session.get('personal_token')):
            raise HTTPException(401, 'Unlock your lab to continue.')
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            check_write(request)
        # A single owner; neither request bodies nor cookies can select a trader.
        return {'key': 'owner', 'name': 'My lab', 'slot': 0}

    from . import bullpen, chart_vision, webpush
    chart_vision.mount(app, workspace)
    bullpen.mount(app, config, workspace, check_write)
    webpush.mount(app, config, workspace)

    # Expose dependency to tests, never an impersonation route.
    app.state.workspace_dependency = workspace

    def db(request, member):
        return request.app.state.workspaces.database(member["key"])

    def journal_preview():
        if not config.site_enabled and not (config.site_preview and config.local):
            raise HTTPException(404)

    from . import routes_imports, routes_journal, routes_matrix, routes_tools
    routes_matrix.mount(app, config, workspace)
    routes_journal.mount(app, config, workspace, check_write, db)
    routes_tools.mount(app, workspace, db)
    routes_imports.mount(app, workspace, signer, db)

    @app.get("/health")
    def health():
        return {"status": "ok", "application": "PrimusLab"}

    def database_ready():
        # Keep at most one probe in flight, including a driver call that outlives its HTTP timeout.
        if not readiness_lock.acquire(blocking=False):
            return False
        try:
            with app.state.workspaces.root.engine.connect() as connection:
                return connection.scalar(select(1)) == 1
        except (SQLAlchemyError, OSError):
            return False
        finally:
            readiness_lock.release()

    @app.get("/ready")
    async def readiness():
        ready = False
        with move_on_after(2):
            ready = await to_thread.run_sync(database_ready, abandon_on_cancel=True)
        return JSONResponse({"status": "ready" if ready else "unavailable"},
                            status_code=200 if ready else 503,
                            headers={"Cache-Control": "no-store"})

    @app.get('/privacy')
    def privacy():
        path = Path(__file__).with_name('privacy.html')
        if config.lab_path:
            return HTMLResponse(path.read_text().replace('href="/"', 'href="/lab"', 1))
        return FileResponse(path, media_type='text/html')

    @app.get("/api/session")
    def session(request: Request):
        request.session.setdefault('csrf', token_urlsafe(32))
        try:
            member = workspace(request)
        except (PermissionError, HTTPException):
            return {'authenticated': False, 'local': config.local, 'csrf': request.session['csrf'], 'auth_mode': config.auth_mode, 'images_enabled': request.app.state.image_storage.enabled}
        return {'authenticated': True, 'name': member['name'], 'owner': member['key'] == 'owner', 'local': config.local,
                'auth_mode': config.auth_mode, 'can_lock': config.password_required or config.google_required,
                'csrf': request.session['csrf'], 'images_enabled': request.app.state.image_storage.enabled,
                'chart_vision_cloud_enabled': chart_vision.enabled(),
                'voice_journal_enabled': daily_journal.voice_transcribe_enabled()}

    def google_return_paths():
        paths = ('/lab', '/journal', '/learn', '/mindset', '/matrix') if (config.site_enabled or config.site_preview) else (config.lab_path or '/',)
        if config.local or config.replay_enabled:paths=(*paths,'/backtesting')
        return paths

    @app.post('/api/login/google')
    def start_google(request: Request, return_to: str = ""):
        if not config.google_required:
            raise HTTPException(404)
        check_write(request)
        allowed_returns = google_return_paths()
        if return_to and return_to not in allowed_returns:
            raise HTTPException(422, 'Choose a Primus page to return to.')
        try:
            attempt, url = app.state.workspaces.google.start(request.session.get('google_attempt'))
        except LoginError:
            raise HTTPException(429, 'Sign-in is busy. Please try again in a few minutes.') from None
        request.session['google_return_to'] = return_to or config.lab_path or '/'
        request.session['google_attempt'] = attempt
        return {'url': url}

    @app.get('/auth/callback')
    def google_callback(request: Request):
        if not config.google_required:
            raise HTTPException(404)
        access = app.state.workspaces.google
        attempt = request.session.pop('google_attempt', None)
        destination = request.session.pop('google_return_to', config.lab_path or '/')
        if destination not in google_return_paths():
            destination = config.lab_path or '/'
        try:
            email, subject = access.exchange(attempt, request.query_params.get('code'))
            key = access.join(email, subject)
            # Finish private storage initialization before issuing access.
            app.state.workspaces.database(key)
            token = access.issue(key, user_agent=request.headers.get('user-agent'), client_ip=client_ip(request))
        except AccountBlocked:
            return RedirectResponse(destination + '?login=blocked', status_code=303)
        except LoginError:
            return RedirectResponse(destination + '?login=retry', status_code=303)
        access.revoke(request.session.get('google_token'))
        request.session.clear()
        request.session.update(google_token=token, csrf=token_urlsafe(32))
        return RedirectResponse(destination, status_code=303)

    @app.post('/api/unlock')
    async def unlock(payload: Unlock, request: Request):
        if config.google_required:
            raise HTTPException(404)
        check_write(request)
        if config.password_required:
            try:
                accepted = await run_in_threadpool(app.state.password_gate.check, payload.password.get_secret_value())
            except Throttled as exc:
                raise HTTPException(429, 'Too many attempts. Please wait a minute and try again.', headers={'Retry-After': str(exc.retry_after)}) from None
            if not accepted:
                raise HTTPException(401, 'That password did not unlock your lab.')
            token = await run_in_threadpool(app.state.personal_sessions.issue)
            request.session.clear()
            request.session['personal_token'] = token
            await run_in_threadpool(app.state.workspaces.bump, 'owner')
        request.session['csrf'] = token_urlsafe(32)
        return {'ok': True, 'csrf': request.session['csrf']}

    @app.post("/api/logout")
    def logout(request: Request, member=Depends(workspace)):
        if config.google_required:
            app.state.workspaces.google.revoke(request.session.get('google_token'))
            app.state.workspaces.bump(member['key'])
        if config.password_required:
            app.state.personal_sessions.revoke(request.session.get('personal_token'))
            app.state.workspaces.bump('owner')
        request.session.clear()
        return {"ok": True}

    from . import replay_sessions
    replay_sessions.mount(app, config, workspace)
    from . import journal_replay
    journal_replay.mount(app, config, workspace)
    from . import compound_edge, learning
    compound_edge.mount(app, workspace)
    learning.mount(app, config, workspace)
    from . import mindset
    mindset.mount(app, config, workspace)
    from . import setup_gallery
    setup_gallery.mount(app, config, workspace)


    @app.get('/api/backtesting/sample')
    def local_chart_sample(member=Depends(workspace)):
        if not config.local:
            raise HTTPException(404)
        sample = Path(__file__).resolve().parents[1] / 'data/private/backtesting-preview.json'
        if not sample.is_file():
            raise HTTPException(404, 'Prepare the local candle sample first.')
        return FileResponse(sample, media_type='application/json', headers={'Cache-Control':'private, no-store'})

    @app.get("/api/metadata")
    def metadata(request: Request, member=Depends(workspace)):
        return app.state.workspaces.metadata(member["key"])

    def access_owner(member):
        if not config.google_required or member['key'] != 'owner':
            raise HTTPException(403, 'Only the owner can manage account access.')

    @app.get('/api/access')
    def list_access(member=Depends(workspace)):
        access_owner(member)
        return app.state.workspaces.google.people()

    @app.post('/api/activity')
    def activity(member=Depends(workspace)):
        return {'ok': True}

    @app.patch('/api/access/{account_key}')
    def change_access(account_key: str, payload: AccountAccess, member=Depends(workspace)):
        access_owner(member)
        app.state.workspaces.google.set_allowed(account_key, payload.allowed)
        app.state.workspaces.bump(account_key)
        return {'ok': True}

    def trade_rows(frame):
        frame = frame.copy()
        frame = frame.drop(columns=["screenshot_path"], errors="ignore")
        if not frame.empty:
            frame["labels"] = frame["tags"].map(edge.read_labels)
            frame['target_rr'] = frame['tags'].map(lambda tags: fixed_rr.read(tags)['target_rr'])
            frame['fixed_exit'] = frame['tags'].map(lambda tags: fixed_rr.read(tags)['fixed_exit'])
            frame["needs_tagging"] = trade_labels.needs_tagging(frame)
        rows = records(frame)
        for row in rows:
            row['study_id'] = research.test_id(row.get('tags'))
            row['custom_fields'] = custom_trade_fields.values(row.get('tags'), row.get('custom_metadata'))
            row.update(trade_review.missing(row))
        return rows

    @app.get("/api/trades")
    def trades(member=Depends(workspace)):
        frame = app.state.workspaces.trades(member["key"]).sort_values(["entry_time", "id"], ascending=False)
        return trade_rows(frame)

    @app.get("/api/trades/page")
    def trade_page(scope: Literal["All", "Backtesting", "Forward testing"] = "All",
                   pending: bool = False, page: int = Query(0, ge=0),
                   size: int = Query(8, ge=1, le=100), member=Depends(workspace)):
        frame = app.state.workspaces.trades(member["key"])
        frame = frame.loc[frame["source"].isin(SCOPES[scope])].sort_values(["entry_time", "id"], ascending=False)
        review_rows = records(frame[["setup_name", "tags", "r_multiple", "exit_price", "net_pnl"]])
        review_mask = [trade_review.missing(row)["needs_review"] for row in review_rows]
        pending_count = sum(review_mask)
        if pending and not frame.empty:
            frame = frame.loc[review_mask]
        total = len(frame)
        page = min(page, max(0, (total - 1) // size))
        return {"items": trade_rows(frame.iloc[page * size:(page + 1) * size]),
                "total": total, "page": page, "pending_count": pending_count}

    @app.get("/api/trades/{trade_id}")
    def trade_detail(trade_id: int, request: Request, member=Depends(workspace)):
        trade = db(request, member).get_trade(trade_id)
        if trade is None:
            raise HTTPException(404, "Trade not found.")
        return serialise_trade(trade)

    @app.post("/api/lab-settings/custom-fields", status_code=201)
    def add_custom_field(payload: CustomTradeField, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            return custom_trade_fields.add(db(request, member), payload)

    @app.delete("/api/lab-settings/custom-fields/{field_id}")
    def delete_custom_field(field_id: CustomFieldId, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            if not custom_trade_fields.remove(db(request, member), field_id):
                raise HTTPException(404, "This trade field no longer exists.")
        return {"removed": True}

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
        values = payload.model_dump(exclude={"labels", "confirmed", "study_id", "risk_unavailable", "journal_day", "journal_trade_id", "custom_fields"})
        values['source'] = Source(values['source'])
        trade = edge.build_trade(instruments=database.instruments(), tags=labels, **values)
        with app.state.workspaces.workspace_lock(member['key']):
            trade.custom_metadata = custom_trade_fields.merge({}, database, payload.custom_fields)
            journal_day = payload.journal_day.isoformat() if payload.journal_day else None
            if bool(journal_day) != bool(payload.journal_trade_id):
                raise ValueError('Choose a saved journal trade and day.')
            if journal_day:
                journal_preview()
                record = daily_journal.trade_entry(database, journal_day, payload.journal_trade_id)
                if record is None:
                    raise ValueError('Save the journal trade before adding it to the Lab.')
                if len(daily_journal.card_accounts(record)) > 1:
                    raise ValueError('Choose one account before adding a trade to Strategy Lab.')
                linked = record.get('lab_trade_id') or daily_journal.linked_record(database, journal_day, payload.journal_trade_id)
                if linked and database.get_trade(linked) is not None:
                    entry = daily_journal.link_trade(database, journal_day, payload.journal_trade_id, linked)
                    app.state.workspaces.bump(member['key'])
                    return {'inserted': 0, 'skipped': 1, 'journal_entry': entry}
                trade.tags.append(daily_journal.journal_tag(journal_day, payload.journal_trade_id))
            fields = tag_cleanup.trade_fields(trade, database.get_setting(tag_cleanup.KEY, {}))
            trade.tags, trade.setup_name = fields['tags'], fields['setup_name']
            research.attach(database, trade, payload.study_id or '')
            result = database.insert_trades([trade])
            if journal_day:
                linked = daily_journal.linked_record(database, journal_day, payload.journal_trade_id)
                if linked:
                    result['journal_entry'] = daily_journal.link_trade(database, journal_day, payload.journal_trade_id, linked)
            app.state.workspaces.bump(member["key"])
        return result

    @app.patch("/api/trades/{trade_id}")
    def review(trade_id: int, payload: Review, request: Request, member=Depends(workspace)):
        database = db(request, member)
        with app.state.workspaces.workspace_lock(member['key']):
            trade = database.get_trade(trade_id)
            if trade is None:
                raise HTTPException(404, "This trade is no longer available.")
            fields = trade_labels.review_fields(trade, payload.strategy, payload.labels.model_dump(), payload.notes, payload.confirmed)
            if payload.risk_amount is not None and payload.risk_unavailable:
                raise ValueError('Enter the original risk or mark it unavailable, not both.')
            if payload.custom_fields is not None:
                fields['custom_metadata'] = custom_trade_fields.merge(
                    custom_trade_fields.values(trade.tags, trade.custom_metadata), database, payload.custom_fields)
            fields.update(trade_review.risk_fields(trade, payload.risk_amount, payload.risk_unavailable))
            if payload.risk_unavailable is not None or payload.risk_amount is not None:
                fields['tags'] = [tag for tag in fields['tags'] if tag != trade_review.UNAVAILABLE]
                if payload.risk_unavailable:
                    fields['tags'].append(trade_review.UNAVAILABLE)
            trade.tags, trade.setup_name = fields['tags'], fields['setup_name']
            fields.update(tag_cleanup.trade_fields(trade, database.get_setting(tag_cleanup.KEY, {})))
            if payload.study_id is not None and payload.study_id != research.test_id(trade.tags):
                research.attach(database, trade, payload.study_id)
                fields['tags'] = trade.tags
            database.update_trade(trade_id, **fields)
            compound_edge.lab_review(database, trade_id,
                                     bool(payload.notes.strip()) and payload.notes.strip() != (trade.notes or '').strip(),
                                     payload.confirmed)
            app.state.workspaces.bump(member["key"])
            return serialise_trade(database.get_trade(trade_id))

    @app.post("/api/trades/deletion-preview")
    def deletion_preview(request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            snapshot = trade_deletion.read_snapshot(db(request, member))
        token = signer.dumps({**snapshot, 'purpose': 'delete-all-trades', 'workspace': member['key'], 'csrf': request.session['csrf']})
        return {'count': snapshot['count'], 'preview_token': token}

    @app.delete("/api/trades")
    def delete_all_trades(payload: DeleteAllTrades, request: Request, member=Depends(workspace)):
        try:
            snapshot = signer.loads(payload.preview_token, max_age=300)
        except (BadSignature, SignatureExpired):
            raise HTTPException(409, "This confirmation has expired. Open Delete all trades again.") from None
        if (snapshot.get('purpose') != 'delete-all-trades' or snapshot.get('workspace') != member['key']
                or not hmac.compare_digest(snapshot.get('csrf', ''), request.session['csrf'])
                or snapshot.get('count') != payload.confirmation_count):
            raise HTTPException(409, "The trade count does not match. Open Delete all trades again.")
        with app.state.workspaces.workspace_lock(member['key']):
            count = trade_deletion.remove_snapshot(db(request, member), snapshot)
            if count is None:
                raise HTTPException(409, "Your trades changed. Open Delete all trades again to confirm the new count.")
            app.state.workspaces.bump(member['key'])
        return {'deleted': count}

    @app.delete("/api/trades/{trade_id}")
    def delete_trade(trade_id: int, request: Request, member=Depends(workspace)):
        database = db(request, member)
        with app.state.workspaces.workspace_lock(member['key']):
            if database.get_trade(trade_id) is None:
                raise HTTPException(404, "This trade is no longer available.")
            database.delete_trade(trade_id)
            app.state.workspaces.bump(member["key"])
        return {"deleted": trade_id}

    @app.post("/api/trades/strategy")
    def bulk_strategy(payload: BulkStrategy, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            strategy = tag_cleanup.canonical(payload.strategy, 'strategy', database.get_setting(tag_cleanup.KEY, {}))
            count = trade_labels.apply_strategy(database, payload.ids, strategy)
            app.state.workspaces.bump(member["key"])
        return {"updated": count}

    @app.post('/api/studies')
    def create_study(payload: Study, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            values = payload.model_dump()
            values['strategy'] = tag_cleanup.canonical(values['strategy'], 'strategy', database.get_setting(tag_cleanup.KEY, {}))
            result = research.save_test(database, values)
            app.state.workspaces.bump(member['key'])
        return result

    @app.put('/api/studies/{study_id}')
    def update_study(study_id: str, payload: Study, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            result = research.save_test(db(request, member), payload.model_dump(), study_id)
            app.state.workspaces.bump(member['key'])
        return result

    @app.post('/api/study-assignment')
    def assign_study(payload: StudyAssignment, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            count = research.assign(db(request, member), payload.ids, payload.study_id)
            app.state.workspaces.bump(member['key'])
        return {'updated': count}

    @app.post('/api/saved-setups')
    def create_saved_setup(payload: SavedSetup, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            if payload.filters.account_id is not None and payload.filters.account_id not in {a.id for a in database.accounts()}:
                raise ValueError('Reload your lab and try again.')
            filters = payload.filters.model_dump(mode='json', exclude={'mode', 'detail', 'comparison', 'study_id'})
            result = research.save_setup(database, payload.name, filters)
            app.state.workspaces.bump(member['key'])
        return result

    @app.delete('/api/saved-setups/{setup_id}')
    def remove_saved_setup(setup_id: str, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            research.remove_setup(db(request, member), setup_id)
            app.state.workspaces.bump(member['key'])
        return {'ok': True}

    @app.get('/api/label-cleanup')
    def cleanup_options(request: Request, member=Depends(workspace)):
        return tag_cleanup.options(db(request, member), app.state.workspaces.trades(member['key']))

    @app.post('/api/label-cleanup/{action}')
    def cleanup_labels(action: str, payload: LabelMerge, request: Request, member=Depends(workspace)):
        if action not in ('preview', 'apply'):
            raise HTTPException(404)
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            frame = app.state.workspaces.trades(member['key'])
            if action == 'apply':
                try:
                    previous = signer.loads(payload.preview_token, max_age=600)
                except (BadSignature, SignatureExpired):
                    raise HTTPException(409, 'Preview the tag cleanup again before applying it.') from None
                if not isinstance(previous, dict) or any(previous.get(key) != value for key, value in {
                    'purpose': 'label-cleanup', 'workspace': member['key'], 'csrf': request.session['csrf']}.items()):
                    raise HTTPException(409, 'Preview the tag cleanup again before applying it.')
            plan = tag_cleanup.plan(database, frame, payload.field, payload.source, payload.target)
            signature = {'purpose': 'label-cleanup', 'workspace': member['key'], 'csrf': request.session['csrf'],
                         'fingerprint': plan['fingerprint'], 'field': payload.field, 'source': payload.source, 'target': payload.target}
            if action == 'apply':
                if previous != signature:
                    raise HTTPException(409, 'Your labels or trades changed. Preview the cleanup again.')
                tag_cleanup.write_changes(database, plan['changes'], plan['settings'])
                app.state.workspaces.bump(member['key'])
                return {'updated': plan['count']}
            return {'count': plan['count'], 'source': plan['source'], 'target': plan['target'],
                    'preview_token': signer.dumps(signature),
                    'examples': [{'id': item['id'], 'strategy': item['setup_name'], 'labels': edge.read_labels(item['tags'])}
                                 for item in plan['changes'][:5]]}

    @app.put('/api/journal-preferences')
    def save_journal_preferences(payload: JournalPreferences, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            values = {**journal_preferences.read(database), 'timezone': payload.timezone}
            if payload.trading_rules is not None:
                values['trading_rules'] = payload.trading_rules
            if 'daily_loss_limit' in payload.model_fields_set:
                values['daily_loss_limit'] = round(float(payload.daily_loss_limit), 2) if payload.daily_loss_limit and payload.daily_loss_limit > 0 else None
            if 'max_daily_trades' in payload.model_fields_set:
                values['max_daily_trades'] = int(payload.max_daily_trades) if payload.max_daily_trades and payload.max_daily_trades > 0 else None
            database.set_setting(journal_preferences.KEY, values)
            app.state.workspaces.bump(member['key'])
        return values

    @app.post('/api/feedback')
    def submit_feedback(payload: FeedbackInput, request: Request, member=Depends(workspace)):
        from datetime import datetime, timezone, timedelta
        from uuid import uuid4
        message = payload.message.strip()
        if not message:
            raise HTTPException(422, 'Write a message before sending.')
        now = datetime.now(timezone.utc)
        with app.state.workspaces.lock:
            database = app.state.workspaces.root
            rows = database.settings_with_prefix('primus_feedback:').values()
            recent = [row for row in rows if row.get('sender') == member['key'] and row['created_at'] > (now-timedelta(hours=1)).isoformat()]
            if len(recent) >= 5:
                raise HTTPException(429, 'You have sent five messages this hour. Please try again later.')
            record = {'id':uuid4().hex, 'sender':member['key'], 'name':member['name'], 'message':message, 'created_at':now.isoformat()}
            database.set_setting('primus_feedback:'+record['id'], record)
        return {'sent':True}

    @app.get('/api/feedback')
    def read_feedback(request: Request, member=Depends(workspace)):
        if member['key'] != 'owner':
            raise HTTPException(403, 'Only the owner can read feedback.')
        with app.state.workspaces.lock:
            rows = app.state.workspaces.root.settings_with_prefix('primus_feedback:').values()
            return sorted(rows, key=lambda row:row['created_at'], reverse=True)[:100]

    @app.post('/api/release-notes/seen')
    def acknowledge_release(request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            db(request, member).set_setting(release_notes.KEY, release_notes.VERSION)
            app.state.workspaces.bump(member['key'])
        return {'version': release_notes.VERSION}

    @app.put('/api/tour')
    def save_tour_progress(payload: TourProgress, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            current = journal_preferences.read(database)
            status = 'completed' if current['tour_status'] == 'completed' else payload.status
            database.set_setting(journal_preferences.KEY, {**current, 'tour_status': status})
            app.state.workspaces.bump(member['key'])
        return {'status': status}

    @app.put('/api/welcome')
    def welcome_setup(payload: WelcomeSetup, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            if not journal_preferences.read(database)['welcome_pending']:
                raise HTTPException(409, 'Your lab is already set up. Use Lab settings to make changes.')
            for value in payload.strategies + payload.levels + payload.confirmations:
                if not value.strip() or len(value.strip()) > 120:
                    raise ValueError('Use non-empty labels of up to 120 characters.')
            labels = {**lab_settings.read(database), 'confirmations': payload.confirmations}
            lab_settings.validate(labels)
            frame = app.state.workspaces.trades(member['key'])
            strategy_catalog.save(database, frame, {'strategies': payload.strategies, 'levels': payload.levels})
            lab_settings.save(database, frame, labels)
            database.set_setting(journal_preferences.KEY, {**journal_preferences.read(database), 'timezone': payload.timezone, 'welcome_pending': False})
            app.state.workspaces.bump(member['key'])
        return {'saved': True}

    @app.put("/api/lab-settings")
    def save_lab_settings(payload: LabSettings, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            cleaned = payload.model_dump(exclude_none=True)
            aliases = database.get_setting(tag_cleanup.KEY, {})
            for field, key in tag_cleanup.LIST_FIELDS.items():
                if key in cleaned:
                    cleaned[key] = tag_cleanup.names(cleaned[key], field, aliases)
            values = lab_settings.save(database, app.state.workspaces.trades(member['key']), cleaned)
            app.state.workspaces.bump(member["key"])
        return values

    @app.post("/api/lab-settings/archives/delete")
    def delete_lab_archive(payload: ArchivedChoice, request: Request, member=Depends(workspace)):
        workspaces = app.state.workspaces
        with workspaces.workspace_lock(member['key']):
            database = db(request, member)
            archived = workspaces.archived_choices(member['key'])
            if payload.name not in archived.get(payload.field, []):
                raise HTTPException(404, 'This archived choice is no longer available.')
            dismissed = database.get_setting(lab_settings.DISMISSED_ARCHIVES_KEY, {})
            dismissed.setdefault(payload.field, []).append(payload.name)
            database.set_setting(lab_settings.DISMISSED_ARCHIVES_KEY, dismissed)
            workspaces.bump(member['key'])
        return {'ok': True}

    @app.put("/api/playbook")
    def playbook(payload: Playbook, request: Request, member=Depends(workspace)):
        if any(len(value) > 120 for value in payload.strategies + payload.levels):
            raise ValueError("Keep strategy and level names under 120 characters.")
        with app.state.workspaces.workspace_lock(member['key']):
            database = db(request, member)
            aliases = database.get_setting(tag_cleanup.KEY, {})
            values = {'strategies': tag_cleanup.names(payload.strategies, 'strategy', aliases),
                      'levels': tag_cleanup.names(payload.levels, 'level', aliases)}
            book = strategy_catalog.save(database, app.state.workspaces.trades(member['key']), values)
            lab_settings.restore_archive_visibility(database, book)
            app.state.workspaces.bump(member["key"])
        return book

    @app.put("/api/tag-mappings")
    async def tag_mappings(request: Request, member=Depends(workspace)):
        if len(await request.body()) > 100000:
            raise HTTPException(413, "Too many tag mappings.")
        payload = await request.json()
        trade_labels.validate_mappings(payload)
        payload = tag_cleanup.mapping_values(payload, db(request, member).get_setting(tag_cleanup.KEY, {}))
        def save():
            with app.state.workspaces.workspace_lock(member["key"]):
                db(request, member).set_setting(trade_labels.MAPPING_KEY, payload)
                app.state.workspaces.bump(member["key"])
        await run_in_threadpool(save)
        return {"ok": True}

    if (config.assets / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=config.assets / "assets"), name="assets")

    if (config.assets / "pwa").is_dir():
        app.mount("/pwa", StaticFiles(directory=config.assets / "pwa"), name="pwa")

    @app.get("/manifest.json", include_in_schema=False)
    def web_manifest():
        manifest = config.assets / "manifest.json"
        if not manifest.is_file():
            raise HTTPException(404)
        return FileResponse(manifest, media_type="application/manifest+json")

    @app.get("/sw.js", include_in_schema=False)
    def service_worker():
        sw = config.assets / "sw.js"
        if not sw.is_file():
            raise HTTPException(404)
        return FileResponse(
            sw,
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
        )

    @app.get("/{path:path}")
    def frontend(path: str):
        if path.startswith(("api/", "auth/")) or path == "team":
            raise HTTPException(404)
        website = config.site_preview or config.site_enabled
        if config.lab_path:
            if not path and not website:
                return RedirectResponse(config.lab_path, status_code=307)
            if path in ('trades', 'journal', 'overview', 'import', 'tools') and not (website and path == 'journal'):
                return RedirectResponse(config.lab_path + ('#trades' if path in ('trades', 'journal') else '' if path == 'overview' else '/' + path), status_code=307)
            if path == 'lab/':
                return RedirectResponse('/lab', status_code=307)
            if path not in ('lab', 'lab/trades', 'lab/journal', 'lab/overview', 'lab/import', 'lab/tools') and not (website and (path in ('', 'signin', 'journal', 'journal/', 'learn', 'mindset', 'matrix') or ((config.local or config.replay_enabled) and path == 'backtesting'))):
                raise HTTPException(404)
        index = config.assets / "index.html"
        if not index.is_file():
            raise HTTPException(503, "Build the frontend before starting PrimusLab.")
        if config.lab_path or config.site_enabled or config.replay_enabled or config.site_preview:
            content = index.read_text()
            if config.lab_path:
                content = content.replace('name="primus-lab-path" content=""', f'name="primus-lab-path" content="{config.lab_path}"')
            if config.site_enabled:
                content = content.replace('</head>', '<meta name="primus-site-enabled" content="true" /></head>')
            if config.replay_enabled:
                content = content.replace('</head>', '<meta name="primus-replay-enabled" content="true" /></head>')
            if config.site_preview:
                content = content.replace('</head>', '<meta name="primus-site-preview" content="true" /></head>')
            return HTMLResponse(content)
        return FileResponse(index)

    return app
