import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Modal} from './components';
import {startReplayClock} from './replayClock';
import {streamReplayBars} from './replayChartStream';
import {replayProjector} from './replayViewport';
import {advanceWindow,reachedExecutions} from './journalReplayWindow';
import './journal-replay.css';

function ReplayChart({record,reference}){
 const host=useRef(null),chart=useRef(null),subscribers=useRef(new Set());
 const state=useRef({active:[],pending:[],next:null,loading:false,time:0,ended:false});
 const [,setVersion]=useState(0),[error,setError]=useState(''),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[ready,setReady]=useState(false),[markers,setMarkers]=useState([]);
 const playback=useRef({});playback.current={playing,speed};
 const controller=useRef(null);
 function project(){
  const p=replayProjector(chart.current);if(!p)return;
  setMarkers(reachedExecutions(record.executions,state.current.time).map(e=>({...e,x:p.xOf(Math.floor(Date.parse(e.time)/60000)*60000),y:p.yOf(Number(e.price),'price')})).filter(e=>Number.isFinite(e.x)&&Number.isFinite(e.y)&&e.x>=0&&e.x<p.width&&e.y>=0&&e.y<p.height));
 }
 async function load(){
  const s=state.current;if(s.loading||s.next===null||s.pending.length)return;
  const signal=controller.current.signal;
  s.loading=true;setError('');setVersion(v=>v+1);
  try{
   const data=await api(`/journal-replay/${reference}/candles?start=${s.next}`,{signal});
   if(signal.aborted)return;
   s.pending=data.bars;s.next=data.next;
   if(!data.bars.length){setPlaying(false);setError('No candles in this window. You can load the next window if available.');}
  }catch(e){if(e.name!=='AbortError'){setPlaying(false);setError(e.message)}}
  finally{if(!signal.aborted){s.loading=false;setVersion(v=>v+1)}}
 }
 function step(count=1){
  const s=state.current;if(!s.pending.length){if(s.next!==null)load();else{setPlaying(false);s.ended=true;setVersion(v=>v+1)}return}
  const previous=s.active;const next=advanceWindow(previous,s.pending,Math.min(count,240));
  Object.assign(s,next);s.time=s.active.at(-1).time+60000;
  if(chart.current)streamReplayBars(chart.current,subscribers.current,previous,s.active,{follow:true});
  project();setVersion(v=>v+1);
 }
 useEffect(()=>{
  let alive=true,instance,off=()=>{};
  controller.current=new AbortController();
  const first=Date.parse(record.executions[0].time);
  state.current.next=Math.floor(first/60000)*60000-120*60000;
  (async()=>{
   await load();if(!alive)return;
   const s=state.current;
   const context=s.pending.filter(b=>b.time+60000<first);
   s.active=context;s.pending=s.pending.slice(context.length);s.time=context.at(-1)?.time+60000||first-1;
   const {Vela}=await import('@luxalgo/vela');if(!alive)return;
   instance=new Vela(host.current,{symbol:`journal:${record.symbol}`,timeframe:'1',nativeBackend:'canvas2d',height:'100%',live:true,bars:120,volume:false,animations:false});
   chart.current=instance;
   instance.data.registerProvider('journal',{getBars:async()=>state.current.active,subscribe:(_s,_tf,cb)=>{subscribers.current.add(cb);return()=>subscribers.current.delete(cb)}});
   await instance.ready();if(!alive)return;
   off=instance.on('viewport:changed',project);setReady(true);setVersion(v=>v+1);project();
  })().catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false;controller.current.abort();off();instance?.destroy();chart.current=null;subscribers.current.clear()};
 },[reference]);
 useEffect(()=>startReplayClock({read:()=>({enabled:playback.current.playing&&ready&&!state.current.loading,speed:playback.current.speed}),advance:step}),[ready]);
 const s=state.current;
 return <>
  <p>{record.provider==='dukascopy'?'Dukascopy BID reference feed':record.provider==='projectx'?'ProjectX exact-contract feed':'Candle mapping unavailable'} · 1-minute candles. Feed prices may differ from your executions. No intraminute reconstruction.</p>
  {record.warning&&<p>{record.warning}</p>}
  <div className="jr-controls"><button disabled={!ready||s.ended||!!error} onClick={()=>setPlaying(v=>!v)}>{playing?'Pause':'Play'}</button><button disabled={!ready||s.loading||s.ended} onClick={()=>{setPlaying(false);step()}}>Step forward</button><label>Speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[1,2,4,8,16,32].map(n=><option key={n} value={n}>{n} bars/sec</option>)}</select></label><span>{s.time?new Date(s.time).toISOString():''}</span></div>
  {error&&<p role="alert">{error} <button disabled={s.loading} onClick={load}>Retry / next window</button></p>}
  {s.loading&&<p role="status">Loading candle window…</p>}
  <div className="jr-chart"><div ref={host} className="jr-canvas"/><svg aria-label="Reached execution markers">{markers.map(e=><g key={e.id} transform={`translate(${e.x},${e.y})`}><circle r="5" fill={e.role==='entry'?'#26a69a':'#e5a25b'}/><text x="8" y="-8">{e.role} {e.quantity} @ {e.price}</text></g>)}</svg></div>
  <h4>Executions reached</h4><ul>{reachedExecutions(record.executions,s.time).map(e=><li key={e.id}>{e.time} · {e.role} · {e.quantity} @ {e.price}</li>)}</ul>
  <h4>Journal notes</h4><p className="jr-notes">{record.notes||'No notes recorded. Your original Journal notes remain on the trade card.'}</p>
 </>;
}
export function ReplayButton({reference,notes}){
 const [record,setRecord]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const request=useRef(null);useEffect(()=>()=>request.current?.abort(),[]);
 async function open(){setBusy(true);setError('');request.current?.abort();request.current=new AbortController();try{setRecord(await api(`/journal-replay/${reference}`,{signal:request.current.signal}))}catch(e){if(e.name!=='AbortError')setError(e.message)}finally{setBusy(false)}}
 return <><button type="button" className="pt-btn" disabled={busy} onClick={open}>{busy?'Opening replay…':'Replay'}</button>{error&&<p role="alert">{error}</p>}{record&&<Modal title={`${record.symbol} · Trade replay`} className="jr-modal" onClose={()=>setRecord(null)}><ReplayChart record={notes===undefined?record:{...record,notes}} reference={reference}/></Modal>}</>;
}
const tradeDate = new Intl.DateTimeFormat('en-GB', {
 dateStyle:'medium', timeStyle:'short', timeZone:'America/New_York',
});

