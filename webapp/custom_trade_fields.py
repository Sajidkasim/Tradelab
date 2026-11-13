"""Workspace field definitions and validation for private trade metadata."""
import re
from uuid import uuid4

from core.edge import tag_list

KEY = 'primuslab_custom_trade_fields'
PREFIX = 'lab:custom-field:'
MAX_FIELDS = 20


def definitions(database):
    return database.get_setting(KEY, [])


def add(database, payload):
    fields = definitions(database)
    name = payload.name.strip()
    options = [option.strip() for option in payload.options]
    if not name or any(not option for option in options):
        raise ValueError('Enter a field name and non-empty options.')
    if len({option.casefold() for option in options}) != len(options):
        raise ValueError('Give each option a different name.')
    if any(field['name'].casefold() == name.casefold() for field in fields):
        raise ValueError('A trade field with that name already exists.')
    if len(fields) >= MAX_FIELDS:
        raise ValueError(f'Keep up to {MAX_FIELDS} custom trade fields.')
    field = {'id': uuid4().hex, 'name': name, 'type': payload.type, 'options': options}
    database.set_setting(KEY, [*fields, field])
    return field


def remove(database, field_id):
    current = definitions(database)
    remaining = [field for field in current if field['id'] != field_id]
    if len(current) == len(remaining):
        return False
    database.set_setting(KEY, remaining)
    return True


def values(tags, metadata=None):
    if isinstance(metadata, dict):
        return metadata
    result = {}
    for tag in tag_list(tags):
        if tag.startswith(PREFIX):
            field_id, separator, value = tag[len(PREFIX):].partition(':')
            if separator and re.fullmatch(r'[a-f0-9]{32}', field_id) and 0 < len(value) <= 80:
                result.setdefault(field_id, []).append(value)
    return result


def merge(existing, database, selected):
    if not selected:
        return existing
    fields = {field['id']: field for field in definitions(database)}
    updated = dict(existing)
    for field_id, choices in selected.items():
        field = fields.get(field_id)
        if field is None:
            raise ValueError('A custom trade field was removed. Reopen the trade and try again.')
        if not set(choices).issubset(field['options']):
            raise ValueError(f"Choose a saved option for {field['name']}.")
        if field['type'] == 'dropdown' and len(set(choices)) > 1:
            raise ValueError(f"Choose one option for {field['name']}.")
        if choices:
            updated[field_id] = list(dict.fromkeys(choices))
        else:
            updated.pop(field_id, None)
    return updated


def filter_frame(frame, database, selected):
    if not selected or frame.empty:
        return frame
    active = {field['id']: set(field['options']) for field in definitions(database)}
    wanted = {field_id: set(options) for field_id, options in selected.items()
              if options and field_id in active}
    if not wanted:
        return frame
    if any(not options.issubset(active[field_id]) for field_id, options in wanted.items()):
        raise ValueError('Choose a saved option for each custom trade field.')

    def matches(recorded):
        return all(options.intersection(recorded.get(field_id, ())) for field_id, options in wanted.items())

    recorded = [values(tags, metadata) for tags, metadata in zip(frame['tags'], frame['custom_metadata'])]
    return frame.loc[[matches(row) for row in recorded]]
