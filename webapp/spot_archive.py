"""Restore a private, immutable spot archive without holding it in memory."""
import gzip
import hashlib
import json
import re
import tempfile
from pathlib import Path

MANIFEST = Path(__file__).with_name('spot_archive_manifest.json')
PREFIX = 'primus-replay/spot/v1/'


def restore(storage, bucket):
    if not MANIFEST.is_file():
        return None
    manifest = json.loads(MANIFEST.read_text())
    digest, size = manifest['sha256'], manifest['size']
    if not re.fullmatch(r'[0-9a-f]{64}', digest) or not 0 < size <= 4 * 1024**3:
        raise ValueError('Invalid spot replay manifest.')
    folder = Path(tempfile.gettempdir())
    target = folder / f'primus-spot-{digest}.db'
    if target.is_file() and target.stat().st_size == size:
        return target
    stream = storage.get_object(Bucket=bucket, Key=PREFIX + digest + '.db.gz')['Body']
    checksum = hashlib.sha256()
    written = 0
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=folder, delete=False) as output:
            temporary = Path(output.name)
            with gzip.GzipFile(fileobj=stream) as source:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > size:
                        raise ValueError('Spot archive exceeded its declared size.')
                    checksum.update(chunk)
                    output.write(chunk)
        if written != size or checksum.hexdigest() != digest:
            raise ValueError('Spot archive integrity check failed.')
        temporary.replace(target)
        return target
    finally:
        stream.close()
        if temporary:
            temporary.unlink(missing_ok=True)
