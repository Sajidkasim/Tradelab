"""Bounded, private archive chunks shared by local packaging and hosted replay."""
import gzip,hashlib,json,re
from datetime import date,timedelta,datetime,timezone
from functools import lru_cache
from io import BytesIO
from .replay_timing import timed
from .byte_cache import byte_cache
from pathlib import Path

MAX_BYTES=12*1024*1024
FIELDS=('time','open','high','low','close','volume')
def encode(value):return json.dumps(value,separators=(',',':')).encode()
def key(digest):
    if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid archive reference.')
    return f'primus-replay/v2/{digest}.json.gz'
def pack(value):
    raw=encode(value)
    if len(raw)>MAX_BYTES:raise ValueError('Archive chunk is too large.')
    return hashlib.sha256(raw).hexdigest(),gzip.compress(raw,mtime=0)
@timed("archive decompress + integrity + JSON parse")
def unpack(body,digest):
    with gzip.GzipFile(fileobj=BytesIO(body)) as stream:raw=stream.read(MAX_BYTES+1)
    if len(raw)>MAX_BYTES or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Archive integrity check failed.')
    return json.loads(raw)
def records(rows):return [dict(zip(FIELDS,row)) for row in rows]

class Archive:
    def __init__(self,manifest,client,bucket):self.manifest=manifest;self.client=client;self.bucket=bucket
    @byte_cache(32*1024*1024,entries=48)
    def chunk(self,digest):
        stream=self.client.get_object(Bucket=self.bucket,Key=key(digest))['Body']
        try:body=stream.read(MAX_BYTES+1)
        finally:stream.close()
        if len(body)>MAX_BYTES:raise ValueError('Archive chunk is too large.')
        return unpack(body,digest)
    def execution_history(self,day):
        if day not in self.manifest['days']:raise ValueError('No candles on this date.')
        selected=self.chunk(self.manifest['days'][day]);start=(date.fromisoformat(day)-timedelta(days=14)).isoformat()
        earlier=[digest for d,digest in self.manifest['days'].items() if start<=d<day]
        signature=hashlib.sha256(encode({'day':self.manifest['days'][day],'context':earlier,'charts':self.manifest['charts']})).hexdigest()
        data={'day':day,'timezone':'UTC','schema':'ohlcv-1m','source':'Databento GLBX.MDP3','history_version':2,'chart_context_version':2,'selection':'Prior-day volume; unadjusted contracts; chart history is paged separately.',
              'markets':{root:{'contract':market['contract'],'bars':records(market['bars'])} for root,market in selected['markets'].items()}}
        return data,signature

    @byte_cache(64*1024*1024,entries=8)
    def history(self,day):
        if day not in self.manifest['days']:raise ValueError('No candles on this date. Choose an available trading day.')
        selected=self.chunk(self.manifest['days'][day]);charts=self.chunk(self.manifest['charts'])
        end=date.fromisoformat(day);start=(end-timedelta(days=14)).isoformat()
        earlier=[self.chunk(digest) for d,digest in self.manifest['days'].items() if start<=d<day]
        cutoff=int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()*1000)
        markets={}
        for root in ('NQ','ES'):
            market=selected['markets'][root]
            markets[root]={**market,'bars':records(market['bars']),
                'context':[bar for part in earlier for bar in records(part['markets'][root]['bars'])],
                'history':[b for b in records(charts[root]['daily']) if cutoff-370*86400000<=b['time']<cutoff],
                'four_hour_history':[b for b in records(charts[root]['4h']) if b['time']<cutoff]}
            if self.manifest.get('charts_ny'):
                ny=self.chunk(self.manifest['charts_ny'])
                markets[root]['four_hour_history_ny']=[b for b in records(ny[root]) if b['time']+14400000<=cutoff]
        data={'day':day,'timezone':'UTC','schema':'ohlcv-1m','source':'Databento GLBX.MDP3','history_version':2,'chart_context_version':1,
              'ny_four_hour':bool(self.manifest.get('charts_ny')),'selection':'Prior-day volume; unadjusted contracts; UTC calendar candles.','markets':markets}
        # Price identity excludes chart-only enrichment; manifests are immutable per release.
        signature=hashlib.sha256(encode({'day':self.manifest['days'][day],'context':[self.manifest['days'][p['day']] for p in earlier],'charts':self.manifest['charts']})).hexdigest()
        return data,signature

    @byte_cache(32*1024*1024,entries=48)
    @timed("archive chart page total")
    def chart_window(self,root,tf,before,cutoff,limit=750,after=None):
        from services.replay_chart_history import aggregate,SESSION_HOUR,CALENDAR_LABEL
        dates=sorted(self.manifest['days'])
        first=records(self.chunk(self.manifest['days'][dates[0]])['markets'][root]['bars'])[0]['time']
        last=records(self.chunk(self.manifest['days'][dates[-1]])['markets'][root]['bars'])[-1]['time']
        calendar=tf in ('1D','1W','1M')
        if calendar and self.manifest.get('calendar_session_hour')!=SESSION_HOUR:
            raise ValueError('Prepare and publish the 17:00 New York chart calendar bundle before opening calendar charts. Existing source candles and saved trades are unchanged.')
        pages=self.manifest.get('timeframe_chunks',{}).get(root,{}).get(tf)
        if pages:
            from bisect import bisect_right
            eligible=[p for p in pages if p['first']<before and (after is None or p['last']>after)]
            rows=[]
            for page in (eligible if after is not None else reversed(eligible)):
                rows.extend(row for row in self.chunk(page['digest']) if row[0]<before and (after is None or row[0]>after) and row[6]<=cutoff+60000)
                if len(rows)>limit:break
            from services.replay_chart_history import bucket
            opened=bucket(cutoff,tf)
            if opened is not None and opened<before and (after is None or opened>after) and not any(row[0]==opened for row in rows) and (after is None or len(rows)<=limit):
                parts=[];start=opened
                if tf in ('1W','1M'):
                    daily=[row for row in self.chunk(self.manifest['charts_calendar_ny'])[root] if row[0]>=opened and row[6]<=cutoff+60000]
                    parts=[row[:6] for row in daily]
                    if daily:start=daily[-1][6]
                startday=datetime.fromtimestamp(start/1000,timezone.utc).date().isoformat();endday=datetime.fromtimestamp(cutoff/1000,timezone.utc).date().isoformat()
                for day in dates:
                    if startday<=day<=endday:parts.extend(row for row in self.chunk(self.manifest['days'][day])['markets'][root]['bars'] if start<=row[0]<=cutoff)
                partial=aggregate(parts,tf)
                if partial:rows.append(partial[-1])
            rows=sorted(rows);selected=rows[:limit] if after is not None else rows[-limit:]
            return {'bars':records(selected),'earliest':first,'latest':last,'replay_time':cutoff,'exhausted':len(rows)<=limit,'timezone':'America/New_York','calendar':CALENDAR_LABEL}
        if calendar:
            digest=self.manifest.get('charts_calendar_ny')
            if not digest:raise ValueError('Upload the prepared New York chart-calendar bundle before enabling full calendar history on this server.')
            daily=[row for row in self.chunk(digest)[root] if row[6]<=cutoff+60000]
            start=daily[-1][6] if daily else first
            rows=[row[:6] for row in daily]
            for day in dates:
                if day<datetime.fromtimestamp(start/1000,timezone.utc).date().isoformat() or day>datetime.fromtimestamp(cutoff/1000,timezone.utc).date().isoformat():continue
                rows.extend(row for row in self.chunk(self.manifest['days'][day])['markets'][root]['bars'] if start<=row[0]<=cutoff)
            candles=aggregate(rows,tf)
        else:
            end=min(before-1,cutoff);endday=datetime.fromtimestamp(end/1000,timezone.utc).date().isoformat()
            startday=datetime.fromtimestamp((after or 0)/1000,timezone.utc).date().isoformat()
            eligible=[day for day in dates if startday<=day<=endday];rows=[];candles=[]
            for day in (eligible if after is not None else reversed(eligible)):
                part=[row for row in self.chunk(self.manifest['days'][day])['markets'][root]['bars'] if row[0]<=end]
                rows=rows+part if after is not None else part+rows
                if len(rows)>=(limit+2)*int(tf):break
            candles=[bar for bar in aggregate(rows,tf) if after is None or bar[0]>after]
        candles=[bar for bar in candles if bar[0]<before and bar[0]<=cutoff and (after is None or bar[0]>after)]
        selected=candles[:limit] if after is not None else candles[-limit:]
        return {'bars':records(selected),'earliest':first,'latest':last,'replay_time':cutoff,'exhausted':len(candles)<=limit,'timezone':'America/New_York','calendar':CALENDAR_LABEL}
