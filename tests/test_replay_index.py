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
    from tools.index_replay_ny import build as build_ny
    build_ny(path)
    history=four_hour_history(path,'2020-06-02')
    assert len(history['NQ'])==3
    assert sum(b['volume'] for b in history['NQ'])==4800
    assert all(b['time']<1591056000000 for b in history['ES'])

def test_index_connections_apply_tuning_and_release_handles(tmp_path):
    import pytest
    from webapp.replay_index import index_connection
    path=tmp_path/'tuned.db'
    with index_connection(path) as con:
        assert con.execute('PRAGMA journal_mode').fetchone()[0]=='wal'
        assert con.execute('PRAGMA synchronous').fetchone()[0]==1
        assert con.execute('PRAGMA cache_size').fetchone()[0]==-64000
        con.execute('CREATE TABLE prices(value INTEGER)')
    with pytest.raises(sqlite3.ProgrammingError):con.execute('SELECT 1')
    # Non-persistent connection settings must be reapplied on the next open.
    with index_connection(path) as writer,index_connection(path) as reader:
        assert reader.execute('PRAGMA synchronous').fetchone()[0]==1
        assert reader.execute('PRAGMA cache_size').fetchone()[0]==-64000
        writer.execute('BEGIN IMMEDIATE')
        writer.execute('INSERT INTO prices VALUES(1)')
        assert reader.execute('SELECT count(*) FROM prices').fetchone()[0]==0
        writer.commit()
        assert reader.execute('SELECT count(*) FROM prices').fetchone()[0]==1

def test_economic_events_schema_index_date_filter_and_order(tmp_path):
    from webapp.replay_index import ensure_economic_events,economic_events
    path=tmp_path/'news.db';ensure_economic_events(path);ensure_economic_events(path)
    with sqlite3.connect(path) as db:
        db.executemany('INSERT INTO economic_events(timestamp_utc,date_ny,time_ny,currency,impact,event) VALUES(?,?,?,?,?,?)',[(200,'2026-07-06','14:00','USD','High','FOMC'),(100,'2026-07-06','08:30','USD','High','CPI'),(300,'2026-07-07','08:30','GBP','Medium','Employment')])
        assert db.execute("SELECT name FROM sqlite_master WHERE name='idx_news_date'").fetchone()
    assert [e['event'] for e in economic_events(path,'2026-07-06')]==['CPI','FOMC']
    assert economic_events(path,'2026-07-08')==[]
    assert economic_events(tmp_path/'missing.db','2026-07-06')==[]
