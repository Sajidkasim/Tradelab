"""Bounded, private archive chunks shared by local packaging and hosted replay."""
import gzip,hashlib,json,re
from datetime import date,timedelta,datetime,timezone
from functools import lru_cache
from io import BytesIO
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
def unpack(body,digest):
    with gzip.GzipFile(fileobj=BytesIO(body)) as stream:raw=stream.read(MAX_BYTES+1)
    if len(raw)>MAX_BYTES or hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Archive integrity check failed.')
    return json.loads(raw)
def records(rows):return [dict(zip(FIELDS,row)) for row in rows]

class Archive:
    def __init__(self,manifest,client,bucket):self.manifest=manifest;self.client=client;self.bucket=bucket
    @lru_cache(maxsize=16)
    def chunk(self,digest):
        stream=self.client.get_object(Bucket=self.bucket,Key=key(digest))['Body']
        try:body=stream.read(MAX_BYTES+1)
        finally:stream.close()
        if len(body)>MAX_BYTES:raise ValueError('Archive chunk is too large.')
        return unpack(body,digest)
    @lru_cache(maxsize=2)
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
        data={'day':day,'timezone':'UTC','schema':'ohlcv-1m','source':'Databento GLBX.MDP3','history_version':2,'chart_context_version':1,
              'selection':'Prior-day volume; unadjusted contracts; UTC calendar candles.','markets':markets}
        # Price identity excludes chart-only enrichment; manifests are immutable per release.
        signature=hashlib.sha256(encode({'day':self.manifest['days'][day],'context':[self.manifest['days'][p['day']] for p in earlier],'charts':self.manifest['charts']})).hexdigest()
        return data,signature
