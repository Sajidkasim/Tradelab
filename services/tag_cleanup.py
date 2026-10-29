"""Previewed vocabulary merges. Financial columns are never updated here."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json

from sqlalchemy import select, bindparam
from core import edge
from core.db import trades_t, settings_t
from core.models import Trade
from . import trade_labels, strategy_catalog

KEY = 'primuslab_label_aliases'
FIELDS = {key: label for key, label in trade_labels.FIELDS.items()
          if key not in ('target_rr', 'weekday')}
LIST_FIELDS = {'strategy': 'strategies', 'level': 'levels', 'confirmation': 'confirmations',
               'timeframe': 'level_timeframes', 'entry_timeframe': 'entry_timeframes',
               'news': 'news', 'condition': 'conditions'}


def canonical(value, field, aliases):
    seen = set()
    while value.casefold() in aliases.get(field, {}) and value.casefold() not in seen:
        seen.add(value.casefold())
        value = aliases[field][value.casefold()]
    return value


def names(values, field, aliases):
    return list(dict.fromkeys(canonical(value, field, aliases) for value in values))


def labels(value, aliases):
    result = dict(value)
    for key in edge.LABEL_KEYS:
        result[key] = canonical(result.get(key, edge.UNKNOWN), key, aliases)
    result['confirmations'] = names(result.get('confirmations', []), 'confirmation', aliases)
    return result


def trade_fields(trade, aliases):
    old = edge.read_labels(trade.tags)
    new = labels(old, aliases)
    fields = {'setup_name': canonical(trade.setup_name, 'strategy', aliases)}
    if new != old:
        reviewed = new.pop('reviewed')
        original = edge.tag_list(trade.tags)
        tags = edge.write_labels(original, **new)
        # Preserve legacy export spelling for audit without reactivating it.
        kept = {tag.casefold() for tag in edge.CONFIRMATIONS}
        tags += [trade_labels.ORIGINAL_TAG_PREFIX + tag for tag in original
                 if tag.casefold() in kept and trade_labels.ORIGINAL_TAG_PREFIX + tag not in tags]
        fields['tags'] = tags if reviewed else [tag for tag in tags if tag != 'edge:reviewed']
    else:
        fields['tags'] = trade.tags
    return fields


def mapping_values(mappings, aliases):
    mappings = deepcopy(mappings)
    for entry in mappings.values():
        for rule in trade_labels.mapping_rules(entry):
            if rule.get('field') in FIELDS:
                rule['value'] = canonical(rule['value'], rule['field'], aliases)
    return mappings


def options(database, frame):
    from webapp import lab_settings
    mappings = database.get_setting(trade_labels.MAPPING_KEY, {})
    book = strategy_catalog.read(database, frame, mappings)
    lab = {**lab_settings.read(database), **lab_settings.choices(database, frame, mappings)}
    result = {key: list(book.get(LIST_FIELDS[key], lab.get(LIST_FIELDS[key], []))) for key in FIELDS}
    for row in frame.to_dict('records'):
        result['strategy'].append(row.get('setup_name') or '')
        value = edge.read_labels(row['tags'])
        for key in edge.LABEL_KEYS:
            result[key].append(value[key])
        result['confirmation'].extend(value['confirmations'])
    aliases = database.get_setting(KEY, {})
    for key in result:
        result[key] = list(dict.fromkeys(value for value in result[key] if value and value != edge.UNKNOWN))
        result[key] = names(result[key], key, aliases)
    duplicates = []
    for field, values in result.items():
        groups = {}
        for value in values:
            groups.setdefault(value.casefold(), []).append(value)
        duplicates.extend({'field': field, 'values': group} for group in groups.values() if len(group) > 1)
    return {'fields': FIELDS, 'choices': result, 'duplicates': duplicates}


def fingerprint(database, frame):
    history = frame[['id', 'setup_name', 'tags', 'updated_at']].to_dict('records') if not frame.empty else []
    payload = {'trades': history, 'settings': database.settings_with_prefix('')}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def plan(database, frame, field, source, target):
    from webapp import lab_settings
    from . import research
    source, target = source.strip(), target.strip()
    if field not in FIELDS or source not in options(database, frame)['choices'][field]:
        raise ValueError('Choose an existing label from your journal.')
    if not target or len(target) > 120 or target == edge.UNKNOWN or target.startswith(('Any ', 'All ')):
        raise ValueError('Choose a clear replacement label of up to 120 characters.')
    if source == target:
        raise ValueError('Choose a different spelling or label to combine into.')
    aliases = deepcopy(database.get_setting(KEY, {}))
    if source.casefold() != target.casefold():
        target = canonical(target, field, aliases)
    aliases.setdefault(field, {})[source.casefold()] = target
    changes = []
    for row in frame.to_dict('records'):
        trade = Trade.from_row(row)
        fields = trade_fields(trade, aliases)
        if fields['setup_name'] != trade.setup_name or fields['tags'] != trade.tags:
            changes.append({'id': trade.id, **fields})
    settings = {KEY: aliases}
    book = database.get_setting(edge.PLAYBOOK_KEY) or edge.playbook(None)
    for key, category in (('strategies', 'strategy'), ('levels', 'level'), ('hidden_strategies', 'strategy')):
        if key in book:
            book[key] = names(book[key], category, aliases)
    if field == 'strategy':
        book['hidden_strategies'] = [value for value in book.get('hidden_strategies', []) if value != target]
    settings[edge.PLAYBOOK_KEY] = book
    lab = database.get_setting(lab_settings.KEY) or lab_settings.read(database)
    for category, key in LIST_FIELDS.items():
        if key in lab:
            lab[key] = names(lab[key], category, aliases)
        if key in lab.get('hidden_choices', {}):
            lab['hidden_choices'][key] = names(lab['hidden_choices'][key], category, aliases)
            if field == category:
                lab['hidden_choices'][key] = [value for value in lab['hidden_choices'][key] if value != target]
    settings[lab_settings.KEY] = lab
    settings[trade_labels.MAPPING_KEY] = mapping_values(database.get_setting(trade_labels.MAPPING_KEY, {}), aliases)
    studies = research.read(database)
    for item in studies['studies']:
        item['strategy'] = canonical(item.get('strategy', ''), 'strategy', aliases)
    for item in studies['saved_setups']:
        filters = item['filters']
        for key in ('strategy', 'level', 'timeframe', 'entry_timeframe', 'news', 'condition'):
            if key in filters:
                filters[key] = canonical(filters[key], key, aliases)
        filters['confirmations'] = names(filters.get('confirmations', []), 'confirmation', aliases)
    settings[research.KEY] = studies
    return {'field': field, 'source': source, 'target': target, 'count': len(changes),
            'changes': changes, 'settings': settings, 'fingerprint': fingerprint(database, frame)}


def write_changes(database, changes, settings):
    """One transaction, explicitly limited to labels/settings and timestamps."""
    with database.engine.begin() as connection:
        batches = {}
        for change in changes:
            fields = {key: change[key] for key in ('setup_name', 'tags') if key in change}
            if 'tags' in fields:
                fields['tags'] = json.dumps(fields['tags'])
            fields['updated_at'] = datetime.now(timezone.utc).replace(tzinfo=None)
            keys = tuple(sorted(fields))
            batches.setdefault(keys, []).append({'target_id': change['id'], **{'v_'+key: value for key, value in fields.items()}})
        for keys, rows in batches.items():
            query = trades_t.update().where(trades_t.c.id == bindparam('target_id')).values(
                **{key: bindparam('v_'+key) for key in keys})
            connection.execute(query, rows)
        for key, value in settings.items():
            encoded = json.dumps(value)
            exists = connection.execute(select(settings_t.c.key).where(settings_t.c.key == key)).scalar_one_or_none()
            if exists is None:
                connection.execute(settings_t.insert().values(key=key, value=encoded))
            else:
                connection.execute(settings_t.update().where(settings_t.c.key == key).values(value=encoded))
