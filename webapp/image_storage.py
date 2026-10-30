"""Private screenshots. Object keys never become browser/public URLs."""
from datetime import date
import re

from botocore.exceptions import BotoCoreError, ClientError

MAX_STORED = 8 * 1024 * 1024


class StorageUnavailable(Exception):
    pass


class ImageStorage:
    def __init__(self, config):
        self.config = config
        self.client = None
        if config.r2_ready:
            import boto3
            from botocore.config import Config
            self.client = boto3.client('s3', endpoint_url=f'https://{config.r2_account_id}.r2.cloudflarestorage.com',
                aws_access_key_id=config.r2_access_key_id, aws_secret_access_key=config.r2_secret_access_key,
                region_name='auto', config=Config(signature_version='s3v4', connect_timeout=5, read_timeout=15,
                    retries={'max_attempts':2, 'mode':'standard'}, s3={'addressing_style':'path'}))

    @property
    def enabled(self):
        return bool(self.client) or (self.config.local and self.config.site_preview)

    def key(self, member, day, image_id):
        if not re.fullmatch(r'owner|[a-f0-9]{32}', member) or not re.fullmatch(r'[a-f0-9]{32}', image_id):
            raise ValueError('Invalid screenshot reference.')
        date.fromisoformat(day)
        return f'primus-journal/v1/{member}/{day}/{image_id}.webp'

    def local_path(self, member, day, image_id):
        from .daily_journal import image_path
        return image_path(self.config, member, day, image_id)

    def put(self, member, day, image_id, data):
        key = self.key(member, day, image_id)
        if not self.enabled:
            raise StorageUnavailable()
        if self.client:
            try:
                self.client.put_object(Bucket=self.config.r2_bucket, Key=key, Body=data,
                    ContentType='image/webp', CacheControl='private, no-store')
            except (BotoCoreError, ClientError):
                raise StorageUnavailable() from None
        else:
            path = self.local_path(member, day, image_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def read(self, member, day, image_id):
        key = self.key(member, day, image_id)
        if not self.enabled:
            raise StorageUnavailable()
        if self.client:
            try:
                result = self.client.get_object(Bucket=self.config.r2_bucket, Key=key)
                body = result['Body']
                try:
                    data = body.read(MAX_STORED + 1)
                finally:
                    body.close()
                if len(data) > MAX_STORED:
                    raise StorageUnavailable()
                return data
            except ClientError as exc:
                if exc.response.get('Error', {}).get('Code') in ('NoSuchKey', '404'):
                    return None
                raise StorageUnavailable() from None
            except (BotoCoreError, OSError):
                raise StorageUnavailable() from None
        path = self.local_path(member, day, image_id)
        return path.read_bytes() if path.is_file() else None

    def discard_unreferenced(self, member, day, image_id):
        key = self.key(member, day, image_id)
        if self.client:
            try:
                self.client.delete_object(Bucket=self.config.r2_bucket, Key=key)
            except (BotoCoreError, ClientError):
                pass  # A failed metadata write must not expose an unreferenced object.
        else:
            self.local_path(member, day, image_id).unlink(missing_ok=True)

    def close(self):
        if self.client:
            self.client.close()
