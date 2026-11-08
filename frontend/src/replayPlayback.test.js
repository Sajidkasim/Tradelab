import {test,expect,vi} from 'vitest';
import {startReplayClock} from './replayClock';
function harness(state={enabled:true,speed:1},advance=vi.fn()){
 let callback,id=0;const cancel=vi.fn();
 const stop=startReplayClock({read:()=>state,advance,requestFrame:cb=>{callback=cb;return ++id},cancelFrame:cancel});
 return {state,advance,stop,cancel,frame:time=>{const cb=callback;callback=null;cb(time)}};
}
test.each([60,120])('paces 32 replay steps/second without drift at %i Hz',hz=>{
 const h=harness({enabled:true,speed:32});
 for(let i=0;i<=hz*60;i++)h.frame(i*1000/hz);
 expect(h.advance.mock.calls.reduce((sum,[steps])=>sum+steps,0)).toBe(1920);
 expect(h.advance.mock.calls.every(([steps])=>steps===1)).toBe(true);
 h.stop();expect(h.cancel).toHaveBeenCalledOnce();
});
test('batches due ticks once per frame, keeps fractional time, and reads live speed',()=>{
 const h=harness({enabled:true,speed:32});h.frame(0);h.frame(100);h.frame(200);
 expect(h.advance.mock.calls).toEqual([[3],[3]]);
 h.state.speed=4;h.frame(350);expect(h.advance.mock.calls).toEqual([[3],[3],[1]]);
 h.state.enabled=false;h.frame(400);h.frame(5000);
 h.state.enabled=true;h.frame(6000);h.frame(6250);
 expect(h.advance.mock.calls).toEqual([[3],[3],[1],[1]]);
 h.stop();
});
test('does not build up catch-up work during a suspended display or async continuation',async()=>{
 let resolve;const advance=vi.fn(()=>new Promise(done=>{resolve=done}));
 const h=harness({enabled:true,speed:4},advance);h.frame(0);h.frame(250);
 h.frame(500);h.frame(10000);expect(advance).toHaveBeenCalledOnce();
 resolve();await Promise.resolve();h.frame(11000);expect(advance).toHaveBeenCalledOnce();
 h.frame(11250);expect(advance).toHaveBeenCalledTimes(2);resolve();h.stop();
});
test('catches up a delayed frame once, but discards suspended-tab time and stops on cancel',()=>{
 const h=harness({enabled:true,speed:32});h.frame(0);h.frame(375);h.frame(500);
 expect(h.advance.mock.calls).toEqual([[12],[4]]);
 h.frame(10000);expect(h.advance).toHaveBeenCalledTimes(2);
 h.frame(10250);expect(h.advance.mock.calls.at(-1)).toEqual([8]);
 h.stop();h.frame(10500);expect(h.advance).toHaveBeenCalledTimes(3);
});
