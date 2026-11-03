// Original session-range implementation. UTC candle storage is unchanged.
export const SESSION_DEFAULTS={enabled:false,days:5,zone:'America/New_York',dashboard:false,advanced:false,sessionDividers:false,dailyDividers:true,sessions:[{name:'Asia',start:'20:00',end:'02:00',enabled:true,range:true,color:'#8b83cb'},{name:'London',start:'02:00',end:'07:00',enabled:true,range:true,color:'#609cc5'},{name:'NY AM',start:'07:00',end:'17:00',enabled:true,range:true,color:'#ca9455'}]};
export function sessionOptions(value){const v=value||{};return {...SESSION_DEFAULTS,...v,days:Math.max(1,Math.min(30,Number(v.days)||5)),sessions:SESSION_DEFAULTS.sessions.map((s,i)=>({...s,...v.sessions?.[i]}))}}
const formats=new Map(),wallCache=new Map();
export function sessionWall(time,zone){const key=zone+':'+time;if(wallCache.has(key))return wallCache.get(key);let format=formats.get(zone);if(!format){format=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formats.set(zone,format)}const p=Object.fromEntries(format.formatToParts(time).map(x=>[x.type,x.value]));const value={day:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};if(wallCache.size>=50000){let n=5000;for(const key of wallCache.keys()){wallCache.delete(key);if(!--n)break}}wallCache.set(key,value);return value}
const minutes=t=>{const [h,m]=t.split(':').map(Number);return h*60+m};
export function sessionRanges(bars,options,clock){
 const groups=new Map(),days=new Map(),windows=options.sessions.map((s,i)=>({...s,index:i,opening:minutes(s.start),closing:minutes(s.end)})).filter(s=>s.enabled);
 for(const bar of bars){if(bar.time>clock)break;const wall=sessionWall(bar.time,options.zone);if(!days.has(wall.day))days.set(wall.day,bar.time);
 for(const s of windows){const i=s.index,start=s.opening,end=s.closing,overnight=start>end;
 if(start===end||!(overnight?wall.minute>=start||wall.minute<end:wall.minute>=start&&wall.minute<end))continue;
 let day=wall.day;if(overnight&&wall.minute>=start)day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const key=`${i}:${day}`;let group=groups.get(key);if(!group){group={...s,key,day,first:bar.time,last:bar.time,high:bar.high,low:bar.low,volume:0,bars:0};groups.set(key,group)}
 group.last=bar.time;group.high=Math.max(group.high,bar.high);group.low=Math.min(group.low,bar.low);group.volume+=bar.volume||0;group.bars++;
 }}
 const lastDays=[...new Set([...groups.values()].map(g=>g.day))].sort().slice(-options.days);
 return {ranges:[...groups.values()].filter(g=>lastDays.includes(g.day)),days:[...days].filter(([day])=>day>=lastDays[0])};
}
