import React,{useEffect,useRef,useState} from 'react';
import {X,CalendarDays,RefreshCw} from 'lucide-react';
import {api} from './api';
import {newsWeek,newsImpact,newsActual,validNewsDate,safeNewsEvents,replayNewsDay} from './replayNews';
import './replayNews.css';
function Flag({currency}){
 return <svg className="rn-flag" viewBox="0 0 24 16" role="img" aria-label={currency}>
 {currency==='USD'?<><rect width="24" height="16" fill="#fff"/>{[0,1,2,3,4,5,6].map(i=><rect key={i} y={i*2.46} width="24" height="1.23" fill="#cb4354"/>)}<rect width="10" height="8.6" fill="#304c88"/>{[0,1,2].map(i=><text key={i} x="1" y={2.6+i*2.5} fill="white" fontSize="3">✦ ✦ ✦</text>)}</>:currency==='GBP'?<><rect width="24" height="16" fill="#253d75"/><path d="M0 0L24 16M24 0L0 16" stroke="white" strokeWidth="4"/><path d="M0 0L24 16M24 0L0 16" stroke="#ce3c51" strokeWidth="1.5"/><path d="M12 0V16M0 8H24" stroke="white" strokeWidth="6"/><path d="M12 0V16M0 8H24" stroke="#ce3c51" strokeWidth="3"/></>:currency==='EUR'?<><rect width="24" height="16" fill="#21438c"/>{Array.from({length:12},(_,i)=><circle key={i} cx={12+4.8*Math.cos(i*Math.PI/6)} cy={8+4.8*Math.sin(i*Math.PI/6)} r=".65" fill="#f4d36a"/>)}</>:<><rect width="24" height="16" fill="#39495f"/><text x="12" y="11" textAnchor="middle" fill="white" fontSize="7">{currency}</text></>}
 </svg>;
}
export default function ReplayNewsDrawer({open,onClose,replayDate,replayTime}){
 const [navigation,setNavigation]=useState(null),[events,setEvents]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const cursorDate=validNewsDate(replayDate)?replayDate:replayNewsDay(replayTime);
 const selected=navigation&&navigation.cursorDay===cursorDate&&validNewsDate(navigation.day)?navigation.day:cursorDate;
 const activeDate=validNewsDate(selected)?selected:null;
 const visibleEvents=safeNewsEvents(events);
 const setSelected=day=>setNavigation({cursorDay:cursorDate,day});
 const close=useRef(null);
 useEffect(()=>{if(open)close.current?.focus()},[open]);
 useEffect(()=>{
  if(!open||!activeDate)return;const controller=new AbortController();let active=true;
  setLoading(true);setError('');setEvents([]);
  api('/replay/news?date='+encodeURIComponent(activeDate),{signal:controller.signal}).then(rows=>{if(active){if(!Array.isArray(rows)){setError('News data is unavailable. Please retry.');setEvents([])}else setEvents(safeNewsEvents(rows))}}).catch(e=>{if(active&&e?.name!=='AbortError')setError(e?.message||'Unable to load economic news.')}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false;controller.abort()};
 },[open,activeDate,retry]);
 return <aside className={`replay-news-drawer ${open?'is-open':''}`} aria-label="Economic news" aria-hidden={!open} inert={!open} onKeyDown={e=>{if(e.key==='Escape')onClose?.()}}>
  <header className="rn-header"><div><CalendarDays size={17}/><h2>Economic calendar</h2></div><button ref={close} onClick={onClose} aria-label="Close economic news"><X size={18}/></button></header>
  <div className="rn-subtitle">New York calendar · Replay synced</div>
  <nav className="rn-week" aria-label="News week">{newsWeek(cursorDate).map(day=><button key={day.date} aria-label={`News for ${day.date}`} aria-current={day.date===cursorDate?'date':undefined} aria-pressed={selected===day.date} onClick={()=>setSelected(day.date)}><span>{day.label}</span><strong>{day.number}</strong></button>)}</nav>
  <div className="rn-date"><span>{activeDate?new Intl.DateTimeFormat('en-GB',{weekday:'long',year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(activeDate+'T12:00:00Z')):'Waiting for replay date…'}</span>{activeDate&&activeDate!==cursorDate&&<button onClick={()=>setSelected(cursorDate)}>Back to replay</button>}</div>
  <div className="rn-events" aria-busy={loading||!activeDate}>
   {(!activeDate||loading)?<p role="status" className="rn-empty">{activeDate?'Loading events…':'Waiting for replay date…'}</p>:error?<div className="rn-empty" role="alert"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}><RefreshCw size={13}/> Retry</button></div>:!visibleEvents.length?<div className="rn-empty"><CalendarDays size={26}/><p>No economic events stored for this date.</p></div>:visibleEvents.map(event=><article className="rn-event" key={event.id}>
    <div className="rn-event-meta"><time>{event.time_ny}</time><Flag currency={event.currency}/><span className={`rn-impact rn-${event.impact.toLowerCase()}`} role="img" aria-label={`${event.impact} impact`}>{[1,2,3].map(n=><i key={n} className={n<=newsImpact(event.impact)?'active':''}/>)}</span><span>{event.currency}</span></div>
    <div className="rn-event-detail"><h3 title={event.event}>{event.event}</h3><div className="rn-stats"><strong>{newsActual(event,replayTime)}</strong><small>F {event.forecast||'—'} · P {event.previous||'—'}</small></div></div>
   </article>)}
  </div><footer>Actual values appear when the replay reaches release time.</footer>
 </aside>;
}
