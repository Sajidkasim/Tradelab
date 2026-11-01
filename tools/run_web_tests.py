"""Disposable loopback server for browser tests. Never opens the real journal."""
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from core.db import Database
from webapp import journal_preferences

with TemporaryDirectory(prefix="primus-browser-tests-") as folder:
    os.environ["PRIMUSLAB_WEB_LOCAL_ONLY"] = "1"
    os.environ["PRIMUSLAB_WEB_PREVIEW_DB"] = str(Path(folder) / "test.db")
    database = Database(os.environ["PRIMUSLAB_WEB_PREVIEW_DB"])
    database.init()
    from webapp import release_notes
    if not os.environ.get("PRIMUSLAB_TEST_SHOW_RELEASE_NOTES"):
        database.set_setting(release_notes.KEY, release_notes.VERSION)
    database.set_setting(journal_preferences.KEY, {'tour_status':'skipped', 'tour_version':journal_preferences.TOUR_VERSION})
    database.engine.dispose()
    os.environ["PRIMUSLAB_PUBLIC_URL"] = "http://127.0.0.1:8111"
    uvicorn.run("webapp.app:create_app", factory=True, host="127.0.0.1", port=8111, proxy_headers=False, access_log=False)
