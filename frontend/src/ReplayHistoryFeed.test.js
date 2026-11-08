import {test,expect,vi,beforeEach} from 'vitest';
vi.mock('./api',()=>({api:vi.fn()}));
import {api} from './api';
import {ReplayHistoryFeed} from './ReplayHistoryFeed';
const t=Date.parse('2023-09-12T14:00:00Z');
const bar=(time,close)=>({time,open:close,high:close+1,low:close-1,close,volume:2});
beforeEach(()=>{api.mockReset()});
test('deduplicates requests, caches by symbol/timeframe, and advances only that symbol',async()=>{
 let now=t;const markets={NQ:{bars:[bar(t,100),bar(t+60000,102)]},ES:{bars:[bar(t,5000),bar(t+60000,5002)]}};
 api.mockImplementation(async url=>{const q=new URL(url,'http://local').searchParams;const root=q.get('root');return {bars:[bar(t,root==='NQ'?100:5000)],replay_time:t,earliest:t-86400000,latest:t+86400000,exhausted:true}});
 const feed=new ReplayHistoryFeed('id',()=>({cursor:0,time:now,markets}),()=>{});
 await Promise.all([feed.initial('NQ','240'),feed.initial('NQ','240')]);expect(api).toHaveBeenCalledTimes(1);
 await feed.initial('ES','240');now+=60000;
 expect(feed.view('NQ','240').at(-1).close).toBe(102);expect(feed.view('ES','240').at(-1).close).toBe(5002);
 expect(feed.view('NQ','240').at(-1).volume).toBe(4);expect(feed.view('NQ','240').at(-1).volume).toBe(4);
 await feed.initial('NQ','240');expect(api).toHaveBeenCalledTimes(2);
 feed.anchor=t-3600000;await feed.initial('NQ','1D');expect(new URL(api.mock.calls.at(-1)[0],'http://local').searchParams.has('before')).toBe(false);
});
test('aborting a stale load removes its pending request and never caches it',async()=>{
 const feed=new ReplayHistoryFeed('id',()=>({cursor:0,time:t,markets:{NQ:{bars:[]}}}),()=>{});
 api.mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')))));
 const job=feed.initial('NQ','240');feed.cancel();await expect(job).rejects.toHaveProperty('name','AbortError');expect(feed.slot('NQ','240')).toBeUndefined();expect(feed.requests.size).toBe(0);
});

test('bounds initial history, extended playback and forward jumps to 3000 candles',async()=>{
 const minutes=Array.from({length:12000},(_,i)=>bar(t+i*60000,i));let now=minutes[4999].time;
 api.mockResolvedValue({bars:minutes.slice(0,5000),exhausted:true,replay_time:now});
 const feed=new ReplayHistoryFeed('id',()=>({cursor:0,time:now,markets:{NQ:{bars:minutes}}}),()=>{});
 expect(await feed.initial('NQ','1')).toHaveLength(3000);expect(feed.slot('NQ','1').leftDone).toBe(false);
 for(let i=5000;i<5200;i++){now=minutes[i].time;const shown=feed.view('NQ','1');expect(shown.length).toBeLessThanOrEqual(3000);expect(shown.at(-1)).toEqual(minutes[i])}
 now=minutes.at(-1).time;const shown=feed.view('NQ','1');
 expect(shown.length).toBeLessThanOrEqual(3000);expect(shown.at(-1)).toEqual(minutes.at(-1));
 expect(feed.view('NQ','1')).toBe(shown);expect(minutes).toHaveLength(12000);
});
test('evicted context can be paged left and back to the live tail without growing memory',async()=>{
 const minutes=Array.from({length:6000},(_,i)=>bar(t+i*60000,i));let now=minutes[4999].time;
 api.mockImplementation(async url=>{
  const q=new URL(url,'http://local').searchParams;const before=Number(q.get('before')??now+1),after=Number(q.get('after')??-1);
  const eligible=minutes.filter(b=>b.time<before&&b.time>after&&b.time<=now);
  const selected=q.has('after')?eligible.slice(0,750):eligible.slice(-750);
  return {bars:selected,exhausted:eligible.length<=750,replay_time:now};
 });
 const feed=new ReplayHistoryFeed('id',()=>({cursor:0,time:now,markets:{NQ:{bars:minutes}}}),()=>{});
 await feed.initial('NQ','1');
 for(let i=0;i<7;i++){await feed.page('NQ','1','left');expect(feed.slot('NQ','1').bars.length).toBeLessThanOrEqual(3000)}
 expect(feed.slot('NQ','1').bars[0]).toEqual(minutes[0]);expect(feed.slot('NQ','1').atTail).toBe(false);
 now=minutes[5001].time;expect(feed.view('NQ','1').at(-1).time).toBeLessThan(now);
 for(let i=0;i<8&&!feed.slot('NQ','1').atTail;i++){await feed.page('NQ','1','right');expect(feed.slot('NQ','1').bars.length).toBeLessThanOrEqual(3000)}
 expect(feed.slot('NQ','1').atTail).toBe(true);expect(feed.slot('NQ','1').bars.at(-1)).toEqual(minutes[5001]);
 now=minutes[5002].time;expect(feed.view('NQ','1').at(-1)).toEqual(minutes[5002]);
});
test('returning from historical context refreshes a formerly partial higher-timeframe candle',async()=>{
 let now=t;const minutes=[bar(t,100),bar(t+60000,110)];
 api.mockResolvedValueOnce({bars:[bar(t,100)],exhausted:true,replay_time:t});
 const feed=new ReplayHistoryFeed('id',()=>({cursor:0,time:now,markets:{NQ:{bars:minutes}}}),()=>{});
 await feed.initial('NQ','5');const slot=feed.slot('NQ','5');slot.atTail=false;slot.rightDone=false;
 now+=60000;expect(feed.view('NQ','5').at(-1).close).toBe(100);
 const updated={...bar(t,100),high:111,close:110,volume:4};
 api.mockResolvedValueOnce({bars:[updated],exhausted:true,replay_time:now});
 expect(await feed.page('NQ','5','right')).toEqual([updated]);
 expect(new URL(api.mock.calls.at(-1)[0],'http://local').searchParams.get('after')).toBe(String(t-1));
 expect(feed.view('NQ','5')).toEqual([updated]);
});
