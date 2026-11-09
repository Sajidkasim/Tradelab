import sqlite3
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
import pytest
from tools.import_economic_calendar import import_rows,normalize,demo_rows,csv_rows,main,release_time

def row(**values):return {'Date':'2024-05-15','Time':'08:30','Currency':'usd','Impact':'Red','Event':'  CPI   m/m ','Actual':' 0.3% ','Forecast':'0.2%','Previous':'-0.1% (R)',**values}

def test_demo_idempotency_and_source_tables_untouched(tmp_path):
    path=tmp_path/'index.db'
    with sqlite3.connect(path) as db:
        db.executescript('CREATE TABLE bars(time,close); INSERT INTO bars VALUES(1,100); CREATE TABLE trades(id,pnl); INSERT INTO trades VALUES(1,42);')
    first,duplicates,_=import_rows(path,demo_rows());second,again,_=import_rows(path,demo_rows())
    assert len(first)==51 and duplicates==0 and second==[] and again==51
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT * FROM bars').fetchall()==[(1,100)]
        assert db.execute('SELECT * FROM trades').fetchall()==[(1,42)]
        assert db.execute('SELECT count(*) FROM economic_events').fetchone()[0]==51
        assert db.execute("SELECT count(*) FROM economic_events WHERE event NOT LIKE '[DEMO] %'").fetchone()[0]==0

def test_timezone_and_strings_preserved():
    event=normalize(row());assert event[1:6]==('2024-05-15','08:30','USD','High','CPI m/m')
    assert event[0]==int(datetime(2024,5,15,12,30,tzinfo=timezone.utc).timestamp()*1000)
    assert event[6:]==('0.3%','0.2%','-0.1% (R)')
    assert normalize(row(Date='2024-01-15'))[0]==int(datetime(2024,1,15,13,30,tzinfo=timezone.utc).timestamp()*1000)
    assert normalize(row(Date='2024-05-16T00:30:00+00:00',Time=''))[1:3]==('2024-05-15','20:30')

@pytest.mark.parametrize('date,time',[('2024-03-10','02:30'),('2024-11-03','01:30')])
def test_ambiguous_or_missing_dst_times_rejected(date,time):
    with pytest.raises(ValueError,match='DST'):normalize(row(Date=date,Time=time))

@pytest.mark.parametrize('impact,level',[('icon--ff-impact-red','High'),('Orange','Medium'),('Low Impact Expected','Low')])
def test_impact_aliases(impact,level):assert normalize(row(Impact=impact))[4]==level

def test_invalid_batch_is_atomic_and_untimed_rows_skip(tmp_path):
    path=tmp_path/'index.db';sqlite3.connect(path).close()
    with pytest.raises(ValueError,match='Row 2'):import_rows(path,[row(),row(Time='nonsense')])
    with sqlite3.connect(path) as db:assert not db.execute("SELECT name FROM sqlite_master WHERE name='economic_events'").fetchone()
    inserted,_,skipped=import_rows(path,[row(),row(Time='All Day'),row(Time='Tentative')]);assert len(inserted)==1 and sum(skipped.values())==2

def test_standard_csv_bom_delimiters_and_cli(tmp_path,capsys):
    path=tmp_path/'index.db';sqlite3.connect(path).close()
    csv=tmp_path/'calendar.csv';csv.write_text('\ufeffDate;Time;Currency;Impact;Event;Actual;Forecast;Previous\n15/05/2024;8:30am;usd;orange;Claims;220K;225K;218K\n',encoding='utf8')
    assert len(csv_rows(csv))==1
    assert main(['--db',str(path),'--csv',str(csv),'--date-order','dmy'])==0
    assert main(['--db',str(path),'--csv',str(csv),'--date-order','dmy'])==0
    assert 'Duplicates ignored: 1' in capsys.readouterr().out

def test_feed_schema_and_epoch_units():
    source={'date':'2024-05-15T08:30:00-04:00','country':'USD','impact':'High','title':'CPI','actual':'0','forecast':'0.1%'}
    value=normalize(source);assert value[6]=='0'
    source['date']=str(value[0]);assert normalize(source)[0]==value[0]
    source['date']=str(value[0]//1000);assert normalize(source)[0]==value[0]

def test_recent_fetch_uses_bounded_public_json_response(monkeypatch):
    from io import BytesIO
    import tools.import_economic_calendar as importer
    seen=[]
    def request(req,timeout):
        seen.append((req.full_url,timeout));return BytesIO(b'[{"date":"2024-05-15T08:30:00-04:00","country":"USD","impact":"High","title":"CPI"}]')
    monkeypatch.setattr(importer,'urlopen',request)
    assert normalize(importer.fetch_recent()[0])[5]=='CPI'
    assert seen==[(importer.FEED,30)]


def test_owner_supplied_2015_preview_releases_are_new_york_dst_normalized():
    events=[normalize(r) for r in demo_rows() if r['Date']=='2015-05-15']
    assert len(events)==3
    assert [r[2] for r in events]==['08:30','09:15','10:00']
    assert [r[4] for r in events]==['Medium','High','High']
    assert [r[6:] for r in events]==[('3.1','5.0','-1.2'),('-0.3%','0.1%','-0.3%'),('88.6','95.8','95.9')]
    assert datetime.fromtimestamp(events[0][0]/1000,timezone.utc).strftime('%H:%M')=='12:30'
