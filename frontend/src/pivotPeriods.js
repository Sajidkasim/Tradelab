import {intervalOrder} from './replayPreferences';
const clocks=new Map();
export function pivotKey(time,anchor,zone){
 let clock=clocks.get(zone);if(!clock){clock=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});clocks.set(zone,clock)}
 const p=Object.fromEntries(clock.formatToParts(time).map(x=>[x.type,x.value])),d=new Date(Date.UTC(+p.year,+p.month-1,+p.day));
 if(anchor==='Yearly')return p.year;if(anchor==='Monthly')return `${p.year}-${p.month}`;
 if(anchor==='Weekly')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
 return d.toISOString().slice(0,10);
}
export function pivotOutput(bars,inputs,timeframe){
 const anchor=inputs.anchor&&inputs.anchor!=='Auto'?inputs.anchor:intervalOrder(timeframe)<=15?'Daily':/^\d+$/.test(timeframe)?'Weekly':timeframe==='1D'?'Monthly':'Yearly';
 if(intervalOrder(timeframe)>({Daily:1440,Weekly:2880,Monthly:4320,Yearly:Infinity}[anchor]))return {series:[]};
 const groups=[];for(const b of bars){const key=pivotKey(b.time,anchor,inputs.zone||'America/New_York');let g=groups.at(-1);if(g?.key!==key){g={key,open:b.open,high:b.high,low:b.low,close:b.close,bars:[]};groups.push(g)}g.high=Math.max(g.high,b.high);g.low=Math.min(g.low,b.low);g.close=b.close;g.bars.push(b)}
 const names=['P','R1','S1','R2','S2','R3','S3','R4','S4'],points=names.map(()=>[]),count=Math.max(1,Math.min(100,Number(inputs.periodsBack)||2));
 // N completed display periods plus the current period; each uses its predecessor.
 for(let i=Math.max(1,groups.length-1-count);i<groups.length;i++){
 const prev=groups[i-1],g=groups[i],range=prev.high-prev.low,kind=inputs.kind||'Traditional',p=kind==='Woodie'?(prev.high+prev.low+2*g.open)/4:(prev.high+prev.low+prev.close)/3;
 let v=[p,2*p-prev.low,2*p-prev.high,p+range,p-range,prev.high+2*(p-prev.low),prev.low-2*(prev.high-p),NaN,NaN];
 if(kind==='Fibonacci')v=[p,p+.382*range,p-.382*range,p+.618*range,p-.618*range,p+range,p-range,NaN,NaN];
 if(kind==='Camarilla')v=[p,...[12,6,4,2].flatMap(n=>[prev.close+1.1*range/n,prev.close-1.1*range/n])];
 if(kind==='Woodie')v=v.map((x,j)=>j>4?NaN:x);
 g.bars.forEach((b,index)=>v.forEach((value,j)=>points[j].push({time:b.time,value})));
 }
 return {series:names.map((title,j)=>({id:`pivot-${title}`,title,kind:'line',points:points[j],style:{color:j===0?inputs.pivotColor||'#ca9455':j%2?inputs.resistanceColor||'#d36871':inputs.supportColor||'#389483',width:1}}))};
}
export function installPivotPeriods(vela){
 const existing=vela.getNativeIndicator('pivot-points');if(!existing||existing.primusPeriods)return;
 vela.registerNativeIndicator({...existing,type:'pivot-points',title:'Pivot Points Standard',shortTitle:'Pivots',paneHint:'price',overlay:true,multiInstance:true,waitsForHistory:true,primusPeriods:true,defaultInputs:()=>({...existing.defaultInputs(),periodsBack:2,zone:'America/New_York'}),inputsSchema:()=>[...existing.inputsSchema(),{key:'periodsBack',title:'Number of periods back',type:'int',defval:2,min:1,max:100,step:1,tooltip:'Previous display periods, plus the current period. Levels use the preceding period from loaded history.'},{key:'zone',title:'Pivot timezone',type:'string',defval:'America/New_York',options:['America/New_York','Europe/London']}],create:()=>{let context,inputs;const draw=()=>context.emit(pivotOutput(context.bars(),inputs,context.timeframe));return {start(c,i){context=c;inputs=i;draw()},onBars:draw,onViewport(){},setInputs(i){inputs=i;draw()},suspend(){},resume:draw,stop(){}}}});
}
