"""Release announcements, acknowledged independently in each private workspace."""
VERSION = '2026-11-13-v1'
KEY = 'primuslab_release_notes_seen'
ITEMS = [
    {'title': 'More markets to backtest',
     'text': 'Replay EUR/USD, GBP/USD and Gold (XAU/USD) alongside Nasdaq (NQ) and S&P 500 (ES). Pick a historical date and practise your entries, exits and risk management as the candles unfold. Backtesting is in beta.'},
    {'title': 'Primax is your AI trading assistant',
     'text': 'Open the floating Primax orb to talk through a setup, sharpen an entry rule or reflect on a Journal entry. Try asking, “Help me define exactly what I need to see before my first trade today.”'},
    {'title': 'Aura tracks your trading habits',
     'text': 'The three rings show your daily progress across Prepare, Execute and Study. Tap them to see which activities counted and what’s left. Your 1% Daily Edge measures how consistently you follow your routine. Trade wins and losses do not affect it.'},
    {'title': 'Pre-Market Warm-Up is in Mindset',
     'text': 'Take about five minutes before the bell. Choose a breathing rhythm, play a one-minute focus game or read an affirmation. Jump straight into any exercise. Your Journal shows the status of that day’s pre-session checklist.'},
    {'title': 'More server capacity for replay',
     'text': 'The 1 CPU and 2 GB RAM compute upgrade gives PrimusTrader more headroom for simultaneous backtests. We’re watching how replay holds up during longer sessions.'},
]


def read(database):
    return {'version': VERSION, 'date': '13 November 2026', 'seen': database.get_setting(KEY) == VERSION, 'items': ITEMS}
