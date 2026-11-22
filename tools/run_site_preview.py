"""Home + Journal concept, isolated from production and all existing previews."""
import json
import math
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from secrets import token_urlsafe
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from core.db import Database
from services.replay_chart_history import SESSION_HOUR, aggregate
from tools.run_research_preview import seed
from webapp import daily_journal, journal_preferences, replay_sessions
from webapp.config import Settings
from webapp.app import create_app


def _seed_synthetic_replay_preview(folder: Path) -> None:
    """Create a deterministic local preview index inside temp dir when private archives are absent."""
    if (replay_sessions.ROOT / 'backtesting-preview.json').is_file() or (replay_sessions.ROOT / 'replay-index.db').is_file():
        return
    day = date(2010, 6, 7)
    trading_days = [day]
    cursor = day - timedelta(days=1)
    while len(trading_days) < 12:
        if cursor.weekday() < 5:
            trading_days.append(cursor)
        cursor -= timedelta(days=1)
    trading_days.reverse()

    def build_minutes(target_day: date, start_price: float, phase: float, minutes: int) -> list[dict]:
        base_ms = int(datetime(target_day.year, target_day.month, target_day.day, tzinfo=timezone.utc).timestamp() * 1000)
        bars = []
        price = start_price
        for i in range(minutes):
            delta = math.sin((i + phase) * 0.045) * 1.25 + math.cos((i + phase) * 0.013) * 0.75
            step = round(delta * 4) / 4.0
            o = round(price * 4) / 4.0
            c = round((o + step) * 4) / 4.0
            h = round((max(o, c) + 0.75) * 4) / 4.0
            l = round((min(o, c) - 0.75) * 4) / 4.0
            bars.append({'time': base_ms + i * 60_000, 'open': o, 'high': h, 'low': l, 'close': c, 'volume': 40 + (i % 25)})
            price = c
        return bars

    con = sqlite3.connect(folder / 'replay-index.db')
    try:
        con.executescript("""
            CREATE TABLE bars (day TEXT, symbol TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume INTEGER);
            CREATE INDEX idx_bars_day_sym_time ON bars (day, symbol, time);
            CREATE TABLE volumes (day TEXT, symbol TEXT, volume INTEGER);
            CREATE TABLE active_contracts (day TEXT, root TEXT, symbol TEXT);
            CREATE TABLE chart_settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE chart_daily_ny (root TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume INTEGER, end INTEGER);
            CREATE TABLE chart_4h_ny (root TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume INTEGER);
        """)
        con.execute("INSERT INTO chart_settings (key, value) VALUES ('session_hour', ?)", (str(SESSION_HOUR),))
        markets = {}
        for root, contract, anchor in (('NQ', 'NQM0', 1860.0), ('ES', 'ESM0', 1072.0)):
            running = anchor
            all_rows = []
            history = []
            context = []
            day_bars = []
            for idx, d in enumerate(trading_days):
                iso = d.isoformat()
                minutes = 1260 if (d == day or d.weekday() == 4) else 1440
                mins = build_minutes(d, running, idx * 31.0, minutes)
                running = mins[-1]['close']
                con.executemany(
                    "INSERT INTO bars (day, symbol, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [(iso, contract, b['time'], b['open'], b['high'], b['low'], b['close'], b['volume']) for b in mins],
                )
                total_vol = sum(b['volume'] for b in mins)
                con.execute("INSERT INTO volumes (day, symbol, volume) VALUES (?, ?, ?)", (iso, contract, total_vol))
                con.execute("INSERT INTO active_contracts (day, root, symbol) VALUES (?, ?, ?)", (iso, root, contract))
                all_rows.extend((b['time'], b['open'], b['high'], b['low'], b['close'], b['volume']) for b in mins)
                if d == day:
                    day_bars = mins
                else:
                    day_ms = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)
                    history.append({
                        'time': day_ms, 'open': mins[0]['open'], 'high': max(b['high'] for b in mins),
                        'low': min(b['low'] for b in mins), 'close': mins[-1]['close'], 'volume': total_vol,
                    })
                    context.extend(mins)
            daily_bars = aggregate(all_rows, '1D')
            con.executemany(
                "INSERT INTO chart_daily_ny (root, time, open, high, low, close, volume, end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [(root, b[0], b[1], b[2], b[3], b[4], b[5], b[0] + 86_400_000) for b in daily_bars],
            )
            four_hour_bars = aggregate(all_rows, '240')
            con.executemany(
                "INSERT INTO chart_4h_ny (root, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(root, b[0], b[1], b[2], b[3], b[4], b[5]) for b in four_hour_bars],
            )
            markets[root] = {'contract': contract, 'bars': day_bars, 'context': context, 'history': history}
        con.commit()
    finally:
        con.close()

    payload = {
        'day': day.isoformat(),
        'timezone': 'UTC',
        'schema': 'ohlcv-1m',
        'source': 'Synthetic preview data',
        'history_version': 2,
        'selection': 'Synthetic preview bars for isolated browser tests.',
        'markets': markets,
    }
    (folder / 'backtesting-preview.json').write_text(json.dumps(payload, separators=(',', ':')))
    replay_sessions.ROOT = folder


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8118
    with TemporaryDirectory(prefix='primus-site-concept-') as folder:
        _seed_synthetic_replay_preview(Path(folder))
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
