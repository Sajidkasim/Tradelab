"""Local real-history request benchmark, isolated from every saved workspace."""
import sys,tempfile,time,json,resource,statistics
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from webapp.config import Settings
from webapp.app import create_app
with tempfile.TemporaryDirectory() as folder:
    app=create_app(Settings(str(Path(folder)/'capacity.db'),'test@example.com','synthetic-capacity-secret-123456789012345','http://127.0.0.1:8100',local=True))
    with TestClient(app,base_url='http://127.0.0.1:8100',client=('127.0.0.1',1234)) as client:
        csrf=client.get('/api/session').json()['csrf'];client.headers.update({'X-Primus-CSRF':csrf,'Origin':'http://127.0.0.1:8100'})
        response=client.post('/api/backtesting/sessions',json={'day':'2013-01-25'})
        response.raise_for_status();sid=response.json()['session']['id'];results=[]
        def read(_):
            start=time.perf_counter();r=client.get(f'/api/backtesting/sessions/{sid}');r.raise_for_status();return time.perf_counter()-start,len(r.content)
        for users in (5,10,25):
            with ThreadPoolExecutor(max_workers=users) as pool:rows=list(pool.map(read,range(users)))
            durations=sorted(t for t,n in rows);results.append({'concurrent_requests':users,'median_seconds':round(statistics.median(durations),3),'max_seconds':round(max(durations),3),'response_bytes':rows[0][1]})
        report={'scope':'Local TestClient, real 2013 history, one private session; not hosted capacity or real tablet testing','results':results,'process_peak_rss_bytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
        out=Path('data/private/replay-capacity.json');out.write_text(json.dumps(report,indent=2));print(json.dumps(report))
