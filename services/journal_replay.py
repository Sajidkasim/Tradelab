"""Read-only execution metadata. No fills, financial results or trades are recalculated."""
from datetime import datetime, timezone, timedelta
import hashlib
import csv
import io
import math
import re
from zoneinfo import ZoneInfo
import pandas as pd

PREFIX = 'journal_replay:'
FX = {'EURUSD':100000, 'GBPUSD':100000, 'USDJPY':1000, 'AUDUSD':100000,
      'USDCAD':100000, 'USDCHF':100000, 'NZDUSD':100000, 'XAUUSD':1000}


def utc(value, zone=None):
    stamp = pd.Timestamp(value)
    if pd.isna(stamp):
        raise ValueError('An execution timestamp is missing.')
    if stamp.tzinfo is None:
        if not zone:
            raise ValueError('Select the export timezone; it cannot be inferred safely.')
        if zone=='FTMO_MT5':
            # MT5 winter UTC+2 / summer UTC+3, following the US clock changes.
            candidates=[]
            for hours in (2,3):
                candidate=stamp.tz_localize(timezone(timedelta(hours=hours))).tz_convert('UTC')
                ny=candidate.tz_convert('America/New_York')
                if hours==2+bool(ny.dst()):candidates.append(candidate)
            if len(candidates)!=1:raise ValueError('Ambiguous or nonexistent FTMO clock time at the DST transition; supply an explicit timestamp offset.')
            return candidates[0].isoformat()
        ZoneInfo(zone)
        stamp = stamp.tz_localize(zone, ambiguous='raise', nonexistent='raise')
    return stamp.tz_convert('UTC').isoformat()


def instrument(symbol):
    symbol = symbol.strip().upper()
    if symbol in FX:
        return 'dukascopy', symbol
    if re.fullmatch(r'(?:CON\.F\.US\.)?(?:NQ|ES|MNQ|MES)\.[HMUZ]\d{2}', symbol):
        return 'projectx', symbol if symbol.startswith('CON.') else 'CON.F.US.'+symbol
    raise ValueError('Use a supported Forex symbol or exact futures contract, e.g. CON.F.US.NQ.Z26. Root/continuous symbols cannot identify an expiry.')


def parse_executions(content, zone):
    """Explicit interchange CSV, not a claim of compatibility with arbitrary broker reports."""
    if len(content)>1024*1024:
        raise ValueError('Execution files must be smaller than 1 MB.')
    text=content.decode('utf-8-sig')
    rows=list(csv.reader(io.StringIO(text)))
    if not rows:raise ValueError('The execution CSV is empty.')
    header=rows[0]
    if {'Id','ContractName','EnteredAt','ExitedAt','EntryPrice','ExitPrice','Size','Type'}.issubset(header):
        return native_report(rows,zone,'topstepx')
    if {'Ticket','Open','Close','Volume','Symbol','Type'}.issubset(header) and header.count('Price')==2:
        return native_report(rows,zone,'ftmo')
    return parse_execution_rows(csv.DictReader(io.StringIO(text)),zone)


def parse_execution_rows(reader,zone,allow_unmapped=False):
    required={'trade_id','execution_id','symbol','timestamp','side','quantity','price','role'}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('Use execution CSV columns: '+', '.join(sorted(required)))
    groups={}
    ids={}
    for index, row in enumerate(reader):
        if index>=10000:
            raise ValueError('Import up to 10,000 executions.')
        try:provider,symbol=instrument(row['symbol'])
        except ValueError:
            if not allow_unmapped:raise
            provider,symbol='unavailable',row['symbol'].strip()
        trade_id=row['trade_id'].strip()
        eid=row['execution_id'].strip()
        if not trade_id or not eid or len(trade_id)>120 or len(eid)>120:
            raise ValueError('Each execution needs a trade ID and execution ID of at most 120 characters.')
        side,role=row['side'].strip().lower(),row['role'].strip().lower()
        if side not in ('buy','sell') or role not in ('entry','exit'):
            raise ValueError('Side must be buy/sell; role must be entry/exit.')
        qty,price=float(row['quantity']),float(row['price'])
        if not all(math.isfinite(x) and x>0 for x in (qty,price)):
            raise ValueError('Quantity and price must be positive finite values.')
        event={'id':eid,'time':utc(row['timestamp'],zone),'side':side,'role':role,'quantity':row['quantity'],'price':row['price'],'source_row':dict(row)}
        account=(row.get('account') or '').strip()
        key=(account,trade_id,eid)
        if key in ids:
            if ids[key]!=event:raise ValueError('Conflicting duplicate execution ID.')
            continue
        ids[key]=event
        group=groups.setdefault((account,trade_id),{'account':account,'external_id':trade_id,'provider':provider,'symbol':symbol,'executions':[],'notes':row.get('notes','')[:6000]})
        if group['symbol']!=symbol:raise ValueError('One trade cannot contain different instruments.')
        group['executions'].append(event)
    result=[]
    for group in groups.values():
        group['executions'].sort(key=lambda x:x['time'])
        if not any(e['role']=='entry' for e in group['executions']):raise ValueError('Each trade needs at least one entry execution.')
        group['id']=hashlib.sha256((group['provider']+':'+group['account']+':'+group['external_id']).encode()).hexdigest()[:32]
        result.append(group)
    if not result:raise ValueError('The execution CSV is empty.')
    return result


