"""Release announcements, acknowledged independently in each private workspace."""
VERSION = '2026-11-12-v1'
KEY = 'primuslab_release_notes_seen'
ITEMS = [
    {'title': 'Mindset warm-up',
     'text': 'Choose a breathing rhythm and see when to use it. Play 60-second rounds of Pattern Match or Visual Search on Easy or Hard, choose an affirmation, and track your editable pre-session checklist. The Brain Explorer stays visible on the Mindset page.'},
    {'title': 'Chat with Primax',
     'text': 'Open Primax to type or dictate a message. Follow-up questions use the open conversation, and new chats clear when you close it.'},
    {'title': 'Journal accounts and copy-traded entries',
     'text': 'Use Add account to create Funded, Eval or Personal accounts. If you copy-traded a setup, select multiple accounts on one Journal trade and enter the combined P&L and risk. The combined result appears under All accounts.'},
    {'title': 'Journal trade replay',
     'text': 'Import TopstepX or FTMO Trading Journal executions and replay supported markets with your entry and exit markers on 1-minute candles. Replay depends on market coverage and data access. Backtesting is still in beta.'},
    {'title': 'Bullpen screen sharing on Android',
     'text': 'In the Bullpen, choose Install plugin, then Prepare screen sharing and Open plugin for screen share. The plugin joins the same Bullpen call so your team can see the screen you share. Supported desktop browsers can share directly in the embedded call. The Bullpen also warns mobile users that switching apps or locking the screen can pause the microphone.'},
    {'title': 'Strategy Lab settings',
     'text': 'Clicking outside Lab Settings now asks before closing. Delete unused archived choices while keeping saved trade labels, or open Advanced to save your Explore filters. The strategy filter now reads Key level.'},
]


def read(database):
    return {'version': VERSION, 'date': '12 November 2026', 'seen': database.get_setting(KEY) == VERSION, 'items': ITEMS}
