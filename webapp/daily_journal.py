"""Private daily Journal notes/cards; saving alone never creates Lab trades."""
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import re
from uuid import uuid4
from zoneinfo import ZoneInfo
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from . import custom_trade_fields
from .journal_replay import KEY as REPLAY_IMPORTS_KEY

PREFIX = 'primus_daily_entry:'
MAX_UPLOAD = 8 * 1024 * 1024
MAX_IMAGES = 6


def entry(database, day):
    stored = database.get_setting(PREFIX + day, {})
    if stored.get('deleted_at'):
        stored = {}
    return with_day_result(database, {'day': day, 'plan': '', 'notes': '', 'lesson': '', 'mindset': 'Not set',
            'images': [], 'trades': [], 'updated_at': None, 'plan_followed': None, 'traded_today': None, **stored})


def save(database, day, values):
    result = {**entry(database, day), **values, 'day': day,
              'updated_at': datetime.now(timezone.utc).isoformat()}
    result.pop('day_result', None)
    result.pop('trade_results', None)
    database.set_setting(PREFIX + day, result)
    return with_day_result(database, result)


def entries(database):
    return sorted((with_day_result(database, row) for row in database.settings_with_prefix(PREFIX).values()
                   if isinstance(row, dict) and row.get('day') and not row.get('deleted_at')), key=lambda row: row['day'], reverse=True)


def card_accounts(card):
    """Legacy cards stored a single account ID."""
    return card.get('account_ids', []) or ([card['account_id']] if card.get('account_id') is not None else [])


def with_day_result(database, row):
    """Journal-only totals use the tested core; missing results never imply zero."""
    import pandas as pd
    from core.metrics import daily_pnl
    trades = []
    amounts = []
    trade_results = []
    seen = set()
    replay_ids = database.get_setting(REPLAY_IMPORTS_KEY, {}) if any(card.get('replay_id') for card in row.get('trades', [])) else {}
    for card in row.get('trades', []):
        if card.get('replay_id') and card['replay_id'] not in replay_ids:
            card = {**card, 'replay_id': None}
        linked = card.get('lab_trade_id')
        trade = database.get_trade(linked) if linked else None
        if trade is not None:
            card = {**card, 'custom_fields': custom_trade_fields.values(trade.tags, trade.custom_metadata)}
        trades.append(card)
        if linked and linked in seen:
            continue  # Two cards linked to one Lab trade are one financial result.
        if linked:
            seen.add(linked)
        net = trade.net_pnl if trade is not None else card.get('net_pnl')
        amounts.append(net)
        result = {'account_id': card.get('account_id'), 'net_pnl': net}
        selected = card_accounts(card)
        if len(selected) > 1:
            result['account_ids'] = selected
        trade_results.append(result)
    recorded = [amount for amount in amounts if amount is not None]
    total = None
    if amounts and len(recorded) == len(amounts):
        frame = pd.DataFrame({'net_pnl': recorded, 'exit_time': [row['day']] * len(recorded)})
        total = float(daily_pnl(frame).iloc[0])
    return {**row, 'trades': trades, 'trade_results': trade_results, 'day_result': {'net_pnl': total, 'outcome': outcome(total),
                                 'recorded_trades': len(recorded), 'total_trades': len(amounts)}}


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


def add_image(database, config, member, day, content, trade_id="", storage=None):
    previous = entry(database, day)
    if trade_id and not any(t['id'] == trade_id for t in previous['trades']):
        raise ValueError('Save this trade before adding a screenshot.')
    if len(previous['images']) >= MAX_IMAGES:
        raise ValueError('Keep up to six screenshots per day in this preview.')
    data, width, height = compress(content)
    image_id = uuid4().hex
    if storage is None:
        from .image_storage import ImageStorage
        storage = ImageStorage(config)
    storage.put(member, day, image_id, data)
    item = {'id': image_id, 'trade_id': trade_id or None, 'width': width, 'height': height, 'size': len(data)}
    try:
        return save(database, day, {'images': [*previous['images'], item]})
    except Exception:
        storage.discard_unreferenced(member, day, image_id)
        raise


