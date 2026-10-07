"""Disposable loopback server for browser tests. Never opens the real journal."""
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn

with TemporaryDirectory(prefix="primus-browser-tests-") as folder:
    os.environ["PRIMUSLAB_WEB_LOCAL_ONLY"] = "1"
    os.environ["PRIMUSLAB_WEB_PREVIEW_DB"] = str(Path(folder) / "test.db")
    os.environ["PRIMUSLAB_PUBLIC_URL"] = "http://127.0.0.1:8111"
    uvicorn.run("webapp.app:create_app", factory=True, host="127.0.0.1", port=8111, proxy_headers=False, access_log=False)
