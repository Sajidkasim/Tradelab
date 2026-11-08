import {MAX_CHART_BARS} from './ReplayHistoryFeed';
import {holdReplayViewport,replaceReplayHistory} from './replayViewport';

// Normal ticks use the provider's live callback. Replace the series only when
// the bounded window moves its oldest edge; never reload the market for playback.
export function streamReplayBars(chart,subscribers,previous,bars,{follow=false,jump=false}={}){
 if(bars.length>MAX_CHART_BARS)throw Error('Replay history exceeded its memory window');
 if(bars[0]?.time!==previous[0]?.time){
  replaceReplayHistory(chart,bars);
  if(follow||jump)chart.panBy(10000);
  return;
 }
 const last=previous.at(-1)?.time??-Infinity;
 let low=0,high=bars.length;
 while(low<high){const middle=(low+high)>>>1;if(bars[middle].time<last)low=middle+1;else high=middle}
 const updates=bars.slice(low);
 const restore=!follow&&!jump?holdReplayViewport(chart,updates.filter(bar=>bar.time>last).length):()=>{};
 for(const callback of subscribers||[]){
  if(updates.length>1&&callback.appendMany)callback.appendMany(updates);
  else for(const bar of updates)callback(bar);
 }
 restore();
 if(jump)chart.panBy(10000);
}
