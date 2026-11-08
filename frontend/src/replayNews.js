import {clockParts} from './replayClock';
export function replayNewsDay(time){
 const p=clockParts(time,'America/New_York');
 const d=new Date(p.day+'T12:00:00Z');if(p.minutes>=17*60)d.setUTCDate(d.getUTCDate()+1);
 return d.toISOString().slice(0,10);
}
export function newsWeek(day){
 const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return Array.from({length:7},(_,i)=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),label:['MON','TUE','WED','THU','FRI','SAT','SUN'][i],number:d.getUTCDate()}});
}
export const newsImpact=impact=>({High:3,Medium:2,Low:1}[impact]||1);
export const newsActual=(event,clock)=>event.timestamp_utc<=clock?(event.actual||'—'):'—';
