"""Release announcements, acknowledged independently in each private workspace."""
VERSION = '2026-11-03-v2'
KEY = 'primuslab_release_notes_seen'
ITEMS = [
    {'title':'Your trade notes are protected','text':'Closing Add trade now asks before discarding unsaved notes or inputs. Cancel the prompt to keep editing.'},
    {'title':'Journal setup grades','text':'Grade each Journal trade A+, A or B. These personal grades stay separate from Strategy Lab labels.'},
    {'title':'Your day at a glance','text':'Journal calendar dots show green for profit, red for loss and blue for break-even, using the total recorded P&L. Missing results leave the day uncoloured.'},
    {'title':'More control over your charts','text':'Set a maximum indicator timeframe, save reusable drawing favorites and optionally sync intervals across split charts.'},
    {'title':'Backtesting is still in beta','text':'Backtesting is still in beta. Chart availability is limited while we improve replay. Use Give feedback on Backtesting to send suggestions or report issues directly to Sajid.'},
]

def read(database):
    return {'version': VERSION, 'date': '3 November 2026', 'seen': database.get_setting(KEY) == VERSION, 'items': ITEMS}
