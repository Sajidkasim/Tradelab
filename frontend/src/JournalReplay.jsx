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
export default function JournalReplayImports(){
 const [rows,setRows]=useState([]),[zone,setZone]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[opened,setOpened]=useState(false);
 const request=useRef(null);useEffect(()=>()=>request.current?.abort(),[]);
 async function refresh(){request.current?.abort();request.current=new AbortController();try{setRows(await api('/journal-replay',{signal:request.current.signal}))}catch(e){if(e.name!=='AbortError')setMessage(e.message)}}
 async function upload(file){if(!file)return;setBusy(true);try{const body=new FormData();body.append('file',file);body.append('source_timezone',zone);const result=await api('/journal-replay/import',{method:'POST',body});setMessage(`${result.inserted} replay trades imported; ${result.skipped} duplicates skipped. Financial records unchanged.`);await refresh()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 return <details className="pj-session-images" onToggle={e=>{if(e.currentTarget.open&&!opened){setOpened(true);refresh()}}}><summary>Trade replay <span>Imported executions · forward playback</span></summary><p>Import execution detail for replay only. This does not add results to your financial journal. Accepts TopstepX Trades CSV, FTMO website Trading Journal CSV and execution CSV. FTMO timestamps require the export clock to be confirmed; unsupported markets are preserved with a clear unavailable message.</p><p>Execution interchange CSV columns: trade_id, execution_id, symbol, timestamp, side, quantity, price, role, notes (optional). Use buy/sell and entry/exit. TopstepX dates use month/day/year; compact contracts such as MNQZ6 retain their expiry. FTMO’s two Price columns remain separate entry/exit prices.</p><label>Export timezone (required for timestamps without offsets)<input aria-label="Replay export timezone" placeholder="e.g. America/New_York — do not guess" value={zone} onChange={e=>setZone(e.target.value)}/></label><button type="button" className="pt-btn" onClick={()=>setZone('FTMO_MT5')}>Use FTMO MT5 platform time (GMT+2/+3)</button><label>Execution CSV<input aria-label="Replay execution CSV" type="file" accept=".csv" disabled={busy} onChange={e=>{upload(e.target.files[0]);e.target.value=''}}/></label>{message&&<p role="status">{message}</p>}{rows.map(row=><div key={row.id} className="jr-import-row"><span>{row.symbol} · {row.executions[0]?.time} · {row.executions.length} executions</span><ReplayButton reference={row.id}/></div>)}</details>;
}
