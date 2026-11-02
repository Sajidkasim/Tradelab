"""Stream a local DBN archive into a small, ignored chart sample; no API keys."""
import argparse
import json
from pathlib import Path
import pandas as pd
import databento as db


def prepare(source, day, target):
    start = pd.Timestamp(day, tz='UTC')
    end = start + pd.Timedelta(days=1)
    pieces = []
    store = db.DBNStore.from_file(source)
    if str(store.metadata.schema) != 'ohlcv-1m':
        raise ValueError('Expected OHLCV-1m data')
    for chunk in store.to_df(count=10000):
        # Databento records arrive in timestamp order; keep one UTC day only.
        selected = chunk.loc[(chunk.index >= start) & (chunk.index < end)]
        if len(selected):
            pieces.append(selected)
        if chunk.index.max() >= end:
            break
    if not pieces:
        raise ValueError('No bars found for this date')
    frame = pd.concat(pieces)
    markets = {}
    for root in ('NQ', 'ES'):
        outright = frame[frame.symbol.str.fullmatch(root + r'[HMUZ]\d{1,2}', na=False)]
        if outright.empty:
            raise ValueError(f'No {root} outright contract found')
        contract = outright.groupby('symbol').volume.sum().idxmax()
        bars = outright[outright.symbol == contract].sort_index()
        if bars.index.has_duplicates or not bars.index.is_monotonic_increasing:
            raise ValueError('Duplicate or unsorted timestamps')
        if not ((bars.low <= bars[['open','close']].min(axis=1)) & (bars.high >= bars[['open','close']].max(axis=1)) & (bars.low <= bars.high) & (bars.volume >= 0)).all():
            raise ValueError('Invalid OHLCV')
        records = [{'time': int(t.value // 1000000), **{k:float(r[k]) for k in ('open','high','low','close')}, 'volume':int(r.volume)} for t,r in bars.iterrows()]
        markets[root] = {'contract':contract, 'bars':records}
    result = {'day':day,'timezone':'UTC','schema':'ohlcv-1m','source':'Databento GLBX.MDP3','selection':'Highest-volume outright contract in this sample day; unadjusted. Chart preview only, not a rollover or replay rule.','markets':markets}
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result, separators=(',',':')))
    print(json.dumps({'file':str(target),'bytes':target.stat().st_size,'markets':{k:{'contract':v['contract'],'bars':len(v['bars'])} for k,v in markets.items()}}))

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('--day',default='2010-06-07')
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'data/private/backtesting-preview.json')
    args=parser.parse_args()
    prepare(args.source,args.day,args.output)
