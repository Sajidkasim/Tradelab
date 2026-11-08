import {test,expect} from 'vitest';
import {replayBucketOpen} from './replayHistoryCalendar';
test('calendar follows NY session DST, Monday trading weeks and calendar months',()=>{
 const at=s=>Date.parse(s);
 expect(replayBucketOpen(at('2023-03-13T21:00:00Z'),'1D')).toBe(at('2023-03-13T21:00:00Z'));
 expect(replayBucketOpen(at('2023-03-06T22:00:00Z'),'1D')).toBe(at('2023-03-06T22:00:00Z'));
 expect(replayBucketOpen(at('2023-09-12T14:00:00Z'),'1W')).toBe(at('2023-09-10T21:00:00Z'));
 expect(replayBucketOpen(at('2023-09-12T14:00:00Z'),'1M')).toBe(at('2023-08-31T21:00:00Z'));
});

test('minute aggregation and streamed daily buckets agree at 17:00 NY in both seasons',async()=>{
 const {aggregateMinuteBars}=await import('./backtestingBars');
 for(const edge of ['2026-01-05T22:00:00Z','2026-07-06T21:00:00Z','2026-03-08T21:00:00Z','2026-11-01T22:00:00Z']){
  const time=Date.parse(edge),bars=[time-60000,time,time+60000].map((t,i)=>({time:t,open:i,high:i+1,low:i-1,close:i,volume:1}));
  expect(replayBucketOpen(time,'1D')).toBe(time);
  expect(replayBucketOpen(time-60000,'1D')).toBeLessThan(time);
  const aggregated=aggregateMinuteBars(bars,'1D');expect(aggregated).toHaveLength(2);
  expect(aggregated[1]).toMatchObject({time,open:1,close:2,volume:2});
 }
});
