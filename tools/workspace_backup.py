"""Create encrypted Primus workspace exports and rehearse a disposable restore."""
from argparse import ArgumentParser
from copy import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from uuid import uuid4

from cryptography.fernet import Fernet
import sqlalchemy as sa

from core.db import Database, metadata
from webapp.backups import TABLES, validate
from webapp.google_access import identities

VERSION = 1


def workspace_exports(root):
    yield 'owner', root.export_json(consistent=True)
    inspector = sa.inspect(root.engine)
    if not inspector.has_table(identities.name):
        return
    with root.engine.connect() as connection:
        keys = connection.scalars(sa.select(identities.c.key).where(identities.c.key != 'owner')).all()
    for key in keys:
        if not re.fullmatch(r'[a-f0-9]{32}', key):
            raise ValueError('Unexpected workspace identifier.')
        if root.is_sqlite:
            path = Path(root.url.removeprefix('sqlite:///')).parent / 'members' / f'{key}.db'
            if not path.is_file():
                raise ValueError('A registered workspace database is missing.')
            member = Database(path)
        else:
            schema = f'primus_{key}'
            if not inspector.has_table('trades', schema=schema):
                raise ValueError('A registered workspace schema is missing.')
            member = copy(root)
            member.engine = root.engine.execution_options(schema_translate_map={None: schema})
        try:
            yield key, member.export_json(consistent=True)
        finally:
            if root.is_sqlite:
                member.engine.dispose()


def create_archive(root, cipher):
    exports = dict(workspace_exports(root))
    for payload in exports.values():
        validate(payload)
    return cipher.encrypt(json.dumps({'version': VERSION, 'workspaces': exports}).encode())


def verify_archive(content, cipher):
    archive = json.loads(cipher.decrypt(content))
    workspaces = archive['workspaces']
    if archive['version'] != VERSION or 'owner' not in workspaces:
        raise ValueError('Unrecognised workspace archive.')
    with tempfile.TemporaryDirectory(prefix='primus-restore-') as directory:
        for index, payload in enumerate(workspaces.values()):
            validated = validate(payload)
            destination = Database(Path(directory) / f'workspace-{index}.db')
            try:
                metadata.create_all(destination.engine)
                destination.import_json(validated, replace=True)
                original = json.loads(payload)
                restored = json.loads(destination.export_json())
                if any(len(restored[table]) != len(original[table]) for table in TABLES):
                    raise ValueError('Restored table counts do not match the backup.')
                for table in ('trades', 'settings'):
                    before = sorted(json.dumps(row, sort_keys=True) for row in original[table])
                    after = sorted(json.dumps(row, sort_keys=True) for row in restored[table])
                    if before != after:
                        raise ValueError('Restored records do not match the backup.')
            finally:
                destination.engine.dispose()
    return len(workspaces)


def upload_archive(content):
    import boto3
    from botocore.config import Config

    account = os.environ['PRIMUS_BACKUP_R2_ACCOUNT_ID']
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account):
        raise ValueError('Invalid backup destination.')
    client = boto3.client(
        's3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com', region_name='auto',
        aws_access_key_id=os.environ['PRIMUS_BACKUP_R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['PRIMUS_BACKUP_R2_SECRET_ACCESS_KEY'],
        config=Config(connect_timeout=5, read_timeout=60),
    )
    date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    try:
        client.put_object(Bucket=os.environ['PRIMUS_BACKUP_R2_BUCKET'],
                          Key=f'workspace-backups/{date}/{uuid4().hex}.fernet',
                          Body=content, ContentType='application/octet-stream')
    finally:
        client.close()


def main():
    parser = ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create')
    target = create.add_mutually_exclusive_group(required=True)
    target.add_argument('--output', type=Path)
    target.add_argument('--upload', action='store_true')
    verify = commands.add_parser('verify')
    verify.add_argument('archive', type=Path)
    args = parser.parse_args()
    try:
        cipher = Fernet(os.environ['PRIMUS_BACKUP_ENCRYPTION_KEY'].encode())
        if args.command == 'verify':
            count = verify_archive(args.archive.read_bytes(), cipher)
        else:
            target = os.environ['TRADELAB_DB_URL']
            if '://' not in target and not Path(target).is_file():
                raise ValueError('The source database does not exist.')
            source = Database(target)
            try:
                content = create_archive(source, cipher)
            finally:
                source.engine.dispose()
            count = verify_archive(content, cipher)
            if args.upload:
                upload_archive(content)
            else:
                with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
                    output.write(content)
        print(f'Verified disposable restore for {count} workspace(s).')
    except Exception as error:
        # Driver and storage errors may contain private connection information.
        parser.exit(1, f'Backup operation failed ({type(error).__name__}). Check configuration or restore compatibility.\n')


if __name__ == '__main__':
    main()
