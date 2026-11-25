"""Daily Journal, Prop Account ledger, Primax coach, voice transcription, and screenshot routes."""
from __future__ import annotations

from dataclasses import asdict, replace
from datetime import date
from email.message import EmailMessage
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
from secrets import randbelow
import smtplib
from tempfile import TemporaryFile
from time import monotonic
from typing import Literal
from zipfile import ZipFile

import httpx

from fastapi import BackgroundTasks, Body, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from core.models import Account
from core.registry import COACH_PROVIDERS, load_extensions
from . import compound_edge, daily_journal, journal_preferences, journal_replay, primax_memory
from .image_storage import StorageUnavailable
from .mail_delivery import send_gmail
from .schemas import DailyEntry, JournalAccount, JournalAccountPresets, JournalTradeLink


class AuraTurn(BaseModel):
    question: str = Field(max_length=400)
    answer: str = Field(max_length=650)


logger = logging.getLogger(__name__)


class JournalResetCode(BaseModel):
    code: str = Field(pattern=r"^[0-9]{6}$")
    confirmation: Literal["DELETE JOURNAL"]


def journal_mail_credentials():
    api_key = os.getenv("JOURNAL_RESEND_API_KEY", "").strip()
    api_sender = os.getenv("JOURNAL_RESEND_FROM", "").strip()
    if api_key and api_sender:
        return "resend", api_sender, api_key
    for prefix in ("JOURNAL", "BULLPEN"):
        sender = os.getenv(f"{prefix}_GMAIL_ADDRESS", "").strip()
        password = "".join(os.getenv(f"{prefix}_GMAIL_APP_PASSWORD", "").split())
        if sender and password:
            return "gmail", sender, password
    return None


def send_journal_reset_code(provider, sender, secret, recipient, code):
    subject = "PrimusTrader Journal reset code"
    content = f"Your Journal reset code is {code}. It expires in 10 minutes. Ignore this email if you did not request it."
    if provider == "resend":
        response = httpx.post("https://api.resend.com/emails", timeout=10,
                              headers={"Authorization": f"Bearer {secret}"},
                              json={"from": sender, "to": [recipient], "subject": subject, "text": content})
        response.raise_for_status()
        return
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = sender, recipient, subject
    message.set_content(content)
    send_gmail(message, sender, secret, [recipient])


def journal_reset_snapshot(database):
    records = {**database.settings_with_prefix(daily_journal.PREFIX),
               **database.settings_with_prefix(daily_journal.TRASH_PREFIX)}
    for key in (daily_journal.PRESETS_KEY, journal_replay.KEY, journal_preferences.KEY, primax_memory.KEY):
        records[key] = database.get_setting(key, {})
    accounts = [asdict(account) for account in database.accounts()]
    retained = database.accounts_with_history()
    return records, accounts, retained


def journal_reset_summary(records, accounts, retained):
    return {
        "entries": sum(bool(row) for key, row in records.items() if key.startswith(daily_journal.PREFIX)),
        "trash": sum(bool(row) for key, row in records.items() if key.startswith(daily_journal.TRASH_PREFIX)),
        "imports": len(records[journal_replay.KEY]),
        "presets": len(records[daily_journal.PRESETS_KEY]),
        "accounts": sum(account["id"] not in retained for account in accounts),
        "shared_accounts": sum(account["id"] in retained for account in accounts),
    }


def journal_reset_fingerprint(records, accounts, retained):
    data = {key: value for key, value in records.items() if key != primax_memory.KEY}
    return hashlib.sha256(json.dumps([data, accounts, sorted(retained)], sort_keys=True).encode()).hexdigest()


def journal_reset_images(records):
    return {(row["day"], image["id"]) for key, row in records.items()
            if key.startswith((daily_journal.PREFIX, daily_journal.TRASH_PREFIX)) and row
            for image in row.get("images", [])}


def discard_reset_screenshots(storage, key, screenshots):
    for day, image_id in screenshots:
        try:
            storage.discard_unreferenced(key, day, image_id)
        except (ValueError, OSError):
            logger.warning("journal_reset_screenshot_cleanup_failed")


