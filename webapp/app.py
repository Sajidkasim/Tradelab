"""Same-origin React application and private Python API. No broker write endpoints."""
from contextlib import asynccontextmanager
from datetime import date
from dataclasses import asdict, replace
import hmac
import ipaddress
import json
import os
from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Body, Depends, HTTPException, UploadFile, File, Form
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse, Response, RedirectResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from starlette.concurrency import run_in_threadpool
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from core import edge
from core.models import Account, Source
from core.registry import COACH_PROVIDERS, load_extensions
from .schemas import JournalAccount
from services import trade_labels, fixed_rr, strategy_catalog, research, review as trade_review, tag_cleanup
from .config import Settings, from_env
from .image_storage import ImageStorage, StorageUnavailable
from .schemas import Filters, NewTrade, Review, Playbook, BulkStrategy, Unlock, PositionSize, LabSettings, DeleteAllTrades, ImportPreferences, AccountAccess, Study, StudyAssignment, SavedSetup, LabelMerge, JournalPreferences, WelcomeSetup, TourProgress, DailyEntry, JournalTradeLink, FeedbackInput
from .workspaces import Workspaces, serialise_trade, records, SCOPES
from . import imports, backups, lab_settings, trade_deletion, import_updates, journal_preferences, daily_journal, release_notes
from .personal_access import PasswordGate, PersonalSessions, Throttled, auth_version, SESSION_SECONDS
from .google_access import LoginError, AccountBlocked


