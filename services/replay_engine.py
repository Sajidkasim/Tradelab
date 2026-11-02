"""Deterministic practice fills on completed one-minute candles. No broker access.

Orders are submitted after the visible bar and first become eligible on the next
bar. Stops win ties. Intrabar entries cannot claim an ambiguous same-bar target.
The browser receives a projection but only displays snapshots at its replay clock.
"""
from copy import deepcopy
import math
from core.instruments import instrument_map, round_to_tick

INSTRUMENTS = {k:v for k,v in instrument_map().items() if k in ('MNQ','NQ','MES','ES')}

def validate_order(order, reference, spec):
    if order.get('side') not in ('buy','sell') or order.get('type') not in ('market','limit','stop'):
        raise ValueError('Choose Buy / Sell and Market / Limit / Stop.')
    qty=order.get('qty')
    if isinstance(qty,bool) or not isinstance(qty,int) or not 1<=qty<=50:
        raise ValueError('Quantity must be a whole number from 1 to 50.')
    instrument=INSTRUMENTS[spec['instrument']]
    for field in ('price','stop','target'):
        value=order.get(field)
        if value is not None and (not isinstance(value,(float,int)) or not math.isfinite(value) or value<=0 or abs(round_to_tick(value,instrument.tick_size)-value)>1e-8):
            raise ValueError(f'{field.title()} must be a positive price in {instrument.tick_size} ticks.')
    price=reference if order['type']=='market' else order.get('price')
    if price is None:raise ValueError('Enter an order price.')
    sign=1 if order['side']=='buy' else -1
    if order['type']=='limit' and (price-reference)*sign>0:
        raise ValueError('A buy limit goes at/below price; a sell limit goes at/above price.')
    if order['type']=='stop' and (price-reference)*sign<0:
        raise ValueError('A buy stop goes at/above price; a sell stop goes at/below price.')
    if order.get('stop') is not None and (price-order['stop'])*sign<=0:
        raise ValueError('The stop loss must be on the loss side of entry.')
    if order.get('target') is not None and (order['target']-price)*sign<=0:
        raise ValueError('The target must be on the profit side of entry.')
    return {k:order.get(k) for k in ('side','type','qty','price','stop','target')}

