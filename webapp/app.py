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
from fastapi.responses import JSONResponse, FileResponse, Response, RedirectResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy.exc import SQLAlchemyError

from core import edge
from core.models import Source
from services import trade_labels, fixed_rr, strategy_catalog, research, review as trade_review, tag_cleanup
from .config import Settings, from_env
from .schemas import Filters, NewTrade, Review, Playbook, BulkStrategy, Unlock, PositionSize, LabSettings, DeleteAllTrades, ImportPreferences, AccountAccess, Study, StudyAssignment, SavedSetup, LabelMerge, JournalPreferences, WelcomeSetup
from .workspaces import Workspaces, serialise_trade, records, SCOPES
from . import imports, backups, lab_settings, trade_deletion, import_updates, journal_preferences
from .personal_access import PasswordGate, PersonalSessions, Throttled, auth_version, SESSION_SECONDS
from .google_access import LoginError, AccountBlocked


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
    if config.legacy_host:
        allowed_hosts.append(config.legacy_host)
    if config.custom_host:
        allowed_hosts.append(config.custom_host)
    app.add_middleware(SessionMiddleware, secret_key=config.secret, session_cookie="primus_session",
                       max_age=SESSION_SECONDS, same_site="lax", https_only=not config.local)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

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
        if not request.url.path.startswith("/assets/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer" if request.url.path.startswith('/auth/') else "same-origin"
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
        if config.google_required:
            try:
                member = request.app.state.workspaces.google.member(request.session.get('google_token'),
                    user_agent=request.headers.get('user-agent'), client_ip=request.client.host if request.client else None)
            except LoginError:
                raise HTTPException(401, 'Sign in to your journal to continue.') from None
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                check_write(request)
            return member
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
            return {'authenticated': False, 'local': config.local, 'csrf': request.session['csrf'], 'auth_mode': config.auth_mode}
        return {'authenticated': True, 'name': member['name'], 'owner': member['key'] == 'owner', 'local': config.local,
                'auth_mode': config.auth_mode, 'can_lock': config.password_required or config.google_required,
                'csrf': request.session['csrf']}

    @app.post('/api/login/google')
    def start_google(request: Request):
        if not config.google_required:
            raise HTTPException(404)
        check_write(request)
        try:
            attempt, url = app.state.workspaces.google.start(request.session.get('google_attempt'))
        except LoginError:
            raise HTTPException(429, 'Sign-in is busy. Please try again in a few minutes.') from None
        request.session['google_attempt'] = attempt
        return {'url': url}

    @app.get('/auth/callback')
    def google_callback(request: Request):
        if not config.google_required:
            raise HTTPException(404)
        access = app.state.workspaces.google
        attempt = request.session.pop('google_attempt', None)
        try:
            email, subject = access.exchange(attempt, request.query_params.get('code'))
            key = access.join(email, subject)
            # Finish private storage initialization before issuing access.
            app.state.workspaces.database(key)
            token = access.issue(key, user_agent=request.headers.get('user-agent'), client_ip=request.client.host if request.client else None)
        except AccountBlocked:
            return RedirectResponse((config.lab_path or '/') + '?login=blocked', status_code=303)
        except LoginError:
            return RedirectResponse((config.lab_path or '/') + '?login=retry', status_code=303)
        access.revoke(request.session.get('google_token'))
        request.session.clear()
        request.session.update(google_token=token, csrf=token_urlsafe(32))
        return RedirectResponse(config.lab_path or '/', status_code=303)

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
                raise HTTPException(401, 'That password did not unlock your journal.')
            token = await run_in_threadpool(app.state.personal_sessions.issue)
            request.session.clear()
            request.session['personal_token'] = token
            app.state.workspaces.bump('owner')
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
            frame['target_rr'] = frame['tags'].map(lambda tags: fixed_rr.read(tags)['target_rr'])
            frame['fixed_exit'] = frame['tags'].map(lambda tags: fixed_rr.read(tags)['fixed_exit'])
            frame["needs_tagging"] = trade_labels.needs_tagging(frame)
        rows = records(frame)
        for row in rows:
            row['study_id'] = research.test_id(row.get('tags'))
            row.update(trade_review.missing(row))
        return rows

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
        values = payload.model_dump(exclude={"labels", "confirmed", "study_id", "risk_unavailable"})
        values['source'] = Source(values['source'])
        trade = edge.build_trade(instruments=database.instruments(), tags=labels, **values)
        with app.state.workspaces.lock:
            fields = tag_cleanup.trade_fields(trade, database.get_setting(tag_cleanup.KEY, {}))
            trade.tags, trade.setup_name = fields['tags'], fields['setup_name']
            research.attach(database, trade, payload.study_id or '')
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
            if payload.risk_amount is not None and payload.risk_unavailable:
                raise ValueError('Enter the original risk or mark it unavailable, not both.')
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
            app.state.workspaces.bump(member["key"])
            return serialise_trade(database.get_trade(trade_id))

    @app.post("/api/trades/deletion-preview")
    def deletion_preview(request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
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
        with app.state.workspaces.lock:
            count = trade_deletion.remove_snapshot(db(request, member), snapshot)
            if count is None:
                raise HTTPException(409, "Your trades changed. Open Delete all trades again to confirm the new count.")
            app.state.workspaces.bump(member['key'])
        return {'deleted': count}

    @app.delete("/api/trades/{trade_id}")
    def delete_trade(trade_id: int, request: Request, member=Depends(workspace)):
        database = db(request, member)
        with app.state.workspaces.lock:
            if database.get_trade(trade_id) is None:
                raise HTTPException(404, "This trade is no longer available.")
            database.delete_trade(trade_id)
            app.state.workspaces.bump(member["key"])
        return {"deleted": trade_id}

    @app.post("/api/trades/strategy")
    def bulk_strategy(payload: BulkStrategy, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            database = db(request, member)
            strategy = tag_cleanup.canonical(payload.strategy, 'strategy', database.get_setting(tag_cleanup.KEY, {}))
            count = trade_labels.apply_strategy(database, payload.ids, strategy)
            app.state.workspaces.bump(member["key"])
        return {"updated": count}

    @app.post('/api/studies')
    def create_study(payload: Study, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            database = db(request, member)
            values = payload.model_dump()
            values['strategy'] = tag_cleanup.canonical(values['strategy'], 'strategy', database.get_setting(tag_cleanup.KEY, {}))
            result = research.save_test(database, values)
            app.state.workspaces.bump(member['key'])
        return result

    @app.put('/api/studies/{study_id}')
    def update_study(study_id: str, payload: Study, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            result = research.save_test(db(request, member), payload.model_dump(), study_id)
            app.state.workspaces.bump(member['key'])
        return result

    @app.post('/api/study-assignment')
    def assign_study(payload: StudyAssignment, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            count = research.assign(db(request, member), payload.ids, payload.study_id)
            app.state.workspaces.bump(member['key'])
        return {'updated': count}

    @app.post('/api/saved-setups')
    def create_saved_setup(payload: SavedSetup, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            database = db(request, member)
            if payload.filters.account_id is not None and payload.filters.account_id not in {a.id for a in database.accounts()}:
                raise ValueError('Choose an account in your journal.')
            filters = payload.filters.model_dump(mode='json', exclude={'mode', 'detail', 'comparison', 'study_id'})
            result = research.save_setup(database, payload.name, filters)
            app.state.workspaces.bump(member['key'])
        return result

    @app.delete('/api/saved-setups/{setup_id}')
    def remove_saved_setup(setup_id: str, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
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
        with app.state.workspaces.lock:
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
        with app.state.workspaces.lock:
            database = db(request, member)
            values = {**journal_preferences.read(database), 'timezone': payload.timezone}
            database.set_setting(journal_preferences.KEY, values)
            app.state.workspaces.bump(member['key'])
        return values

    @app.put('/api/welcome')
    def welcome_setup(payload: WelcomeSetup, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            database = db(request, member)
            if not journal_preferences.read(database)['welcome_pending']:
                raise HTTPException(409, 'Your journal is already set up. Use Lab settings to make changes.')
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
        with app.state.workspaces.lock:
            database = db(request, member)
            cleaned = payload.model_dump(exclude_none=True)
            aliases = database.get_setting(tag_cleanup.KEY, {})
            for field, key in tag_cleanup.LIST_FIELDS.items():
                if key in cleaned:
                    cleaned[key] = tag_cleanup.names(cleaned[key], field, aliases)
            values = lab_settings.save(database, app.state.workspaces.trades(member['key']), cleaned)
            app.state.workspaces.bump(member["key"])
        return values

    @app.put("/api/playbook")
    def playbook(payload: Playbook, request: Request, member=Depends(workspace)):
        if any(len(value) > 120 for value in payload.strategies + payload.levels):
            raise ValueError("Keep strategy and level names under 120 characters.")
        with app.state.workspaces.lock:
            database = db(request, member)
            aliases = database.get_setting(tag_cleanup.KEY, {})
            values = {'strategies': tag_cleanup.names(payload.strategies, 'strategy', aliases),
                      'levels': tag_cleanup.names(payload.levels, 'level', aliases)}
            book = strategy_catalog.save(database, app.state.workspaces.trades(member['key']), values)
            app.state.workspaces.bump(member["key"])
        return book

    @app.put("/api/tag-mappings")
    async def tag_mappings(request: Request, member=Depends(workspace)):
        if len(await request.body()) > 100000:
            raise HTTPException(413, "Too many tag mappings.")
        payload = await request.json()
        trade_labels.validate_mappings(payload)
        payload = tag_cleanup.mapping_values(payload, db(request, member).get_setting(tag_cleanup.KEY, {}))
        await run_in_threadpool(db(request, member).set_setting, trade_labels.MAPPING_KEY, payload)
        app.state.workspaces.bump(member["key"])
        return {"ok": True}

    @app.put('/api/import-preferences')
    def save_import_preferences(payload: ImportPreferences, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            database = db(request, member)
            if payload.account_id not in {account.id for account in database.accounts()}:
                raise ValueError('Choose an account in your journal.')
            values = payload.model_dump()
            database.set_setting(import_updates.PROFILE_KEY, values)
            app.state.workspaces.bump(member['key'])
        return values

    @app.post("/api/import/{action}")
    async def import_file(action: str, request: Request, file: UploadFile = File(...), account_id: int = Form(...),
                          source: str = Form("fxreplay"), timezone: str = Form("UTC"), dayfirst: bool = Form(False),
                          mapping: str = Form("{}"), preview_token: str = Form(""), update_labels: bool = Form(False),
                          include_breakeven: bool = Form(True),
                          remember_profile: bool = Form(False), study_id: str = Form(''), member=Depends(workspace)):
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
        fingerprint = imports.digest(content, filename, account_id, source, timezone, dayfirst, columns, include_breakeven)
        def operation():
            with app.state.workspaces.lock:
                database = db(request, member)
                parsed, preview = imports.parse(content, filename, database, account_id, source, timezone, dayfirst, columns, include_breakeven)
                study = research.get_test(database, study_id, active=True)
                for trade in parsed:
                    research.attach(database, trade, study_id, study=study)
                preview['study'] = {'id': study['id'], 'name': study['name']} if study else None
                if study and study.get('symbol') and any(trade.symbol != study['symbol'] for trade in parsed):
                    preview['issues'].append(f"Some trades use a different market from this test’s planned {study['symbol']}. Check the destination before importing.")
                notes = preview.pop('_notes', {})
                changes, issues = import_updates.plan(database, parsed, notes) if update_labels else ([], [])
                preview['issues'].extend(issues)
                if update_labels:
                    preview['counts']['updates'] = len(changes)
                preview['label_updates'] = [{'id':item['id'], **item['preview']} for item in changes][:200]
                signature = [member['key'], fingerprint, import_updates.digest({
                    'mappings': database.get_setting(trade_labels.MAPPING_KEY, {}),
                    'aliases': database.get_setting(tag_cleanup.KEY, {}), 'study_id': study_id,
                    'update_labels': update_labels, 'remember_profile': remember_profile,
                    'changes':changes if update_labels else None})]
                if action == "confirm":
                    try:
                        approval = signer.loads(preview_token, max_age=900)
                    except (BadSignature, SignatureExpired):
                        raise HTTPException(409, "Preview the file again before importing.") from None
                    if approval != signature:
                        raise HTTPException(409, "File, labels or import options changed. Preview again.")
                    result = import_updates.apply(database, parsed, changes) if update_labels else database.insert_trades(parsed)
                    if remember_profile:
                        database.set_setting(import_updates.PROFILE_KEY, {'account_id':account_id, 'source':preview['source'],
                            'timezone':timezone, 'dayfirst':dayfirst, 'update_labels':update_labels,
                            'include_breakeven':include_breakeven})
                    if preview['excluded_breakeven']:
                        result['excluded_breakeven'] = preview['excluded_breakeven']
                    app.state.workspaces.bump(member["key"])
                    return result
                preview["preview_token"] = signer.dumps(signature)
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
        if config.lab_path:
            if not path:
                return RedirectResponse(config.lab_path, status_code=307)
            if path in ('trades', 'journal', 'overview', 'import', 'tools'):
                return RedirectResponse(config.lab_path + ('#trades' if path in ('trades', 'journal') else '' if path == 'overview' else '/' + path), status_code=307)
            if path == 'lab/':
                return RedirectResponse('/lab', status_code=307)
            if path not in ('lab', 'lab/trades', 'lab/journal', 'lab/overview', 'lab/import', 'lab/tools'):
                raise HTTPException(404)
        index = config.assets / "index.html"
        if not index.is_file():
            raise HTTPException(503, "Build the frontend before starting PrimusLab.")
        if config.lab_path:
            return HTMLResponse(index.read_text().replace('name="primus-lab-path" content=""',
                                                         'name="primus-lab-path" content="/lab"'))
        return FileResponse(index)

    return app
