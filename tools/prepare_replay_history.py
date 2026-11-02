"""Offline bounded history preparation. Never splice adjusted/future-volume contracts."""
import json
from pathlib import Path
import pandas as pd
import databento as db

def prepare(source,day,target):
    end=pd.Timestamp(day,tz='UTC')+pd.Timedelta(days=1);start=end-pd.Timedelta(days=370)
    daily={};pieces=[]
    for chunk in db.DBNStore.from_file(source).to_df(count=10000):
        frame=chunk[(chunk.index>=start)&(chunk.index<end)]
        frame=frame[frame.symbol.str.fullmatch(r'(NQ|ES)[HMUZ]\d{1,2}',na=False)]
        if len(frame):
            frame=frame.assign(day=frame.index.strftime('%Y-%m-%d'))
            for (date,symbol),g in frame.groupby(['day','symbol'],sort=False):
                if not ((g.low<=g[['open','close']].min(axis=1))&(g.high>=g[['open','close']].max(axis=1))&(g.volume>=0)).all():raise ValueError('Invalid OHLCV')
                key=(date,symbol);a=daily.get(key)
                b={'time':int(pd.Timestamp(date,tz='UTC').timestamp()*1000),'open':float(g.open.iloc[0]),'high':float(g.high.max()),'low':float(g.low.min()),'close':float(g.close.iloc[-1]),'volume':int(g.volume.sum())}
                if a:b={**a,'high':max(a['high'],b['high']),'low':min(a['low'],b['low']),'close':b['close'],'volume':a['volume']+b['volume']}
                daily[key]=b
            if frame.index.max()>=end-pd.Timedelta(days=8):pieces.append(frame[frame.index>=end-pd.Timedelta(days=8)])
        if chunk.index.max()>=end:break
    minutes=pd.concat(pieces) if pieces else pd.DataFrame();markets={}
    for root in ('NQ','ES'):
        history=[];selected={};previous={}
        days=sorted({d for d,s in daily if s.startswith(root)})
        for date in days:
            candidates={s:b for (d,s),b in daily.items() if d==date and s.startswith(root)}
            # Prior available day's volume chooses the next day's contract. No future volume.
            eligible={s:v for s,v in previous.items() if s in candidates}
            contract=max(eligible,key=eligible.get) if eligible else sorted(candidates)[0]
            selected[date]=contract;history.append({**daily[(date,contract)],'contract':contract})
            previous={s:b['volume'] for s,b in candidates.items()}
        if day not in selected:raise ValueError('No candles for this trading date')
        def records(g):
            if g.index.has_duplicates:raise ValueError('Duplicate minute timestamps')
            return [{'time':int(t.value//1000000),**{k:float(row[k]) for k in ('open','high','low','close')},'volume':int(row.volume)} for t,row in g.sort_index().iterrows()]
        context=[];current=[]
        for date,contract in selected.items():
            g=minutes[(minutes.day==date)&(minutes.symbol==contract)]
            if date==day:current=records(g)
            elif len(g):context.extend(records(g))
        markets[root]={'contract':selected[day],'bars':current,'context':context,'history':[x for x in history if x['time']<int(pd.Timestamp(day,tz='UTC').timestamp()*1000)]}
    result={'day':day,'timezone':'UTC','schema':'ohlcv-1m','source':'Databento GLBX.MDP3','history_version':1,'selection':'Previous available day volume; unadjusted contract changes; UTC calendar bars. First available day uses deterministic symbol order.','markets':markets}
    target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_suffix('.tmp');temp.write_text(json.dumps(result,separators=(',',':')));temp.replace(target)
    return result
