import {nyFourHourOpen} from './backtestingBars';
const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function nyEpoch(year,month,day,hour){let guess=Date.UTC(year,month,day,hour);for(let i=0;i<3;i++){const p=Object.fromEntries(fmt.formatToParts(guess).map(x=>[x.type,x.value]));guess+=Date.UTC(year,month,day,hour)-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)}return guess}
export function replayBucketOpen(time,tf){
 if(tf==='240')return nyFourHourOpen(time);
 if(!['1D','1W','1M'].includes(tf))return Math.floor(time/(Number(tf)*60000))*Number(tf)*60000;
 const p=Object.fromEntries(fmt.formatToParts(time).map(x=>[x.type,x.value]));const day=new Date(Date.UTC(+p.year,+p.month-1,+p.day+(+p.hour>=18?1:0)));
 if(tf==='1W')day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
 if(tf==='1M')day.setUTCDate(1);
 day.setUTCDate(day.getUTCDate()-1);return nyEpoch(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),18);
}
