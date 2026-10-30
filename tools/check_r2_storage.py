"""Verify a private R2 connection using only a tiny synthetic test object.
Run with --env-file pointing to a privately saved file; never put keys in CLI args.
"""
import argparse
from datetime import date
from pathlib import Path
import sys
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dotenv import dotenv_values
from webapp.config import Settings
from webapp.image_storage import ImageStorage

parser=argparse.ArgumentParser();parser.add_argument('--env-file',required=True)
args=parser.parse_args();values=dotenv_values(args.env_file)
config=Settings('unused-check.db','local@primuslab.invalid','local-check-secret', 'http://127.0.0.1:8100',local=True,
    r2_account_id=values.get('PRIMUS_R2_ACCOUNT_ID',''),r2_bucket=values.get('PRIMUS_R2_BUCKET',''),
    r2_access_key_id=values.get('PRIMUS_R2_ACCESS_KEY_ID',''),r2_secret_access_key=values.get('PRIMUS_R2_SECRET_ACCESS_KEY',''))
config.validate()
if not config.r2_ready:raise SystemExit('The private file is missing R2 settings.')
store=ImageStorage(config);image_id=uuid4().hex;day=date.today().isoformat()
try:
    data=b'Primus private storage connection check. No user data.'
    store.put('owner',day,image_id,data)
    if store.read('owner',day,image_id)!=data:raise SystemExit('Storage verification failed.')
    store.discard_unreferenced('owner',day,image_id)
    if store.read('owner',day,image_id) is not None:raise SystemExit('Storage cleanup could not be verified.')
    print('Private R2 write/read/delete check passed. No user data was uploaded.')
except Exception:
    raise SystemExit('R2 connection failed. Check the bucket permissions and privately saved keys.') from None
finally:store.close()
