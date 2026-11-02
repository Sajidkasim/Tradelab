"""Durable local practice workspace; separate from all existing journals."""
from pathlib import Path
from secrets import token_urlsafe
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import uvicorn
from core.db import Database
from webapp.config import Settings
from webapp.app import create_app
from webapp import journal_preferences, release_notes

if __name__=='__main__':
    port=int(sys.argv[1]) if len(sys.argv)>1 else 8132
    target=Path(__file__).resolve().parents[1]/'data/private/backtesting-workspace.db'
    target.parent.mkdir(parents=True,exist_ok=True)
    db=Database(str(target));db.init()
    if db.get_setting(journal_preferences.KEY) is None:
        db.set_setting(journal_preferences.KEY,{'tour_status':'skipped','tour_version':journal_preferences.TOUR_VERSION})
        db.set_setting(release_notes.KEY,release_notes.VERSION)
    db.engine.dispose()
    settings=Settings(str(target),'local@primuslab.invalid',token_urlsafe(48),f'http://127.0.0.1:{port}',local=True,lab_path='/lab',site_preview=True)
    uvicorn.run(create_app(settings),host='127.0.0.1',port=port,proxy_headers=False,access_log=False)
