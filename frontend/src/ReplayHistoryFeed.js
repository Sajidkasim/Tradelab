import {recordTiming} from './replayTiming';
import {api} from './api';
import {replayBucketOpen} from './replayHistoryCalendar';
const merge=(a,b)=>[...new Map([...a,...b].map(bar=>[bar.time,bar])).values()].sort((a,b)=>a.time-b.time);
export const MAX_CHART_BARS=3000;
// Leave a page of headroom so native series replacement is occasional, not per tick.
const PLAYBACK_WINDOW=MAX_CHART_BARS-750;
function bound(slot,direction='right',limit=MAX_CHART_BARS){
 if(slot.bars.length<=MAX_CHART_BARS)return;
 slot.bars=direction==='left'?slot.bars.slice(0,limit):slot.bars.slice(-limit);
 if(direction==='left'){slot.rightDone=false;slot.atTail=false}
 else slot.leftDone=false;
}
export class ReplayHistoryFeed{
 constructor(id,read,onStatus){this.id=id;this.read=read;this.onStatus=onStatus;this.slots=new Map();this.requests=new Map();this.anchor=null;this.controllers=new Map()}
 key(root,tf){return `${root}:${tf}`}
 slot(root,tf){return this.slots.get(this.key(root,tf))}
 async fetch(root,tf,params={}){
  const {cursor}=this.read(),query=new URLSearchParams({root,timeframe:String(tf),cursor:String(cursor),limit:'750',...params});
  const key=query.toString();if(this.requests.has(key))return this.requests.get(key);
  const controller=new AbortController();this.controllers.set(key,controller);const started=performance.now();const job=api(`/backtesting/sessions/${this.id}/chart-history?${query}`,{signal:controller.signal}).finally(()=>{recordTiming('history-request:'+tf,started);if(this.requests.get(key)===job){this.requests.delete(key);this.controllers.delete(key)}});this.requests.set(key,job);return job;
 }
 cancel(){for(const controller of this.controllers.values())controller.abort()}
 async prefetch(root){for(const tf of ['240','1D','1W','1M']){if(!this.slot(root,tf))try{await this.initial(root,tf,true)}catch(error){if(error.name==='AbortError')return}}}
 async initial(root,tf,background=false){
  const cached=this.slot(root,tf);if(cached&&(!this.anchor||cached.atTail&&this.anchor>=cached.bars.at(-1)?.time||this.anchor>=cached.bars[0]?.time&&this.anchor<=cached.bars.at(-1)?.time||['1D','1W','1M'].includes(String(tf)))){this.view(root,tf);if(!background)this.onStatus(cached);return cached.bars}
  const {time}=this.read();const anchor=!background&&!['1D','1W','1M'].includes(String(tf))&&this.anchor&&this.anchor<time?this.anchor:null;
  const reply=await this.fetch(root,tf,anchor?{before:String(Math.ceil(anchor))}:{});
  let bars=reply.bars;
  if(anchor&& !['1D','1W','1M'].includes(String(tf))){const right=await this.fetch(root,tf,{after:String(Math.floor(anchor)-1)});bars=merge(bars,right.bars)}
  const value={...reply,bars,seen:time,atTail:!anchor,leftDone:reply.exhausted,rightDone:!anchor};
  bound(value);bars=value.bars;
  this.slots.set(this.key(root,tf),value);if(!background)this.onStatus(value);
  // Bounded symbol/timeframe caches; eviction never limits what can be fetched again.
  if(this.slots.size>12)this.slots.delete(this.slots.keys().next().value);
  return bars;
 }
 view(root,tf){
  const slot=this.slot(root,tf);if(!slot)return null;
  const {time,markets}=this.read();const minutes=markets[root].bars;if(!slot.atTail||time<=slot.seen)return slot.bars;
  let lo=0,hi=minutes.length;while(lo<hi){const mid=(lo+hi)>>>1;if(minutes[mid].time<=slot.seen)lo=mid+1;else hi=mid}
  slot.bars=[...slot.bars];
  for(let i=lo;i<minutes.length&&minutes[i].time<=time;i++){const bar=minutes[i],bars=slot.bars;const opened=replayBucketOpen(bar.time,String(tf));if(opened==null)continue;const last=bars.at(-1);
   if(last?.time===opened)bars[bars.length-1]={...last,high:Math.max(last.high,bar.high),low:Math.min(last.low,bar.low),close:bar.close,volume:(last.volume||0)+(bar.volume||0)};
   else bars.push({...bar,time:opened});
   bound(slot,'right',PLAYBACK_WINDOW);
  }
  slot.seen=time;return slot.bars;
 }
 async page(root,tf,direction){
  const slot=this.slot(root,tf);if(!slot||slot.busy||slot[direction==='left'?'leftDone':'rightDone'])return null;
  slot.busy=true;
  try{
   const seen=slot.seen;
   // Include the right edge again: its formerly partial candle may now be complete.
   const reply=await this.fetch(root,tf,direction==='left'?{before:String(slot.bars[0].time)}:{after:String(slot.bars.at(-1).time-1)});
   // Prefer the response on return to live history, unless a live tick arrived meanwhile.
   slot.bars=direction==='right'&&slot.seen===seen?merge(slot.bars,reply.bars):merge(reply.bars,slot.bars);slot[direction==='left'?'leftDone':'rightDone']=reply.exhausted;
   if(direction==='right'&&reply.exhausted){slot.atTail=true;slot.seen=reply.replay_time}
   bound(slot,direction);
   this.onStatus(slot);return slot.bars;
  }finally{slot.busy=false}
 }
}
