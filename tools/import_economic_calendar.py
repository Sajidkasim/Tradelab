"""Import calendar metadata only. Never changes source candles or saved trades.

CSV timestamps without offsets use --timezone (default America/New_York).
Demo records are explicitly synthetic and labelled [DEMO] in the drawer.
"""
import argparse
import csv
import io
import json
import re
import random
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from webapp.replay_index import NEWS_SCHEMA, index_connection

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
FIELDS = ('timestamp_utc', 'date_ny', 'time_ny', 'currency', 'impact', 'event', 'actual', 'forecast', 'previous')

class UntimedEvent(ValueError):
    pass

def clean(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()

def release_time(value, clock, zone, date_order):
    value, clock = clean(value), clean(clock)
    if clock.lower() in ('all day', 'tentative', 'tba', 'n/a') or clock.lower().startswith('day '):
        raise UntimedEvent('untimed release')
    if re.fullmatch(r'-?\d{10,13}(?:\.\d+)?', value):
        number = Decimal(value)
        return datetime.fromtimestamp(float(number / (1000 if abs(number) >= 100000000000 else 1)), timezone.utc)
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if 'T' not in value and ' ' not in value and not clock:
            raise UntimedEvent('date has no release time')
        if clock:raise ValueError('separate time')
    except UntimedEvent:
        raise
    except ValueError:
        formats = ['%Y-%m-%d', '%Y.%m.%d', '%Y/%m/%d', '%b %d, %Y', '%B %d, %Y', '%d %b %Y', '%b %d %Y', '%d/%m/%Y' if date_order == 'dmy' else '%m/%d/%Y', '%d-%m-%Y' if date_order == 'dmy' else '%m-%d-%Y']
        day = None
        for fmt in formats:
            try:day = datetime.strptime(value, fmt);break
            except ValueError:pass
        if day is None:raise ValueError(f'unsupported date {value!r}; use a complete date or ISO timestamp')
        if not clock:raise UntimedEvent('date has no release time')
        for fmt in ('%H:%M', '%H:%M:%S', '%I:%M%p', '%I:%M %p', '%I%p'):
            try:time = datetime.strptime(clock.upper(), fmt);break
            except ValueError:time = None
        if time is None:raise ValueError(f'unsupported release time {clock!r}')
        parsed = day.replace(hour=time.hour, minute=time.minute, second=time.second)
    if parsed.tzinfo is not None:return parsed.astimezone(timezone.utc)
    choices = []
    for fold in (0, 1):
        candidate = parsed.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
        if candidate.astimezone(zone).replace(tzinfo=None) == parsed and candidate not in choices:choices.append(candidate)
    if len(choices) != 1:raise ValueError('ambiguous or nonexistent DST time; provide an ISO timestamp with an explicit UTC offset')
    return choices[0]

def normalize(row, zone=NY, date_order='mdy'):
    row = {re.sub(r'[^a-z0-9]', '', str(key).lower()): value for key, value in row.items() if key is not None}
    def get(*keys):return next((row[key] for key in keys if key in row and row[key] is not None and str(row[key]).strip()), '')
    impact = clean(get('impact', 'importance', 'volatility')).lower()
    if impact in ('holiday', 'non-economic', 'none'):raise UntimedEvent('non-economic event')
    level = next((value for names, value in [(('high', 'red', '3', '🔴'), 'High'), (('medium', 'orange', '2', '🟠'), 'Medium'), (('low', 'yellow', '1', '🟡'), 'Low')] if any(re.search(r'(?<![a-z0-9])'+re.escape(name)+r'(?![a-z0-9])',impact) for name in names)), None)
    if level is None:raise ValueError(f'unknown impact {impact!r}')
    currency = clean(get('currency', 'country')).upper()
    if not re.fullmatch('[A-Z]{3}', currency):raise ValueError('currency must be a three-letter code')
    event = clean(get('event', 'title', 'name'))
    if not event:raise ValueError('event title is empty')
    stamp = release_time(get('timestamputc', 'timestamp', 'datetime', 'date'), get('time'), zone, date_order)
    local = stamp.astimezone(NY)
    return (int(stamp.timestamp()*1000), local.strftime('%Y-%m-%d'), local.strftime('%H:%M'), currency, level, event,
            *(str(get(key)).strip() or None for key in ('actual', 'forecast', 'previous')))

def demo_rows():
    events = [('08:30','USD','High','CPI m/m','0.3%','0.2%','0.1%'), ('14:00','USD','High','FOMC Rate Decision','5.25%','5.25%','5.25%'),
              ('08:30','USD','High','Non-Farm Payrolls','180K','175K','160K'), ('08:30','USD','High','PPI m/m','0.2%','0.1%','0.0%'),
              ('08:30','USD','Medium','Initial Jobless Claims','220K','225K','218K'), ('15:10','USD','Medium','Fed Chair Speech',None,None,None),
              ('08:30','USD','High','Retail Sales m/m','0.4%','0.3%','0.2%'), ('08:15','EUR','High','ECB Rate Decision','4.00%','4.00%','4.00%'),
              ('07:00','GBP','High','BOE Rate Decision','5.00%','5.00%','5.00%'), ('04:30','GBP','Medium','Manufacturing PMI','51.2','50.8','50.5'),
              ('08:30','CAD','Medium','GDP m/m','0.2%','0.1%','0.0%'), ('09:00','EUR','Medium','ECB President Speech',None,None,None)]
    for day in ('2013-01-25','2020-06-02','2024-05-15','2026-10-30'):
        for clock, currency, impact, event, actual, forecast, previous in events:
            yield {'Date':day,'Time':clock,'Currency':currency,'Impact':impact,'Event':'[DEMO] '+event,'Actual':actual,'Forecast':forecast,'Previous':previous}

    # Owner-supplied preview fixtures; kept labelled separately from verified imports.
    for clock,impact,event,actual,forecast,previous in (
        ('08:30','Medium','Empire State Manufacturing Index','3.1','5.0','-1.2'),
        ('09:15','High','Industrial Production m/m','-0.3%','0.1%','-0.3%'),
        ('10:00','High','Prelim UoM Consumer Sentiment','88.6','95.8','95.9'),
    ):
        yield {'Date':'2015-05-15','Time':clock,'Currency':'USD','Impact':impact,'Event':'[DEMO] '+event,'Actual':actual,'Forecast':forecast,'Previous':previous}

def full_history_rows():
    """Synthetic schedule fixtures, NOT official dates or historical observations.

    Fixed per-year RNG seeds keep repeated runs and FOMC choices reproducible.
    Holidays and actual agency scheduling exceptions are intentionally not inferred.
    """
    for year in range(2010,2027):
        start=date(year,1,1)
        days=[start+timedelta(days=n) for n in range((date(year+1,1,1)-start).days)]
        fomc=set(random.Random(year).sample([d for d in days if d.weekday()==2],8))
        for day in days:
            events=[]
            if day.weekday()==3:
                events.append(('08:30','High','Initial Jobless Claims','220K','225K','218K'))
            if day.weekday()==4 and day.day<=7:
                events.append(('08:30','High','Non-Farm Employment Change','180K','175K','165K'))
            if day.weekday()==2:
                if 8<=day.day<=14:
                    events.append(('08:30','High','CPI m/m','0.2%','0.2%','0.3%'))
                events.append(('10:30','Medium','Crude Oil Inventories','-1.2M','-0.8M','0.5M'))
                if day in fomc:
                    events.append(('14:00','High','FOMC Statement',None,None,None))
            for clock,impact,event,actual,forecast,previous in events:
                yield {'Date':day.isoformat(),'Time':clock,'Currency':'USD','Impact':impact,
                       'Event':'[DEMO] '+event,'Actual':actual,'Forecast':forecast,'Previous':previous}

def seed_full_history(db_path):
    """Atomically insert labelled 2010–2026 fixtures without altering existing rows."""
    if not Path(db_path).is_file():raise ValueError('Existing replay index required')
    return import_rows(db_path,full_history_rows(),NY)

def import_rows(path, rows, zone=NY, date_order='mdy'):
    normalized=[];skipped=Counter()
    for number,row in enumerate(rows,1):
        try:normalized.append(normalize(row, zone, date_order))
        except UntimedEvent as error:skipped[str(error)]+=1
        except (ValueError,OverflowError,InvalidOperation) as error:raise ValueError(f'Row {number}: {error}') from error
    # Only economic_events and its indexes are written. No per-row commits.
    with index_connection(path) as db:
        db.execute('BEGIN IMMEDIATE')
        for statement in NEWS_SCHEMA.split(';'):
            if statement.strip():db.execute(statement)
        if db.execute('SELECT 1 FROM economic_events GROUP BY timestamp_utc,currency,event COLLATE NOCASE HAVING count(*)>1 LIMIT 1').fetchone():
            raise ValueError('Existing duplicate economic events prevent the unique index; no existing rows were removed or changed.')
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_news_identity ON economic_events(timestamp_utc,currency,event COLLATE NOCASE)')
        inserted=[]
        for row in normalized:
            cursor=db.execute('INSERT INTO economic_events('+','.join(FIELDS)+') VALUES('+','.join('?' for _ in FIELDS)+') ON CONFLICT DO NOTHING',row)
            if cursor.rowcount:inserted.append(row)
    return inserted,len(normalized)-len(inserted),skipped

def csv_rows(path):
    text=Path(path).read_text(encoding='utf-8-sig')
    try:dialect=csv.Sniffer().sniff(text[:8192],delimiters=',;\t')
    except csv.Error:dialect=csv.excel
    reader=csv.DictReader(io.StringIO(text),dialect=dialect)
    if not reader.fieldnames:raise ValueError('CSV has no header')
    return list(reader)

def fetch_recent():
    request=Request(FEED,headers={'User-Agent':'Tradelab economic calendar importer/1.0','Accept':'application/json'})
    with urlopen(request,timeout=30) as response:body=response.read(5*1024*1024+1)
    if len(body)>5*1024*1024:raise ValueError('Calendar response exceeds 5 MiB')
    rows=json.loads(body)
    if not isinstance(rows,list):raise ValueError('Calendar feed must contain a list of events')
    return rows

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--seed-full-history',action='store_true',help='Synthetic [DEMO] weekly US schedule for 2010–2026, not official history')
    mode.add_argument('--seed-demo',action='store_true',help='Insert explicitly synthetic [DEMO] fixtures on five historical dates')
    mode.add_argument('--csv',type=Path,help='Calendar CSV with Date, Time, Currency, Impact, Event and optional values')
    mode.add_argument('--fetch-recent',action='store_true',help='Fetch the public current-week ForexFactory JSON feed (not historical backfill)')
    parser.add_argument('--db',type=Path,default=ROOT/'data/private/replay-index.db')
    parser.add_argument('--timezone',default='America/New_York',help='Source timezone for naive CSV timestamps; default America/New_York')
    parser.add_argument('--date-order',choices=('mdy','dmy'),default='mdy')
    args=parser.parse_args(argv)
    try:
        if not args.db.is_file():raise ValueError('Replay index does not exist; refusing to create a replacement archive')
        zone=ZoneInfo(args.timezone)
        rows=list(full_history_rows()) if args.seed_full_history else list(demo_rows()) if args.seed_demo else csv_rows(args.csv) if args.csv else fetch_recent()
        if args.seed_full_history or args.seed_demo:print('DEMO ONLY: synthetic values and dates, not verified historical releases.')
        print('Source timezone:', 'America/New_York (demo)' if args.seed_full_history or args.seed_demo else args.timezone, '| stored timestamps: UTC milliseconds')
        inserted,duplicates,skipped=seed_full_history(args.db) if args.seed_full_history else import_rows(args.db,rows,NY if args.seed_demo else zone,args.date_order)
        print(f'Inserted: {len(inserted)} | Duplicates ignored: {duplicates} | Untimed/non-economic skipped: {sum(skipped.values())}')
        print('Category       Inserted')
        for name,index in [('Currency',3),('Impact',4)]:
            counts=Counter(row[index] for row in inserted)
            for value in (('USD','EUR','GBP') if index==3 else ('High','Medium','Low')):counts.setdefault(value,0)
            for key,value in sorted(counts.items()):print(f'{name+" "+key:<16}{value}')
        for reason,count in skipped.items():print(f'Skipped {reason}: {count}')
        if rows:
            from webapp.replay_index import economic_events
            day=inserted[0][1] if inserted else None
            if day is None:
                for row in rows:
                    try:day=normalize(row,NY if args.seed_full_history or args.seed_demo else zone,args.date_order)[1];break
                    except UntimedEvent:continue
            if day:
                print('Verification date:',day)
                for event in economic_events(args.db,day):print(json.dumps(event,ensure_ascii=False))
        return 0
    except Exception as error:
        print(f'Import failed: {error}',file=sys.stderr);return 1

if __name__=='__main__':raise SystemExit(main())