function replayLabel(row){
 const execution=row.executions[0];
 return `${row.symbol} · ${execution.side} @ ${execution.price} · ${tradeDate.format(new Date(execution.time))}`;
}

export function JournalReplayLink({trade, day, timezone, onChange}){
 const [rows,setRows]=useState(null),[open,setOpen]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState('');
 const [sameDay,setSameDay]=useState(true);
 const dateKey=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 useEffect(()=>{
  if(!open)return;
  const request=new AbortController();
  api('/journal-replay',{signal:request.signal}).then(setRows).catch(error=>{
   if(error.name!=='AbortError')setError(error.message);
  });
  return ()=>request.abort();
 },[open]);
 const choices=rows?.filter(row=>row.provider!=='unavailable'&&(
  !sameDay||row.id===trade.replay_id||dateKey.format(new Date(row.executions[0].time))===day
 ));
 return <>
  {trade.replay_id&&<ReplayButton reference={trade.replay_id} notes={trade.notes}/>}
  <button type="button" className="pj-link" onClick={()=>{
   setSelected(trade.replay_id||'');setRows(null);setError('');setSameDay(true);setOpen(true);
  }}>{trade.replay_id?'Change replay link':'Link imported replay'}</button>
  {open&&<Modal title="Link an imported replay" className="pj-link-modal" onClose={()=>setOpen(false)}>
   <label><input type="checkbox" checked={sameDay} onChange={event=>setSameDay(event.target.checked)}/> Show trades from this Journal day</label>
   {!rows&&!error&&<p role="status">Loading imported trades…</p>}
   {error&&<p role="alert">{error}</p>}
   {choices?.length===0&&<p>Browse other dates or import a CSV in Trade replay.</p>}
   {choices?.length>0&&<label className="jr-link-choice">Imported trade
    <select value={selected} onChange={event=>setSelected(event.target.value)}>
     <option value="">Choose a trade</option>
     {choices.map(row=><option key={row.id} value={row.id}>{replayLabel(row)}</option>)}
    </select>
   </label>}
   <p>Use Save entry to keep this link in your Journal.</p>
   <div className="pj-modal-actions">
    {trade.replay_id&&<button type="button" className="pt-btn" onClick={()=>{onChange(null);setOpen(false)}}>Unlink replay</button>}
    <button type="button" className="pt-btn pt-btn-dark" disabled={!choices?.some(row=>row.id===selected)} onClick={()=>{
     onChange(selected);setOpen(false);
    }}>Link replay</button>
   </div>
  </Modal>}
 </>;
}

