"""Chart-only, UTC stored candles with DST-aware New York session buckets."""
from datetime import datetime,timedelta,time,timezone
from zoneinfo import ZoneInfo
NY=ZoneInfo('America/New_York')
FIELDS=('time','open','high','low','close','volume')
def bucket(stamp,tf):
    if tf=='240':
        from .replay_candles import ny_four_hour_open
        return ny_four_hour_open(stamp)
    if tf not in ('1D','1W','1M'):return stamp//(int(tf)*60000)*(int(tf)*60000)
    local=datetime.fromtimestamp(stamp/1000,timezone.utc).astimezone(NY)
    day=local.date()+timedelta(days=local.hour>=18)
    if tf=='1W':day-=timedelta(days=day.weekday())
    if tf=='1M':day=day.replace(day=1)
    return int(datetime.combine(day-timedelta(days=1),time(18),NY).timestamp()*1000)
def aggregate(rows,tf):
    result=[]
    for row in rows:
        t,o,h,l,c,v=row;opened=bucket(t,tf)
        if opened is None:continue
        if result and result[-1][0]==opened:
            last=result[-1];last[2]=max(last[2],h);last[3]=min(last[3],l);last[4]=c;last[5]+=v
        else:result.append([opened,o,h,l,c,v])
    return result
