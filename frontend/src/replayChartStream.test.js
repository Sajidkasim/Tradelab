import {test,expect,vi} from 'vitest';
vi.mock('./replayViewport',()=>({holdReplayViewport:vi.fn(()=>vi.fn()),replaceReplayHistory:vi.fn()}));
import {holdReplayViewport,replaceReplayHistory} from './replayViewport';
import {streamReplayBars} from './replayChartStream';
const bar=time=>({time,open:1,high:2,low:0,close:1});
test('ordinary playback batches incremental callbacks without setMarket or history replacement',()=>{
 vi.clearAllMocks();const chart={setMarket:vi.fn(),panBy:vi.fn()},callback=vi.fn();
 const previous=[bar(1),bar(2)],bars=[bar(1),{...bar(2),close:2},bar(3),bar(4)];
 streamReplayBars(chart,[callback],previous,bars);
 expect(callback.mock.calls).toEqual(bars.slice(1).map(b=>[b]));
 expect(holdReplayViewport).toHaveBeenCalledWith(chart,2);
 expect(holdReplayViewport.mock.results.at(-1).value).toHaveBeenCalledOnce();
 expect(replaceReplayHistory).not.toHaveBeenCalled();expect(chart.setMarket).not.toHaveBeenCalled();
});
test('eviction replaces only the bounded native series and leaves the Vela market mounted',()=>{
 vi.clearAllMocks();const chart={setMarket:vi.fn(),panBy:vi.fn()},callback=vi.fn();
 const previous=Array.from({length:3000},(_,i)=>bar(i)),bars=Array.from({length:2250},(_,i)=>bar(i+751));
 streamReplayBars(chart,[callback],previous,bars,{follow:true});
 expect(replaceReplayHistory).toHaveBeenCalledWith(chart,bars);expect(chart.panBy).toHaveBeenCalledOnce();
 expect(callback).not.toHaveBeenCalled();expect(chart.setMarket).not.toHaveBeenCalled();
 expect(()=>streamReplayBars(chart,[callback],bars,[...previous,bar(3000)])).toThrow('memory window');
});
