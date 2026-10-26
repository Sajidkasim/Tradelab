"""Password UI regression server; synthetic credential and disposable data only."""
from pathlib import Path
from secrets import token_urlsafe
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from webapp.app import create_app
from webapp.config import Settings
from webapp.personal_access import hash_password

with TemporaryDirectory(prefix='primus-password-tests-') as folder:
    config = Settings(str(Path(folder) / 'test.db'), '', token_urlsafe(48), 'http://127.0.0.1:8112',
                      local=True, password_hash=hash_password('Synthetic password for browser tests only'))
    uvicorn.run(create_app(config), host='127.0.0.1', port=8112, proxy_headers=False, access_log=False)
