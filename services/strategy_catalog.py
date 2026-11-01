"""One editable strategy list for the laboratory, imports and trade entry.

Removed choices stay hidden even if old trades or import aliases still use
them. This changes vocabulary settings only, never saved trades or formulas.
"""
from core import edge
from . import trade_labels


def real_choice(value):
    return isinstance(value, str) and bool(value.strip()) and value.strip().casefold() not in ('not recorded', 'unclassified')


def read(database, frame, mappings=None):
    stored = database.get_setting(edge.PLAYBOOK_KEY)
    book = edge.playbook(stored)
    hidden = stored.get('hidden_strategies', []) if isinstance(stored, dict) else []
    hidden = {name for name in hidden if isinstance(name, str)} if isinstance(hidden, list) else set()
    mappings = database.get_setting(trade_labels.MAPPING_KEY, {}) if mappings is None else mappings
    used = sorted(set(frame['setup_name'].dropna()) - {''}) if not frame.empty else []
    candidates = (book['strategies'] + [setup.name for setup in database.setups()]
                  + used + trade_labels.mapped_values(mappings, 'strategy'))
    book['strategies'] = list(dict.fromkeys(name for name in candidates if real_choice(name) and name not in hidden))
    book['levels'] = [name for name in book['levels'] if real_choice(name)]
    return book


def archived(database, frame):
    stored = database.get_setting(edge.PLAYBOOK_KEY, {}) or {}
    active = read(database, frame)
    used_levels = [edge.read_labels(tags)['level'] for tags in frame['tags']] if not frame.empty else []
    return {'strategies':sorted({v for v in stored.get('hidden_strategies', []) if real_choice(v)} - set(active['strategies'])),
            'levels':sorted({v for v in stored.get('hidden_levels', []) + used_levels if real_choice(v)} - set(active['levels']))}


def save(database, frame, payload):
    current = read(database, frame)
    stored = database.get_setting(edge.PLAYBOOK_KEY)
    previous = stored.get('hidden_strategies', []) if isinstance(stored, dict) else []
    hidden = {name for name in previous if isinstance(name, str)} if isinstance(previous, list) else set()
    book = edge.playbook(payload)
    book = {key:[value for value in values if real_choice(value)] for key,values in book.items()}
    hidden.update(set(current['strategies']) - set(book['strategies']))
    hidden.difference_update(book['strategies'])
    levels = set(archived(database, frame)['levels']) | (set(current['levels']) - set(book['levels']))
    database.set_setting(edge.PLAYBOOK_KEY, {**book, 'hidden_strategies': sorted(hidden),
                                          'hidden_levels':sorted(levels - set(book['levels']))})
    return book
