import {test,expect} from 'vitest';
import {replayNewsDay,newsWeek,newsActual,newsImpact} from './replayNews';
test('news session date follows 17:00 New York in winter and summer',()=>{
 for(const [day,offset] of [['2026-01-05','-05:00'],['2026-07-06','-04:00']]){
  expect(replayNewsDay(Date.parse(day+'T16:59:00'+offset))).toBe(day);
  expect(replayNewsDay(Date.parse(day+'T17:00:00'+offset))).not.toBe(day);
 }
});
test('week pills handle month boundaries and include weekends without shifting dates',()=>{
 const week=newsWeek('2026-11-01');expect(week).toHaveLength(7);
 expect(week[0]).toEqual({date:'2026-10-26',label:'MON',number:26});
 expect(week[6].date).toBe('2026-11-01');
});
test('future actuals stay hidden and impacts use three distinct levels',()=>{
 const event={timestamp_utc:100,actual:'0.3%'};
 expect(newsActual(event,99)).toBe('—');expect(newsActual(event,100)).toBe('0.3%');
 expect(['High','Medium','Low'].map(newsImpact)).toEqual([3,2,1]);
});
