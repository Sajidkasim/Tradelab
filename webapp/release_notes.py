"""Release announcements, acknowledged independently in each private workspace."""
VERSION = '2026-11-01'
KEY = 'primuslab_release_notes_seen'
ITEMS = [
    {'title': 'Your Lab choices become import tags', 'text': 'Strategies, key levels, timeframes and confirmations saved in Lab settings are recognised automatically. Capitals, extra spaces and clear spelling variations are handled for you.'},
    {'title': 'A clearer tag review', 'text': 'Unfamiliar or ambiguous CSV tags open a review popup explaining why. Choose their meaning once, or cancel and keep the preview. Shared timeframe names may need a key level or entry category.'},
    {'title': 'Straight back to Trades', 'text': 'After a successful import, you return to Trades. Duplicate detection still skips trades already saved.'},
    {'title': 'Removed choices have an archive', 'text': 'Removed strategies, key levels and timeframes leave the main dropdowns. Use Show archived to explore old labels, or Restore in Lab settings. Existing trades keep their labels.'},
    {'title': 'A simpler interface', 'text': 'Classic mode has been removed. Light and dark modes remain, and Unclassified / Not recorded are no longer choices in setup dropdowns.'},
    {'title': 'More detail in your Journal', 'text': 'Trade cards include optional key level, key level timeframe, entry timeframe, amount risked and net profit or loss under Setup & result.'},
]

def read(database):
    return {'version': VERSION, 'date': '1 November 2026', 'seen': database.get_setting(KEY) == VERSION, 'items': ITEMS}
