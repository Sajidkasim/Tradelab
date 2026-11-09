import {clockParts} from './replayClock';
export function replayNewsDay(time){
 if(!Number.isFinite(time)||!Number.isFinite(new Date(time).getTime()))return null;
 return clockParts(time,'America/New_York').day;
}
export function validNewsDate(day){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
 const stamp=new Date(day+'T12:00:00Z');
 return Number.isFinite(stamp.getTime())&&stamp.toISOString().slice(0,10)===day;
}
export function safeNewsEvents(rows){
 if(!Array.isArray(rows))return [];
 const text=value=>typeof value==='string'||typeof value==='number'?String(value):'';
 return rows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map((row,i)=>({
  id:text(row.id)||'event-'+i,event:text(row.event)||'Economic event',currency:text(row.currency)||'—',time_ny:text(row.time_ny)||'—',
  impact:['High','Medium','Low'].includes(row.impact)?row.impact:'Low',
  timestamp_utc:typeof row.timestamp_utc==='number'&&Number.isFinite(row.timestamp_utc)?row.timestamp_utc:Infinity,
  actual:text(row.actual),forecast:text(row.forecast),previous:text(row.previous),
 }));
}
export function newsWeek(day){
 if(!validNewsDate(day))return [];
 const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return Array.from({length:7},(_,i)=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),label:['MON','TUE','WED','THU','FRI','SAT','SUN'][i],number:d.getUTCDate()}});
}
export const newsImpact=impact=>({High:3,Medium:2,Low:1}[impact]||1);
export const newsActual=(event,clock)=>Number.isFinite(clock)&&Number.isFinite(event?.timestamp_utc)&&event.timestamp_utc<=clock?(event.actual||'—'):'—';
