import sqlite3
from webapp.replay_index import days,load

def test_full_index_selects_prior_volume_and_returns_complete_intraday_context(tmp_path):
    path=tmp_path/'index.db'
    with sqlite3.connect(path) as con:
        con.execute('CREATE TABLE bars(time INTEGER,symbol TEXT,day TEXT,open REAL,high REAL,low REAL,close REAL,volume INTEGER)')
        for day,stamp in [('2020-06-01',1590969600000),('2020-06-02',1591056000000)]:
            for root in ('NQ','ES'):
                con.executemany('INSERT INTO bars VALUES(?,?,?,?,?,?,?,?)',[(stamp+i*60000,root+'M0',day,100,102,99,101,10) for i in range(300)])
        con.execute('CREATE TABLE volumes AS SELECT day,symbol,SUM(volume) volume FROM bars GROUP BY day,symbol')
    assert days(path)==['2020-06-01','2020-06-02']
    data=load(path,'2020-06-02')
    assert len(data['markets']['NQ']['context'])==300
    assert len(data['markets']['NQ']['bars'])==300
    assert data['markets']['ES']['history'][0]['volume']==3000

def test_four_hour_index_contains_full_archive_without_future_bars(tmp_path):
    from tools.index_replay_charts import build
    from webapp.replay_index import four_hour_history
    path=tmp_path/'charts.db'
    with sqlite3.connect(path) as c:
        c.execute('CREATE TABLE bars(time INTEGER,symbol TEXT,day TEXT,open REAL,high REAL,low REAL,close REAL,volume INTEGER)')
        for day,t in [('2010-06-07',1275868800000),('2020-06-02',1591056000000)]:
            for root in ('NQ','ES'):
                c.executemany('INSERT INTO bars VALUES(?,?,?,?,?,?,?,?)',[(t+i*60000,root+'M0',day,100,102,99,101,10) for i in range(480)])
        c.execute('CREATE TABLE volumes AS SELECT day,symbol,SUM(volume) volume FROM bars GROUP BY day,symbol')
    build(path)
    history=four_hour_history(path,'2020-06-02')
    assert len(history['NQ'])==2
    assert history['NQ'][0]['volume']==2400
    assert all(b['time']<1591056000000 for b in history['ES'])
