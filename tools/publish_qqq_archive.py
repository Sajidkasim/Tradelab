"""Upload the prepared QQQ index to private replay storage and verify it."""
import gzip
import hashlib
import json
import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from webapp.image_storage import ImageStorage
from webapp.spot_archive import restore


def publish():
    source = ROOT / 'data/private/qqq-replay.db'
    with source.open('rb') as raw:
        digest = hashlib.file_digest(raw, 'sha256').hexdigest()
    manifest = {'sha256': digest, 'size': source.stat().st_size}
    config = dotenv_values(ROOT / 'data/private/r2.env')
    values = {f'r2_{name.lower()}': config.get(f'PRIMUS_R2_{name}') for name in
              ('ACCOUNT_ID', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY')}
    if not all(values.values()):
        raise ValueError('Private R2 configuration is missing.')
    storage = ImageStorage(SimpleNamespace(r2_ready=True, **values))
    prefix = 'primus-replay/qqq/v1/'
    try:
        with TemporaryDirectory() as folder:
            archive = Path(folder) / 'qqq.db.gz'
            with source.open('rb') as raw, gzip.open(archive, 'wb', compresslevel=6) as zipped:
                shutil.copyfileobj(raw, zipped)
            with archive.open('rb') as body:
                storage.client.put_object(
                    Bucket=values['r2_bucket'], Key=prefix + digest + '.db.gz',
                    Body=body, ContentType='application/gzip', Metadata={'sha256': digest},
                    CacheControl='private, max-age=31536000, immutable')
            manifest_path = Path(folder) / 'manifest.json'
            manifest_path.write_text(json.dumps(manifest) + '\n')
            restore(storage.client, values['r2_bucket'], manifest_path=manifest_path, prefix=prefix)
            shutil.copyfile(manifest_path, ROOT / 'webapp/qqq_archive_manifest.json')
            print(f'Uploaded and verified {archive.stat().st_size:,} compressed bytes.')
    finally:
        storage.close()


if __name__ == '__main__':
    publish()
