"""Resolve CSV vocabulary from the user's Lab, without changing financial data.

Saved overrides win. Unqualified names must identify exactly one field/value.
Fuzzy matching is deliberately limited to small, unambiguous word typos; numbers
never change, and short acronyms allow only four-letter transpositions. Original
CSV tags remain untouched.
"""
import re
import unicodedata
from . import trade_labels

PREFIXES = {
    'strategy': ('Strategy', 'Strat', 'Model'),
    'level': ('Key level', 'Level', 'PDA', 'Key level / PDA'),
    'timeframe': ('Key level timeframe', 'Key level time frame', 'Level timeframe', 'Level TF', 'Key level TF'),
    'entry_timeframe': ('Entry timeframe', 'Entry time frame', 'Entry TF'),
    'confirmation': ('Confirmation', 'Confirmations', 'Confluence'),
    'news': ('News',), 'condition': ('Market condition', 'Condition'),
    'weekday': ('Day', 'Weekday'), 'target_rr': ('Target RR', 'RR'),
}


def normal(value):
    text = unicodedata.normalize('NFKC', str(value)).casefold()
    # Time units are explicit: 1 HR = 1H, 15 minutes = 15m, never 1m = 1H.
    text = re.sub(r'(\d)\s*(hours?|hrs?)\b', r'\1h', text)
    text = re.sub(r'(\d)\s*(minutes?|mins?)\b', r'\1m', text)
    text = re.sub(r'(\d)\s*(seconds?|secs?)\b', r'\1s', text)
    text = re.sub(r'\s+', '', text)
    text = re.sub(r'(?<=\d)\.(?=\d)', 'decimal', text)
    text = re.sub(r'(?<=\d):(?=\d)', 'ratio', text)
    return ''.join(c for c in text if c.isalnum())


def identity(entry):
    if entry.get('ignore'):
        return ('ignore',)
    return tuple(sorted((r.get('field'), r.get('value'), bool(r.get('full_exit')))
                        for r in trade_labels.mapping_rules(entry)))


def unique(entries):
    values = {identity(entry): entry for entry in entries}
    return next(iter(values.values())) if len(values) == 1 else None


def distance(a, b):
    """Small edit distance including adjacent transpositions (common typing error)."""
    rows = [list(range(len(b) + 1))]
    for i, x in enumerate(a, 1):
        row = [i]
        for j, y in enumerate(b, 1):
            cost = min(row[j-1]+1, rows[-1][j]+1, rows[-1][j-1]+(x != y))
            if i > 1 and j > 1 and x == b[j-2] and a[i-2] == y:
                cost = min(cost, rows[-2][j-2]+1)
            row.append(cost)
        rows.append(row)
    return rows[-1][-1]


def near(a, b):
    if re.findall(r'\d+', a) != re.findall(r'\d+', b):
        return False
    if min(len(a), len(b)) == 4 and len(a) == len(b):
        # A transposed four-letter acronym is safe only when the catalogue
        # resolves it uniquely; substitutions such as MSS/SMT stay distinct.
        return any(a[:i] + a[i+1] + a[i] + a[i+2:] == b for i in range(3))
    limit = 1 if len(a) < 10 else 2
    return (min(len(a), len(b)) >= 5 and abs(len(a)-len(b)) <= limit
            and distance(a, b) <= limit)


