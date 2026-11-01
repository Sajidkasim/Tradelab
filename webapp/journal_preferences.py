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
    return {'timezone': zone if zone in ZONES else 'America/New_York',
            'welcome_pending': stored.get('welcome_pending') is True,
            'personal_setup': stored.get('personal_setup') is True,
            'tour_status': tour_status, 'tour_version': TOUR_VERSION}


def fresh(database):
    # New members already start on this release; the welcome guide introduces it.
    database.set_setting(release_notes.KEY, release_notes.VERSION)
    database.set_setting(edge.PLAYBOOK_KEY, {'strategies': [], 'levels': []})
    settings = deepcopy(lab_settings.DEFAULTS)
    settings['confirmations'] = []
    database.set_setting(lab_settings.KEY, settings)
    database.set_setting(KEY, {'timezone': 'America/New_York', 'welcome_pending': True, 'personal_setup': True, 'tour_status': 'pending', 'tour_version': TOUR_VERSION})
