"""Read bounded chart windows from the offline full-archive index."""
import sqlite3
from contextlib import contextmanager
from datetime import date,timedelta,datetime,timezone

@contextmanager
def index_connection(path):
 """Tune every local price-index reader; always release its SQLite handle."""
 con=sqlite3.connect(path)
 try:
  con.execute('PRAGMA journal_mode = WAL')
  con.execute('PRAGMA synchronous = NORMAL')
  con.execute('PRAGMA cache_size = -64000')
  with con:yield con
 finally:con.close()

def days(path):
 with index_connection(path) as con:return [r[0] for r in con.execute("SELECT day FROM volumes GROUP BY day HAVING COUNT(DISTINCT SUBSTR(symbol,1,2))=2 ORDER BY day")]

def load(path,day):
 end=date.fromisoformat(day);start=(end-timedelta(days=370)).isoformat();context_start=(end-timedelta(days=14)).isoformat()
 with index_connection(path) as con:
  volumes=con.execute('SELECT day,symbol,volume FROM volumes WHERE day>=? AND day<=? ORDER BY day,symbol',(start,day)).fetchall()
  markets={}
  for root in ('NQ','ES'):
   groups={}
   for d,s,v in volumes:
    if s.startswith(root):groups.setdefault(d,{})[s]=v
   previous={};history=[];context=[];current=[];contract=None
   for d,candidates in groups.items():
    eligible={s:v for s,v in previous.items() if s in candidates};symbol=max(eligible,key=eligible.get) if eligible else sorted(candidates)[0];previous=candidates
    rows=con.execute('SELECT time,open,high,low,close,volume FROM bars WHERE day=? AND symbol=? ORDER BY time',(d,symbol)).fetchall()
    if not rows:continue
    records=[dict(zip(('time','open','high','low','close','volume'),r)) for r in rows] if d>=context_start else []
    if d==day:current=records;contract=symbol
    else:
     history.append({'time':int(datetime.fromisoformat(d).replace(tzinfo=timezone.utc).timestamp()*1000),'open':rows[0][1],'high':max(r[2] for r in rows),'low':min(r[3] for r in rows),'close':rows[-1][4],'volume':sum(r[5] for r in rows)})
     if d>=context_start:context.extend(records)
   if not current:raise ValueError('No NQ/ES candles on this date. Choose an available trading day.')
   markets[root]={'contract':contract,'bars':current,'context':context,'history':history}
 return {'day':day,'timezone':'UTC','schema':'ohlcv-1m','source':'Databento GLBX.MDP3','history_version':2,'selection':'Prior-day volume; unadjusted contracts; UTC calendar candles.','markets':markets}

def four_hour_history(path,day):
 cutoff=int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()*1000)
 with index_connection(path) as con:
  if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chart_4h_ny'").fetchone():return {}
  result={root:[] for root in ('NQ','ES')}
  for root,t,o,h,l,c,v in con.execute('SELECT root,time,open,high,low,close,volume FROM chart_4h_ny WHERE time+14400000<=? ORDER BY root,time',(cutoff,)):
   result[root].append({'time':t,'open':o,'high':h,'low':l,'close':c,'volume':v})
  return result

NEWS_SCHEMA='''CREATE TABLE IF NOT EXISTS economic_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 timestamp_utc INTEGER NOT NULL,
 date_ny TEXT NOT NULL,
 time_ny TEXT NOT NULL,
 currency TEXT NOT NULL,
 impact TEXT NOT NULL,
 event TEXT NOT NULL,
 actual TEXT,
 forecast TEXT,
 previous TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_date ON economic_events(date_ny);'''

def ensure_economic_events(path):
 with index_connection(path) as con:con.executescript(NEWS_SCHEMA)

def economic_events(path,day):
 # Dates are validated even for an installation without a local archive.
 day=date.fromisoformat(day).isoformat()
 from pathlib import Path
 if not Path(path).is_file():return []
 ensure_economic_events(path)
 with index_connection(path) as con:
  con.row_factory=sqlite3.Row
  return [dict(row) for row in con.execute('SELECT * FROM economic_events WHERE date_ny=? ORDER BY timestamp_utc ASC,id ASC',(day,))]