def create_app(config: Settings | None = None):
    config = config or from_env()
    config.validate()

    @asynccontextmanager
    async def lifespan(app):
        app.state.image_storage = ImageStorage(config)
        app.state.workspaces = await run_in_threadpool(Workspaces, config)
        if config.password_required:
            app.state.personal_sessions = await run_in_threadpool(PersonalSessions, app.state.workspaces.root, auth_version(config.password_hash, config.secret))
        yield
        app.state.workspaces.close()
        app.state.image_storage.close()

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
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=3)
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

    @app.exception_handler(StorageUnavailable)
    async def storage_error(request, exc):
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
                    user_agent=request.headers.get('user-agent'), client_ip=request.client.host if request.client else None)
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

    from . import bullpen
    bullpen.mount(app, config, workspace, check_write)

    # Expose dependency to tests, never an impersonation route.
    app.state.workspace_dependency = workspace

    def db(request, member):
        return request.app.state.workspaces.database(member["key"])

    @app.get("/api/journal-accounts")
    def journal_accounts(request: Request, member=Depends(workspace)):
        return [asdict(account) for account in db(request, member).accounts()]

    def write_journal_account(database, payload, account_id=None):
        values = payload.model_dump()
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise HTTPException(422, "Enter an account name.")
        if account_id is None:
            account = Account(**values, daily_loss_limit=0, max_trailing_drawdown=0)
        else:
            existing = next((item for item in database.accounts() if item.id == account_id), None)
            if existing is None:
                raise HTTPException(404, "Account not found.")
            account = replace(existing, **values)
        try:
            account.id = database.upsert_account(account)
        except IntegrityError:
            raise HTTPException(409, "An account with that name already exists.") from None
        return asdict(account)

    @app.post("/api/journal-accounts", status_code=201)
    def add_journal_account(payload: JournalAccount, request: Request, member=Depends(workspace)):
        return write_journal_account(db(request, member), payload)

    @app.put("/api/journal-accounts/{account_id}")
    def edit_journal_account(account_id: int, payload: JournalAccount, request: Request, member=Depends(workspace)):
        return write_journal_account(db(request, member), payload, account_id)

    @app.delete("/api/journal-accounts/{account_id}")
    def remove_journal_account(account_id: int, request: Request, member=Depends(workspace)):
        database = db(request, member)
        with app.state.workspaces.lock:
            if daily_journal.references_account(database, account_id):
                raise HTTPException(409, "This account has linked Journal trades and cannot be deleted.")
            if not database.delete_unused_account(account_id):
                accounts = database.accounts()
                if not any(account.id == account_id for account in accounts):
                    raise HTTPException(404, "Account not found.")
                if len(accounts) == 1:
                    raise HTTPException(409, "Keep at least one account for trades and imports.")
                raise HTTPException(409, "This account has linked trades and cannot be deleted.")
        return {"deleted": account_id}

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
            return {'authenticated': False, 'local': config.local, 'csrf': request.session['csrf'], 'auth_mode': config.auth_mode, 'images_enabled': request.app.state.image_storage.enabled}
        return {'authenticated': True, 'name': member['name'], 'owner': member['key'] == 'owner', 'local': config.local,
                'auth_mode': config.auth_mode, 'can_lock': config.password_required or config.google_required,
                'csrf': request.session['csrf'], 'images_enabled': request.app.state.image_storage.enabled}

    @app.post('/api/login/google')
    def start_google(request: Request, return_to: str = ""):
        if not config.google_required:
            raise HTTPException(404)
        check_write(request)
        allowed_returns = ('/lab', '/journal', '/learn', '/market-lab', '/mindset') if (config.site_enabled or config.site_preview) else (config.lab_path or '/',)
        if config.local or config.replay_enabled:allowed_returns=(*allowed_returns,'/backtesting')
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
        if destination not in ('/lab', '/journal', '/'):
            destination = config.lab_path or '/'
        try:
            email, subject = access.exchange(attempt, request.query_params.get('code'))
            key = access.join(email, subject)
            # Finish private storage initialization before issuing access.
            app.state.workspaces.database(key)
            token = access.issue(key, user_agent=request.headers.get('user-agent'), client_ip=request.client.host if request.client else None)
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

    from . import replay_sessions
    replay_sessions.mount(app, config, workspace)
    from . import learning
    learning.mount(app, config, workspace)

    @app.get('/api/backtesting/sample')
    def local_chart_sample(member=Depends(workspace)):
        if not config.local:
            raise HTTPException(404)
        sample = Path(__file__).resolve().parents[1] / 'data/private/backtesting-preview.json'
        if not sample.is_file():
            raise HTTPException(404, 'Prepare the local candle sample first.')
        return FileResponse(sample, media_type='application/json', headers={'Cache-Control':'private, no-store'})

    def journal_preview():
        if not config.site_enabled and not (config.site_preview and config.local):
            raise HTTPException(404)

    def journal_images():
        if not app.state.image_storage.enabled:
            raise HTTPException(404)

    @app.get('/api/journal')
    def list_journal(request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.lock:
            return daily_journal.entries(db(request, member))

    @app.get('/api/journal/coach')
    @app.post('/api/journal/coach')
    def journal_coach(day: date, request: Request, account_id: int | None = None,
                      member=Depends(workspace), question: str = Body("", embed=True, max_length=1000)):
        journal_preview()
        check_write(request, allow_missing_origin=request.method == "GET")
        load_extensions(Path(__file__).resolve().parents[1] / 'extensions')
        provider = COACH_PROVIDERS.get('Aura - Trading Assistant')
        if provider is None:
            raise HTTPException(503, 'Aura is unavailable.')
        database = db(request, member)
        accounts = database.accounts()
        account = next((item for item in accounts if account_id is None or item.id == account_id), None)
        if account is None:
            raise HTTPException(404, 'Choose an available Journal account.')
        journal_day = day.isoformat()
        entry = daily_journal.entry(database, journal_day)
        notes = '\n'.join(f'{label}: {entry.get(field) or ""}' for label, field in (
            ('Plan', 'plan'), ('Observations', 'notes'), ('Review', 'lesson'),
        ))
        email = (member.get('email') or (config.owner_email if not config.google_required else '')).strip().casefold()
        matches = [name for name in ('Sajid', 'Safwaan', 'Mubeen', 'Mustafa', 'Amir')
                   if email and email == os.getenv(f'COACH_{name.upper()}_EMAIL', '').strip().casefold()]
        markdown = provider({
            'database': database, 'account': account,
            'trader_name': matches[0] if len(matches) == 1 else 'Trader',
            'notes': f'Journal date: {journal_day}\n{notes}',
            'question': question.strip() if request.method == 'POST' else '',
            'image_ids': [image['id'] for image in entry['images']],
            'read_image': lambda image_id: app.state.image_storage.read(member['key'], journal_day, image_id),
        })
        return {'markdown': markdown}

    @app.get('/api/journal/export')
    def export_journal(request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.lock:
            database = db(request, member)
            content = json.dumps({'entries': daily_journal.entries(database),
                                  'images': 'Download screenshot files separately; this JSON contains notes and image references.'})
        return Response(content, media_type='application/json', headers={'Content-Disposition':'attachment; filename="primus-journal-notes.json"'})

    @app.get('/api/journal/trash')
    def journal_trash(request: Request, member=Depends(workspace)):
        journal_preview()
        return daily_journal.deleted_entries(db(request, member))

    @app.delete('/api/journal/{day}')
    def delete_journal_entry(day: date, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.lock:
            archive_id = daily_journal.delete_entry(db(request, member), day.isoformat())
            app.state.workspaces.bump(member['key'])
        return {'ok': True, 'archive_id': archive_id}

    @app.post('/api/journal/trash/{archive_id}/restore')
    def restore_journal_entry(archive_id: str, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.lock:
            result = daily_journal.restore_entry(db(request, member), archive_id)
            app.state.workspaces.bump(member['key'])
            return daily_journal.with_day_result(db(request, member), result)

    @app.put('/api/journal/{day}')
    def save_journal(day: date, payload: DailyEntry, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.lock:
            values = payload.model_dump(exclude_unset=True)
            if values.get('trades') is None:
                values.pop('trades', None)
            try:
                result = daily_journal.save_day(db(request, member), day.isoformat(), values)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            app.state.workspaces.bump(member['key'])
            return result

    @app.post('/api/journal/{day}/images')
    async def upload_journal_image(day: date, request: Request, file: UploadFile = File(...), trade_id: str = "", member=Depends(workspace)):
        journal_images()
        try:
            content = await file.read(daily_journal.MAX_UPLOAD + 1)
        finally:
            await file.close()
        if len(content) > daily_journal.MAX_UPLOAD:
            raise HTTPException(413, 'Choose a screenshot smaller than 8 MB.')
        def operation():
            with app.state.workspaces.lock:
                result = daily_journal.add_image(db(request, member), config, member['key'], day.isoformat(), content, trade_id, app.state.image_storage)
                app.state.workspaces.bump(member['key'])
                return result
        return await run_in_threadpool(operation)

    @app.get('/api/journal/{day}/images/{image_id}')
    def journal_image(day: date, image_id: str, request: Request, member=Depends(workspace)):
        journal_images()
        database = db(request, member)
        stored = daily_journal.entry(database, day.isoformat())
        if not any(item['id'] == image_id for item in stored['images']):
            raise HTTPException(404)
        data = app.state.image_storage.read(member['key'], day.isoformat(), image_id)
        if data is None:
            raise HTTPException(404)
        return Response(data, media_type='image/webp', headers={'Content-Disposition':'inline; filename="primus-screenshot.webp"'})

    @app.delete('/api/journal/{day}/images/{image_id}')
    def remove_journal_image(day: date, image_id: str, request: Request, member=Depends(workspace)):
        journal_images()
        with app.state.workspaces.lock:
            database = db(request, member)
            stored = daily_journal.entry(database, day.isoformat())
            images = [item for item in stored['images'] if item['id'] != image_id]
            if len(images) == len(stored['images']):
                raise HTTPException(404)
            result = daily_journal.save(database, day.isoformat(), {'images': images})
            app.state.workspaces.bump(member['key'])
        # Detached preview files are no longer accessible and disappear with the
        # disposable preview directory. No real cloud objects are deleted.
        return result

    @app.put('/api/journal/{day}/trades/{record_id}/link')
    def link_journal_trade(day: date, record_id: str, payload: JournalTradeLink, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.lock:
            result = daily_journal.link_trade(db(request, member), day.isoformat(), record_id, payload.trade_id)
            app.state.workspaces.bump(member['key'])
            return result

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
            raise ValueError('Choose a valid market from your lab.')
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
        values = payload.model_dump(exclude={"labels", "confirmed", "study_id", "risk_unavailable", "journal_day", "journal_trade_id"})
        values['source'] = Source(values['source'])
        trade = edge.build_trade(instruments=database.instruments(), tags=labels, **values)
        with app.state.workspaces.lock:
            journal_day = payload.journal_day.isoformat() if payload.journal_day else None
            if bool(journal_day) != bool(payload.journal_trade_id):
                raise ValueError('Choose a saved journal trade and day.')
            if journal_day:
                journal_preview()
                record = daily_journal.trade_entry(database, journal_day, payload.journal_trade_id)
                if record is None:
                    raise ValueError('Save the journal trade before adding it to the Lab.')
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
                raise ValueError('Reload your lab and try again.')
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
        with app.state.workspaces.lock:
            db(request, member).set_setting(release_notes.KEY, release_notes.VERSION)
            app.state.workspaces.bump(member['key'])
        return {'version': release_notes.VERSION}

    @app.put('/api/tour')
    def save_tour_progress(payload: TourProgress, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
            database = db(request, member)
            current = journal_preferences.read(database)
            status = 'completed' if current['tour_status'] == 'completed' else payload.status
            database.set_setting(journal_preferences.KEY, {**current, 'tour_status': status})
            app.state.workspaces.bump(member['key'])
        return {'status': status}

    @app.put('/api/welcome')
    def welcome_setup(payload: WelcomeSetup, request: Request, member=Depends(workspace)):
        with app.state.workspaces.lock:
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
                raise ValueError('Reload your lab and try again.')
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
                tag_context = preview.pop('_tag_context', {})
                changes, issues = import_updates.plan(database, parsed, notes) if update_labels else ([], [])
                preview['issues'].extend(issues)
                if update_labels:
                    preview['counts']['updates'] = len(changes)
                preview['label_updates'] = [{'id':item['id'], **item['preview']} for item in changes][:200]
                signature = [member['key'], fingerprint, import_updates.digest({
                    'mappings': database.get_setting(trade_labels.MAPPING_KEY, {}),
                    'automatic_labels': tag_context,
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
                    raise HTTPException(409, "Restore is available only in an empty lab. Download a backup before migrating an existing lab.")
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
        website = config.site_preview or config.site_enabled
        if config.lab_path:
            if not path and not website:
                return RedirectResponse(config.lab_path, status_code=307)
            if path in ('trades', 'journal', 'overview', 'import', 'tools') and not (website and path == 'journal'):
                return RedirectResponse(config.lab_path + ('#trades' if path in ('trades', 'journal') else '' if path == 'overview' else '/' + path), status_code=307)
            if path == 'lab/':
                return RedirectResponse('/lab', status_code=307)
            if path not in ('lab', 'lab/trades', 'lab/journal', 'lab/overview', 'lab/import', 'lab/tools') and not (website and (path in ('', 'journal', 'journal/', 'learn', 'market-lab', 'mindset') or ((config.local or config.replay_enabled) and path == 'backtesting'))):
                raise HTTPException(404)
        index = config.assets / "index.html"
        if not index.is_file():
            raise HTTPException(503, "Build the frontend before starting PrimusLab.")
        if config.lab_path:
            content = index.read_text().replace('name="primus-lab-path" content=""', 'name="primus-lab-path" content="/lab"')
            if config.site_enabled:
                content = content.replace('</head>', '<meta name="primus-site-enabled" content="true" /></head>')
            if config.replay_enabled:
                content = content.replace('</head>', '<meta name="primus-replay-enabled" content="true" /></head>')
            if config.site_preview:
                content = content.replace('</head>', '<meta name="primus-site-preview" content="true" /></head>')
            return HTMLResponse(content)
        return FileResponse(index)

    return app
