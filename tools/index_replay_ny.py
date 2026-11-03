"""Rebuild chart-only NY 4H data from original minutes; never modify source prices."""
import sqlite3,sys
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.replay_candles import aggregate_ny_four_hours

def build(path):
    with sqlite3.connect(path) as db:
        db.execute('DROP TABLE IF EXISTS chart_4h_ny_build')
        db.execute('CREATE TABLE chart_4h_ny_build(root TEXT,time INTEGER,open REAL,high REAL,low REAL,close REAL,volume INTEGER,PRIMARY KEY(root,time))')
        for root in ('NQ','ES'):
            rows=db.execute('SELECT b.time,b.open,b.high,b.low,b.close,b.volume FROM active_contracts a JOIN bars b ON b.day=a.day AND b.symbol=a.symbol WHERE a.root=? ORDER BY b.time',(root,))
            bars=aggregate_ny_four_hours(rows)
            db.executemany('INSERT INTO chart_4h_ny_build VALUES(?,?,?,?,?,?,?)',[(root,*bar) for bar in bars])
            print(root,len(bars),'NY 4H candles',flush=True)
            for bar in bars[:12]:print(datetime.fromtimestamp(bar[0]/1000,timezone.utc).astimezone(ZoneInfo('America/New_York')).strftime('%Y-%m-%d %H:%M %Z'),*bar[1:],flush=True)
        db.execute('DROP TABLE IF EXISTS chart_4h_ny');db.execute('ALTER TABLE chart_4h_ny_build RENAME TO chart_4h_ny')
def check(path,root='NQ'):
    with sqlite3.connect(path) as db:
        for row in db.execute('SELECT time,open,high,low,close,volume FROM chart_4h_ny WHERE root=? ORDER BY time LIMIT 12',(root,)):
            opened=datetime.fromtimestamp(row[0]/1000,timezone.utc).astimezone(ZoneInfo('America/New_York'))
            print(opened.strftime('%Y-%m-%d %H:%M %Z'),*row[1:])
if __name__=='__main__':
    path=Path(__file__).resolve().parents[1]/'data/private/replay-index.db'
    check(path) if '--check' in sys.argv else build(path)
