"""Display-only New York 4H candles. Source timestamps stay UTC milliseconds."""
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo
NY=ZoneInfo('America/New_York')

def ny_four_hour_open(stamp):
    local=datetime.fromtimestamp(stamp/1000,timezone.utc).astimezone(NY)
    if local.weekday()==5 or (local.weekday()==4 and local.hour>=17) or (local.weekday()==6 and local.hour<18):return None
    midnight=local.replace(hour=0,minute=0,second=0,microsecond=0)
    opened=midnight+timedelta(hours=2+4*((local.hour-2)//4))
    return int(opened.astimezone(timezone.utc).timestamp()*1000)

def aggregate_ny_four_hours(rows):
    result=[];previous=-1
    for stamp,o,h,l,c,v in rows:
        if stamp<=previous:raise ValueError('Minute timestamps must be unique and increasing.')
        previous=stamp;opened=ny_four_hour_open(stamp)
        if opened is None:continue
        if result and result[-1][0]==opened:
            bar=result[-1];bar[2]=max(bar[2],h);bar[3]=min(bar[3],l);bar[4]=c;bar[5]+=v
        else:result.append([opened,o,h,l,c,v])
    return result