def project(bars, spec, commands):
    if not bars:raise ValueError('This session has no candles.')
    instrument=INSTRUMENTS[spec['instrument']]
    capital=float(spec['capital']);fee=float(spec['commission']);slip=spec['slippage']*instrument.tick_size
    if not math.isfinite(capital) or capital<=0 or not 0<=fee<=100 or not 0<=spec['slippage']<=20:
        raise ValueError('Invalid simulation costs or capital.')
    start=spec['start_cursor']
    if not 0<=start<len(bars):raise ValueError('Invalid session start.')
    balance=capital;position=None;order=None;closing=False
    frames=[];trades=[];fills=[];by_cursor={};previous=start
    for command in commands:
        at=command['at']
        if at<previous or at>=len(bars):raise ValueError('Replay actions must be in time order.')
        previous=at;by_cursor.setdefault(at,[]).append(command)
    def fill_event(i,kind,**values):fills.append({'cursor':i,'time':bars[i]['time'],'kind':kind,**values})
    def exit_position(i,price,reason):
        nonlocal balance,position,closing
        direction=1 if position['side']=='buy' else -1
        gross=(price-position['entry'])*direction*instrument.multiplier*position['qty']
        balance+=gross-fee*position['qty']
        trades.append({**position,'exit':price,'exit_cursor':i,'exit_time':bars[i]['time'],'reason':reason,
                       'gross':round(gross,2),'fees':round(2*fee*position['qty'],2),'net':round(gross-2*fee*position['qty'],2)})
        fill_event(i,'exit',side=position['side'],price=price,qty=position['qty'],reason=reason)
        position=None;closing=False
    for i in range(start,len(bars)):
        bar=bars[i];new_intrabar=False
        if closing and position:exit_position(i,bar['open']-slip*(1 if position['side']=='buy' else -1),'close')
        if order and i>order['submitted']:
            sign=1 if order['side']=='buy' else -1
            price=None
            if order['type']=='market':price=bar['open']+slip*sign
            elif order['type']=='limit':
                if (bar['open']-order['price'])*sign<=0:price=bar['open']
                elif (bar['low']<=order['price'] if sign==1 else bar['high']>=order['price']):price=order['price'];new_intrabar=True
            else:
                if (bar['open']-order['price'])*sign>=0:price=bar['open']+slip*sign
                elif (bar['high']>=order['price'] if sign==1 else bar['low']<=order['price']):price=order['price']+slip*sign;new_intrabar=True
            if price is not None:
                position={k:order[k] for k in ('side','qty','stop','target')}
                position['original_stop']=order.get('stop')
                position.update(entry=round_to_tick(price,instrument.tick_size),entry_cursor=i,entry_time=bar['time'],instrument=spec['instrument'])
                balance-=fee*position['qty'];fill_event(i,'entry',side=position['side'],qty=position['qty'],price=position['entry']);order=None
        if position:
            sign=1 if position['side']=='buy' else -1
            stop=position.get('stop');target=position.get('target')
            stopped=stop is not None and (bar['low']<=stop if sign==1 else bar['high']>=stop)
            targeted=target is not None and (bar['high']>=target if sign==1 else bar['low']<=target)
            if stopped:
                # The candle open preceded an intrabar entry, so it cannot be
                # used as a gap exit for that newly opened position.
                base=stop if new_intrabar else (min(stop,bar['open']) if sign==1 else max(stop,bar['open']))
                price=base-slip*sign
                exit_position(i,round_to_tick(price,instrument.tick_size),'stop')
            elif targeted and not new_intrabar:
                exit_position(i,max(target,bar['open']) if sign==1 else min(target,bar['open']),'target')
        if i==len(bars)-1:
            if position:exit_position(i,bar['close']-slip*(1 if position['side']=='buy' else -1),'session end')
            if order:fill_event(i,'cancel',reason='Session ended');order=None
        for command in by_cursor.get(i,[]):
            kind=command['kind']
            if kind=='order':
                if position or order or closing:raise ValueError('Close the position or cancel the pending order before entering again.')
                if i==len(bars)-1:raise ValueError('The session has ended.')
                if balance<=0:raise ValueError('No practice capital remains.')
                order=validate_order(command['order'],bar['close'],spec);order['submitted']=i
            elif kind=='amend':
                if order:
                    submitted=order['submitted']
                    order=validate_order({**order,**command['order'],'side':order['side'],'type':order['type'],'qty':order['qty']},bar['close'],spec)
                    order['submitted']=submitted
                    continue
                if not position or closing:raise ValueError('There is no editable open position.')
                proposed=validate_order({**command['order'],'side':position['side'],'type':'market','qty':position['qty']},bar['close'],spec)
                position['stop']=proposed['stop'];position['target']=proposed['target']
            elif kind=='cancel':
                if order:fill_event(i,'cancel',reason='Cancelled by you')
                order=None
            elif kind=='close':
                if not position or closing:raise ValueError('There is no open position to close.')
                closing=True
            else:raise ValueError('Unknown replay action.')
        unrealized=0 if not position else (bar['close']-position['entry'])*(1 if position['side']=='buy' else -1)*instrument.multiplier*position['qty']
        visible_position=deepcopy(position)
        if visible_position:visible_position['closing']=closing
        ticket=None
        active=position or order
        if active:
            reference=position['entry'] if position else (order.get('price') or bar['close'])
            direction=1 if active['side']=='buy' else -1
            ticket={'pending':position is None,'reference':reference,'qty':active['qty'],'side':active['side'],
                    'stop_price':active.get('stop') if active.get('stop') is not None else reference,
                    'target_price':active.get('target') if active.get('target') is not None else reference}
            for field in ('stop','target'):
                price=active.get(field)
                ticket[field+'_result']=None if price is None else round((price-reference)*direction*instrument.multiplier*active['qty'],2)
        frames.append({'ticket':ticket,'cursor':i,'balance':round(balance,2),'equity':round(balance+unrealized,2),'unrealized':round(unrealized,2),
                       'position':visible_position,'order':deepcopy(order)})
    return {'frames':frames,'trades':trades,'fills':fills}


def ticket_result(reference,price,side,qty,instrument):
    if side not in ('buy','sell') or instrument not in INSTRUMENTS or not 1<=qty<=50 or not all(math.isfinite(v) and v>0 for v in (reference,price)):
        raise ValueError('Invalid ticket preview.')
    return round((price-reference)*(1 if side=='buy' else -1)*INSTRUMENTS[instrument].multiplier*qty,2)
