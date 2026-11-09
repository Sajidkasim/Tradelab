"""Validate and import a supplied Forex Factory archive. Never bypasses challenges.

The public historical snapshot is a candidate source, not verified data. All rows
are staged and checked before a single economic-events transaction is started.
"""
import argparse,csv,hashlib,io,json,sys
from datetime import date,datetime,timezone
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
        try:value=normalize(row)
        except UntimedEvent:continue
        except ValueError as error:raise ValueError(f'Row {number}: {error}') from error
        if value[3] in ('USD','EUR','GBP') and value[4] in ('High','Medium') and '2010-01-01'<=value[1]<=min(date.today().isoformat(),'2026-11-30'):
            kept.append(row);result.append(value)
    return kept,result

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv',type=Path,help='Complete, timestamped archive from an accessible source')
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
        # Coverage is not invented from weekday formulas or padded with demo rows.
        if not events or max(r[1] for r in events)<'2026-11-06':
            raise ValueError('Archive does not cover the requested period through November 2026; supply a complete timestamped export. No partial import committed.')
        inserted,duplicates,skipped=import_rows(args.db,kept)
        report.update(imported=True,inserted=len(inserted),duplicates=duplicates,skipped=dict(skipped))
        print(json.dumps(report,indent=2));return 0
    except Exception as error:
        report['error']=str(error);print('ABORTED: '+str(error),file=sys.stderr);return 1
    finally:(target/'archive-fetch-report.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':raise SystemExit(main())
