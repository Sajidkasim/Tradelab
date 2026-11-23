"""CSV/FX Replay preview-confirm importer, backup/CSV export, and restore routes."""
from __future__ import annotations

import json

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from itsdangerous import BadSignature, SignatureExpired
from starlette.concurrency import run_in_threadpool

from services import research, tag_cleanup, trade_labels
from . import backups, import_updates, imports
from .schemas import ImportPreferences
from .workspaces import SCOPES


def mount(app, workspace, signer, db):
    @app.put("/api/import-preferences")
    def save_import_preferences(payload: ImportPreferences, request: Request, member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member["key"]):
            database = db(request, member)
            if payload.account_id not in {account.id for account in database.accounts()}:
                raise ValueError("Reload your lab and try again.")
            values = payload.model_dump()
            database.set_setting(import_updates.PROFILE_KEY, values)
            app.state.workspaces.bump(member["key"])
        return values

    @app.post("/api/import/{action}")
    async def import_file(
        action: str,
        request: Request,
        file: UploadFile = File(...),
        account_id: int = Form(...),
        source: str = Form("fxreplay"),
        timezone: str = Form("UTC"),
        dayfirst: bool = Form(False),
        mapping: str = Form("{}"),
        preview_token: str = Form(""),
        update_labels: bool = Form(False),
        include_breakeven: bool = Form(True),
        remember_profile: bool = Form(False),
        study_id: str = Form(""),
        member=Depends(workspace),
    ):
        if action not in ("preview", "confirm"):
            raise HTTPException(404)
        try:
            content = await file.read(imports.MAX_UPLOAD + 1)
        finally:
            await file.close()
        if len(content) > imports.MAX_UPLOAD:
            raise HTTPException(413, "Choose a file smaller than 5 MB.")
        filename = file.filename or "trades.csv"
        try:
            columns = json.loads(mapping)
        except json.JSONDecodeError:
            raise ValueError("Check the column mapping.") from None
        fingerprint = imports.digest(
            content, filename, account_id, source, timezone, dayfirst, columns, include_breakeven
        )

        def operation():
            with app.state.workspaces.workspace_lock(member["key"]):
                database = db(request, member)
                parsed, preview = imports.parse(
                    content, filename, database, account_id, source, timezone, dayfirst, columns, include_breakeven
                )
                study = research.get_test(database, study_id, active=True)
                for trade in parsed:
                    research.attach(database, trade, study_id, study=study)
                preview["study"] = {"id": study["id"], "name": study["name"]} if study else None
                if study and study.get("symbol") and any(trade.symbol != study["symbol"] for trade in parsed):
                    preview["issues"].append(
                        f"Some trades use a different market from this test’s planned {study['symbol']}. Check the destination before importing."
                    )
                notes = preview.pop("_notes", {})
                tag_context = preview.pop("_tag_context", {})
                changes, issues = import_updates.plan(database, parsed, notes) if update_labels else ([], [])
                preview["issues"].extend(issues)
                if update_labels:
                    preview["counts"]["updates"] = len(changes)
                preview["label_updates"] = [{"id": item["id"], **item["preview"]} for item in changes][:200]
                signature = [
                    member["key"],
                    fingerprint,
                    import_updates.digest(
                        {
                            "mappings": database.get_setting(trade_labels.MAPPING_KEY, {}),
                            "automatic_labels": tag_context,
                            "aliases": database.get_setting(tag_cleanup.KEY, {}),
                            "study_id": study_id,
                            "update_labels": update_labels,
                            "remember_profile": remember_profile,
                            "changes": changes if update_labels else None,
                        }
                    ),
                ]
                if action == "confirm":
                    try:
                        approval = signer.loads(preview_token, max_age=900)
                    except (BadSignature, SignatureExpired):
                        raise HTTPException(409, "Preview the file again before importing.") from None
                    if approval != signature:
                        raise HTTPException(409, "File, labels or import options changed. Preview again.")
                    result = (
                        import_updates.apply(database, parsed, changes)
                        if update_labels
                        else database.insert_trades(parsed)
                    )
                    if remember_profile:
                        database.set_setting(
                            import_updates.PROFILE_KEY,
                            {
                                "account_id": account_id,
                                "source": preview["source"],
                                "timezone": timezone,
                                "dayfirst": dayfirst,
                                "update_labels": update_labels,
                                "include_breakeven": include_breakeven,
                            },
                        )
                    if preview["excluded_breakeven"]:
                        result["excluded_breakeven"] = preview["excluded_breakeven"]
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
            from .csv_security import safe_cell

            content = (
                database.trades_df(sources=SCOPES["All"])
                .drop(columns=["screenshot_path"], errors="ignore")
                .map(safe_cell)
                .to_csv(index=False)
            )
            media, name = "text/csv", "primuslab-trades.csv"
        else:
            raise HTTPException(404)
        return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.post("/api/restore")
    async def restore(request: Request, file: UploadFile = File(...), member=Depends(workspace)):
        try:
            content = await file.read(imports.MAX_UPLOAD + 1)
        finally:
            await file.close()
        if len(content) > imports.MAX_UPLOAD:
            raise HTTPException(413, "Choose a backup smaller than 5 MB.")

        def operation():
            with app.state.workspaces.workspace_lock(member["key"]):
                database = db(request, member)
                if database.count_trades():
                    raise HTTPException(
                        409,
                        "Restore is available only in an empty lab. Download a backup before migrating an existing lab.",
                    )
                result = database.import_json(backups.validate(content.decode("utf-8")), replace=True)
                app.state.workspaces.bump(member["key"])
                return result

        return await run_in_threadpool(operation)
