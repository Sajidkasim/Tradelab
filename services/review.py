"""Explain missing journal inputs. The existing database owns R calculation."""
import math
from core import edge

UNAVAILABLE = 'lab:risk-unavailable'


def missing(row):
    labels = row.get('labels') or edge.read_labels(row.get('tags'))
    issues = []
    if not str(row.get('setup_name') or '').strip() or row.get('setup_name') == 'Unclassified':
        issues.append({'field': 'strategy', 'label': 'Missing strategy'})
    if not labels.get('reviewed'):
        issues.append({'field': 'confirmations', 'label': 'Check confirmations'})
    value = row.get('r_multiple')
    absent = value is None or (isinstance(value, float) and not math.isfinite(value))
    unavailable = UNAVAILABLE in edge.tag_list(row.get('tags'))
    if absent and row.get('exit_price') is not None and row.get('net_pnl') is not None and not unavailable:
        issues.append({'field': 'risk', 'label': 'Original risk missing'})
    return {'review_issues': issues, 'risk_unavailable': unavailable, 'needs_review': bool(issues)}


def risk_fields(trade, risk_amount, unavailable):
    if risk_amount is not None:
        if trade.stop_price is not None:
            raise ValueError('Original risk is already calculated from this trade’s stop. Keep that price-based risk.')
        if trade.net_pnl is None or trade.exit_price is None:
            raise ValueError('Add original risk only to a closed trade with a recorded result.')
        # Database.update_trade uses the existing tested financial calculation.
        return {'initial_risk': risk_amount}
    if unavailable and trade.r_multiple is not None:
        raise ValueError('This trade already has recorded R. Keep its recorded risk.')
    return {}
