import {test,expect} from 'vitest';
import {replayBucketOpen} from './replayHistoryCalendar';
test('calendar follows NY session DST, Monday trading weeks and calendar months',()=>{
 const at=s=>Date.parse(s);
 expect(replayBucketOpen(at('2023-03-13T22:00:00Z'),'1D')).toBe(at('2023-03-13T22:00:00Z'));
 expect(replayBucketOpen(at('2023-03-06T23:00:00Z'),'1D')).toBe(at('2023-03-06T23:00:00Z'));
 expect(replayBucketOpen(at('2023-09-12T14:00:00Z'),'1W')).toBe(at('2023-09-10T22:00:00Z'));
 expect(replayBucketOpen(at('2023-09-12T14:00:00Z'),'1M')).toBe(at('2023-08-31T22:00:00Z'));
});
