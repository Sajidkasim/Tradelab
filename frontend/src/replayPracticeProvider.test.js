import {test,expect,vi} from 'vitest';
import {appendPracticeBars,subscribePractice} from './replayPracticeProvider';
import {streamReplayBars} from './replayChartStream';
const bar=time=>({time,open:100,high:101,low:99,close:100,volume:1});
test('a 60-minute step reaches the practice provider as one bounded array update',()=>{
 const previous=Array.from({length:750},(_,i)=>bar(i*60000));
 const updates=Array.from({length:61},(_,i)=>bar((749+i)*60000));
 const chart={setMarket:vi.fn(),orchestrator:{rawBars:previous,setBarSeries:vi.fn(),notifySessionsBars:vi.fn()}};
 const subscribers=new Set(),callback=vi.fn(),release=subscribePractice(chart,subscribers,callback);
 streamReplayBars(chart,subscribers,previous,previous.slice(0,-1).concat(updates));
 expect(callback).not.toHaveBeenCalled();expect(chart.setMarket).not.toHaveBeenCalled();
 expect(chart.orchestrator.setBarSeries).toHaveBeenCalledOnce();
 expect(chart.orchestrator.setBarSeries.mock.calls[0][0]).toEqual(previous.slice(0,-1).concat(updates));
 expect(chart.orchestrator.notifySessionsBars).toHaveBeenCalledOnce();
 expect(previous).toHaveLength(750);release();expect(subscribers.size).toBe(0);
});
test('single forming candles remain incremental and overflowing batches are rejected before writing',()=>{
 const chart={orchestrator:{rawBars:[bar(0)],setBarSeries:vi.fn(),notifySessionsBars:vi.fn()}};
 const subscribers=new Set(),callback=vi.fn();subscribePractice(chart,subscribers,callback);
 streamReplayBars(chart,subscribers,[bar(0)],[{...bar(0),close:101}]);
 expect(callback).toHaveBeenCalledWith(expect.objectContaining({close:101}));
 expect(chart.orchestrator.setBarSeries).not.toHaveBeenCalled();
 expect(()=>appendPracticeBars(chart,Array.from({length:3001},(_,i)=>bar(i*60000)))).toThrow('memory window');
 expect(chart.orchestrator.setBarSeries).not.toHaveBeenCalled();
});
