// Replay time only; all simulated financial results are computed by Python.
export function nextReplayCursor(bars,cursor,minutes=1) {
 if(cursor>=bars.length-1)return cursor;
 const target=bars[cursor].time+minutes*60000;
 let next=cursor+1;
 while(next+1<bars.length && bars[next+1].time<=target)next++;
 return next;
}
export function revealedBars(bars,clock){return bars.filter(bar=>bar.time<=clock)}

export const REPLAY_ZONES=[{value:'America/New_York',label:'New York'},{value:'Europe/London',label:'London'}];
export const REPLAY_SPEEDS=[0.25,0.5,1,2,4,8,16,32];
export const JUMP_DEFAULTS={favorite:'newyork',asia:'20:00',london:'02:00',newyork:'09:30',dayopen:'17:00'};
export const validClockTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function replayZone(value){return REPLAY_ZONES.some(zone=>zone.value===value)?value:'America/New_York'}
export function savedJumpSettings(raw){
 let value;try{value=JSON.parse(raw||'{}')}catch{value={}}
 if(!value||typeof value!=='object')value={};
 return Object.fromEntries(Object.entries(JUMP_DEFAULTS).map(([key,fallback])=>[key,key==='favorite'?(Object.hasOwn(JUMP_DEFAULTS,value[key])&&value[key]!=='favorite'?value[key]:fallback):(validClockTime(value[key])?value[key]:fallback)]));
}
export function clockParts(time,zone){
 const values=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(time).map(x=>[x.type,x.value]));
 return {day:`${values.year}-${values.month}-${values.day}`,time:`${values.hour}:${values.minute}:${values.second}`,minutes:Number(values.hour)*60+Number(values.minute)};
}
export function nextSessionCursor(bars,cursor,time){
 if(!validClockTime(time)||!bars[cursor])return null;
 const [h,m]=time.split(':').map(Number),target=h*60+m;
 const now=clockParts(bars[cursor].time+60000,'America/New_York');
 for(let i=cursor+1;i<bars.length;i++){
  const next=clockParts(bars[i].time+60000,'America/New_York');
  if(next.day===now.day&&target<=now.minutes)continue;
  if(next.day>=now.day&&next.minutes>=target)return i;
 }
 return null;
}

export function replayClockLabel(time,zone){
 const offset=new Intl.DateTimeFormat('en-GB',{timeZone:zone,timeZoneName:'shortOffset'}).formatToParts(time).find(p=>p.type==='timeZoneName').value.replace('GMT','UTC').replace('−','-');
 return `${clockParts(time,zone).time} (${offset})`;
}
