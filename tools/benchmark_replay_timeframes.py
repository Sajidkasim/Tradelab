"""Offline timings: local index, or packaged archive without network latency."""
import os,sys,time,json,argparse
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['PRIMUS_REPLAY_PROFILE']='1'
from webapp.replay_timing import SAMPLES
ROOT=Path(__file__).resolve().parents[1]
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--archive',action='store_true');parser.add_argument('--date',default='2023-09-12');args=parser.parse_args()
 cutoff=int(datetime.fromisoformat(args.date+'T13:30:00+00:00').timestamp()*1000)
 if args.archive:
  from webapp.replay_archive import Archive
  target=ROOT/'data/private/replay-archive-v2'
  class LocalObjects:
   def get_object(self,**kw):return {'Body':open(target/kw['Key'].split('/')[-1],'rb')}
  reader=Archive(json.loads((target/'manifest.json').read_text()),LocalObjects(),'offline')
  read=lambda tf:reader.chart_window('NQ',tf,cutoff+1,cutoff)
 else:
  from webapp.replay_chart_windows import window
  path=ROOT/'data/private/replay-index.db';read=lambda tf:window(str(path),path.stat().st_mtime_ns,'NQ',tf,cutoff+1,cutoff)
 for tf in ['240','1D','1W','1M','60']:
  SAMPLES.clear();start=time.perf_counter();result=read(tf);elapsed=(time.perf_counter()-start)*1000
  print(json.dumps({'timeframe':tf,'candles':len(result['bars']),'milliseconds':round(elapsed,2),'stages':[(name,round(ms,2)) for name,ms in SAMPLES]}))
if __name__=='__main__':main()
