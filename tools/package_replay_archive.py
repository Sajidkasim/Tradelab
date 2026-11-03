"""Package the full offline index once; optional private R2 upload with read-back checks."""
import argparse,json,sqlite3,sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from webapp.replay_archive import pack,key,unpack
ROOT=Path(__file__).resolve().parents[1]

def build(index,target):
    target.mkdir(parents=True,exist_ok=True);days={};daily={'NQ':[],'ES':[]}
    with sqlite3.connect(index) as db:
        active=db.execute('SELECT day,root,symbol FROM active_contracts ORDER BY day,root').fetchall();groups={}
        for day,root,symbol in active:groups.setdefault(day,{})[root]=symbol
        for i,(day,symbols) in enumerate(groups.items()):
            if set(symbols)!={'NQ','ES'}:continue
            markets={}
            for root,symbol in symbols.items():
                rows=db.execute('SELECT time,open,high,low,close,volume FROM bars WHERE day=? AND symbol=? ORDER BY time',(day,symbol)).fetchall()
                if not rows:break
                markets[root]={'contract':symbol,'bars':rows}
                stamp=rows[0][0]//86400000*86400000
                daily[root].append([stamp,rows[0][1],max(r[2] for r in rows),min(r[3] for r in rows),rows[-1][4],sum(r[5] for r in rows)])
            if len(markets)!=2:continue
            digest,body=pack({'day':day,'markets':markets});(target/(digest+'.json.gz')).write_bytes(body);days[day]=digest
            if i%500==0:print('Packaged',day,flush=True)
        charts={root:{'daily':daily[root],'4h':db.execute('SELECT time,open,high,low,close,volume FROM chart_4h WHERE root=? ORDER BY time',(root,)).fetchall()} for root in ('NQ','ES')}
    digest,body=pack(charts);(target/(digest+'.json.gz')).write_bytes(body)
    manifest={'version':2,'timezone':'UTC','days':days,'charts':digest}
    with sqlite3.connect(index) as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='chart_4h_ny'").fetchone():
            ny={root:db.execute('SELECT time,open,high,low,close,volume FROM chart_4h_ny WHERE root=? ORDER BY time',(root,)).fetchall() for root in ('NQ','ES')}
            ny_digest,ny_body=pack(ny);(target/(ny_digest+'.json.gz')).write_bytes(ny_body);manifest['charts_ny']=ny_digest
    with sqlite3.connect(index) as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='chart_daily_ny'").fetchone():
            calendar={root:db.execute('SELECT time,open,high,low,close,volume,end FROM chart_daily_ny WHERE root=? ORDER BY time',(root,)).fetchall() for root in ('NQ','ES')}
            digest,body=pack(calendar);(target/(digest+'.json.gz')).write_bytes(body);manifest['charts_calendar_ny']=digest
    (target/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    print(json.dumps({'dates':len(days),'compressed_bytes':sum(p.stat().st_size for p in target.glob('*.gz'))}),flush=True)
    return manifest

def upload(target):
    from dotenv import dotenv_values
    from types import SimpleNamespace
    from webapp.image_storage import ImageStorage
    cfg=dotenv_values(ROOT/'data/private/r2.env');names=('ACCOUNT_ID','BUCKET','ACCESS_KEY_ID','SECRET_ACCESS_KEY')
    values={f'r2_{n.lower()}':cfg.get('PRIMUS_R2_'+n,'') for n in names}
    if not all(values.values()):raise SystemExit('Private R2 configuration is missing.')
    connection=ImageStorage(SimpleNamespace(r2_ready=True,**values));client=connection.client
    manifest=json.loads((target/'manifest.json').read_text());digests=list(dict.fromkeys([*manifest['days'].values(),manifest['charts'],*([manifest['charts_ny']] if manifest.get('charts_ny') else []),*([manifest['charts_calendar_ny']] if manifest.get('charts_calendar_ny') else [])]))
    def put(digest):
        body=(target/(digest+'.json.gz')).read_bytes();object_key=key(digest)
        try:
            head=client.head_object(Bucket=values['r2_bucket'],Key=object_key)
            if head.get('Metadata',{}).get('sha256')==digest and head['ContentLength']==len(body):return
        except client.exceptions.ClientError as e:
            if e.response['Error']['Code'] not in ('404','NoSuchKey','NotFound'):raise
        client.put_object(Bucket=values['r2_bucket'],Key=object_key,Body=body,ContentType='application/gzip',Metadata={'sha256':digest},CacheControl='private, max-age=31536000, immutable')
        stream=client.get_object(Bucket=values['r2_bucket'],Key=object_key)['Body']
        try:unpack(stream.read(),digest)
        finally:stream.close()
    with ThreadPoolExecutor(max_workers=6) as pool:
        for i,_ in enumerate(pool.map(put,digests)):
            if i%250==0:print('Uploaded and verified',i+1,'of',len(digests),flush=True)
    # Publish only a complete verified manifest. Existing v1 files remain untouched.
    (ROOT/'webapp/replay_archive_manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    print('Full archive upload verified; release manifest ready.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--upload-r2',action='store_true');parser.add_argument('--reuse',action='store_true');args=parser.parse_args()
    target=ROOT/'data/private/replay-archive-v2'
    if not args.reuse:build(ROOT/'data/private/replay-index.db',target)
    if args.upload_r2:upload(target)
