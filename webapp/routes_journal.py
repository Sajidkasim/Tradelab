"""Daily Journal, Prop Account ledger, Primax coach, voice transcription, and screenshot routes."""
from __future__ import annotations

from dataclasses import asdict, replace
from datetime import date, datetime
from email.message import EmailMessage
import hashlib
import hmac
import json
import os
from pathlib import Path
from secrets import randbelow
import smtplib
import ssl
from time import monotonic
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Body, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from core.models import Account
from core.registry import COACH_PROVIDERS, load_extensions
from . import compound_edge, daily_journal, journal_preferences, primax_memory
from .schemas import DailyEntry, JournalAccount, JournalAccountPresets, JournalTradeLink


class AuraTurn(BaseModel):
    question: str = Field(max_length=400)
    answer: str = Field(max_length=650)


class JournalHistoryCode(BaseModel):
    code: str = Field(pattern=r"^[0-9]{6}$")


def journal_mail_credentials():
    sender = (os.getenv("JOURNAL_GMAIL_ADDRESS") or os.getenv("BULLPEN_GMAIL_ADDRESS", "")).strip()
    password = "".join((os.getenv("JOURNAL_GMAIL_APP_PASSWORD") or os.getenv("BULLPEN_GMAIL_APP_PASSWORD", "")).split())
    return sender, password


def send_journal_history_code(sender, password, recipient, code):
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = "PrimusTrader Journal deletion code"
    message.set_content(f"Your Journal deletion code is {code}. It expires in 10 minutes. "
                        "Ignore this email if you did not request it.")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10, context=ssl.create_default_context()) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)


def journal_history_snapshot(database):
    timezone = journal_preferences.read(database)["timezone"]
    cutoff = datetime.now(ZoneInfo(timezone)).date().isoformat()
    return cutoff, daily_journal.past_entries(database, cutoff)


def history_fingerprint(cutoff, records):
    return hashlib.sha256(json.dumps([cutoff, records], sort_keys=True).encode()).hexdigest()


def mount(app, config, workspace, check_write, db):
    history_codes = {}

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
            text = await run_in_threadpool(daily_journal.transcribe_audio, content)
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

    @app.get("/api/journal/history/preview")
    def preview_journal_history(request: Request, member=Depends(workspace)):
        journal_preview()
        with app.state.workspaces.workspace_lock(member["key"]):
            cutoff, records = journal_history_snapshot(db(request, member))
        email = member.get("email") or ""
        name, _, domain = email.partition("@")
        return {"count": len(records), "before": cutoff,
                "email_hint": f"{name[:1]}…@{domain}" if domain else None,
                "available": bool(domain and all(journal_mail_credentials()))}

    @app.post("/api/journal/history/send-code")
    def request_journal_history_code(request: Request, member=Depends(workspace)):
        journal_preview()
        recipient = member.get("email")
        if not recipient:
            raise HTTPException(403, "Sign in with your Google account to verify this action.")
        sender, password = journal_mail_credentials()
        if not (sender and password):
            raise HTTPException(503, "Journal verification email is unavailable.")
        key = member["key"]
        with app.state.workspaces.workspace_lock(key):
            cutoff, records = journal_history_snapshot(db(request, member))
            if not records:
                raise HTTPException(409, "There are no past entries to delete.")
            retry = app.state.rate_counters.consume(f"journal-history-code:{key}", limit=3, window=900)
            if retry:
                raise HTTPException(429, "Too many code requests. Try again later.", headers={"Retry-After": str(retry)})
            fingerprint = history_fingerprint(cutoff, records)
            history_codes.pop(key, None)
        code = f"{randbelow(1_000_000):06d}"
        try:
            send_journal_history_code(sender, password, recipient, code)
        except (OSError, ValueError):
            raise HTTPException(503, "Could not send the verification email. Please try again.") from None
        with app.state.workspaces.workspace_lock(key):
            history_codes[key] = {"digest": code_digest(request, member, code), "expires": monotonic() + 600,
                                  "session": request.session["csrf"], "fingerprint": fingerprint, "attempts": 0}
        return {"count": len(records), "before": cutoff}

    @app.post("/api/journal/history/delete")
    def delete_journal_history(payload: JournalHistoryCode, request: Request, member=Depends(workspace)):
        journal_preview()
        key = member["key"]
        with app.state.workspaces.workspace_lock(key):
            challenge = history_codes.get(key)
            if not challenge or challenge["session"] != request.session["csrf"]:
                raise HTTPException(403, "Request a code from this session first.")
            if monotonic() >= challenge["expires"]:
                history_codes.pop(key)
                raise HTTPException(403, "The code expired. Request a new one.")
            if not hmac.compare_digest(challenge["digest"], code_digest(request, member, payload.code)):
                challenge["attempts"] += 1
                if challenge["attempts"] >= 5:
                    history_codes.pop(key)
                    raise HTTPException(403, "Too many attempts. Request a new code.")
                raise HTTPException(422, "That code is incorrect.")
            history_codes.pop(key)
            database = db(request, member)
            cutoff, records = journal_history_snapshot(database)
            if challenge["fingerprint"] != history_fingerprint(cutoff, records):
                raise HTTPException(409, "Journal entries changed. Review the count and request a new code.")
            days = {row["day"] for row in records.values()}
            daily_journal.archive_past_entries(database, records, additional_settings=primax_memory.without_days(database, days))
            app.state.workspaces.bump(key)
        return {"days": sorted(days)}

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
