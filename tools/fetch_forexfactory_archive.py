"""Validate and import a supplied Forex Factory archive. Never bypasses challenges.

The public historical snapshot is a candidate source, not verified data. All rows
are staged and checked before a single economic-events transaction is started.
"""
import argparse,csv,hashlib,io,json,re,sys,time
from datetime import date,datetime,timezone,timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.request import Request,urlopen
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.import_economic_calendar import normalize,import_rows,UntimedEvent
ROOT=Path(__file__).resolve().parents[1]
DATASET='https://huggingface.co/api/datasets/Ehsanrs2/Forex_Factory_Calendar'

def download(url,limit):
    req=Request(url,headers={'User-Agent':'Tradelab calendar audit/1.0','Accept':'text/csv,application/json'})
    with urlopen(req,timeout=60) as response:
        body=response.read(limit+1)
    if len(body)>limit:raise ValueError('Source exceeds download size limit')
    if b'captcha' in body[:4096].lower() or b'just a moment' in body[:4096].lower():
        raise ValueError('Source requires verification; collection stopped without bypassing it')
    return body

def sanity_gate(events):
    matches=[r for r in events if r[1]=='2024-05-15' and r[3]=='USD' and 'core cpi' in r[5].lower()]
    if not matches:raise ValueError('BLS sanity gate: May 15, 2024 USD Core CPI is missing; import aborted')
    if any(r[2]!='08:30' for r in matches):raise ValueError('BLS sanity gate: May 15, 2024 Core CPI must be 08:30 New York; found '+', '.join(r[2] for r in matches))

def stage(rows):
    result=[];kept=[]
    for number,row in enumerate(rows,1):
        try:value=normalize(row,zone=timezone.utc)
        except UntimedEvent:continue
        except ValueError as error:raise ValueError(f'Row {number}: {error}') from error
        if value[3] in ('USD','EUR','GBP') and value[4] in ('High','Medium') and '2010-01-01'<=value[1]<=min(date.today().isoformat(),'2026-11-30'):
            kept.append(row);result.append(value)
    return kept,result

def parse_week(html, start):
    """Parse a weekly page, never infer its timezone from the request cookie alone."""
    from bs4 import BeautifulSoup
    soup=BeautifulSoup(html,'html.parser')
    if 'just a moment' in soup.get_text(' ',strip=True).lower() or soup.select('[name="cf-turnstile-response"]'):
        raise ValueError('Forex Factory verification challenge; no rows imported')
    rows=soup.select('tr.calendar__row')
    if not rows:raise ValueError('Weekly page contains no calendar rows; refusing silent coverage gaps')
    # The server may ignore a cookie; require confirmation before using wall clocks.
    zone_ok=bool(re.search(r'(?:Calendar Time Zone|timezone)[^<\n]{0,100}(?:America/New_York|New York)',soup.get_text(' ',strip=True),re.I))
    current_day=None;current_clock=None;result=[]
    for row in rows:
        def cell(name):
            node=row.select_one('.calendar__'+name)
            return node.get_text(' ',strip=True) if node else ''
        day_text=cell('date')
        if day_text:
            match=re.search(r'([A-Za-z]{3})\s*(\d{1,2})',day_text)
            if match:
                month=datetime.strptime(match[1],'%b').month
                choices=[date(y,month,int(match[2])) for y in (start.year-1,start.year,start.year+1)]
                current_day=next((d for d in choices if start<=d<start+timedelta(days=7)),None)
                current_clock=None
        clock=cell('time')
        if clock:current_clock=clock
        currency=cell('currency').upper()
        impact_node=row.select_one('.calendar__impact')
        impact_text=str(impact_node).lower()
        impact='High' if 'high' in impact_text or 'icon--ff-impact-red' in impact_text else 'Medium' if 'medium' in impact_text or 'med impact' in impact_text or 'icon--ff-impact-ora' in impact_text else None
        if currency not in ('USD','EUR','GBP') or not impact:continue
        title=cell('event')
        if not title:raise ValueError('Calendar event title missing')
        raw_stamp=row.get('data-timestamp') or row.get('data-event-timestamp')
        if raw_stamp:
            stamp=datetime.fromtimestamp(float(raw_stamp)/(1000 if abs(float(raw_stamp))>=1e11 else 1),timezone.utc)
            local=stamp.astimezone(ZoneInfo('America/New_York'))
            if not start<=local.date()<start+timedelta(days=7):raise ValueError('Event timestamp outside requested week')
        else:
            if not current_day:raise ValueError('Missing calendar release date')
            if not current_clock or current_clock.lower() in ('all day','tentative',''):continue
            if not zone_ok:raise ValueError('Server did not confirm America/New_York calendar timezone; refusing to guess')
            # Reuse the importer's DST ambiguity validation for naive wall clocks.
            from tools.import_economic_calendar import release_time
            stamp=release_time(current_day.isoformat(),current_clock,ZoneInfo('America/New_York'),'mdy')
        result.append({'DateTime':stamp.isoformat(),'Currency':currency,'Impact':impact,'Event':title,
                       'Actual':cell('actual'),'Forecast':cell('forecast'),'Previous':cell('previous')})
    return result

