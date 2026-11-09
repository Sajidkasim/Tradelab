import {test,expect} from 'vitest';
import {replayNewsDay,newsWeek,newsActual,newsImpact} from './replayNews';
test('news date follows the candle calendar date in New York, independently of futures rollover',()=>{
 for(const [day,offset] of [['2026-01-05','-05:00'],['2026-07-06','-04:00']]){
  expect(replayNewsDay(Date.parse(day+'T16:59:00'+offset))).toBe(day);
  expect(replayNewsDay(Date.parse(day+'T17:00:00'+offset))).toBe(day);
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

test('historical May 2015 date keeps its year, even after 17:00 NY and near midnight',()=>{
 for(const clock of ['08:30','17:01','23:59'])expect(replayNewsDay(Date.parse('2015-05-15T'+clock+':00-04:00'))).toBe('2015-05-15');
 expect(replayNewsDay(Date.parse('2015-05-16T00:00:00-04:00'))).toBe('2015-05-16');
});

test('missing or invalid cursor dates and malformed event payloads are safe',async()=>{
 const {validNewsDate,safeNewsEvents}=await import('./replayNews');
 for(const value of [undefined,null,'','invalid','2015-02-30',{},NaN]){
  expect(validNewsDate(value)).toBe(false);expect(newsWeek(value)).toEqual([]);
 }
 expect(replayNewsDay(undefined)).toBeNull();expect(replayNewsDay(null)).toBeNull();
 for(const rows of [null,undefined,{},'oops'])expect(safeNewsEvents(rows)).toEqual([]);
 expect(safeNewsEvents([null,undefined,{}, {impact:null,event:{bad:true}}])).toHaveLength(2);
 expect(safeNewsEvents([{}])[0]).toMatchObject({impact:'Low',event:'Economic event'});
});