class Catalog:
    def __init__(self, vocabulary, overrides):
        self.overrides = overrides
        self.vocabulary = vocabulary
        self.index = {}
        self.automatic = {}
        for field, names in vocabulary.items():
            for value in names:
                entry = {'field': field, 'value': value}
                for tag in [value] + [f'{prefix}: {value}' for prefix in PREFIXES[field]]:
                    self.index.setdefault(normal(tag), []).append(entry)
                    self.automatic[tag] = entry
        self.automatic = {tag: entry for tag, entry in self.automatic.items()
                          if unique(self.index[normal(tag)]) is not None}
        self.saved = {}
        for tag, entry in overrides.items():
            self.saved.setdefault(normal(tag), []).append(entry)

    def resolve(self, tag, allow_typo=True):
        if not tag or len(tag) > 200:
            return None, 'unknown'
        key = normal(tag)
        if tag in self.overrides:
            return self.overrides[tag], 'saved'
        if key in self.saved:
            entry = unique(self.saved[key])
            return entry, 'saved' if entry else 'ambiguous'
        if key in self.index:
            entry = unique(self.index[key])
            return entry, 'automatic' if entry else 'ambiguous'
        # A qualified tag carries its own category, including future strategies.
        if ':' in tag:
            prefix, value = tag.split(':', 1)
            fields = {field for field, prefixes in PREFIXES.items()
                      if any(normal(prefix) == normal(p) for p in prefixes)}
            if not fields and allow_typo:
                fields = {field for field, prefixes in PREFIXES.items()
                          if any(near(normal(prefix), normal(p)) for p in prefixes)}
            if len(fields) == 1 and value.strip():
                field = next(iter(fields))
                matches = [name for name in self.vocabulary.get(field, []) if normal(name) == normal(value)]
                if not matches and allow_typo:
                    matches = [name for name in self.vocabulary.get(field, []) if near(normal(value), normal(name))]
                if len({normal(name) for name in matches}) == 1:
                    return {'field': field, 'value': matches[0]}, 'automatic'
                if matches:
                    return None, 'ambiguous'
                suggestion = trade_labels.suggested_mapping(f'{PREFIXES[field][0]}: {value.strip()}') if field != 'target_rr' else {}
                if suggestion.get('field') and len(suggestion['value']) <= 120:
                    return suggestion, 'automatic'
        # New RR meanings retain their separate explicit approval workflow.
        # Never infer full-target/stop agreement or fuzzy-match numeric targets.
        if not allow_typo:
            return None, 'unknown'
        matches = [entry for candidate, entries in {**self.index, **self.saved}.items()
                   if near(key, candidate) for entry in entries]
        entry = unique(matches)
        if entry and not entry.get('ignore') and all(r.get('field') != 'target_rr' for r in trade_labels.mapping_rules(entry)):
            return entry, 'spelling'
        return None, 'ambiguous' if matches else 'unknown'

    def resolve_all(self, tags):
        mappings, recognised, unresolved = {}, [], []
        typo_candidates = 0
        for tag in tags:
            entry, status = self.resolve(tag, allow_typo=typo_candidates < 200)
            if normal(tag) not in self.index and normal(tag) not in self.saved:
                typo_candidates += 1
            if entry is None:
                unresolved.append(tag)
            else:
                mappings[tag] = entry
                recognised.append({'tag': tag, 'meaning': entry, 'match': status})
        return mappings, recognised, unresolved

    def explain(self, tag):
        entries = self.saved.get(normal(tag), self.index.get(normal(tag), []))
        choices = list({identity(entry):entry for entry in entries}.values())
        return {'tag':tag, 'reason':'ambiguous' if len(choices) > 1 else 'unfamiliar',
                'choices':choices[:8] if len(choices) > 1 else []}


def for_database(database, frame=None):
    # Same effective lists as Explore/Add trade, including hidden-choice rules.
    from core import edge
    from services import strategy_catalog, tag_cleanup, weekdays
    from webapp import lab_settings
    if frame is None:
        frame = database.trades_df()
    mappings = database.get_setting(trade_labels.MAPPING_KEY, {})
    book = strategy_catalog.read(database, frame, mappings)
    lab = {**lab_settings.read(database), **lab_settings.choices(database, frame, mappings)}
    aliases = database.get_setting(tag_cleanup.KEY, {})
    vocabulary = {field: tag_cleanup.names(book.get(name, lab.get(name, [])), field, aliases)
                  for field, name in tag_cleanup.LIST_FIELDS.items()}
    vocabulary['weekday'] = list(weekdays.DAYS)
    vocabulary['target_rr'] = trade_labels.mapped_values(mappings, 'target_rr')
    def distinct(names):
        result = {}
        for name in names:
            if name and name != edge.UNKNOWN:
                result.setdefault(normal(name), name)
        return list(result.values())
    vocabulary = {field: distinct(names) for field, names in vocabulary.items()}
    return Catalog(vocabulary, tag_cleanup.mapping_values(mappings, aliases))
