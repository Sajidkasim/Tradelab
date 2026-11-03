import {test,expect} from 'vitest';
import {replayFrames} from './replayFrames';
test('columnar snapshots reconstruct only the requested frame without financial calculations',()=>{
 const frames=replayFrames({encoding:'columns-v1',start:20,length:2,numbers:{balance:[100,99],equity:[101,100],unrealized:[1,1]},ids:{position:[0,1],ticket:[0,0],order:[0,0]},states:{position:[null,{entry:4}],ticket:[null],order:[null]}});
 expect(frames.length).toBe(2);expect(frames[0]).toEqual({cursor:20,balance:100,equity:101,unrealized:1,position:null,ticket:null,order:null});expect(frames[1].position.entry).toBe(4);expect(frames[2]).toBeUndefined();
 const legacy=[{cursor:1}];expect(replayFrames(legacy)).toBe(legacy);
});
