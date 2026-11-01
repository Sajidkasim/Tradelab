"""Home + Journal concept, isolated from production and all existing previews."""
from datetime import date, timedelta
from pathlib import Path
from secrets import token_urlsafe
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from core.db import Database
from tools.run_research_preview import seed
from webapp import daily_journal, journal_preferences
from webapp.config import Settings
from webapp.app import create_app


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8118
    with TemporaryDirectory(prefix='primus-site-concept-') as folder:
        target = str(Path(folder) / 'preview.db')
        database = Database(target)
        seed(database)
        from webapp import release_notes
        if "--release-notes" not in sys.argv:
            database.set_setting(release_notes.KEY, release_notes.VERSION)
        database.set_setting(journal_preferences.KEY, {'timezone':'Europe/London', 'tour_status':'skipped',
            'tour_version':journal_preferences.TOUR_VERSION})
        for offset in (1, 2, 3):
            daily_journal.save(database, (date.today()-timedelta(days=offset)).isoformat(), {
                'plan':'Example entry — local design preview. Mark the higher-timeframe levels first. Wait for a clear reaction before considering a trade.',
                'notes':'Example observation: price returned to the level. I waited for confirmation rather than entering on the first move.',
                'lesson':'I waited for the reaction before entering. Tomorrow I want to keep the same patience.', 'mindset':'Patient',
                'trades': [{'id': f'{offset:032x}', 'symbol':'NQ', 'direction':'long', 'strategy':'Displacement continuation',
                    'time':'09:45', 'source':'manual', 'outcome':'win', 'confirmations':['SMT','CISD'], 'notes':'Example trade — local preview. Waited for confirmation at the level before entering.', 'lab_trade_id':None},
                    {'id':f'{offset+10:032x}', 'symbol':'NQ', 'direction':'short', 'strategy':'Range reversal', 'time':'10:20',
                     'source':'manual','outcome':'loss','confirmations':['MSS'],'notes':'Example trade — local preview. Recorded the reaction at the session high.', 'lab_trade_id':None}]})
        database.engine.dispose()
        config = Settings(target, 'local@primuslab.invalid', token_urlsafe(48), f'http://127.0.0.1:{port}',
            local=True, lab_path='/lab', site_preview=True)
        uvicorn.run(create_app(config), host='127.0.0.1', port=port, proxy_headers=False, access_log=False)
