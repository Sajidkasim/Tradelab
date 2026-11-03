import {api} from './api';
import {replayBucketOpen} from './replayHistoryCalendar';
const merge=(a,b)=>[...new Map([...a,...b].map(bar=>[bar.time,bar])).values()].sort((a,b)=>a.time-b.time);
export class ReplayHistoryFeed{
 constructor(id,read,onStatus){this.id=id;this.read=read;this.onStatus=onStatus;this.slots=new Map();this.requests=new Map();this.anchor=null}
 key(root,tf){return `${root}:${tf}`}
 slot(root,tf){return this.slots.get(this.key(root,tf))}
 async fetch(root,tf,params={}){
  const {cursor}=this.read(),query=new URLSearchParams({root,timeframe:String(tf),cursor:String(cursor),limit:'750',...params});
  const key=query.toString();if(this.requests.has(key))return this.requests.get(key);
  const job=api(`/backtesting/sessions/${this.id}/chart-history?${query}`).finally(()=>this.requests.delete(key));this.requests.set(key,job);return job;
 }
 async initial(root,tf){
  const cached=this.slot(root,tf);if(cached&&(!this.anchor||this.anchor>=cached.bars[0]?.time&&this.anchor<=cached.bars.at(-1)?.time||['1D','1W','1M'].includes(String(tf)))){this.view(root,tf);this.onStatus(cached);return cached.bars}
  const {time}=this.read();const anchor=!['1D','1W','1M'].includes(String(tf))&&this.anchor&&this.anchor<time?this.anchor:null;
  const reply=await this.fetch(root,tf,anchor?{before:String(Math.ceil(anchor))}:{});
  let bars=reply.bars;
  if(anchor&& !['1D','1W','1M'].includes(String(tf))){const right=await this.fetch(root,tf,{after:String(Math.floor(anchor)-1)});bars=merge(bars,right.bars)}
  const value={...reply,bars,seen:time,atTail:!anchor,leftDone:reply.exhausted,rightDone:!anchor};
  this.slots.set(this.key(root,tf),value);this.onStatus(value);
  // Bounded symbol/timeframe caches; eviction never limits what can be fetched again.
  if(this.slots.size>12)this.slots.delete(this.slots.keys().next().value);
  return bars;
 }
 view(root,tf){
  const slot=this.slot(root,tf);if(!slot)return null;
  const {time,markets}=this.read();const minutes=markets[root].bars;if(!slot.atTail||time<=slot.seen)return slot.bars;
  let lo=0,hi=minutes.length;while(lo<hi){const mid=(lo+hi)>>>1;if(minutes[mid].time<=slot.seen)lo=mid+1;else hi=mid}const additions=[];for(let i=lo;i<minutes.length&&minutes[i].time<=time;i++)additions.push(minutes[i]);
  const bars=[...slot.bars];
  for(const bar of additions){const opened=replayBucketOpen(bar.time,String(tf));if(opened==null)continue;const last=bars.at(-1);
   if(last?.time===opened)bars[bars.length-1]={...last,high:Math.max(last.high,bar.high),low:Math.min(last.low,bar.low),close:bar.close,volume:(last.volume||0)+(bar.volume||0)};
   else bars.push({...bar,time:opened});
  }
  slot.bars=bars;slot.seen=time;return bars;
 }
 async page(root,tf,direction){
  const slot=this.slot(root,tf);if(!slot||slot.busy||slot[direction==='left'?'leftDone':'rightDone'])return null;
  slot.busy=true;
  try{
   const reply=await this.fetch(root,tf,direction==='left'?{before:String(slot.bars[0].time)}:{after:String(slot.bars.at(-1).time)});
   // A historical response must not overwrite a forming candle updated while it loaded.
   slot.bars=merge(reply.bars,slot.bars);slot[direction==='left'?'leftDone':'rightDone']=reply.exhausted;
   if(direction==='right'&&reply.exhausted){slot.atTail=true;slot.seen=reply.replay_time}
   this.onStatus(slot);return slot.bars;
  }finally{slot.busy=false}
 }
}
