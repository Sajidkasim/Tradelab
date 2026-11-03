"""Build small chart-only NY session calendar; leaves source and saved fills untouched."""
from pathlib import Path
import sqlite3,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.replay_chart_history import aggregate,NY
from datetime import datetime,timedelta

def build(path):
    with sqlite3.connect(path) as db:
        db.execute('DROP TABLE IF EXISTS chart_daily_ny_build')
        db.execute('CREATE TABLE chart_daily_ny_build(root TEXT,time INTEGER,end INTEGER,open REAL,high REAL,low REAL,close REAL,volume INTEGER,PRIMARY KEY(root,time))')
        for root in ('NQ','ES'):
            rows=db.execute('SELECT b.time,b.open,b.high,b.low,b.close,b.volume FROM active_contracts a JOIN bars b ON b.day=a.day AND b.symbol=a.symbol WHERE a.root=? ORDER BY a.day,b.time',(root,))
            bars=aggregate(rows,'1D')
            db.executemany('INSERT INTO chart_daily_ny_build VALUES(?,?,?,?,?,?,?,?)',[(root,t,int((datetime.fromtimestamp(t/1000,NY)+timedelta(days=1)).timestamp()*1000),o,h,l,c,v) for t,o,h,l,c,v in bars])
            print(root,len(bars),'NY daily candles',flush=True)
        db.execute('DROP TABLE IF EXISTS chart_daily_ny');db.execute('ALTER TABLE chart_daily_ny_build RENAME TO chart_daily_ny')
if __name__=='__main__':build(Path(__file__).resolve().parents[1]/'data/private/replay-index.db')
