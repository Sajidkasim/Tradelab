"""Precompute completed 4h context from canonical prior-day-volume contracts."""
from pathlib import Path
import sqlite3

def build(path):
 with sqlite3.connect(path) as c:
  c.execute('CREATE TABLE IF NOT EXISTS active_contracts(day TEXT,root TEXT,symbol TEXT,PRIMARY KEY(day,root))')
  c.execute('CREATE INDEX IF NOT EXISTS active_contracts_root_day ON active_contracts(root,day,symbol)')
  rows=c.execute('SELECT day,symbol,volume FROM volumes ORDER BY day,symbol').fetchall();groups={}
  for d,s,v in rows:groups.setdefault((d,s[:2]),{})[s]=v
  previous={};selected=[]
  for (d,root),candidates in sorted(groups.items()):
   eligible={s:v for s,v in previous.get(root,{}).items() if s in candidates}
   symbol=max(eligible,key=eligible.get) if eligible else sorted(candidates)[0]
   selected.append((d,root,symbol));previous[root]=candidates
  c.executemany('INSERT OR REPLACE INTO active_contracts VALUES(?,?,?)',selected)
  c.execute('DROP TABLE IF EXISTS chart_4h_build')
  c.execute('CREATE TABLE chart_4h_build(root TEXT,time INTEGER,open REAL,high REAL,low REAL,close REAL,volume INTEGER,PRIMARY KEY(root,time))')
  for i,(day,root,symbol) in enumerate(selected):
   rows=c.execute('SELECT time,open,high,low,close,volume FROM bars WHERE day=? AND symbol=? ORDER BY time',(day,symbol)).fetchall();buckets={}
   for t,o,h,l,close,v in rows:
    bucket=t//14400000*14400000
    if bucket in buckets:
     a=buckets[bucket];a[2]=max(a[2],h);a[3]=min(a[3],l);a[4]=close;a[5]+=v
    else:buckets[bucket]=[bucket,o,h,l,close,v]
   c.executemany('INSERT INTO chart_4h_build VALUES(?,?,?,?,?,?,?)',[(root,*v) for v in buckets.values()])
   if i%500==0:print('Prepared',day,root,flush=True)
  c.execute('DROP TABLE IF EXISTS chart_4h');c.execute('ALTER TABLE chart_4h_build RENAME TO chart_4h');c.commit()
  print('Complete:',c.execute('SELECT COUNT(*) FROM chart_4h').fetchone()[0],flush=True)
if __name__=='__main__':build(Path(__file__).resolve().parents[1]/'data/private/replay-index.db')
