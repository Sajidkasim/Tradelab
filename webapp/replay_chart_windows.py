"""Paged chart history, separate from immutable execution-session snapshots."""
import sqlite3
from functools import lru_cache
from datetime import datetime,timezone
from services.replay_chart_history import aggregate,FIELDS
from .replay_timing import timed

def _records(rows):return [dict(zip(FIELDS,row)) for row in rows]
def _minutes(db,root,start,end):
    first=datetime.fromtimestamp(start/1000,timezone.utc).date().isoformat();last=datetime.fromtimestamp(end/1000,timezone.utc).date().isoformat()
    for day,symbol in db.execute('SELECT day,symbol FROM active_contracts WHERE root=? AND day>=? AND day<=? ORDER BY day',(root,first,last)).fetchall():
        yield from db.execute('SELECT time,open,high,low,close,volume FROM bars WHERE day=? AND symbol=? AND time>=? AND time<=? ORDER BY time',(day,symbol,start,end))
@timed("forming candle aggregation")
def forming(db,root,tf,opened,cutoff):
    rows=[];start=opened
    if tf in ('1W','1M'):
        daily=db.execute('SELECT time,open,high,low,close,volume,end FROM chart_daily_ny WHERE root=? AND time>=? AND end<=? ORDER BY time',(root,opened,cutoff+60000)).fetchall()
        rows=[row[:6] for row in daily]
        if daily:start=daily[-1][6]
    rows.extend(_minutes(db,root,start,cutoff));result=aggregate(rows,tf)
    return result[-1] if result else None

@lru_cache(maxsize=16)
@timed("indexed chart query + forming candle")
def window(path,stamp,root,tf,before,cutoff,limit=750,after=None):
    with sqlite3.connect(path) as db:
        available=db.execute('SELECT MIN(day),MAX(day) FROM active_contracts WHERE root=?',(root,)).fetchone()
        # Exact source bounds, not a calendar guess or a provider allowance.
        def edge(day,order):
            symbol=db.execute('SELECT symbol FROM active_contracts WHERE day=? AND root=?',(day,root)).fetchone()[0]
            return db.execute(f'SELECT time FROM bars WHERE day=? AND symbol=? ORDER BY time {order} LIMIT 1',(day,symbol)).fetchone()[0]
        first,last=edge(available[0],'ASC'),edge(available[1],'DESC')
        precomputed=db.execute("SELECT 1 FROM sqlite_master WHERE name='chart_precomputed'").fetchone()
        if precomputed and db.execute('SELECT 1 FROM chart_precomputed WHERE root=? AND tf=? LIMIT 1',(root,tf)).fetchone():
            from services.replay_chart_history import bucket
            calendar=tf in ('1D','1W','1M')
            sql='SELECT time,open,high,low,close,volume FROM chart_precomputed WHERE root=? AND tf=? AND time<? AND time>? AND end<=? ORDER BY time '+('ASC' if calendar or after is not None else 'DESC')
            params=[root,tf,before,after if after is not None else -1,cutoff+60000]
            if not calendar:sql+=' LIMIT ?';params.append(limit+1)
            rows=db.execute(sql,params).fetchall();candles={row[0]:list(row) for row in rows}
            opened=bucket(cutoff,tf)
            if opened is not None and opened<before and (after is None or opened>after) and opened not in candles and (calendar or after is None or len(rows)<=limit):
                partial=forming(db,root,tf,opened,cutoff)
                if partial:candles[opened]=partial
            candles=sorted(candles.values());selected=candles if calendar else candles[:limit] if after is not None else candles[-limit:]
            return {'bars':_records(selected),'earliest':first,'latest':last,'replay_time':cutoff,'exhausted':calendar or len(candles)<=limit,'timezone':'America/New_York','calendar':'New York 18:00 session; Monday trading week'}
        if tf in ('1D','1W','1M'):
            daily=db.execute('SELECT time,open,high,low,close,volume,end FROM chart_daily_ny WHERE root=? AND end<=? ORDER BY time',(root,cutoff+60000)).fetchall()
            start=daily[-1][6] if daily else first
            rows=[row[:6] for row in daily]+list(_minutes(db,root,start,cutoff))
            candles=aggregate(rows,tf)
        elif tf=='240':
            rows=db.execute('SELECT time,open,high,low,close,volume FROM chart_4h_ny WHERE root=? AND time<? AND time>? AND time+14400000<=? ORDER BY time '+('ASC' if after is not None else 'DESC')+' LIMIT ?',(root,before,after if after is not None else -1,cutoff+60000,limit+1)).fetchall()
            if after is None:rows=rows[::-1]
            tail=aggregate(_minutes(db,root,max(first,cutoff-86400000),cutoff),tf)
            # Only the last tail bucket can be incomplete. Complete table bars win earlier buckets.
            merged={row[0]:list(row) for row in rows}
            if tail and (after is None or len(rows)<=limit):merged[tail[-1][0]]=tail[-1]
            candles=sorted(merged.values())
        else:
            end=min(cutoff,before-1);endday=datetime.fromtimestamp(end/1000,timezone.utc).date().isoformat();rows=[];candles=[]
            startday=datetime.fromtimestamp((after or 0)/1000,timezone.utc).date().isoformat()
            for day,symbol in db.execute('SELECT day,symbol FROM active_contracts WHERE root=? AND day<=? AND day>=? ORDER BY day '+('ASC' if after is not None else 'DESC'),(root,endday,startday)).fetchall():
                part=db.execute('SELECT time,open,high,low,close,volume FROM bars WHERE day=? AND symbol=? AND time<=? ORDER BY time',(day,symbol,end)).fetchall()
                rows=rows+part if after is not None else part+rows;candles=[bar for bar in aggregate(rows,tf) if after is None or bar[0]>after]
                if len(candles)>limit:break
        candles=[bar for bar in candles if bar[0]<before and bar[0]<=cutoff and (after is None or bar[0]>after)]
        calendar=tf in ('1D','1W','1M')
        selected=candles if calendar else (candles[:limit] if after is not None else candles[-limit:])
        return {'bars':_records(selected),'earliest':first,'latest':last,'replay_time':cutoff,'exhausted':calendar or len(candles)<=limit,'timezone':'America/New_York','calendar':'New York 18:00 session; Monday trading week'}
