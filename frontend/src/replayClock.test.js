import {it,expect} from 'vitest';
import {nextReplayCursor,revealedBars,clockParts,nextSessionCursor,replayZone,savedJumpSettings} from './replayClock';
import {aggregateMinuteBars} from './backtestingBars';
const t=Date.UTC(2026,10,2,13,0);
const bars=[0,1,2,8,9].map((m,i)=>({time:t+m*60000,open:100+i,high:101+i,low:99+i,close:100+i,volume:1}));
it('steps to the next available candle through gaps and stops at the end',()=>{
 expect(nextReplayCursor(bars,2,1)).toBe(3);
 expect(nextReplayCursor(bars,1,5)).toBe(2);
 expect(nextReplayCursor(bars,4,60)).toBe(4);
});
it('an unfinished higher-timeframe candle never includes future highs, closes or volume',()=>{
 const shown=aggregateMinuteBars(revealedBars(bars,t+60000),'5');
 expect(shown).toEqual([{time:t,open:100,high:102,low:99,close:101,volume:2}]);
 expect(revealedBars(bars,t-1)).toEqual([]);
});
it('shows the same instant in New York and London across their different DST dates',()=>{
 expect(clockParts(Date.parse('2026-01-25T14:30:00Z'),'America/New_York').time).toBe('09:30:00');
 expect(clockParts(Date.parse('2026-07-25T13:30:00Z'),'America/New_York').time).toBe('09:30:00');
 expect(clockParts(Date.parse('2026-03-15T13:30:00Z'),'Europe/London').time).toBe('13:30:00');
 expect(clockParts(Date.parse('2026-07-25T13:30:00Z'),'Europe/London').time).toBe('14:30:00');
});
it('jumps only forward to the first available session candle, including gaps',()=>{
 const session=['13:00','13:28','13:30','13:31'].map(time=>({time:Date.parse(`2026-07-25T${time}:00Z`)}));
 expect(nextSessionCursor(session,0,'09:30')).toBe(2);
 expect(nextSessionCursor(session,2,'09:30')).toBeNull();
 expect(nextSessionCursor(session,0,'25:00')).toBeNull();
 expect(nextSessionCursor([],0,'09:30')).toBeNull();
 const winter=['14:00','14:29','14:30'].map(time=>({time:Date.parse(`2026-01-25T${time}:00Z`)}));
 expect(nextSessionCursor(winter,0,'09:30')).toBe(1);
});
it('recovers safe clock and jump preferences from malformed browser settings',()=>{
 expect(replayZone('Europe/London')).toBe('Europe/London');
 expect(replayZone('bad/zone')).toBe('America/New_York');
 expect(savedJumpSettings('null').favorite).toBe('newyork');
 expect(savedJumpSettings('{"favorite":"bad","london":"99:99"}').london).toBe('02:00');
 expect(savedJumpSettings('{"favorite":"london","london":"03:00"}').favorite).toBe('london');
});
it('labels the replay clock with a DST-aware UTC offset in 24h format',async()=>{
 const {replayClockLabel}=await import('./replayClock');
 expect(replayClockLabel(Date.parse('2026-07-06T18:32:05Z'),'America/New_York')).toBe('14:32:05 (UTC-4)');
 expect(replayClockLabel(Date.parse('2026-01-05T19:32:05Z'),'America/New_York')).toBe('14:32:05 (UTC-5)');
 expect(replayClockLabel(Date.parse('2026-07-06T18:32:05Z'),'UTC')).toBe('18:32:05 (UTC)');
});

it('continuation preserves the selected 60-minute step and processes only available candles across the NY break',async()=>{
 const {nextContinuedReplayCursor}=await import('./replayClock');
 for(const [day,offset] of [['2026-01-05','-05:00'],['2026-07-06','-04:00']]){
  const start=Date.parse(day+'T16:59:00'+offset);
  const bars=[{time:start},...Array.from({length:121},(_,i)=>({time:start+(61+i)*60000}))];
  const reply={sample:{markets:{NQ:{bars}}}};
  expect(nextContinuedReplayCursor(reply,'NQ',0,60)).toBe(1);
  expect(nextContinuedReplayCursor(reply,'NQ',1,60)).toBe(61);
  expect(nextContinuedReplayCursor(reply,'NQ',0,60,2)).toBe(61);
  expect(()=>nextContinuedReplayCursor({},'NQ',0,60)).toThrow('unavailable');
 }
});
