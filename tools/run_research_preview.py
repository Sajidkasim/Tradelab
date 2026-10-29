"""Disposable local preview with example data. Never reads real secrets/journals."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from secrets import token_urlsafe
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from core import edge
from core.db import Database
from core.models import Account, Source
from services import research, trade_labels
from webapp.config import Settings
from webapp.app import create_app

PORT = 8115


def seed(database):
    database.init()
    account = database.upsert_account(Account('Preview account', 50000, 1000, 2000))
    a = research.save_test(database, {'name': 'Reversal study · 1:3', 'strategy': 'Reversal at key level',
        'symbol': 'NQ', 'target_rr': '1:3', 'rules': 'Wait for a key level, a sweep and entry confirmation. Example test.'})
    b = research.save_test(database, {'name': 'Displacement study · 1:2', 'strategy': 'Displacement continuation',
        'symbol': 'NQ', 'target_rr': '1:2', 'rules': 'Wait for displacement and a pullback to the level. Example test.'})
    database.set_setting(trade_labels.MAPPING_KEY, {'SECOND SWEEP': {'field': 'confirmation', 'value': 'Second Sweep'}})
    trades = []
    outcomes = [-100, 300, -100, 300, 300, -100, 300, -100, -100, 300, 300, -100, 200, -100, 200, 200, -100, 200]
    for index, pnl in enumerate(outcomes):
        stamp = datetime(2026, 7, 1, 13, 35, tzinfo=timezone.utc) + timedelta(days=index)
        study = a if index < 12 else b
        confirmations = ['SMT', 'CISD', 'Second sweep' if index % 2 else 'Second Sweep']
        tags = edge.write_labels(level='Previous day high / low', timeframe='1H', entry_timeframe='1m', confirmations=confirmations)
        if index >= 15:
            tags.remove('edge:reviewed')
        trade = edge.build_trade(symbol='NQ', direction='long' if index % 3 else 'short', account_id=account,
            source=Source.BACKTEST, strategy=study['strategy'], entry_time=stamp, exit_time=stamp+timedelta(minutes=14),
            instruments=database.instruments(), tags=tags, net_pnl=pnl, risk_amount=100,
            notes='Example trade for the local preview. This is not your live journal.')
        trade.external_id = f'research-preview-{index}'
        if index >= 16:
            trade.initial_risk = trade.r_multiple = None
        research.attach(database, trade, study['id'])
        trades.append(trade)
    database.insert_trades(trades)
    research.save_setup(database, 'Morning reversal + SMT', {'scope': 'All', 'strategy': 'Reversal at key level',
        'direction': 'Both', 'level': 'Previous day high / low', 'timeframe': 'Any timeframe',
        'entry_timeframe': 'Any timeframe', 'target_rr': 'Any RR', 'weekday': 'All days',
        'confirmations': ['SMT'], 'news': 'Any news status', 'condition': 'Any condition',
        'window': 'All sessions', 'symbol': 'All markets', 'account_id': None, 'start': None, 'end': None})


if __name__ == '__main__':
    with TemporaryDirectory(prefix='primus-research-preview-') as folder:
        path = str(Path(folder) / 'preview.db')
        database = Database(path)
        seed(database)
        database.engine.dispose()
        config = Settings(path, 'local@primuslab.invalid', token_urlsafe(48), f'http://127.0.0.1:{PORT}', local=True, lab_path='/lab')
        uvicorn.run(create_app(config), host='127.0.0.1', port=PORT, proxy_headers=False, access_log=False)
