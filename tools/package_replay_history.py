"""Package prepared local history into immutable bundles. R2 upload is explicit."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from webapp.replay_history_storage import HistoryStorage

def package(source,target,client=None,bucket=''):
    storage=HistoryStorage(target/'bundles',client,bucket);manifest={}
    for path in sorted(source.glob('*.json')):
        data=json.loads(path.read_bytes());manifest[data['day']]=storage.put(path.read_bytes())
    target.mkdir(parents=True,exist_ok=True)
    (target/'manifest.json').write_text(json.dumps({'version':1,'days':manifest,'timezone':'UTC'}))
    return manifest
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--upload-r2',action='store_true');args=parser.parse_args()
    client=None;bucket=''
    if args.upload_r2:
        from dotenv import load_dotenv
        from types import SimpleNamespace
        import os
        from webapp.image_storage import ImageStorage
        load_dotenv(Path(__file__).resolve().parents[1]/'data/private/r2.env')
        names=('ACCOUNT_ID','BUCKET','ACCESS_KEY_ID','SECRET_ACCESS_KEY')
        values={f'r2_{name.lower()}':os.getenv(f'PRIMUS_R2_{name}','') for name in names}
        cfg=SimpleNamespace(r2_ready=all(values.values()),**values)
        connection=ImageStorage(cfg);client=connection.client;bucket=cfg.r2_bucket
        if client is None:raise SystemExit('Configure private R2 settings first.')
    root=Path(__file__).resolve().parents[1]/'data/private'
    result=package(root/'replay-history',root/'replay-package',client,bucket)
    print(json.dumps({'days':len(result),'destination':'private R2' if client else 'local durable bundles'}))
