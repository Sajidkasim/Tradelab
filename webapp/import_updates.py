"""Explicit, previewed label updates. Imported results are never overwritten."""
import hashlib
import json
from datetime import datetime, timezone
import pandas as pd
from sqlalchemy import select
from core import edge
from core.db import trades_t
from core.models import Trade
from services import trade_labels

PROFILE_KEY = 'primuslab_import_profile'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def plan(database, parsed, notes):
    by_id = {}
    ids = list({trade.external_id for trade in parsed})
    with database.engine.connect() as conn:
        for start in range(0, len(ids), 500):
            for row in conn.execute(select(trades_t).where(trades_t.c.external_id.in_(ids[start:start+500]))).mappings():
                by_id[row['external_id']] = dict(row)
    changes, warnings, seen = [], [], set()
    for incoming in parsed:
        old = by_id.get(incoming.external_id)
        if old is None or incoming.external_id in seen:
            continue
        seen.add(incoming.external_id)
        existing = Trade.from_row(old)
        stamp = lambda v: pd.Timestamp(v).tz_localize('UTC') if pd.Timestamp(v).tzinfo is None else pd.Timestamp(v).tz_convert('UTC')
        if (existing.account_id != incoming.account_id or existing.source != incoming.source
                or existing.symbol != incoming.symbol or existing.direction != incoming.direction
                or stamp(existing.entry_time) != stamp(incoming.entry_time)):
            warnings.append('An existing ID belongs to a different account, source or trade. It will be skipped.')
            continue
        labels = edge.read_labels(existing.tags)
        new = edge.read_labels(incoming.tags)
        reviewed = labels.pop('reviewed')
        new.pop('reviewed')
        merged = {key: new[key] if new[key] != edge.UNKNOWN else labels[key] for key in edge.LABEL_KEYS}
        merged['confirmations'] = new['confirmations'] or labels['confirmations']
        strategy = incoming.setup_name.strip() or existing.setup_name
        label_changes = merged != labels or strategy != existing.setup_name
        tags = edge.write_labels(list(dict.fromkeys(existing.tags + incoming.tags)), **merged)
        if label_changes or not reviewed:
            tags = [tag for tag in tags if tag != 'edge:reviewed']
        text = existing.notes or ''
        note = notes.get(incoming.external_id, '').strip()
        if note and note not in text:
            text = (text + '\n\nImported note:\n' + note).strip()
        fields = {'setup_name': strategy, 'tags': tags, 'notes': text}
        if strategy != existing.setup_name or tags != existing.tags or text != (existing.notes or ''):
            changes.append({'id': existing.id, 'external_id': incoming.external_id, 'fields': fields,
                            'before': {key:old[key] for key in ('setup_name','tags','notes')},
                            'preview': {'previous_strategy':existing.setup_name, 'strategy':strategy, 'labels':merged,
                                        'note_added': bool(note and note not in (existing.notes or ''))}})
    return changes, list(dict.fromkeys(warnings))


def apply(database, parsed, changes):
    with database.engine.begin() as conn:
        existing = set(conn.execute(select(trades_t.c.external_id).where(trades_t.c.external_id.is_not(None))).scalars())
        rows, skipped = [], 0
        changed_ids = {item['external_id'] for item in changes}
        for trade in parsed:
            row = database._trade_row(trade)  # Existing core storage path owns financial fields.
            if row['external_id'] in existing:
                if row['external_id'] not in changed_ids:
                    skipped += 1
                else:
                    changed_ids.remove(row['external_id'])
                continue
            existing.add(row['external_id']); rows.append(row)
        if rows:
            conn.execute(trades_t.insert(), rows)
        for item in changes:
            query = trades_t.update().where(trades_t.c.id == item['id'])
            for key, value in item['before'].items():
                query = query.where(trades_t.c[key] == value)
            fields = {**item['fields'], 'tags':json.dumps(item['fields']['tags']),
                      'updated_at':datetime.now(timezone.utc).replace(tzinfo=None)}
            if conn.execute(query.values(**fields)).rowcount != 1:
                raise ValueError('A saved trade changed. Preview the import again before updating labels.')
    return {'inserted':len(rows), 'skipped':skipped, 'updated':len(changes)}
