"""One-off atomic chart index rebuild. Re-run after adding minute data; no trade edits.
Usage: .venv/bin/python tools/precompute_replay_timeframes.py [--minutes 5,15,30,60]
"""
import argparse,sqlite3,sys,time,json,calendar
from pathlib import Path
from datetime import datetime,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.replay_chart_history import aggregate,NY
ROOT=Path(__file__).resolve().parents[1]
def end_of(t,tf):
 if tf not in ('1D','1W','1M'):return t+int(tf)*60000
 local=datetime.fromtimestamp(t/1000,NY)
 if tf=='1M':
  # Open is the evening BEFORE the first trading-date month.
  day=(local+timedelta(days=1)).date();day=day.replace(year=day.year+(day.month==12),month=day.month%12+1,day=1)-timedelta(days=1)
  return int(local.replace(year=day.year,month=day.month,day=day.day).timestamp()*1000)
 return int((local+timedelta(days=7 if tf=='1W' else 1)).timestamp()*1000)
def build(path,minutes):
 start=time.perf_counter()
 with sqlite3.connect(path) as db:
  db.execute('DROP TABLE IF EXISTS chart_precomputed_build');db.execute('CREATE TABLE chart_precomputed_build(root TEXT,tf TEXT,time INTEGER,end INTEGER,open REAL,high REAL,low REAL,close REAL,volume INTEGER,PRIMARY KEY(root,tf,time)) WITHOUT ROWID')
  for root in ('NQ','ES'):
   pending={tf:None for tf in minutes};batch=[]
   def emit(tf,row):
    batch.append((root,tf,row[0],end_of(row[0],tf),*row[1:]))
    if len(batch)>=5000:db.executemany('INSERT INTO chart_precomputed_build VALUES(?,?,?,?,?,?,?,?,?)',batch);batch.clear()
   rows=db.execute('SELECT b.time,b.open,b.high,b.low,b.close,b.volume FROM active_contracts a JOIN bars b ON b.day=a.day AND b.symbol=a.symbol WHERE a.root=? ORDER BY a.day,b.time',(root,))
   for t,o,h,l,c,v in rows:
    for tf in minutes:
     opened=t//(int(tf)*60000)*(int(tf)*60000);last=pending[tf]
     if last and last[0]==opened:last[2]=max(last[2],h);last[3]=min(last[3],l);last[4]=c;last[5]+=v
     else:
      if last:emit(tf,last)
      pending[tf]=[opened,o,h,l,c,v]
   for tf,row in pending.items():
    if row:emit(tf,row)
   for tf,table in [('240','chart_4h_ny'),('1D','chart_daily_ny')]:
    for row in db.execute(f'SELECT time,open,high,low,close,volume FROM {table} WHERE root=? ORDER BY time',(root,)).fetchall():emit(tf,row)
   daily=db.execute('SELECT time,open,high,low,close,volume FROM chart_daily_ny WHERE root=? ORDER BY time',(root,)).fetchall()
   for tf in ('1W','1M'):
    for row in aggregate(daily,tf):emit(tf,row)
   if batch:db.executemany('INSERT INTO chart_precomputed_build VALUES(?,?,?,?,?,?,?,?,?)',batch)
   print(root,'prepared',round(time.perf_counter()-start,1),'seconds',flush=True)
  db.execute('DROP TABLE IF EXISTS chart_precomputed');db.execute('ALTER TABLE chart_precomputed_build RENAME TO chart_precomputed')
  # Separate indexed rows for every timeframe. Dataset source minute table remains unchanged.
  db.execute('CREATE INDEX chart_precomputed_end ON chart_precomputed(root,tf,end,time)')
 print('Complete. Re-run this same command after a source-data import.',flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--minutes',default='5,15,30,60');args=p.parse_args();minutes=sorted(set(args.minutes.split(',')),key=int)
 if any(not tf.isdigit() or not 2<=int(tf)<=720 or tf=='240' for tf in minutes):p.error('Custom minutes must be 2–720, excluding the separately NY-aligned 240.')
 from tools.index_replay_ny import build as rebuild_four_hour
 from tools.index_replay_calendar import build as rebuild_daily
 path=ROOT/'data/private/replay-index.db'
 rebuild_four_hour(path);rebuild_daily(path);build(path,minutes)
