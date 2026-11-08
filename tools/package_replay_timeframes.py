"""Package precomputed chart pages locally. Publishing remains an explicit R2 upload."""
import sys,json,sqlite3
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from webapp.replay_archive import pack
from services.replay_chart_history import require_calendar,SESSION_HOUR
ROOT=Path(__file__).resolve().parents[1]
def build(index,target):
 manifest=json.loads((target/'manifest.json').read_text());lookup={}
 with sqlite3.connect(index) as db:
  require_calendar(db)
  daily={root:db.execute('SELECT time,open,high,low,close,volume,end FROM chart_daily_ny WHERE root=? ORDER BY time',(root,)).fetchall() for root in ('NQ','ES')}
  digest,body=pack(daily);(target/(digest+'.json.gz')).write_bytes(body)
  manifest['charts_calendar_ny']=digest;manifest['calendar_session_hour']=SESSION_HOUR
  for root,tf in db.execute('SELECT DISTINCT root,tf FROM chart_precomputed').fetchall():
   rows=db.execute('SELECT time,open,high,low,close,volume,end FROM chart_precomputed WHERE root=? AND tf=? ORDER BY time',(root,tf)).fetchall();entries=[]
   for i in range(0,len(rows),750):
    chunk=rows[i:i+750];digest,body=pack(chunk);(target/(digest+'.json.gz')).write_bytes(body);entries.append({'first':chunk[0][0],'last':chunk[-1][0],'digest':digest})
   lookup.setdefault(root,{})[tf]=entries
 manifest['timeframe_chunks']=lookup;(target/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
 print('Prepared',sum(len(pages) for m in lookup.values() for pages in m.values()),'private chart pages. Not uploaded.')
if __name__=='__main__':build(ROOT/'data/private/replay-index.db',ROOT/'data/private/replay-archive-v2')
