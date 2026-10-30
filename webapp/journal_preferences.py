"""Per-journal clock and first-visit setup. Never changes stored trade times."""
from copy import deepcopy
from core import edge
from . import lab_settings

KEY = 'primuslab_journal_preferences'
ZONES = ('America/New_York', 'Europe/London')


def read(database):
    stored = database.get_setting(KEY, {})
    stored = stored if isinstance(stored, dict) else {}
    zone = stored.get('timezone', 'America/New_York')
    return {'timezone': zone if zone in ZONES else 'America/New_York',
            'welcome_pending': stored.get('welcome_pending') is True,
            'personal_setup': stored.get('personal_setup') is True}


def fresh(database):
    database.set_setting(edge.PLAYBOOK_KEY, {'strategies': [], 'levels': []})
    settings = deepcopy(lab_settings.DEFAULTS)
    settings['confirmations'] = []
    database.set_setting(lab_settings.KEY, settings)
    database.set_setting(KEY, {'timezone': 'America/New_York', 'welcome_pending': True, 'personal_setup': True})
