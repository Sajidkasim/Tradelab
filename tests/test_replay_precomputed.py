import sqlite3
from datetime import datetime,timezone
from tools.index_replay_ny import build as four_hour
from tools.index_replay_calendar import build as daily
from tools.precompute_replay_timeframes import build,end_of
from services.replay_chart_history import aggregate,FIELDS
from webapp.replay_chart_windows import window

def test_precomputed_windows_match_raw_ohlcv_and_keep_future_hidden(tmp_path):
 path=tmp_path/'index.db';t=int(datetime(2023,9,12,13,30,tzinfo=timezone.utc).timestamp()*1000)
 rows=[(t+i*60000,100+i,9999 if i==29 else 102+i,99+i,101+i,2) for i in range(30)]
 with sqlite3.connect(path) as db:
  db.executescript('CREATE TABLE active_contracts(day,root,symbol);CREATE TABLE bars(time,symbol,day,open,high,low,close,volume);')
  for root in ('NQ','ES'):
   db.execute('INSERT INTO active_contracts VALUES(?,?,?)',('2023-09-12',root,root+'U'))
   db.executemany('INSERT INTO bars VALUES(?,?,?,?,?,?,?,?)',[(r[0],root+'U','2023-09-12',*r[1:]) for r in rows])
 four_hour(path);daily(path);build(path,['5','15','60'])
 cutoff=rows[11][0]
 for tf in ['5','15','60','240','1D','1W','1M']:
  result=window(str(path),path.stat().st_mtime_ns,'NQ',tf,cutoff+1,cutoff)
  assert result['bars']==[dict(zip(FIELDS,row)) for row in aggregate(rows[:12],tf)],tf
 opened=int(datetime(2023,2,28,22,tzinfo=timezone.utc).timestamp()*1000)
 assert end_of(opened,'1M')==int(datetime(2023,3,31,21,tzinfo=timezone.utc).timestamp()*1000)
