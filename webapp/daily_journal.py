"""Local-only Journal draft. Private notes reuse the existing settings backup.

Images belong to the disposable preview directory, never a public static mount.
Cloud uploads remain disabled until the separate Journal/R2 release is approved.
"""
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import re
from uuid import uuid4
from zoneinfo import ZoneInfo
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

PREFIX = 'primus_daily_entry:'
MAX_UPLOAD = 8 * 1024 * 1024
MAX_IMAGES = 6


def entry(database, day):
    stored = database.get_setting(PREFIX + day, {})
    return {'day': day, 'plan': '', 'notes': '', 'lesson': '', 'mindset': 'Not set',
            'images': [], 'trades': [], 'updated_at': None, **stored}


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


def add_image(database, config, member, day, content, trade_id=""):
    previous = entry(database, day)
    if trade_id and not any(t['id'] == trade_id for t in previous['trades']):
        raise ValueError('Save this trade before adding a screenshot.')
    if len(previous['images']) >= MAX_IMAGES:
        raise ValueError('Keep up to six screenshots per day in this preview.')
    data, width, height = compress(content)
    image_id = uuid4().hex
    path = image_path(config, member, day, image_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    item = {'id': image_id, 'trade_id': trade_id or None, 'width': width, 'height': height, 'size': len(data)}
    try:
        return save(database, day, {'images': [*previous['images'], item]})
    except Exception:
        path.unlink(missing_ok=True)
        raise


def save_day(database, day, values):
    previous = entry(database, day)
    incoming = values.get('trades')
    if incoming is not None:
        ids = [t['id'] for t in incoming]
        if len(set(ids)) != len(ids):
            raise ValueError('Each journal trade needs its own reference.')
        old = {t['id']: t for t in previous['trades']}
        values['trades'] = [{ 'symbol':'', 'direction':'', 'strategy':'', 'time':'', 'source':'manual', 'notes':'', 'outcome':'not_recorded', 'confirmations':[], **old.get(t['id'], {}), **t, 'lab_trade_id': old.get(t['id'], {}).get('lab_trade_id')} for t in incoming]
        # Removing a narrative card never removes its Lab trade or its screenshots.
        values['images'] = [{**image, 'trade_id': image.get('trade_id') if image.get('trade_id') in ids else None} for image in previous['images']]
    return save(database, day, values)


def trade_entry(database, day, record_id):
    return next((t for t in entry(database, day)['trades'] if t['id'] == record_id), None)


def link_trade(database, day, record_id, trade_id):
    current = entry(database, day)
    if not any(t['id'] == record_id for t in current['trades']):
        raise ValueError('Save this journal trade first.')
    if trade_id is not None and database.get_trade(trade_id) is None:
        raise ValueError('Choose a trade from your own Strategy Lab.')
    snapshot = {}
    if trade_id is not None:
        from . import journal_preferences
        from core.models import BACKTEST_SOURCES
        from core import edge
        trade = database.get_trade(trade_id)
        clock = trade.entry_time
        if clock.tzinfo is None:
            clock = clock.replace(tzinfo=timezone.utc)
        snapshot = {'symbol': trade.symbol, 'direction': trade.direction, 'strategy': trade.setup_name,
                    'source': 'backtest' if trade.source in BACKTEST_SOURCES else 'manual',
                    'outcome': 'not_recorded' if trade.net_pnl is None else 'win' if trade.net_pnl > 0 else 'loss' if trade.net_pnl < 0 else 'breakeven',
                    'confirmations': edge.read_labels(trade.tags)['confirmations'],
                    'time': clock.astimezone(ZoneInfo(journal_preferences.read(database)['timezone'])).strftime('%H:%M')}
    return save(database, day, {'trades': [{**t, **snapshot, 'lab_trade_id': trade_id} if t['id'] == record_id else t for t in current['trades']]})


def journal_tag(day, record_id):
    return f'lab:journal:{day}:{record_id}'


def linked_record(database, day, record_id):
    # Recover the link if an earlier insert succeeded but the response/link save failed.
    marker = journal_tag(day, record_id)
    frame = database.trades_df()
    if frame.empty:
        return None
    match = frame[frame['tags'].map(lambda tags: marker in (tags or []))]
    return int(match.iloc[0]['id']) if not match.empty else None
