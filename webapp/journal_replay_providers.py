"""Bounded read-only candle adapters; no persistent cache or order endpoints."""
from datetime import datetime, timedelta, timezone
import lzma
import math
import struct
import requests
from pathlib import Path
from core.projectx_api import ProjectXClient, Unit
from services.journal_replay import FX
from . import spot_replay


def projectx(symbol, start, end):
    client=ProjectXClient.from_env()
    client.timeout=10
    client.max_retries=1
    try:
        frame=client.bars(symbol,start,end,unit=Unit.MINUTE)
        return [{'time':int(r.t.timestamp()*1000),'open':r.o,'high':r.h,'low':r.l,'close':r.c,'volume':r.v} for r in frame.itertuples()]
    finally:
        if client.session:client.session.close()


def decode_candles(content, day, symbol):
    decoder=lzma.LZMADecompressor(memlimit=64*1024*1024)
    raw=decoder.decompress(content,max_length=1440*24+1)
    if not decoder.eof or len(raw)%24 or len(raw)>1440*24:
        raise ValueError('Invalid Dukascopy candle response.')
    scale=FX[symbol]
    result=[]
    for offset,o,c,l,h,v in struct.iter_unpack('>5If',raw):
        if offset>=86400 or offset%60:raise ValueError('Invalid candle timestamp.')
        result.append({'time':int(day.timestamp()*1000)+offset*1000,'open':o/scale,'high':h/scale,'low':l/scale,'close':c/scale,'volume':v})
    return result


def dukascopy(symbol,start,end,*,archive:Path|None=None):
    if archive and archive.is_file() and symbol in spot_replay.SYMBOLS:
        with spot_replay.connect(archive) as connection:
            rows = connection.execute(
                'SELECT time,open,high,low,close,volume FROM spot_bars '
                'WHERE symbol=? AND time>=? AND time<? ORDER BY time LIMIT 750',
                (symbol, int(start.timestamp()*1000), int(end.timestamp()*1000)),
            ).fetchall()
        if rows:
            return [dict(zip(spot_replay.FIELDS, row)) for row in rows]
    day=start.replace(hour=0,minute=0,second=0,microsecond=0)
    rows=[]
    while day<end:
        url=f'https://datafeed.dukascopy.com/datafeed/{symbol}/{day.year}/{day.month-1:02}/{day.day:02}/BID_candles_min_1.bi5'
        with requests.get(url,timeout=10,stream=True,allow_redirects=False) as response:
            if response.status_code==404:
                day+=timedelta(days=1)
                continue
            response.raise_for_status()
            content=bytearray()
            for chunk in response.iter_content(8192):
                content.extend(chunk)
                if len(content)>128000:raise ValueError('Oversized candle response.')
            if content:rows.extend(decode_candles(bytes(content),day,symbol))
        day+=timedelta(days=1)
    return [b for b in rows if start.timestamp()*1000<=b['time']<end.timestamp()*1000]


def validate_bars(bars):
    for bar in bars:
        if not all(isinstance(bar[k], (int,float)) and math.isfinite(bar[k]) for k in ('time','open','high','low','close','volume')):
            raise ValueError('Invalid candle values.')
        if bar['time']%60000 or bar['low']>min(bar['open'],bar['close']) or bar['high']<max(bar['open'],bar['close']) or bar['volume']<0:
            raise ValueError('Invalid candle geometry.')
    return bars
