import sqlite3
from datetime import datetime,timezone
from services.replay_chart_history import bucket,aggregate
from webapp.replay_chart_windows import window

def stamp(text):return int(datetime.fromisoformat(text).timestamp()*1000)
def test_new_york_calendar_dst_week_month_and_ohlcv():
    assert bucket(stamp('2023-03-13T22:00:00+00:00'),'1D')==stamp('2023-03-13T22:00:00+00:00')
    assert bucket(stamp('2023-03-06T23:00:00+00:00'),'1D')==stamp('2023-03-06T23:00:00+00:00')
    assert bucket(stamp('2023-09-12T14:00:00+00:00'),'1W')==stamp('2023-09-10T22:00:00+00:00')
    assert bucket(stamp('2023-09-12T14:00:00+00:00'),'1M')==stamp('2023-08-31T22:00:00+00:00')
    a=stamp('2023-09-12T14:00:00+00:00');rows=[(a,10,12,9,11,3),(a+60000,11,15,8,13,7)]
    assert aggregate(rows,'5')==[[a,10,15,8,13,10]]

def test_windows_page_both_ways_no_future_or_fixed_year_cap(tmp_path):
    path=tmp_path/'index.db'
    with sqlite3.connect(path) as db:
        db.executescript('CREATE TABLE active_contracts(day,root,symbol); CREATE TABLE bars(time,symbol,day,open,high,low,close,volume); CREATE TABLE chart_daily_ny(root,time,end,open,high,low,close,volume);')
        for d in ['2010-06-07','2023-09-12']:
            t=stamp(d+'T14:00:00+00:00');db.execute('INSERT INTO active_contracts VALUES(?,?,?)',(d,'NQ','NQM'))
            for i in range(12):db.execute('INSERT INTO bars VALUES(?,?,?,?,?,?,?,?)',(t+i*60000,'NQM',d,10+i,12+i,9+i,11+i,1))
            if d.startswith('2010'):db.execute('INSERT INTO chart_daily_ny VALUES(?,?,?,?,?,?,?,?)',('NQ',bucket(t,'1D'),t+86400000,10,23,9,22,12))
    cutoff=stamp('2023-09-12T14:05:00+00:00')
    first=window(str(path),0,'NQ','1',cutoff+1,cutoff,3)
    assert len(first['bars'])==3 and first['bars'][-1]['time']==cutoff
    older=window(str(path),0,'NQ','1',first['bars'][0]['time'],cutoff,3)
    assert older['bars'][-1]['time']<first['bars'][0]['time']
    newer=window(str(path),0,'NQ','1',cutoff+1,cutoff,3,older['bars'][-1]['time'])
    assert [b['time'] for b in newer['bars']]==[b['time'] for b in first['bars']]
    daily=window(str(path),0,'NQ','1D',cutoff+1,cutoff)
    assert len(daily['bars'])==2 and daily['earliest']==stamp('2010-06-07T14:00:00+00:00')
    assert daily['bars'][-1]['high']==17 # unrevealed 14:06+ highs must not leak
