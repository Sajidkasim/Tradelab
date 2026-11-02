import {expect,it} from 'vitest';
import {aggregateMinuteBars} from './backtestingBars';
const t=Date.UTC(2026,10,2,13,0);
const bars=[
 {time:t,open:100,high:105,low:99,close:103,volume:10},
 {time:t+60000,open:103,high:104,low:97,close:98,volume:15},
 {time:t+4*60000,open:98,high:106,low:98,close:105,volume:7},
 {time:t+10*60000,open:108,high:110,low:107,close:109,volume:3},
];
it('aggregates UTC candle buckets with first open, extrema, last close and summed volume',()=>{
 expect(aggregateMinuteBars(bars,'5')).toEqual([
  {time:t,open:100,high:106,low:97,close:105,volume:32},
  {time:t+10*60000,open:108,high:110,low:107,close:109,volume:3},
 ]);
});
it('preserves gaps and does not mutate the one-minute source when aggregating or returning it',()=>{
 const copy=structuredClone(bars);
 aggregateMinuteBars(bars,'60');const one=aggregateMinuteBars(bars,'1');one[0].close=0;
 expect(bars).toEqual(copy);expect(one).toHaveLength(4);
 expect(aggregateMinuteBars([],'5')).toEqual([]);
});
it('rejects unsupported resolutions and unordered or duplicate timestamps',()=>{
 expect(()=>aggregateMinuteBars(bars,'15s')).toThrow();
 expect(()=>aggregateMinuteBars([bars[1],bars[0]],'5')).toThrow();
 expect(()=>aggregateMinuteBars([bars[0],bars[0]],'5')).toThrow();
});

it('supports custom minute/hour buckets and safely restores saved choices',async()=>{
 const {savedTimeframes,timeframeLabel}=await import('./backtestingBars');
 expect(savedTimeframes('bad')).not.toContain('2');
 expect(savedTimeframes('["3","90","90","1D",0]')).toEqual(['3','90','1D']);
 expect(timeframeLabel('120')).toBe('2h');expect(timeframeLabel('90')).toBe('90m');
 const result=aggregateMinuteBars(bars,'3');expect(result[0].volume).toBe(25);
 expect(()=>aggregateMinuteBars(bars,'0')).toThrow();expect(aggregateMinuteBars(bars,'1D')).toHaveLength(1);
});

it('calendar candles combine earlier sessions and never reveal future minutes',async()=>{
 const {chartHistory}=await import('./backtestingBars');
 const market={history:[{time:Date.UTC(2026,10,1),open:80,high:95,low:79,close:90,volume:20}],bars};
 const current=chartHistory(market,t,'1M');expect(current).toHaveLength(1);expect(current[0].open).toBe(80);expect(current[0].high).toBe(105);expect(current[0].volume).toBe(30);
 expect(chartHistory(market,t,'1W')).toHaveLength(2);
});
