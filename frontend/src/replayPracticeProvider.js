import {MAX_CHART_BARS} from './ReplayHistoryFeed';

// Vela 0.9.3's provider callback takes ONE candle, never an array. This bridge
// reconciles a multi-minute reveal into one bounded canonical series update.
export function appendPracticeBars(chart,updates){
 if(!updates.length)return;
 const core=chart.orchestrator;
 if(!core?.setBarSeries)throw Error('This Vela version does not support batched replay history.');
 const previous=core.rawBars||[];
 let low=0,high=previous.length;
 while(low<high){const mid=(low+high)>>>1;if(previous[mid].time<updates[0].time)low=mid+1;else high=mid}
 const bars=previous.slice(0,low).concat(updates);
 if(bars.length>MAX_CHART_BARS)throw Error('Replay history exceeded its memory window');
 core.setBarSeries(bars,{preserveView:true});
 core.notifySessionsBars('backfill');
}
export function subscribePractice(chart,subscribers,callback){
 const listener=bar=>callback(bar);
 listener.appendMany=updates=>appendPracticeBars(chart,updates);
 subscribers.add(listener);
 return()=>subscribers.delete(listener);
}
