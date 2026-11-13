import {recordTiming} from './replayTiming';
import {api} from './api';
import {replayBucketOpen} from './replayHistoryCalendar';
import {qqqRegularBucket} from './backtestingBars';
const merge=(a,b)=>[...new Map([...a,...b].map(bar=>[bar.time,bar])).values()].sort((a,b)=>a.time-b.time);
export const MAX_CHART_BARS=3000;
export const HISTORY_PAGE_SIZE=750;
export const MAX_VISIBLE_REPLAY_BARS=MAX_CHART_BARS-2*HISTORY_PAGE_SIZE;
const PAGE_ENTER=80,PAGE_REARM=200;
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
 hours(root){return root==='QQQ'?(this.read().qqqHours||'extended'):''}
 key(root,tf){return `${root}:${tf}:${this.hours(root)}`}
 slot(root,tf){return this.slots.get(this.key(root,tf))}
 async fetch(root,tf,params={}){
  const {cursor}=this.read(),query=new URLSearchParams({root,timeframe:String(tf),cursor:String(cursor),limit:String(HISTORY_PAGE_SIZE),...(this.hours(root)?{hours:this.hours(root)}:{}),...params});
  const key=query.toString();if(this.requests.has(key))return this.requests.get(key);
  const controller=new AbortController();this.controllers.set(key,controller);const started=performance.now();const job=api(`/backtesting/sessions/${this.id}/chart-history?${query}`,{signal:controller.signal}).finally(()=>{recordTiming('history-request:'+tf,started);if(this.requests.get(key)===job){this.requests.delete(key);this.controllers.delete(key)}});this.requests.set(key,job);return job;
 }
 cancel(){for(const controller of this.controllers.values())controller.abort()}
 async prefetch(root){for(const tf of ['240','1D','1W','1M']){if(!this.slot(root,tf))try{await this.initial(root,tf,true)}catch(error){if(error.name==='AbortError')return}}}
 async initial(root,tf,background=false){
  const cached=this.slot(root,tf);if(cached&&(!this.anchor||cached.atTail&&this.anchor>=cached.bars.at(-1)?.time||this.anchor>=cached.bars[0]?.time&&this.anchor<=cached.bars.at(-1)?.time||['1D','1W','1M'].includes(String(tf)))){this.view(root,tf);if(!background)this.onStatus(cached);return cached.bars}
  const slotKey=this.key(root,tf);
  const {time}=this.read();const anchor=!background&&!['1D','1W','1M'].includes(String(tf))&&this.anchor&&this.anchor<time?this.anchor:null;
  const reply=await this.fetch(root,tf,anchor?{before:String(Math.ceil(anchor))}:{});
  let bars=reply.bars;
  if(anchor&& !['1D','1W','1M'].includes(String(tf))){const right=await this.fetch(root,tf,{after:String(Math.floor(anchor)-1)});bars=merge(bars,right.bars)}
  const value={...reply,bars,seen:time,atTail:!anchor,leftDone:reply.exhausted,rightDone:!anchor};
  bound(value);bars=value.bars;
  this.slots.set(slotKey,value);if(!background)this.onStatus(value);
  // Bounded symbol/timeframe caches; eviction never limits what can be fetched again.
  if(this.slots.size>12)this.slots.delete(this.slots.keys().next().value);
  return bars;
 }
 view(root,tf){
  const slot=this.slot(root,tf);if(!slot)return null;
  const {time,markets}=this.read();const minutes=markets[root].bars;if(!slot.atTail||time<=slot.seen)return slot.bars;
  let lo=0,hi=minutes.length;while(lo<hi){const mid=(lo+hi)>>>1;if(minutes[mid].time<=slot.seen)lo=mid+1;else hi=mid}
  const regular=this.hours(root)==='rth';
  let changed=false;
  for(let i=lo;i<minutes.length&&minutes[i].time<=time;i++){const bar=minutes[i];const opened=regular?qqqRegularBucket(bar.time,String(tf)):replayBucketOpen(bar.time,String(tf));if(opened==null)continue;
   if(!changed){slot.bars=[...slot.bars];changed=true}
   const bars=slot.bars,last=bars.at(-1);
   if(last?.time===opened)bars[bars.length-1]={...last,high:Math.max(last.high,bar.high),low:Math.min(last.low,bar.low),close:bar.close,volume:(last.volume||0)+(bar.volume||0)};
   else bars.push({...bar,time:opened});
   bound(slot,'right',PLAYBACK_WINDOW);
  }
  slot.seen=time;return slot.bars;
 }
 // Paging uses fractional logical indices, never rounded public visible ranges.
 pagingDirection(root,tf,range,navigation=0){
  const slot=this.slot(root,tf);if(!slot?.bars.length||slot.busy)return null;
  const {logicalFrom,logicalTo}=range;
  if(!Number.isFinite(logicalFrom)||!Number.isFinite(logicalTo))return null;
  const gate=slot.paging??={armed:{left:true,right:true}};
  const gaps={left:logicalFrom,right:slot.bars.length-1-logicalTo};
  if(gate.failedNavigation!=null&&gate.failedNavigation!==navigation){gate.failedNavigation=null;gate.armed={left:true,right:true}}
  for(const direction of ['left','right'])if(gaps[direction]>PAGE_REARM||gate.navigation!==navigation||direction===gate.lastDirection&&gaps[direction]<0)gate.armed[direction]=true;
  if(gate.failedNavigation===navigation)return null;
  const candidates=['left','right'].filter(d=>gaps[d]<=PAGE_ENTER&&gate.armed[d]&&!slot[d==='left'?'leftDone':'rightDone']);
  candidates.sort((a,b)=>gaps[a]-gaps[b]);
  const direction=candidates[0];
  // A prepend/trim is not a user pan: never fetch the opposite edge in response.
  if(direction&&gate.lastDirection&&direction!==gate.lastDirection&&gate.navigation===navigation)return null;
  return direction||null;
 }
 async page(root,tf,direction,navigation=null){
  const slot=this.slot(root,tf);if(!slot||slot.busy||slot[direction==='left'?'leftDone':'rightDone'])return null;
  slot.busy=true;
  const gate=slot.paging??={armed:{left:true,right:true}};
  if(navigation!==null){gate.armed[direction]=false;gate.lastDirection=direction;gate.navigation=navigation}
  try{
   const seen=slot.seen;
   // Include the right edge again: its formerly partial candle may now be complete.
   const reply=await this.fetch(root,tf,direction==='left'?{before:String(slot.bars[0].time)}:{after:String(slot.bars.at(-1).time-1)});
   // Prefer the response on return to live history, unless a live tick arrived meanwhile.
   const edge=direction==='left'?slot.bars[0].time:slot.bars.at(-1).time;
   const progressed=reply.bars.some(b=>direction==='left'?b.time<edge:b.time>edge);
   slot.bars=direction==='right'&&slot.seen===seen?merge(slot.bars,reply.bars):merge(reply.bars,slot.bars);slot[direction==='left'?'leftDone':'rightDone']=reply.exhausted||!progressed;
   if(direction==='right'&&(reply.exhausted||!progressed)){slot.atTail=true;slot.seen=reply.replay_time}
   bound(slot,direction);
   this.onStatus(slot);return slot.bars;
  }catch(error){if(navigation!==null)gate.failedNavigation=navigation;throw error}
  finally{slot.busy=false}
 }
}