def mount(app, config, workspace, check_write, db):
    reset_codes = {}

    def code_digest(request, member, code):
        binding = json.dumps([member["key"], member["email"], request.session["csrf"], code])
        return hmac.digest(config.secret.encode(), binding.encode(), "sha256")

    def write_journal_account(database, payload, account_id=None):
        values = payload.model_dump(exclude_unset=True)
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise HTTPException(422, "Enter an account name.")
        if "firm" in values:
            values["firm"] = values["firm"].strip()
        if "closed_at" in values and values["closed_at"] is not None:
            values["closed_at"] = values["closed_at"].isoformat()
        if account_id is None:
            if values.get("status") in ("blown", "passed") and not values.get("closed_at"):
                values["closed_at"] = date.today().isoformat()
            account = Account(**values, daily_loss_limit=0, max_trailing_drawdown=0)
        else:
            existing = next((item for item in database.accounts() if item.id == account_id), None)
            if existing is None:
                raise HTTPException(404, "Account not found.")
            if "status" in values and "closed_at" not in values:
                if values["status"] in ("blown", "passed") and existing.status == "active" and not existing.closed_at:
                    values["closed_at"] = date.today().isoformat()
                elif values["status"] == "active" and existing.status != "active":
                    values["closed_at"] = None
            account = replace(existing, **values)
        try:
            account.id = database.upsert_account(account)
        except IntegrityError:
            raise HTTPException(409, "An account with that name already exists.") from None
        return asdict(account)

    @app.get("/api/journal-accounts")
    def journal_accounts(request: Request, member=Depends(workspace)):
        return [asdict(account) for account in db(request, member).accounts()]

    @app.get("/api/journal-accounts/presets")
    def get_journal_account_presets(request: Request, member=Depends(workspace)):
        return {"presets": daily_journal.account_presets(db(request, member))}

    @app.put("/api/journal-accounts/presets")
    def put_journal_account_presets(payload: JournalAccountPresets, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member["key"]):
            try:
                saved = daily_journal.save_account_presets(
                    db(request, member), [item.model_dump() for item in payload.presets]
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            app.state.workspaces.bump(member["key"])
        return {"presets": saved}

    @app.post("/api/journal-accounts", status_code=201)
    def add_journal_account(payload: JournalAccount, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member["key"]):
            result = write_journal_account(db(request, member), payload)
            app.state.workspaces.bump(member["key"])
            return result

    @app.put("/api/journal-accounts/{account_id}")
    def edit_journal_account(account_id: int, payload: JournalAccount, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member["key"]):
            result = write_journal_account(db(request, member), payload, account_id)
            app.state.workspaces.bump(member["key"])
            return result

    @app.delete("/api/journal-accounts/{account_id}")
    def remove_journal_account(account_id: int, request: Request, member=Depends(workspace)):
        database = db(request, member)
        with app.state.workspaces.workspace_lock(member["key"]):
            if daily_journal.references_account(database, account_id):
                raise HTTPException(
                    409,
                    "This account has linked Journal trades. Mark it as Blown or Passed to keep its history.",
                )
            if not database.delete_unused_account(account_id):
                accounts = database.accounts()
                if not any(account.id == account_id for account in accounts):
                    raise HTTPException(404, "Account not found.")
                if len(accounts) == 1:
                    raise HTTPException(409, "Keep at least one account for trades and imports.")
                raise HTTPException(409, "This account has linked trades and cannot be deleted.")
            app.state.workspaces.bump(member["key"])
        return {"deleted": account_id}

    def journal_preview():
        if not config.site_enabled and not (config.site_preview and config.local):
            raise HTTPException(404)

    def journal_images():
        if not app.state.image_storage.enabled:
            raise HTTPException(404)

    @app.get("/api/journal")
    def list_journal(request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            return daily_journal.entries(db(request, member))

    @app.get("/api/journal/summary")
    def list_journal_summary(request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            return daily_journal.entries_summary(db(request, member))

    @app.get("/api/journal/equity")
    def journal_equity(
        request: Request,
        scope: Literal["active", "funded", "eval", "personal", "passed", "blown", "all"] = "active",
        account_id: int | None = Query(default=None, gt=0),
        member=Depends(workspace),
    ):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            return daily_journal.equity_and_insights(db(request, member), scope=scope, account_id=account_id)

    @app.post("/api/journal/transcribe")
    async def transcribe_journal_voice(request: Request, file: UploadFile = File(...), member=Depends(workspace)):
        journal_preview()
        try:
            content = await file.read(daily_journal.MAX_AUDIO_UPLOAD + 1)
        finally:
            await file.close()
        if len(content) > daily_journal.MAX_AUDIO_UPLOAD:
            raise HTTPException(413, "Keep voice recordings smaller than 8 MB.")
        try:
            text = await run_in_threadpool(
                daily_journal.transcribe_audio,
                content,
                filename=file.filename or "voice-note.webm",
                content_type=file.content_type or "audio/webm",
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from None
        return {"text": text}

    @app.get("/api/journal/coach")
    @app.post("/api/journal/coach")
    def journal_coach(
        day: date,
        request: Request,
        account_id: int | None = None,
        member=Depends(workspace),
        question: str = Body("", embed=True, max_length=1000),
        history: list[AuraTurn] | None = Body(None, max_length=3),
    ):
        journal_preview()
        check_write(request, allow_missing_origin=request.method == "GET")
        from . import app as app_mod

        app_mod.load_extensions(Path(__file__).resolve().parents[1] / "extensions")
        provider = app_mod.COACH_PROVIDERS.get("Primax - Trading Assistant")
        if provider is None:
            raise HTTPException(503, "Primax is unavailable.")
        database = db(request, member)
        accounts = database.accounts()
        account = next((item for item in accounts if account_id is None or item.id == account_id), None)
        if account is None:
            raise HTTPException(404, "Choose an available Journal account.")
        journal_day = day.isoformat()
        entry = daily_journal.entry(database, journal_day)
        notes = "\n".join(
            f'{label}: {entry.get(field) or ""}'
            for label, field in (("Plan", "plan"), ("Observations", "notes"), ("Review", "lesson"))
        )
        email = (member.get("email") or (config.owner_email if not config.google_required else "")).strip().casefold()
        matches = [
            name
            for name in ("Sajid", "Safwaan", "Mubeen", "Mustafa", "Amir")
            if email and email == os.getenv(f"COACH_{name.upper()}_EMAIL", "").strip().casefold()
        ]
        asked = question.strip() if request.method == "POST" else ""
        recalled = primax_memory.recall(
            database,
            asked or notes,
            exclude_day=journal_day,
            limit=4,
        )
        markdown = provider(
            {
                "database": database,
                "account": account,
                "trader_name": matches[0] if len(matches) == 1 else "Trader",
                "notes": (
                    f'Journal date: {journal_day}\nDid you trade today? '
                    f'{entry.get("traded_today") or "Not recorded"}\n{notes}'
                ),
                "question": asked,
                "history": [turn.model_dump() for turn in (history or [])],
                "recalled_memories": recalled,
                "journal_trades": [
                    {
                        field: str(trade.get(field) or "")[:220] if field != "net_pnl" else trade.get(field)
                        for field in ("symbol", "direction", "strategy", "outcome", "net_pnl", "notes")
                    }
                    for trade in entry["trades"]
                    if account_id is None or trade.get("account_id") == account_id
                ][:6],
                "image_ids": [image["id"] for image in entry["images"]],
                "read_image": lambda image_id: app.state.image_storage.read(member["key"], journal_day, image_id),
            }
        )
        reply = {"markdown": markdown}
        if recalled:
            reply["memories"] = [
                {"day": item["day"], "mindset": item["mindset"], "preview": item["preview"]}
                for item in recalled
            ]
        return reply

    @app.get("/api/journal/export")
    def export_journal(request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            database = db(request, member)
            content = json.dumps(
                {
                    "entries": daily_journal.entries(database),
                    "images": "Download screenshot files separately; this JSON contains notes and image references.",
                }
            )
        return Response(
            content,
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="primus-journal-notes.json"'},
        )

    @app.get("/api/journal/trash")
    def journal_trash(request: Request, member=Depends(workspace)):
        journal_preview()
        return daily_journal.deleted_entries(db(request, member))

    @app.get("/api/journal/reset/preview")
    def preview_journal_reset(request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            summary = journal_reset_summary(*journal_reset_snapshot(db(request, member)))
        name, _, domain = (member.get("email") or "").partition("@")
        return {**summary, "email_hint": f"{name[:1]}…@{domain}" if domain else None,
                "available": bool(domain and journal_mail_credentials())}

    @app.get("/api/journal/reset/backup")
    def download_journal_reset_backup(request: Request, member=Depends(workspace)):
        journal_preview()
        key = member["key"]
        with app.state.workspaces.workspace_lock(key):
            records, accounts, _ = journal_reset_snapshot(db(request, member))
        archive = TemporaryFile()
        try:
            with ZipFile(archive, "w") as files:
                files.writestr("journal.json", json.dumps({
                    "accounts": accounts, "settings": {k: v for k, v in records.items() if k != primax_memory.KEY},
                }))
                for day, image_id in sorted(journal_reset_images(records)):
                    image = app.state.image_storage.read(key, day, image_id)
                    if image is None:
                        raise StorageUnavailable()
                    files.writestr(f"screenshots/{day}/{image_id}.webp", image)
            archive.seek(0)
        except (StorageUnavailable, OSError, ValueError):
            archive.close()
            raise HTTPException(503, "A complete Journal backup could not be downloaded.") from None

        def chunks():
            with archive:
                while chunk := archive.read(64 * 1024):
                    yield chunk

        return StreamingResponse(chunks(), media_type="application/zip", background=BackgroundTask(archive.close), headers={
            "Content-Disposition": 'attachment; filename="primus-journal-backup.zip"',
            "Cache-Control": "private, no-store",
        })

    @app.post("/api/journal/reset/send-code")
    def request_journal_reset_code(request: Request, member=Depends(workspace)):
        journal_preview()
        recipient = member.get("email")
        if not recipient:
            raise HTTPException(403, "Sign in with your Google account to verify this action.")
        credentials = journal_mail_credentials()
        if not credentials:
            raise HTTPException(503, "Journal verification email is unavailable.")
        key = member["key"]
        with app.state.workspaces.workspace_lock(key):
            snapshot = journal_reset_snapshot(db(request, member))
            summary = journal_reset_summary(*snapshot)
            if not any(summary[k] for k in ("entries", "trash", "imports", "presets", "accounts")):
                raise HTTPException(409, "There is no Journal history to reset.")
            retry = app.state.rate_counters.consume(f"journal-reset-code:{key}", limit=3, window=900)
            if retry:
                raise HTTPException(429, "Too many code requests. Try again later.", headers={"Retry-After": str(retry)})
            challenge = {"fingerprint": journal_reset_fingerprint(*snapshot), "attempts": 0}
            reset_codes[key] = challenge
        code = f"{randbelow(1_000_000):06d}"
        try:
            send_journal_reset_code(*credentials, recipient, code)
        except (OSError, ValueError, httpx.HTTPError) as exc:
            with app.state.workspaces.workspace_lock(key):
                if reset_codes.get(key) is challenge:
                    reset_codes.pop(key)
            logger.warning("journal_reset_mail_failed provider=%s error_type=%s", credentials[0], type(exc).__name__)
            if isinstance(exc, smtplib.SMTPAuthenticationError):
                raise HTTPException(503, "Gmail rejected the Journal sender credentials. Update the mail sender and retry.") from None
            raise HTTPException(503, "The Journal mail sender could not deliver a code. Try again shortly.") from None
        with app.state.workspaces.workspace_lock(key):
            if reset_codes.get(key) is not challenge:
                raise HTTPException(409, "A newer code was requested. Use the latest email.")
            challenge.update(digest=code_digest(request, member, code), expires=monotonic() + 600,
                             session=request.session["csrf"])
        return summary

    @app.post("/api/journal/reset/confirm")
    def confirm_journal_reset(payload: JournalResetCode, request: Request, background: BackgroundTasks,
                              member=Depends(workspace)):
        journal_preview()
        key = member["key"]
        with app.state.workspaces.workspace_lock(key):
            challenge = reset_codes.get(key)
            if not challenge or challenge.get("session") != request.session["csrf"]:
                raise HTTPException(403, "Request a code from this session first.")
            if monotonic() >= challenge["expires"]:
                reset_codes.pop(key)
                raise HTTPException(403, "The code expired. Request a new one.")
            if not hmac.compare_digest(challenge["digest"], code_digest(request, member, payload.code)):
                challenge["attempts"] += 1
                if challenge["attempts"] >= 5:
                    reset_codes.pop(key)
                    raise HTTPException(403, "Too many attempts. Request a new code.")
                raise HTTPException(422, "That code is incorrect.")
            reset_codes.pop(key)
            database = db(request, member)
            snapshot = journal_reset_snapshot(database)
            if challenge["fingerprint"] != journal_reset_fingerprint(*snapshot):
                raise HTTPException(409, "The Journal changed. Request a new code to review the updated totals.")
            records, _, retained = snapshot
            screenshots = journal_reset_images(records)
            database.reset_journal(records, retained)
            app.state.workspaces.bump(key)
        background.add_task(discard_reset_screenshots, app.state.image_storage, key, screenshots)
        return {"reset": True}

    @app.delete("/api/journal/{day}")
    def delete_journal_entry(day: date, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            database = db(request, member)
            archive_id = daily_journal.delete_entry(database, day.isoformat())
            primax_memory.remove_day(database, day.isoformat())
            app.state.workspaces.bump(member["key"])
        return {"ok": True, "archive_id": archive_id}

    @app.post("/api/journal/trash/{archive_id}/restore")
    def restore_journal_entry(archive_id: str, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            result = daily_journal.restore_entry(db(request, member), archive_id)
            app.state.workspaces.bump(member["key"])
            return daily_journal.with_day_result(db(request, member), result)

    @app.get("/api/journal/{day}")
    def read_journal_day(day: date, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            return daily_journal.entry(db(request, member), day.isoformat())

    @app.put("/api/journal/{day}")
    def save_journal(day: date, payload: DailyEntry, request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            values = payload.model_dump(exclude_unset=True)
            if values.get("trades") is None:
                values.pop("trades", None)
            try:
                database = db(request, member)
                result = daily_journal.save_day(database, day.isoformat(), values)
                compound_edge.journal_saved(database, day, result)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from None
            app.state.workspaces.bump(member["key"])
            pending_embed = primax_memory.prepare_day(database, result)
        if pending_embed:
            try:
                embed_day, embed_digest, embed_text = pending_embed
                vector = primax_memory.embed_text(embed_text)
                if vector is not None:
                    with app.state.workspaces.workspace_lock(member["key"]):
                        primax_memory.store_vector(db(request, member), embed_day, embed_digest, vector)
            except Exception:
                pass
        return result

    @app.post("/api/journal/{day}/images")
    async def upload_journal_image(
        day: date,
        request: Request,
        file: UploadFile = File(...),
        trade_id: str = "",
        member=Depends(workspace),
    ):
        journal_images()
        try:
            content = await file.read(daily_journal.MAX_UPLOAD + 1)
        finally:
            await file.close()
        if len(content) > daily_journal.MAX_UPLOAD:
            raise HTTPException(413, "Choose a screenshot smaller than 8 MB.")

        def operation():
            with app.state.workspaces.workspace_lock(member["key"]):
                result = daily_journal.add_image(
                    db(request, member),
                    config,
                    member["key"],
                    day.isoformat(),
                    content,
                    trade_id,
                    app.state.image_storage,
                )
                app.state.workspaces.bump(member["key"])
                return result

        return await run_in_threadpool(operation)

    @app.get("/api/journal/{day}/images/{image_id}")
    def journal_image(day: date, image_id: str, request: Request, member=Depends(workspace)):
        journal_images()
        database = db(request, member)
        stored = daily_journal.entry(database, day.isoformat())
        if not any(item["id"] == image_id for item in stored["images"]):
            raise HTTPException(404)
        data = app.state.image_storage.read(member["key"], day.isoformat(), image_id)
        if data is None:
            raise HTTPException(404)
        return Response(
            data,
            media_type="image/webp",
            headers={"Content-Disposition": 'inline; filename="primus-screenshot.webp"'},
        )

    @app.delete("/api/journal/{day}/images/{image_id}")
    def remove_journal_image(day: date, image_id: str, request: Request, member=Depends(workspace)):
        journal_images()
        with app.state.workspaces.workspace_lock(member["key"]):
            database = db(request, member)
            stored = daily_journal.entry(database, day.isoformat())
            images = [item for item in stored["images"] if item["id"] != image_id]
            if len(images) == len(stored["images"]):
                raise HTTPException(404)
            result = daily_journal.save(database, day.isoformat(), {"images": images})
            referenced_in_trash = any(
                isinstance(row, dict) and any(img.get("id") == image_id for img in row.get("images", []))
                for row in database.settings_with_prefix(daily_journal.TRASH_PREFIX).values()
            )
            app.state.workspaces.bump(member["key"])
        if not referenced_in_trash:
            app.state.image_storage.discard_unreferenced(member["key"], day.isoformat(), image_id)
        return result

    @app.put("/api/journal/{day}/trades/{record_id}/link")
    def link_journal_trade(
        day: date,
        record_id: str,
        payload: JournalTradeLink,
        request: Request,
        member=Depends(workspace),
    ):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            result = daily_journal.link_trade(db(request, member), day.isoformat(), record_id, payload.trade_id)
            app.state.workspaces.bump(member["key"])
            return result
