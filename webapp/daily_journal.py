"""Local-only Journal draft. Private notes reuse the existing settings backup.

Images belong to the disposable preview directory, never a public static mount.
Cloud uploads remain disabled until the separate Journal/R2 release is approved.
"""
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import re
from uuid import uuid4
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

PREFIX = 'primus_daily_entry:'
MAX_UPLOAD = 8 * 1024 * 1024
MAX_IMAGES = 6


def entry(database, day):
    stored = database.get_setting(PREFIX + day, {})
    return {'day': day, 'plan': '', 'notes': '', 'lesson': '', 'mindset': 'Not set',
            'images': [], 'updated_at': None, **stored}


def save(database, day, values):
    result = {**entry(database, day), **values, 'day': day,
              'updated_at': datetime.now(timezone.utc).isoformat()}
    database.set_setting(PREFIX + day, result)
    return result


def entries(database):
    return sorted((row for row in database.settings_with_prefix(PREFIX).values()
                   if isinstance(row, dict) and row.get('day')), key=lambda row: row['day'], reverse=True)


def image_path(config, member, day, image_id):
    if not config.local or not config.site_preview:
        raise PermissionError('Local Journal preview only.')
    if not re.fullmatch(r'owner|[a-f0-9]{32}', member) or not re.fullmatch(r'[a-f0-9]{32}', image_id):
        raise ValueError('Invalid image reference.')
    return Path(config.database).resolve().parent / 'journal-images' / member / day / (image_id + '.webp')


def compress(content):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as source:
                if source.format not in ('PNG', 'JPEG', 'WEBP') or source.width * source.height > 16000000:
                    raise ValueError('Choose a PNG, JPEG or WebP image under 16 megapixels.')
                if getattr(source, 'n_frames', 1) != 1:
                    raise ValueError('Choose a still screenshot rather than an animation.')
                image = ImageOps.exif_transpose(source).convert('RGB')
                image.thumbnail((2200, 2200))
                output = BytesIO()
                image.save(output, format='WEBP', quality=84, method=4)
                return output.getvalue(), image.width, image.height
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError('Choose a readable PNG, JPEG or WebP screenshot.') from None


def add_image(database, config, member, day, content):
    previous = entry(database, day)
    if len(previous['images']) >= MAX_IMAGES:
        raise ValueError('Keep up to six screenshots per day in this preview.')
    data, width, height = compress(content)
    image_id = uuid4().hex
    path = image_path(config, member, day, image_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    item = {'id': image_id, 'width': width, 'height': height, 'size': len(data)}
    try:
        return save(database, day, {'images': [*previous['images'], item]})
    except Exception:
        path.unlink(missing_ok=True)
        raise
