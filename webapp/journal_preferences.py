"""Per-journal clock and first-visit setup. Never changes stored trade times."""
from copy import deepcopy
from core import edge
from . import lab_settings, release_notes

KEY = 'primuslab_journal_preferences'
TOUR_VERSION = 1
ZONES = ('America/New_York', 'Europe/London')


def read(database):
    stored = database.get_setting(KEY, {})
    stored = stored if isinstance(stored, dict) else {}
    zone = stored.get('timezone', 'America/New_York')
    status = stored.get('tour_status')
    tour_status = status if stored.get('tour_version') == TOUR_VERSION and status in ('pending', 'completed', 'skipped') else 'pending'
    raw_loss = stored.get('daily_loss_limit')
    daily_loss_limit = round(float(raw_loss), 2) if isinstance(raw_loss, (int, float)) and not isinstance(raw_loss, bool) and 0 < float(raw_loss) <= 1_000_000 else None
    raw_trades = stored.get('max_daily_trades')
    max_daily_trades = int(raw_trades) if isinstance(raw_trades, int) and not isinstance(raw_trades, bool) and 0 < raw_trades <= 50 else None
    return {'trading_rules': stored.get('trading_rules', '') if isinstance(stored.get('trading_rules', ''), str) else '',
            'timezone': zone if zone in ZONES else 'America/New_York',
            'daily_loss_limit': daily_loss_limit,
            'max_daily_trades': max_daily_trades,
            'welcome_pending': stored.get('welcome_pending') is True,
            'personal_setup': stored.get('personal_setup') is True,
            'tour_status': tour_status, 'tour_version': TOUR_VERSION}


def fresh(database):
    # New members also receive the current update notice after onboarding.
    database.set_setting(edge.PLAYBOOK_KEY, {'strategies': [], 'levels': []})
    settings = deepcopy(lab_settings.DEFAULTS)
    settings['confirmations'] = []
    database.set_setting(lab_settings.KEY, settings)
    database.set_setting(KEY, {'timezone': 'America/New_York', 'welcome_pending': True, 'personal_setup': True, 'tour_status': 'pending', 'tour_version': TOUR_VERSION})