def scrape_weeks(start,end,target):
    from curl_cffi import requests
    cache=target/'weeks';cache.mkdir(exist_ok=True)
    start-=timedelta(days=(start.weekday()+1)%7)
    result=[];last_request=None
    with requests.Session(impersonate='chrome120') as session:
        session.cookies.set('fftimezone','America/New_York',domain='.forexfactory.com')
        while start<=end:
            path=cache/(start.isoformat()+'.html')
            if path.exists():html=path.read_text()
            else:
                if last_request is not None:time.sleep(max(0,1.5-(time.monotonic()-last_request)))
                key=start.strftime('%b').lower()+str(start.day)+start.strftime('.%Y')
                response=session.get('https://www.forexfactory.com/calendar',params={'week':key},timeout=60)
                last_request=time.monotonic()
                if response.status_code!=200:raise ValueError(f'Weekly request {start}: HTTP {response.status_code}; no rows imported')
                html=response.text
                parsed=parse_week(html,start) # Validate before caching; challenges never cached.
                path.write_text(html)
                (cache/(start.isoformat()+'.json')).write_text(json.dumps({'url':response.url,'sha256':hashlib.sha256(html.encode()).hexdigest()}))
            result.extend(parse_week(html,start))
            print(f'Staged week {start}',flush=True)
            start+=timedelta(days=7)
    return result

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv',type=Path,help='Complete, timestamped archive from an accessible source')
    parser.add_argument('--end',type=date.fromisoformat,default=date(2026,10,31),help='Final NY release date (default 2026-10-31)')
    parser.add_argument('--db',type=Path,default=ROOT/'data/private/replay-index.db')
    args=parser.parse_args(argv)
    target=ROOT/'data/private/economic-calendar-sources';target.mkdir(exist_ok=True)
    report={'imported':False}
    try:
        if not args.db.is_file():raise ValueError('Existing replay index required')
        if args.csv:body=args.csv.read_bytes();source=str(args.csv)
        else:
            metadata=json.loads(download(DATASET,2*1024*1024));revision=metadata['sha']
            source=f'https://huggingface.co/datasets/Ehsanrs2/Forex_Factory_Calendar/resolve/{revision}/forex_factory_cache.csv'
            cached=target/'forex_factory_cache.csv';provenance=target/'source.json'
            info=json.loads(provenance.read_text()) if provenance.exists() else {}
            body=cached.read_bytes() if cached.exists() and info.get('revision')==revision else download(source,200*1024*1024)
        report.update(source=source,sha256=hashlib.sha256(body).hexdigest())
        rows=list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))
        kept,events=stage(rows);report['eligible_events']=len(events)
        report['source_dates']=[min(r[1] for r in events),max(r[1] for r in events)] if events else []
        sanity_gate(events)
        if not events:raise ValueError('No eligible archive events')
        end=min(args.end,date.today())
        last=date.fromisoformat(max(r[1] for r in events))
        if last<end:
            recent=scrape_weeks(last,end,target)
            rows.extend(recent)
            kept,events=stage(rows)
            sanity_gate(events)
        # Explicit-offset rows retain their true instant; naive archive times are UTC.
        kept=[{'DateTime':datetime.fromtimestamp(v[0]/1000,timezone.utc).isoformat(),
               **dict(zip(('Currency','Impact','Event','Actual','Forecast','Previous'),v[3:]))}
              for v in events if v[1]<=end.isoformat()]
        inserted,duplicates,skipped=import_rows(args.db,kept)
        report.update(imported=True,inserted=len(inserted),duplicates=duplicates,skipped=dict(skipped))
        print(json.dumps(report,indent=2));return 0
    except Exception as error:
        report['error']=str(error);print('ABORTED: '+str(error),file=sys.stderr);return 1
    finally:(target/'archive-fetch-report.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':raise SystemExit(main())
