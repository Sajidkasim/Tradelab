"""Explicit full-target/stop backtest models; never rewrite recorded financials.

The owner confirms each model in the tag guide. R observations for the model are
passed to the unchanged core.metrics summary, separately from recorded returns.
"""
import re
import math
from core import edge, metrics
from core.models import BACKTEST_SOURCES

TARGET_PREFIX = 'rr:target:'
FIXED_PREFIX = 'rr:fixed:'


def ratio(value):
    match = re.fullmatch(r'1\s*:\s*(\d+(?:\.\d+)?)', str(value).strip())
    if not match:
        raise ValueError('Use a target RR such as 1:3 or 1:2.')
    reward = float(match[1])
    if not math.isfinite(reward) or not 0 < reward <= 100:
        raise ValueError('Target RR must be greater than zero and at most 1:100.')
    # Stable plain decimal spelling (including 1:3.0 -> 1:3).
    canonical = format(reward, '.10f').rstrip('0').rstrip('.')
    if float(canonical) == 0:
        raise ValueError('Use a target RR with at most ten decimal places.')
    return f'1:{canonical}', reward


def is_internal(tag):
    return tag.startswith((TARGET_PREFIX, FIXED_PREFIX))


def read(tags):
    values = set()
    for tag in edge.tag_list(tags):
        if tag.startswith(TARGET_PREFIX):
            try:
                values.add(ratio(tag[len(TARGET_PREFIX):])[0])
            except ValueError:
                pass
    target = next(iter(values)) if len(values) == 1 else edge.UNKNOWN
    return {'target_rr': target, 'fixed_exit': target != edge.UNKNOWN and FIXED_PREFIX + target in edge.tag_list(tags)}


def write(tags, target, fixed_exit=False):
    target, _ = ratio(target)
    result = [tag for tag in edge.tag_list(tags) if not is_internal(tag)]
    result.append(TARGET_PREFIX + target)
    if fixed_exit:
        result.append(FIXED_PREFIX + target)
    return result


def merge(existing, incoming):
    # A provided target replaces the previous target only on an opted-in update.
    supplied = read(incoming)
    kept = [tag for tag in existing if not is_internal(tag)] if supplied['target_rr'] != edge.UNKNOWN else existing
    return list(dict.fromkeys(kept + incoming))


def summary(frame):
    closed = metrics.closed(frame)
    observations = closed.copy(deep=True).reset_index(drop=True)
    eligible = []
    targets = set()
    tagged = 0
    for _, row in observations.iterrows():
        model = read(row['tags'])
        target = model['target_rr']
        if target != edge.UNKNOWN:
            targets.add(target)
            tagged += 1
        applicable = (model['fixed_exit'] and row['source'] in BACKTEST_SOURCES
                      and row['net_pnl'] != 0)
        eligible.append(applicable)
    observations = observations.loc[eligible].copy() if len(observations) else observations
    for index, row in observations.iterrows():
        _, reward = ratio(read(row['tags'])['target_rr'])
        observations.loc[index, 'r_multiple'] = reward if row['net_pnl'] > 0 else -1.0
    stats = metrics.summary_stats(observations)
    return {'targets': sorted(targets), 'tagged': tagged, 'count': stats['trades'],
            'excluded': len(closed) - stats['trades'],
            'complete': bool(len(closed)) and stats['trades'] == len(closed),
            'avg_r': stats['avg_r'], 'wins': stats['wins'], 'losses': stats['losses']}