export default function JournalReplayImports({onDelete}){
 const [rows,setRows]=useState([]),[zone,setZone]=useState(''),[file,setFile]=useState(null);
 const [message,setMessage]=useState(null),[busy,setBusy]=useState(false),[opened,setOpened]=useState(false);
 const [deleting,setDeleting]=useState(null);
 const [showUnavailable,setShowUnavailable]=useState(false);
 const unavailableCount=rows.filter(row=>row.provider==='unavailable').length;
 const visibleRows=showUnavailable?rows:rows.filter(row=>row.provider!=='unavailable');
 const request=useRef(null);
 const fileInput=useRef(null);
 useEffect(()=>()=>request.current?.abort(),[]);

 async function refresh(){
  request.current?.abort();
  request.current=new AbortController();
  try{setRows(await api('/journal-replay',{signal:request.current.signal}))}
  catch(error){
   if(error.name!=='AbortError')setMessage({error:true,text:error.message});
  }
 }

 async function upload(event){
  event.preventDefault();
  if(!file||busy)return;
  setBusy(true);
  setMessage(null);
  try{
   const body=new FormData();
   body.append('file',file);
   body.append('source_timezone',zone);
   const {inserted,skipped}=await api('/journal-replay/import',{method:'POST',body});
   setFile(null);
   fileInput.current.value='';
   setMessage({text:`${inserted} replay ${inserted===1?'trade':'trades'} imported.${skipped?` ${skipped} already imported.`:''}`});
   await refresh();
  }catch(error){setMessage({error:true,text:error.message})}
  finally{setBusy(false)}
 }

 async function removeImport(){
  setBusy(true);
  try{
   await api(`/journal-replay/${deleting.id}`,{method:'DELETE'});
   setRows(current=>current.filter(row=>row.id!==deleting.id));
   onDelete?.(deleting.id);
   setDeleting(null);
   setMessage({text:'Replay import deleted.'});
  }catch(error){setMessage({error:true,text:error.message})}
  finally{setBusy(false)}
 }

 return <details className="pj-session-images jr-imports" onToggle={event=>{
  if(event.currentTarget.open&&!opened){setOpened(true);refresh()}
 }}>
  <summary>Trade replay</summary>
  <form className="jr-import-form" onSubmit={upload}>
   <p>Import a TopstepX <strong>Trades CSV</strong> or an FTMO <strong>Trading Journal CSV</strong> to replay past trades.</p>
   <fieldset disabled={busy}>
    <label className="jr-import-clock">
     <input type="checkbox" checked={zone==='FTMO_MT5'} onChange={event=>setZone(event.target.checked?'FTMO_MT5':'')}/>
     Use FTMO MT5 platform time
    </label>
    <div className="jr-import-actions">
     <label>Trade CSV<input ref={fileInput} aria-label="Replay execution CSV" type="file" accept=".csv,text/csv"
      onChange={event=>{setFile(event.target.files[0]||null);setMessage(null)}}/></label>
     <button type="submit" className="pt-btn" disabled={!file}>{busy?'Importing…':'Import trades'}</button>
    </div>
    <details className="jr-import-advanced">
     <summary>Custom CSV or timezone</summary>
     <label>Export timezone<input aria-label="Replay export timezone" placeholder="e.g. America/New_York"
      value={zone} onChange={event=>setZone(event.target.value)}/></label>
     <p>Custom CSV columns <code>trade_id, execution_id, symbol, timestamp, side, quantity, price, role</code>. Use buy/sell and entry/exit. Include a timestamp offset or enter the export timezone above.</p>
    </details>
   </fieldset>
   {message&&!deleting&&<p role={message.error?'alert':'status'}>{message.text}</p>}
  </form>
  {rows.length>0&&<section className="jr-import-list" aria-label="Imported replay trades">
   <h3>Imported trades <span>{rows.length}</span></h3>
   <p>Trade times are shown in New York time.</p>
   {unavailableCount>0&&<div className="jr-import-availability">
    <p>{rows.length-unavailableCount} with a supported candle source · {unavailableCount} without a candle mapping</p>
    <label className="jr-import-clock">
     <input type="checkbox" checked={showUnavailable} onChange={event=>setShowUnavailable(event.target.checked)}/>
     Show trades without replay ({unavailableCount})
    </label>
   </div>}
   {visibleRows.map(row=><div key={row.id} className="jr-import-row">
    <div><strong>{row.symbol}</strong> <time dateTime={row.executions[0].time}>{tradeDate.format(new Date(row.executions[0].time))}</time><small> · {row.executions[0].side} @ {row.executions[0].price}</small></div>
    <div className="jr-import-row-actions">
     {row.provider==='unavailable'?<span>Replay unavailable for this market</span>:<ReplayButton reference={row.id}/>}
     <button type="button" className="pj-remove" onClick={()=>{setMessage(null);setDeleting(row)}} disabled={busy}>Delete import</button>
    </div>
   </div>)}
  </section>}
  {deleting&&<Modal title="Delete replay import?" onClose={()=>!busy&&setDeleting(null)} className="pj-link-modal">
   <p>{replayLabel(deleting)}. Journal cards linked to this import will lose their replay link.</p>
   {message?.error&&<p role="alert">{message.text}</p>}
   <div className="pj-modal-actions">
    <button type="button" className="pt-btn" disabled={busy} onClick={()=>setDeleting(null)}>Cancel</button>
    <button type="button" className="pt-btn pj-danger" disabled={busy} onClick={removeImport}>Delete import</button>
   </div>
  </Modal>}
 </details>;
}
