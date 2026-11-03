"""Disposable synthetic replay memory benchmark. No database or real trades touched.
Run separately: python tools/benchmark_replay_memory.py [--compact] [--bars 50000]
"""
import sys,argparse,tracemalloc,json,resource,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.replay_engine import project
p=argparse.ArgumentParser();p.add_argument('--compact',action='store_true');p.add_argument('--bars',type=int,default=50000);args=p.parse_args()
bars=[{'time':i*60000,'open':100,'high':101,'low':99,'close':100,'volume':1} for i in range(args.bars)]
spec={'capital':50000,'instrument':'NQ','commission':.5,'slippage':0,'start_cursor':0,'close_at_end':False}
commands=[{'at':0,'kind':'order','order':{'side':'buy','type':'market','qty':1,'stop':90,'target':110}}]
tracemalloc.start();start=time.perf_counter();plan=project(bars,spec,commands,compact=args.compact)
if args.compact:plan={**plan,'frames':plan['frames'].wire()}
encoded=json.dumps(plan,separators=(',',':'));current,peak=tracemalloc.get_traced_memory()
print(json.dumps({'compact':args.compact,'bars':args.bars,'projection_and_json_peak_MiB':round(peak/1048576,2),'JSON_MiB':round(len(encoded)/1048576,2),'process_peak_RSS_MiB':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1048576 if sys.platform=='darwin' else 1024),2),'seconds':round(time.perf_counter()-start,2)}))
