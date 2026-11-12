"""Private setup screenshots shared with verified Bullpen teammates."""
from uuid import uuid4

from fastapi import Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from .bullpen import _team_name
from .daily_journal import MAX_UPLOAD, compress

SETTING = "primus_setup_gallery_v1"
IMAGE_DAY = "2000-01-02"


def mount(app, config, workspace):
    def team(member=Depends(workspace)):
        name = _team_name(member.get("email"))
        if not config.google_required or not name:
            raise HTTPException(403, "The setup gallery is reserved for the Primus team.")
        return member, name

    def entries():
        return app.state.workspaces.root.get_setting(SETTING, [])

    @app.get("/api/learn/setup-gallery")
    def list_setups(identity=Depends(team)):
        return [{k: v for k, v in entry.items() if k != "owner"} for entry in entries()]

    @app.post("/api/learn/setup-gallery", status_code=201)
    async def upload_setup(
        file: UploadFile = File(...),
        title: str = Form(min_length=1, max_length=120),
        tags: str = Form(default="", max_length=300),
        identity=Depends(team),
    ):
        member, name = identity
        content = await file.read(MAX_UPLOAD + 1)
        if len(content) > MAX_UPLOAD:
            raise HTTPException(413, "Choose an image under 8 MB.")
        labels = list(dict.fromkeys(tag.strip().casefold() for tag in tags.split(",") if tag.strip()))
        if not title.strip() or len(labels) > 10 or any(len(label) > 32 for label in labels):
            raise HTTPException(422, "Use a title and up to ten short tags.")

        def save():
            data, _, _ = compress(content)
            store = app.state.image_storage
            with app.state.workspaces.lock:
                rows = entries()
                if len(rows) >= 100:
                    raise HTTPException(409, "The gallery is full.")
                entry = {"id": uuid4().hex, "title": title.strip(), "tags": labels, "author": name}
                store.put(member["key"], IMAGE_DAY, entry["id"], data)
                try:
                    app.state.workspaces.root.set_setting(SETTING, [{**entry, "owner": member["key"]}, *rows])
                except Exception:
                    store.discard_unreferenced(member["key"], IMAGE_DAY, entry["id"])
                    raise
                return entry

        return await run_in_threadpool(save)

    @app.get("/api/learn/setup-gallery/{entry_id}/image")
    def image(entry_id: str, identity=Depends(team)):
        entry = next((row for row in entries() if row["id"] == entry_id), None)
        if entry:
            data = app.state.image_storage.read(entry["owner"], IMAGE_DAY, entry_id)
            if data is not None:
                return Response(data, media_type="image/webp", headers={"Cache-Control": "private, no-store"})
        raise HTTPException(404, "Setup image unavailable.")

    @app.delete("/api/learn/setup-gallery/{entry_id}")
    def remove_setup(entry_id: str, identity=Depends(team)):
        member, _ = identity
        with app.state.workspaces.lock:
            rows = entries()
            entry = next((row for row in rows if row["id"] == entry_id), None)
            if not entry or member["key"] not in ("owner", entry["owner"]):
                raise HTTPException(404, "Setup unavailable.")
            app.state.workspaces.root.set_setting(SETTING, [row for row in rows if row["id"] != entry_id])
        app.state.image_storage.discard_unreferenced(entry["owner"], IMAGE_DAY, entry_id)
        return {"removed": True}
