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

it('4h candles retain their full preceding minute context and share the replay cutoff',async()=>{
 const {chartHistory}=await import('./backtestingBars');
 const start=Date.UTC(2020,5,2,10);
 const context=Array.from({length:120},(_,i)=>({time:start+i*60000,open:100,high:105,low:95,close:101,volume:1}));
 const today=Array.from({length:180},(_,i)=>({time:start+(120+i)*60000,open:101,high:i===179?999:106,low:94,close:102,volume:1}));
 const market={context,bars:today},clock=start+179*60000;
 const four=chartHistory(market,clock,'240');
 expect(four).toEqual([{time:start,open:100,high:106,low:94,close:102,volume:180}]);
 expect(chartHistory(market,clock,'1').at(-1).time).toBe(clock);
 expect(chartHistory(market,clock,'60').at(-1).high).toBe(106);
});

it('4h uses complete older archive candles without mixing daily candles or future prices',async()=>{
 const {chartHistory}=await import('./backtestingBars');
 const t=Date.UTC(2020,5,2);
 const market={bars:[{time:t,open:110,high:112,low:109,close:111,volume:5},{time:t+60000,open:111,high:999,low:109,close:998,volume:5}],context:[],four_hour_history_ny:[{time:t-86400000,open:100,high:105,low:99,close:101,volume:2400}]};
 const bars=chartHistory(market,t,'240');
 expect(bars).toHaveLength(2);expect(bars[0].volume).toBe(2400);expect(bars[1].high).toBe(112);
});

it('anchors winter and summer 4H to NY clock and leaves weekend closed',async()=>{
 const {nyFourHourOpen}=await import('./backtestingBars');
 for(const [day,offset] of [['2026-01-05','-05:00'],['2026-07-06','-04:00']])for(const hour of [2,6,10,14,18,22]){
  const t=Date.parse(`${day}T${String(hour).padStart(2,'0')}:00:00${offset}`);expect(nyFourHourOpen(t+60000)).toBe(t);
 }
 expect(nyFourHourOpen(Date.parse('2026-03-08T17:59:00-04:00'))).toBeNull();
 expect(nyFourHourOpen(Date.parse('2026-03-08T18:01:00-04:00'))).toBe(Date.parse('2026-03-08T18:00:00-04:00'));
 expect(nyFourHourOpen(Date.parse('2026-11-01T18:01:00-05:00'))).toBe(Date.parse('2026-11-01T18:00:00-05:00'));
});
it('prebuilt replay arrays show partial highs and volume without leaking future data',async()=>{
 const {buildMarketCache,registerMarketCache,chartHistory}=await import('./backtestingBars');
 const source=[{time:Date.parse('2026-07-06T10:00:00-04:00'),open:100,high:102,low:99,close:101,volume:3},{time:Date.parse('2026-07-06T10:01:00-04:00'),open:101,high:999,low:1,close:998,volume:100}];
 const market={bars:source};registerMarketCache(market,buildMarketCache(market));
 for(const tf of ['1','5','15','60','240','1D']){
  const first=chartHistory(market,source[0].time,tf).at(-1);expect(first.high).toBe(102);expect(first.low).toBe(99);expect(first.volume).toBe(3);
  expect(chartHistory(market,source[1].time,tf).at(-1).high).toBe(999);
 }
 expect(source[0].high).toBe(102);
});