def save_day(database, day, values):
    previous = entry(database, day)
    incoming = values.get('trades')
    if incoming is not None:
        ids = [t['id'] for t in incoming]
        if len(set(ids)) != len(ids):
            raise ValueError('Each journal trade needs its own reference.')
        old = {t['id']: t for t in previous['trades']}
        cards = []
        account_ids = {account.id for account in database.accounts()}
        replay_ids = database.get_setting(REPLAY_IMPORTS_KEY, {}) if any(item.get('replay_id') for item in incoming) else {}
        for item in incoming:
            if item.get('replay_id') and item['replay_id'] not in replay_ids:
                raise ValueError('Choose an imported replay from your workspace.')
            prior = old.get(item['id'], {})
            if 'account_ids' in item:
                selected = list(dict.fromkeys(item['account_ids']))
            elif 'account_id' in item:
                selected = card_accounts({'account_id': item['account_id']})
                if item['account_id'] is None and len(card_accounts(prior)) > 1:
                    selected = card_accounts(prior)
            else:
                selected = card_accounts(prior)
            if any(account_id not in account_ids for account_id in selected):
                raise ValueError('Choose accounts from your Journal.')
            linked_id = prior.get('lab_trade_id')
            if linked_id and len(selected) > 1:
                raise ValueError('A linked Strategy Lab trade can have one Journal account.')
            if selected or 'account_ids' in item or 'account_id' in item:
                item = {**item, 'account_ids': selected, 'account_id': selected[0] if len(selected) == 1 else None}
            card = {'symbol':'', 'direction':'', 'strategy':'', 'time':'', 'source':'manual', 'notes':'',
                    'outcome':'not_recorded', 'confirmations':[], 'level':'Not recorded',
                    'timeframe':'Not recorded', 'entry_timeframe':'Not recorded',
                    'risk_amount':None, 'net_pnl':None, 'custom_fields':{},
                    **old.get(item['id'], {}), **item, 'lab_trade_id':linked_id}
            if not linked_id:
                submitted = item.get('custom_fields')
                previous_fields = prior.get('custom_fields') or {}
                if submitted is not None:
                    # Older clients may round-trip unchanged archived values.
                    changes = {key: value for key, value in submitted.items() if previous_fields.get(key) != value}
                    card['custom_fields'] = custom_trade_fields.merge(previous_fields, database, changes)
                else:
                    card['custom_fields'] = previous_fields
            if linked_id:
                # Linked setup/results come from the user's own Lab, never a
                # Journal payload. Personal notes remain independently editable.
                snapshot = trade_snapshot(database, linked_id)
                if not snapshot:
                    snapshot = {key:old[item['id']].get(key, card[key]) for key in
                                ('symbol','direction','strategy','time','source','outcome','confirmations',
                                 'level','timeframe','entry_timeframe','risk_amount','net_pnl','custom_fields')}
                card.update(snapshot)
            elif card['net_pnl'] is not None:
                card['outcome'] = outcome(card['net_pnl'])
            cards.append(card)
        values['trades'] = cards
        # Removing a narrative card never removes its Lab trade or its screenshots.
        values['images'] = [{**image, 'trade_id': image.get('trade_id') if image.get('trade_id') in ids else None} for image in previous['images']]
    return save(database, day, values)


def trade_entry(database, day, record_id):
    return next((t for t in entry(database, day)['trades'] if t['id'] == record_id), None)


def outcome(net):
    return 'not_recorded' if net is None else 'win' if net > 0 else 'loss' if net < 0 else 'breakeven'


def trade_snapshot(database, trade_id):
    from . import journal_preferences
    from core.models import BACKTEST_SOURCES
    from core import edge
    trade = database.get_trade(trade_id)
    if trade is None:
        return {}
    clock = trade.entry_time
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    labels = edge.read_labels(trade.tags)
    return {'symbol':trade.symbol, 'direction':trade.direction, 'strategy':trade.setup_name,
            'source':'backtest' if trade.source in BACKTEST_SOURCES else 'manual',
            'outcome':outcome(trade.net_pnl), 'confirmations':labels['confirmations'],
            'level':labels['level'], 'timeframe':labels['timeframe'], 'entry_timeframe':labels['entry_timeframe'],
            'risk_amount':trade.initial_risk, 'net_pnl':trade.net_pnl,
            'custom_fields':custom_trade_fields.values(trade.tags, trade.custom_metadata),
            'time':clock.astimezone(ZoneInfo(journal_preferences.read(database)['timezone'])).strftime('%H:%M')}


def link_trade(database, day, record_id, trade_id):
    current = entry(database, day)
    card = next((t for t in current['trades'] if t['id'] == record_id), None)
    if card is None:
        raise ValueError('Save this journal trade first.')
    if trade_id is not None and len(card_accounts(card)) > 1:
        raise ValueError('Choose one account before linking a Strategy Lab trade.')
    if trade_id is not None and database.get_trade(trade_id) is None:
        raise ValueError('Choose a trade from your own Strategy Lab.')
    snapshot = trade_snapshot(database, trade_id) if trade_id is not None else {}
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


TRASH_PREFIX = 'primus_deleted_entry:'


def deleted_entries(database):
    return sorted(({'id':row['archive_id'], 'day':row['day'], 'deleted_at':row['deleted_at']} for row in database.settings_with_prefix(TRASH_PREFIX).values()
        if isinstance(row, dict) and row.get('archive_id')), key=lambda row:row['deleted_at'], reverse=True)


def delete_entry(database, day):
    stored = database.get_setting(PREFIX + day, {})
    if not stored:
        return None
    archive_id = uuid4().hex
    database.set_setting(TRASH_PREFIX + archive_id, {**stored, 'archive_id':archive_id, 'deleted_at':datetime.now(timezone.utc).isoformat()})
    database.set_setting(PREFIX + day, {})
    return archive_id


def restore_entry(database, archive_id):
    if not re.fullmatch(r'[a-f0-9]{32}', archive_id):
        raise ValueError('Choose a deleted entry to restore.')
    stored = database.get_setting(TRASH_PREFIX + archive_id, {})
    if not stored:
        raise ValueError('This entry is not in deleted entries.')
    if database.get_setting(PREFIX + stored['day'], {}):
        raise ValueError('An entry already exists for this day. Delete it before restoring this version.')
    restored = {key:value for key,value in stored.items() if key not in ('deleted_at','archive_id')}
    database.set_setting(PREFIX + stored['day'], restored)
    database.set_setting(TRASH_PREFIX + archive_id, {})
    return restored


def references_account(database, account_id):
    for prefix in (PREFIX, TRASH_PREFIX):
        for row in database.settings_with_prefix(prefix).values():
            if isinstance(row, dict) and any(account_id in card_accounts(card) for card in row.get('trades', [])):
                return True
    return False
