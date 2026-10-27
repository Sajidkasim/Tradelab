"""Non-financial trade organisation and explicit export-label mappings."""
import json
import re
from core import edge

MAPPING_KEY = 'fx_tag_mappings'
FIELDS = {'strategy': 'Strategy', 'level': 'Key level / PDA', 'timeframe': 'Level timeframe',
          'entry_timeframe': 'Entry timeframe', 'confirmation': 'Confirmation',
          'condition': 'Market condition', 'news': 'News'}
ORIGINAL_TAG_PREFIX = 'fx-original:'
# Owner's FX Replay groups, confirmed 27 October 2026. 15M occurs in both
# timeframe groups, so it deliberately has no unqualified suggestion.
FX_TAG_GUIDE = {
    'DISPLACEMENT AT KEY LEVEL': ('strategy', 'Displacement at key level'),
    'REVERSAL AT KEY LEVEL': ('strategy', 'Reversal at key level'),
    'FVG': ('level', 'FVG'),
    'ORDERBLOCK': ('level', 'Order block'),
    'PDL PDH': ('level', 'Previous day high / low'),
    'MSS': ('confirmation', 'MSS'),
    'CISD': ('confirmation', 'CISD'),
    'SMT': ('confirmation', 'SMT'),
    'WEEKLY': ('timeframe', 'Weekly'),
    'MONTHLY': ('timeframe', 'Monthly'),
    '4HR': ('timeframe', '4H'),
    '1HR': ('timeframe', '1H'),
    '1M': ('entry_timeframe', '1m'),
    '15S': ('entry_timeframe', '15s'),
    '5M': ('entry_timeframe', '5m'),
}


def fx_tag_guide():
    return {tag: {'field': field, 'value': value}
            for tag, (field, value) in FX_TAG_GUIDE.items()}


def original_tag(tag):
    return tag[len(ORIGINAL_TAG_PREFIX):] if tag.startswith(ORIGINAL_TAG_PREFIX) else tag


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
    normal = tag.strip().rstrip('\\').strip().upper()
    if normal in FX_TAG_GUIDE:
        field, value = FX_TAG_GUIDE[normal]
        return {'field': field, 'value': value}
    known = {
        'CONTINUATION': [{'field': 'strategy', 'value': 'Continuation'}],
        'HTF LEVEL 1HR FVG': [{'field': 'level', 'value': 'FVG'}, {'field': 'timeframe', 'value': '1H'}],
        'CISD FVG': [{'field': 'confirmation', 'value': 'CISD'}, {'field': 'confirmation', 'value': 'FVG'}],
    }
    if normal in known:
        return {'rules': known[normal]}
    prefixes = {'strategy': 'strategy', 'strat': 'strategy', 'model': 'strategy',
                'key level': 'level', 'confluence': 'confirmation',
                'level tf': 'timeframe', 'key level timeframe': 'timeframe',
                'key level time frame': 'timeframe', 'entry tf': 'entry_timeframe',
                'entry timeframe': 'entry_timeframe', 'entry time frame': 'entry_timeframe'}
    if ':' in tag:
        prefix, value = tag.split(':', 1)
        if prefix.strip().casefold() in prefixes and value.strip():
            field = prefixes[prefix.strip().casefold()]
            value = value.strip()
            if field in ('timeframe', 'entry_timeframe'):
                value = {'MONTHLY': 'Monthly', 'WEEKLY': 'Weekly', 'DAILY': 'Daily',
                         '4HR': '4H', '1HR': '1H', '15M': '15m', '5M': '5m',
                         '1M': '1m', '15S': '15s', '5S': '5s'}.get(value.upper(), value)
            return {'field': field, 'value': value}
    if tag in edge.CONFIRMATIONS:
        return {'field': 'confirmation', 'value': tag}
    return {'field': '', 'value': ''}


def mapping_rules(entry):
    if isinstance(entry, dict) and entry.get('ignore') is True:
        return []
    return entry.get('rules', [entry]) if isinstance(entry, dict) else []


def mapped_values(mappings, field):
    return list(dict.fromkeys(rule['value'] for entry in mappings.values()
                             for rule in mapping_rules(entry)
                             if rule.get('field') == field and rule.get('value')))


def validate_mappings(payload):
    if not isinstance(payload, dict) or len(payload) > 200:
        raise ValueError('Choose up to 200 tag mappings.')
    for tag, entry in payload.items():
        if not isinstance(tag, str) or not tag.strip() or len(tag) > 200 or not isinstance(entry, dict):
            raise ValueError('Each CSV tag needs a name of up to 200 characters.')
        if 'ignore' in entry:
            if entry != {'ignore': True}:
                raise ValueError('Keep original tag only cannot include field rules.')
            continue
        rules = mapping_rules(entry)
        if not isinstance(tag, str) or len(tag) > 200 or not isinstance(rules, list) or not 1 <= len(rules) <= 8:
            raise ValueError('Each tag needs between 1 and 8 field rules.')
        for rule in rules:
            if not isinstance(rule, dict) or rule.get('field') not in FIELDS or not isinstance(rule.get('value'), str) or not 0 < len(rule['value'].strip()) <= 120:
                raise ValueError('Each tag rule needs a field and a short value.')
    return payload


def mapped_fields(tags, mappings, strategy=''):
    """Only apply approved mappings; never infer absence or mark a trade reviewed."""
    raw_tags = list(dict.fromkeys(original_tag(tag) for tag in export_tags(tags)))
    # A legacy bare FVG is otherwise treated as an entry confirmation by core.
    # An explicit owner mapping to a key level must take precedence. Preserve
    # that original wording in an audit tag which core does not interpret.
    non_confirmation = {
        tag for tag in raw_tags
        if (mappings.get(tag, {}).get('ignore') is True or (
            any(rule.get('field') in FIELDS for rule in mapping_rules(mappings.get(tag, {})))
            and not any(rule.get('field') == 'confirmation' for rule in mapping_rules(mappings.get(tag, {})))))
        and tag.casefold() in {value.casefold() for value in edge.CONFIRMATIONS}
    }
    retained = [ORIGINAL_TAG_PREFIX + tag if tag in non_confirmation else tag for tag in raw_tags]
    labels = edge.read_labels(retained)
    candidates = {}
    for tag in raw_tags:
        entry = mappings.get(tag, {})
        for rule in mapping_rules(entry):
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
    result = edge.write_labels(retained, **labels)
    result = list(dict.fromkeys(retained + result))
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
