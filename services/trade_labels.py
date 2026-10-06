"""Non-financial trade organisation and explicit export-label mappings."""
import json
import re
from core import edge

MAPPING_KEY = 'fx_tag_mappings'
FIELDS = {'strategy': 'Strategy', 'level': 'Key level / PDA', 'timeframe': 'Level timeframe',
          'entry_timeframe': 'Entry timeframe', 'confirmation': 'Confirmation',
          'condition': 'Market condition', 'news': 'News'}


def export_tags(value):
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = re.split(r'[;,|]', value)
    if not isinstance(value, (list, tuple)):
        return []
    result = []
    for item in value:
        if isinstance(item, dict):
            item = item.get('name') or item.get('label') or json.dumps(item, sort_keys=True)
        text = str(item).strip()
        if text and text not in result:
            result.append(text)
    return result


def suggested_mapping(tag):
    prefixes = {'strategy': 'strategy', 'model': 'strategy', 'key level': 'level',
                'level tf': 'timeframe', 'entry tf': 'entry_timeframe'}
    if ':' in tag:
        prefix, value = tag.split(':', 1)
        if prefix.strip().casefold() in prefixes and value.strip():
            return {'field': prefixes[prefix.strip().casefold()], 'value': value.strip()}
    if tag in edge.CONFIRMATIONS:
        return {'field': 'confirmation', 'value': tag}
    return {'field': '', 'value': ''}


def mapped_fields(tags, mappings, strategy=''):
    """Only apply approved mappings; never infer absence or mark a trade reviewed."""
    labels = edge.read_labels(tags)
    candidates = {}
    for tag in export_tags(tags):
        rule = mappings.get(tag, {})
        field, value = rule.get('field'), str(rule.get('value', '')).strip()
        if field in FIELDS and value:
            candidates.setdefault(field, set()).add(value)
    issues = []
    for field, values in candidates.items():
        if field == 'confirmation':
            labels['confirmations'] = sorted(set(labels['confirmations']) | values)
        elif len(values) != 1:
            issues.append(f'Conflicting {FIELDS[field].lower()} tags; choose it when reviewing.')
        elif field == 'strategy':
            value = next(iter(values))
            if strategy and strategy != value:
                issues.append('Existing strategy kept; export tag disagrees.')
            else:
                strategy = value
        elif labels[field] == edge.UNKNOWN:
            labels[field] = next(iter(values))
        elif labels[field] != next(iter(values)):
            issues.append(f'Existing {FIELDS[field].lower()} kept; export tag disagrees.')
    reviewed = labels.pop('reviewed')
    # Retain the original export labels as well as the internal structured labels.
    result = edge.write_labels(tags, **labels)
    result = list(dict.fromkeys(export_tags(tags) + result))
    if not reviewed:
        result = [t for t in result if t != 'edge:reviewed']
    return {'setup_name': strategy, 'tags': result}, issues


def needs_tagging(frame):
    return frame['setup_name'].fillna('').str.strip().eq('') | ~frame['tags'].map(lambda t: edge.read_labels(t)['reviewed'])


def review_fields(trade, strategy, labels, notes, confirmed):
    tags = edge.write_labels(trade.tags, **labels)
    if not confirmed:
        tags = [t for t in tags if t != 'edge:reviewed']
    return {'setup_name': strategy.strip(), 'tags': tags, 'notes': notes}


def apply_strategy(db, ids, strategy):
    if not strategy or not strategy.strip():
        raise ValueError('Choose or type a strategy first.')
    # The db is already scoped to the signed-in workspace. Validate before writes.
    trades = [db.get_trade(int(tid)) for tid in dict.fromkeys(ids)]
    if any(t is None for t in trades):
        raise ValueError('One of these trades is no longer available. Refresh the list.')
    for trade in trades:
        db.update_trade(trade.id, setup_name=strategy.strip())
    return len(trades)
