import {test,expect,vi,beforeEach} from 'vitest';
vi.mock('./api',()=>({api:vi.fn()}));
import {api} from './api';
import {ReplayHistoryFeed} from './ReplayHistoryFeed';
const t=Date.parse('2023-09-12T14:00:00Z');
const bar=(time,close)=>({time,open:close,high:close+1,low:close-1,close,volume:2});
beforeEach(()=>api.mockReset());
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