def from_trade(trade):
    # core.db deliberately stores UTC-naive datetimes; this is a known storage convention, not an export-timezone guess.
    provider,symbol=instrument(trade.symbol)
    events=[{'id':'entry','time':utc(trade.entry_time,'UTC'),'role':'entry','side':'buy' if getattr(trade.direction,'value',trade.direction)=='long' else 'sell', 'quantity':str(trade.qty),'price':str(trade.entry_price)}]
    if trade.exit_time and trade.exit_price is not None:
        events.append({'id':'exit','time':utc(trade.exit_time,'UTC'),'role':'exit','quantity':str(trade.qty),'price':str(trade.exit_price)})
    return {'id':str(trade.id),'symbol':symbol,'provider':provider,'executions':events,'notes':trade.notes,
            'warning':'Aggregate entry/exit only. Import execution detail to review partial fills.'}


def native_report(rows, zone, source):
    """Actual TopstepX closed-trade and FTMO website Trading Journal schemas.

    Each source row is a closed trade/leg, not a complete fill tape. Never merge
    separate rows or infer partial execution sizes which the file cannot establish.
    """
    header=rows[0]
    if len(rows)>5001:raise ValueError('Import up to 5,000 closed-trade rows.')
    if source=='ftmo' and not zone:
        raise ValueError('FTMO website export has no timezone. Confirm the website Trading Journal export clock, then enter its timezone. Do not assume the MT5 server clock.')
    price_columns=[i for i,name in enumerate(header) if name=='Price']
    converted=[]
    originals={}
    for values in rows[1:]:
        if not any(values):continue
        if len(values)!=len(header):raise ValueError('A CSV row has missing or extra columns.')
        raw=dict(zip(header,values))
        if source=='topstepx':
            def stamp(value):return datetime.strptime(value,'%m/%d/%Y %H:%M:%S %z').isoformat()
            opened,closed=stamp(raw['EnteredAt']),stamp(raw['ExitedAt'])
            symbol=raw['ContractName'].upper().strip()
            match=re.fullmatch(r'(MNQ|MES|NQ|ES)([HMUZ])(\d{1,2})',symbol)
            if not match:raise ValueError('TopstepX contract is unsupported or lacks a quarterly expiry: '+symbol)
            root,month,year=match.groups()
            if len(year)==1:
                anchor=datetime.fromisoformat(opened).year
                candidates=[y for y in range(anchor-2,anchor+3) if y%10==int(year)]
                if len(candidates)!=1:raise ValueError('Cannot establish the futures expiry year.')
                year=str(candidates[0])[-2:]
            symbol=f'CON.F.US.{root}.{month}{year}'
            external=raw['Id'].strip()
            side=raw['Type'].strip().lower()
            if side not in ('long','short'):raise ValueError('Unexpected TopstepX trade direction.')
            side='buy' if side=='long' else 'sell'
            qty,entry,exit=raw['Size'],raw['EntryPrice'],raw['ExitPrice']
        else:
            opened,closed=utc(raw['Open'],zone),utc(raw['Close'],zone)
            symbol=raw['Symbol'].strip()
            external=raw['Ticket'].strip()
            side=raw['Type'].strip().lower()
            if side not in ('buy','sell'):raise ValueError('Unexpected FTMO trade direction.')
            qty=raw['Volume']
            entry,exit=(values[i] for i in price_columns)
        if datetime.fromisoformat(closed)<datetime.fromisoformat(opened):raise ValueError('A trade closes before it opens.')
        if not external or len(external)>100:raise ValueError('A broker ticket/ID is missing or too long.')
        trade_id=source+':'+external
        original={'columns':header,'values':values}
        if trade_id in originals and originals[trade_id]!=original:raise ValueError('Conflicting duplicate broker trade ID.')
        originals[trade_id]=original
        for role,time,price,execution_side in [('entry',opened,entry,side),('exit',closed,exit,'sell' if side=='buy' else 'buy')]:
            converted.append({'trade_id':trade_id,'execution_id':external+':'+role,'symbol':symbol,'timestamp':time,'side':execution_side,'quantity':qty,'price':price,'role':role})
    output=io.StringIO()
    columns=['trade_id','execution_id','symbol','timestamp','side','quantity','price','role']
    writer=csv.DictWriter(output,fieldnames=columns)
    writer.writeheader();writer.writerows(converted)
    groups=parse_execution_rows(csv.DictReader(io.StringIO(output.getvalue())),zone,allow_unmapped=source=='ftmo')
    for group in groups:
        group['source_format']=source
        group['original_report_row']=originals[group['external_id']]
        group['warning']='Exported entry/exit per closed trade or leg; individual intratrade fills are not supplied by this report.'
        if group['provider']=='unavailable':
            group['warning']+=' No verified candle mapping is configured for '+group['symbol']+'. No substitute instrument will be used.'
    return groups
