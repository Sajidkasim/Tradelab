// Chart-data aggregation only. Trade P&L and performance remain in the Python core.
// UTC source timestamps; New York 4H boundaries. Never fill missing minutes.
export const CHART_TIMEFRAMES = [
  {value: '1', label: '1m'},
  {value: '5', label: '5m'}, {value: '15', label: '15m'},
  {value: '30', label: '30m'}, {value: '60', label: '1h'},
  {value: '240', label: '4h'}, {value:'1D',label:'Daily'}, {value:'1W',label:'Weekly'}, {value:'1M',label:'Monthly'},
];

export function timeframeLabel(value){
 if(['1D','1W','1M'].includes(value))return value;
 const minutes=Number(value);return minutes%60===0?`${minutes/60}h`:`${minutes}m`;
}
export function validTimeframe(value){return ['1D','1W','1M'].includes(value)||/^\d+$/.test(String(value))&&Number(value)>=1&&Number(value)<=720}
export function savedTimeframes(raw){
 try{const values=JSON.parse(raw);if(!Array.isArray(values))throw Error();
 const valid=[...new Set(values.filter(v=>typeof v==='string'&&validTimeframe(v)).map(v=>(['1D','1W','1M'].includes(v)?v:String(Number(v)))))].slice(0,10);
 return valid.length?valid:CHART_TIMEFRAMES.map(x=>x.value);
 }catch{return CHART_TIMEFRAMES.map(x=>x.value)}
}

const nyClock=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function nyFourHourOpen(time){
 const p=Object.fromEntries(nyClock.formatToParts(time).map(x=>[x.type,x.value])),hour=Number(p.hour);
 if(p.weekday==='Sat'||p.weekday==='Fri'&&hour>=17||p.weekday==='Sun'&&hour<18)return null;
 const local=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),hour,Number(p.minute));
 const bucket=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),2+4*Math.floor((hour-2)/4));
 return bucket-(local-Math.floor(time/60000)*60000);
}
// Chart session opens at 17:00 New York: 22:00 UTC winter, 21:00 UTC summer.
function nyEpoch(year,month,day,hour){
 let guess=Date.UTC(year,month,day,hour);
 for(let i=0;i<3;i++){
  const p=Object.fromEntries(nyClock.formatToParts(guess).map(x=>[x.type,x.value]));
  guess+=Date.UTC(year,month,day,hour)-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
 }
 return guess;
}
export function replayBucketOpen(time,timeframe){
 const tf=String(timeframe);
 if(tf==='240')return nyFourHourOpen(time);
 if(!['1D','1W','1M'].includes(tf))return Math.floor(time/(Number(tf)*60000))*Number(tf)*60000;
 const p=Object.fromEntries(nyClock.formatToParts(time).map(x=>[x.type,x.value]));
 const day=new Date(Date.UTC(+p.year,+p.month-1,+p.day+(+p.hour>=17?1:0)));
 if(tf==='1W')day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
 if(tf==='1M')day.setUTCDate(1);
 day.setUTCDate(day.getUTCDate()-1);
 return nyEpoch(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),17);
}
const bucketOpen=(bar,timeframe)=>replayBucketOpen(bar.time,timeframe);
export function aggregateMinuteBars(bars,timeframe){
 if(!validTimeframe(timeframe))throw Error('Unsupported sample timeframe');
 const result=[];let previous=-Infinity;
 for(const bar of bars){
  if(!Number.isFinite(bar.time)||bar.time<=previous)throw Error('Candle times must be unique and increasing');
  previous=bar.time;const time=bucketOpen(bar,timeframe);if(time==null)continue;
  const last=result.at(-1);
  if(last?.time===time){last.high=Math.max(last.high,bar.high);last.low=Math.min(last.low,bar.low);last.close=bar.close;last.volume+=bar.volume??0}
  else result.push({...bar,time,volume:bar.volume??0});
 }
 return result;
}
const prepared=new WeakMap();
export function buildMarketCache(market,timeframes=CHART_TIMEFRAMES.map(x=>x.value)){
 const caches={};
 for(const tf of timeframes){
  const calendar=['1D','1W','1M'].includes(tf);
  const source=[...(calendar?(market.history||[]):(market.context||[])),...market.bars];
  const bars=[],ids=new Int32Array(source.length),high=new Float64Array(source.length),low=new Float64Array(source.length),volume=new Float64Array(source.length);
  ids.fill(-1);let previous=-Infinity,nySlot=null,nyEnd=null;
  for(let i=0;i<source.length;i++){
   const b=source[i];if(b.time<=previous)throw Error('Candle times must be unique and increasing');previous=b.time;
   let time;
   if(tf==='240'&&nySlot!=null&&b.time>=nySlot&&b.time<nyEnd)time=nySlot;
   else {time=bucketOpen(b,tf);if(tf==='240'){nySlot=time;const part=time==null?[]:nyClock.formatToParts(time);nyEnd=time+(part.some(p=>p.type==='weekday'&&p.value==='Fri')&&part.some(p=>p.type==='hour'&&p.value==='14')?10800000:14400000)}}
   if(time==null)continue;
   let current=bars.at(-1);
   if(current?.time!==time){current={...b,time,volume:b.volume??0};bars.push(current)}
   else{current.high=Math.max(current.high,b.high);current.low=Math.min(current.low,b.low);current.close=b.close;current.volume+=b.volume??0}
   ids[i]=bars.length-1;high[i]=current.high;low[i]=current.low;volume[i]=current.volume;
  }
  let prefix=[];
  if(tf==='240'&&market.four_hour_history_ny&&bars.length){
   prefix=market.four_hour_history_ny.filter(b=>b.time<bars[0].time);
   const whole=market.four_hour_history_ny.find(b=>b.time===bars[0].time);
   if(whole)bars[0]=whole;
  }
  caches[tf]={bars,prefix,ids,high,low,volume,times:source.map(b=>b.time),closes:source.map(b=>b.close)};
 }
 return caches;
}
export function registerMarketCache(market,cache){prepared.set(market,cache)}
export function upperBound(times,time){let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<=time)lo=mid+1;else hi=mid}return lo}
export function chartHistory(market,replayTime,timeframe){
 const tf=String(timeframe);let cache=prepared.get(market);
 if(!cache?.[tf]){cache={...cache,...buildMarketCache(market,[tf])};prepared.set(market,cache)}
 const c=cache[tf];let i=upperBound(c.times,replayTime)-1;while(i>=0&&c.ids[i]<0)i--;
 if(i<0)return c.prefix.filter(b=>b.time<=replayTime);
 const id=c.ids[i],final=c.bars[id],partial={time:final.time,open:final.open,high:c.high[i],low:c.low[i],close:c.closes[i],volume:c.volume[i]};
 return [...c.prefix,...c.bars.slice(0,id),partial];
}
