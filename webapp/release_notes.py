"""Release announcements, acknowledged independently in each private workspace."""
VERSION = '2026-11-05-v1'
KEY = 'primuslab_release_notes_seen'
ITEMS = [
    {'title': 'Journal accounts and equity',
     'text': 'Create Funded, Eval or Personal accounts with a name and starting balance. Assign trades to an account and filter by account. Mark whether you followed your plan and see it on the calendar. The equity curve uses the Strategy Lab chart style, and Weekly Review has been removed.'},
    {'title': 'Backtesting replay and split-screen',
     'text': 'Resuming a session shows a PrimusTrader loading screen. Split-screen uses one drawing toolbar, and Volume starts off until you add it through Indicators. Backtesting is still in beta.'},
    {'title': 'Drawings stay anchored',
     'text': 'Drawings stay anchored when you switch timeframes. The fix uses the existing candles and session boundaries.'},
    {'title': 'Search the Learn glossary',
     'text': 'Find glossary terms by search or category. The “Glossary?” banner shortcut has been removed.'},
    {'title': 'Learn and Market Lab guidance',
     'text': 'Learn has expanded trading foundations, a guided learning trail and explanations next to key terms. Market Lab also explains key terms alongside its results.'},
    {'title': 'Mindset brain explorer',
     'text': 'Explore the interactive 3D brain, read about each region and try exercises based on trading situations. The separate preview image and illustrated guide panels were rolled back. The interactive explorer is still available.'},
]


def read(database):
    return {'version': VERSION, 'date': '5 November 2026', 'seen': database.get_setting(KEY) == VERSION, 'items': ITEMS}
