import {describe,it,expect,vi} from 'vitest';
import {installDrawingPerformance,latestLayoutWriter} from './replayDrawingPerformance';

function fixture(){
 let id=0;const frames=new Map();const schedule=fn=>{frames.set(++id,fn);return id},cancel=id=>frames.delete(id);
 const painted=vi.fn(),committed=vi.fn(),moved=vi.fn();
 const layer={drawings:[],deps:{chartBarMs:()=>60000},render:painted,pointerMove(...args){moved(...args);this.render()},pointerDown:vi.fn(),pointerUp:committed,handleKey:vi.fn(),onScreen(){return this.drawings.slice()}};
 const native={userDrawings:layer,bars:Array.from({length:1000},(_,i)=>({time:i*60000})),barsInTimeRange:vi.fn()};
 return {layer,native,painted,committed,moved,frames,install:()=>installDrawingPerformance({renderer:{renderer:native}},schedule,cancel),tick:()=>{const work=[...frames.values()];frames.clear();work.forEach(fn=>fn())}};
}
describe('drawing interaction scheduling',()=>{
 it('coalesces paints and pointer bursts while preserving the final release and cleanup',()=>{
  const f=fixture(),release=f.install();
  for(let i=0;i<200;i++)f.layer.pointerMove(i,20);
  expect(f.moved).not.toHaveBeenCalled();f.layer.pointerUp(199,20);
  expect(f.moved).toHaveBeenCalledExactlyOnceWith(199,20);
  expect(f.committed).toHaveBeenCalledExactlyOnceWith(199,20);
  for(let i=0;i<200;i++)f.layer.render();f.tick();expect(f.painted).toHaveBeenCalledTimes(1);
  f.layer.pointerMove(5,6);release();f.tick();expect(f.moved).toHaveBeenCalledTimes(1);expect(f.frames.size).toBe(0);
 });
 it('Escape discards pending movement and preserves native undo/keyboard handling',()=>{
  const f=fixture();f.install();f.layer.pointerMove(10,15);f.layer.handleKey({key:'Escape'});f.tick();expect(f.moved).not.toHaveBeenCalled();expect(f.layer.handleKey).toBeTypeOf('function');
 });
 it('searches exact inclusive ranges, reversed endpoints, empty ranges and changed arrays',()=>{
  const f=fixture(),original=f.native.barsInTimeRange,release=f.install();
  expect(f.native.barsInTimeRange(59940000,59880000)).toEqual(f.native.bars.slice(998));
  expect(f.native.barsInTimeRange(1,2)).toEqual([]);f.native.bars=[{time:5}];expect(f.native.barsInTimeRange(5,5)).toEqual([{time:5}]);release();expect(f.native.barsInTimeRange).toBe(original);
 });
 it('invalidates visible drawings when documents or timeframe change',()=>{
  const f=fixture();f.install();const first=f.layer.onScreen();expect(f.layer.onScreen()).toBe(first);f.layer.drawings=[{id:'new'}];expect(f.layer.onScreen()).toEqual([{id:'new'}]);
 });
});
it('retains only the latest pending layout and waits for it before resolving',async()=>{
 let done;const sent=[];const write=latestLayoutWriter(value=>{sent.push(value);return new Promise(resolve=>{done=resolve})});
 const first=write('first');write('obsolete');const final=write('last');expect(sent).toEqual(['first']);done();await Promise.resolve();expect(sent).toEqual(['first','last']);done();await final;await first;
});
it('allows retry after a failed layout write',async()=>{
 const fn=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce();const write=latestLayoutWriter(fn);
 await expect(write('old')).rejects.toThrow('offline');await write('new');expect(fn).toHaveBeenLastCalledWith('new');
});
