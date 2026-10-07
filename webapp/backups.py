"""Validate portable backup references before replacing an empty workspace."""
import json

TABLES = {'accounts', 'instruments', 'setups', 'trades', 'settings', 'import_mappings', 'backtest_runs', 'rule_breaches'}


def validate(payload):
    def invalid_number(value):
        raise ValueError('Backup numbers must be finite.')
    try:
        data = json.loads(payload, parse_constant=invalid_number)
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError('Choose a readable PrimusLab JSON backup.') from None
    if not isinstance(data, dict) or not TABLES.issubset(data) or any(not isinstance(data[name], list) or any(not isinstance(row, dict) for row in data[name]) for name in TABLES):
        raise ValueError('This is not a complete PrimusLab backup. No data was changed.')
    if not data['accounts'] or not data['instruments']:
        raise ValueError('The backup needs at least one account and instrument.')
    ids = [row.get('id') for row in data['accounts']]
    if any(not isinstance(value, int) or value <= 0 for value in ids) or len(set(ids)) != len(ids):
        raise ValueError('The backup contains invalid account references.')
    for row in data['trades']:
        if row.get('account_id') is not None and row['account_id'] not in ids:
            raise ValueError('A trade refers to an account missing from this backup.')
        for field in ('tags', 'mistake_tags'):
            value = row.get(field) or '[]'
            try:
                parsed = json.loads(value) if isinstance(value, str) else value
            except json.JSONDecodeError:
                raise ValueError('The backup contains unreadable trade labels.') from None
            if not isinstance(parsed, list) or any(not isinstance(tag, str) for tag in parsed):
                raise ValueError('The backup contains invalid trade labels.')
    return payload
