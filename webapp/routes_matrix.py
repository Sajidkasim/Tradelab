"""The Matrix macro scorecard snapshot and owner-triggered live refresh routes."""
from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
import time

from anyio import to_thread
from fastapi import Depends, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError


def mount(app, config, workspace):
    @app.get("/api/matrix/snapshot")
    def matrix_snapshot():
        if not (config.site_preview or config.site_enabled):
            return {"snapshot": None}
        try:
            if config.local:
                from . import app as app_mod
                path = app_mod.Path(__file__).resolve().parents[1] / "data/private/matrix-verified-snapshot.json"
                return {"snapshot": json.loads(path.read_text()) if path.is_file() else None}
            from sqlalchemy import text
            with app.state.workspaces.root.engine.connect() as connection:
                snapshot = connection.execute(
                    text("SELECT snapshot FROM public.macro_scorecard WHERE id = 'matrix'")
                ).scalar_one_or_none()
            return {"snapshot": snapshot}
        except (SQLAlchemyError, OSError, ValueError, TypeError):
            raise HTTPException(503, "The macro snapshot could not be read.") from None

    matrix_refresh_lock = Lock()
    matrix_last_refresh = [float("-inf")]

    @app.post("/api/matrix/refresh")
    async def refresh_matrix_now(request: Request, member=Depends(workspace)):
        if not (config.site_preview or config.site_enabled):
            raise HTTPException(404, "The Matrix is unavailable.")
        if member["key"] != "owner":
            raise HTTPException(403, "Only the workspace owner can trigger a live Matrix refresh.")
        now = time.monotonic()
        with matrix_refresh_lock:
            elapsed = now - matrix_last_refresh[0]
            if elapsed < 300:
                wait_s = max(1, int(300 - elapsed))
                raise HTTPException(429, f"Matrix was refreshed recently. Try again in {wait_s}s.")
            matrix_last_refresh[0] = now

        def _run_refresh():
            from sqlalchemy import text
            from tools import refresh_matrix as rm
            from . import app as app_mod

            local_path = app_mod.Path(__file__).resolve().parents[1] / "data/private/matrix-verified-snapshot.json"
            snapshot = {}
            if config.local:
                if local_path.is_file():
                    snapshot = json.loads(local_path.read_text())
            else:
                with app.state.workspaces.root.engine.connect() as conn:
                    existing = conn.execute(
                        text("SELECT snapshot FROM public.macro_scorecard WHERE id = 'matrix'")
                    ).scalar_one_or_none()
                    if isinstance(existing, dict):
                        snapshot = dict(existing)

            changed = rm.refresh_snapshot(snapshot, source="all")
            if not changed:
                raise HTTPException(502, "No macro providers responded. Existing snapshot retained.")

            if config.local:
                local_path.parent.mkdir(parents=True, exist_ok=True)
                local_path.write_text(json.dumps(snapshot))
            else:
                with app.state.workspaces.root.engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO public.macro_scorecard(id, snapshot) VALUES ('matrix', CAST(:snap AS jsonb)) "
                            "ON CONFLICT (id) DO UPDATE SET snapshot = excluded.snapshot"
                        ),
                        {"snap": json.dumps(snapshot)},
                    )
            return snapshot

        try:
            updated = await to_thread.run_sync(_run_refresh)
        except HTTPException:
            with matrix_refresh_lock:
                matrix_last_refresh[0] = float("-inf")
            raise
        except (SQLAlchemyError, OSError, ValueError, TypeError) as err:
            with matrix_refresh_lock:
                matrix_last_refresh[0] = float("-inf")
            raise HTTPException(502, f"Matrix refresh failed ({type(err).__name__}).") from None
        return {"snapshot": updated, "refreshed": True}
