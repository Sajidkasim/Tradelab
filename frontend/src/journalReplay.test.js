import {describe,it,expect} from 'vitest';
import {advanceWindow,reachedExecutions} from './journalReplayWindow';
describe('Journal replay windows',()=>{
 it('caps active memory and advances forward in batches',()=>{
  const active=Array.from({length:3000},(_,time)=>({time})),pending=Array.from({length:750},(_,i)=>({time:3000+i}));
  const next=advanceWindow(active,pending,32);
  expect(next.active).toHaveLength(3000);expect(next.active[0].time).toBe(32);expect(next.pending).toHaveLength(718);
 });
 it('does not reveal executions before the cursor',()=>{
  const events=[{time:'2024-05-15T12:30:14Z'},{time:'2024-05-15T12:30:45Z'}];
  expect(reachedExecutions(events,Date.parse('2024-05-15T12:30:30Z'))).toHaveLength(1);
 });
});
