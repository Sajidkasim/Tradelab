import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Play,Plus,ArrowUpRight,FlaskConical,CalendarDays,Trash2} from 'lucide-react';
import Unlock from './Unlock';
import {api,setCsrf} from './api';
import {PrimusHeader} from './SiteExperience';
import {Modal,Button,Notice,Select,Field} from './components';
import BacktestingChart from './BacktestingChart';
import {prepareReplayCharts} from './prepareReplayCharts';
import './backtesting.css';
const cash=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const clock=value=>new Date(value).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});

export default function BacktestingSessions({theme,onThemeToggle}) {
 const [identity,setIdentity]=useState(null);
 const [listing,setListing]=useState(null),[active,setActive]=useState(null),[cursor,setCursor]=useState(0);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState(null);
 const [deleting,setDeleting]=useState(null);
 const [twoCharts,setTwoCharts]=useState(false);
 const [chartWorkspace,setChartWorkspace]=useState({charts:[],activeChartId:'primary',syncCrosshair:false});
 const [toolbarHost,setToolbarHost]=useState(null),[controlsHost,setControlsHost]=useState(null);
 const chartInstances=useRef({}),crosshairSync=useRef(false);
 crosshairSync.current=chartWorkspace.syncCrosshair;
 const updatePane=useCallback((id,patch)=>setChartWorkspace(state=>({...state,charts:state.charts.map(chart=>chart.id===id?{...chart,...patch}:chart)})),[]);
 const registerChart=useCallback((id,chart)=>{chartInstances.current[id]=chart},[]);
 const syncPointer=useCallback((id,event)=>{if(!crosshairSync.current)return;for(const [other,chart] of Object.entries(chartInstances.current))if(other!==id)chart?.renderer.setExternalCrosshair(event.time??null,null)},[]);
 function toggleCrosshair(){setChartWorkspace(state=>({...state,syncCrosshair:!state.syncCrosshair}));for(const chart of Object.values(chartInstances.current))chart?.renderer.setExternalCrosshair(null)}
 function toggleSplit(){if(twoCharts)layoutSavers.current.secondary?.().catch(()=>{});for(const chart of Object.values(chartInstances.current))chart?.renderer.setExternalCrosshair(null);setTwoCharts(value=>!value);setChartWorkspace(state=>({...state,activeChartId:'primary'}))}

 const layoutSavers=useRef({}),prefetch=useRef(null);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const latest=useRef({data:null,cursor:0}),queue=useRef(Promise.resolve()),locked=useRef(false);
 latest.current={data:active,cursor};
 const accept=useCallback(reply=>{const next={...latest.current.data,...reply};latest.current.data=next;setActive(next)},[]);
 const list=useCallback(async()=>{setListing(await api('/backtesting/sessions'))},[]);
 async function opened(data){
  if(data.session.next_day&&data.session.last_cursor-data.session.cursor<3000){
   const reply=await api(`/backtesting/sessions/${data.session.id}/continue`,{method:'POST',body:{version:data.session.version,cursor:data.session.cursor,days:3}});data={...data,...reply};
  }
  await prepareReplayCharts(data.sample);
  const group=data.layout?.chartGroup||{};
  setChartWorkspace({charts:[{...data.layout,id:'primary',symbol:data.layout?.symbol||data.session.root,timeframe:data.layout?.timeframe||'1'}, {...data.layout_secondary,id:'secondary',symbol:data.layout_secondary?.symbol||'ES',timeframe:data.layout_secondary?.timeframe||'1'}],activeChartId:data.layout?.split&&group.activeChartId==='secondary'?'secondary':'primary',syncCrosshair:Boolean(group.syncCrosshair)});
  setTwoCharts(Boolean(data.layout?.split));latest.current={data,cursor:data.session.cursor};setActive(data);setCursor(data.session.cursor);setSaveError('');history.replaceState({},'',`/backtesting?session=${data.session.id}`)
 }
 useEffect(()=>{
  let alive=true;
  (async()=>{const identity=await api('/session');setCsrf(identity.csrf);setIdentity(identity);if(!identity.authenticated)return;await list();const sid=new URLSearchParams(location.search).get('session');if(sid){const data=await api(`/backtesting/sessions/${encodeURIComponent(sid)}`);if(alive)await opened(data)}})().catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false};
 },[list]);
 function enqueue(job){const task=queue.current.catch(()=>{}).then(job);queue.current=task;return task}
 const save=useCallback(()=>enqueue(async()=>{
  const {data,cursor:at}=latest.current;if(!data||at===data.session.cursor)return;
  setSaving(true);
  try{const reply=await api(`/backtesting/sessions/${data.session.id}/progress`,{method:'PUT',body:{version:data.session.version,cursor:at}});accept(reply);setSaveError('')}
  catch(e){setSaveError(e.message);throw e}
  finally{setSaving(false)}
 }),[accept]);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>{save().catch(()=>{})},3000);return()=>clearInterval(timer)},[active?.session.id,save]);
 useEffect(()=>{
  const exit=()=>{const {data,cursor:at}=latest.current;if(!data||saving||locked.current||at===data.session.cursor)return;api(`/backtesting/sessions/${data.session.id}/progress`,{method:'PUT',keepalive:true,body:{version:data.session.version,cursor:at}}).catch(()=>{})};
  window.addEventListener('pagehide',exit);return()=>window.removeEventListener('pagehide',exit);
 },[saving]);
 async function action(kind,order){
  const background=kind==='amend';
  if(!background){locked.current=true;setBusy(true)}setSaveError('');
  try{await enqueue(async()=>{const {data,cursor:at}=latest.current;const reply=await api(`/backtesting/sessions/${data.session.id}/action`,{method:'POST',body:{version:data.session.version,cursor:at,kind,event_id:crypto.randomUUID(),...(order?{order}: {})}});accept(reply)})}
  catch(e){setSaveError(e.message);throw e}
  finally{if(!background){locked.current=false;setBusy(false)}}
 }
 function continueSession(background=false){
  if(prefetch.current)return prefetch.current;
  if(!background){locked.current=true;setBusy(true)}
  setSaveError('');
  const task=enqueue(async()=>{const {data,cursor:at}=latest.current;const reply=await api(`/backtesting/sessions/${data.session.id}/continue`,{method:'POST',body:{version:data.session.version,cursor:at,days:3}});await prepareReplayCharts(reply.sample);accept(reply);return reply}).catch(e=>{setSaveError(e.message);throw e}).finally(()=>{prefetch.current=null;if(!background){locked.current=false;setBusy(false)}});
  prefetch.current=task;return task;
 }
 useEffect(()=>{
  if(active?.session.next_day&&active.session.last_cursor-cursor<2000&&!prefetch.current&&!saveError)continueSession(true).catch(()=>{});
 },[active?.sample,cursor,active?.session.next_day,saveError]);
 async function leave(){try{await save();setActive(null);history.replaceState({},'','/backtesting');await list()}catch{}}
 async function remove(id,restore=false){setBusy(true);try{await api(`/backtesting/sessions/${id}${restore?'/restore':''}`,{method:restore?'POST':'DELETE'});setDeleting(null);await list()}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function resume(id){setBusy(true);setError('');try{await opened(await api(`/backtesting/sessions/${id}`))}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function create(event){event.preventDefault();setBusy(true);setError('');try{const data=await api('/backtesting/sessions',{method:'POST',body:{...form,capital:Number(form.capital),commission:Number(form.commission),slippage:Number(form.slippage)}});await opened(data);setForm(null)}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function newSession(){setError('');setBusy(true);try{const fresh=await api('/backtesting/sessions');setListing(fresh);setForm({name:'',day:fresh.history.sample_day,start_time:'13:30',instrument:'NQ',capital:50000,commission:fresh.history.instruments.find(x=>x.symbol==='NQ')?.commission??0.5,slippage:0})}catch(e){setError(e.message)}finally{setBusy(false)}}
 function change(field,value){setForm(f=>({...f,[field]:value}))}
 if(identity&&!identity.authenticated)return <><PrimusHeader active="backtesting"/><Unlock workspace="backtesting" ready={Boolean(identity.csrf)} authMode={identity.auth_mode} onUnlocked={()=>location.reload()}/></>;
 if(active){
  const common={theme,onThemeToggle,twoCharts,onSplit:toggleSplit,journal:active.journal||{},sample:active.sample,session:active.session,projection:active.projection,cursor,onCursor:at=>{if(!locked.current){latest.current.cursor=at;setCursor(at)}},onContinue:continueSession,onAction:action,onSessionBack:leave,onSave:save,saving,saveError,sessionBusy:busy,toolbarHost,controlsHost,onPaneChange:updatePane,registerChart,onCrosshair:syncPointer,chartGroup:{activeChartId:chartWorkspace.activeChartId,syncCrosshair:chartWorkspace.syncCrosshair},onToggleCrosshair:toggleCrosshair};
  return <div className="backtesting-workspace bt-layout">
   <div className="bt-shared-toolbar" ref={setToolbarHost}/>
   <div className={twoCharts?'bt-panes bt-panes-split':'bt-panes'}>
    {chartWorkspace.charts.filter(pane=>pane.id==='primary'||twoCharts).map(pane=><BacktestingChart {...common} key={active.session.id+pane.id} paneId={pane.id} paneState={pane} selected={chartWorkspace.activeChartId===pane.id} onSelect={()=>setChartWorkspace(state=>state.activeChartId===pane.id?state:{...state,activeChartId:pane.id})} secondary={pane.id==='secondary'} layout={pane} registerLayoutSave={fn=>{layoutSavers.current[pane.id]=fn}} saveOtherLayout={()=>layoutSavers.current[pane.id==='primary'?'secondary':'primary']?.()||Promise.resolve()}/>)}
   </div>
   <div className="bt-shared-playback" ref={setControlsHost}/>
  </div>;
 }

 return <div className="pt-site"><PrimusHeader active="backtesting" actions={<span className="bt-local-label">{identity?.local?'Local practice':'Private practice'}</span>}/><main className="pt-wrap bt-sessions-page">
  <div className="bt-sessions-heading"><div><span className="pt-overline">PRIMUS / BACKTESTING (BETA)</span><h1>Your practice desk.</h1><small>Backtesting (Beta)</small><p>Pick a starting day. Set your capital. Continue across trading days in the same session.</p></div><Button variant="primary" disabled={!listing||busy} onClick={newSession}><Plus size={17}/>New session</Button></div>
  {error&&!form&&<Notice error>{error}</Notice>}{listing?.history.indexed_days&&<p className="bt-session-note">Available history · {listing.history.indexed_days.toLocaleString()} dates · {listing.history.first_day} to {listing.history.last_day}. Ready for your practice sessions.</p>}
  {!listing?<p role="status">Loading your sessions…</p>:listing.sessions.length===0?<div className="bt-session-empty"><FlaskConical size={32}/><h2>Your first session starts here.</h2><p>Use real NQ or ES candles with a separate practice balance.</p><Button variant="primary" onClick={newSession}>Create a session</Button></div>:<section className="bt-saved-sessions" aria-label="Saved backtesting sessions"><h2>Recent sessions <span>{listing.sessions.length}</span></h2>{listing.sessions.map(item=><article className="bt-session-card" key={item.id}><div className="bt-session-symbol">{item.instrument}</div><div className="bt-session-info"><h3>{item.name}</h3><p><CalendarDays size={13}/>{item.day} · {clock(item.clock)} UTC · {item.finished?'Completed':'In progress'}</p><small>{item.closed} closed trades · Starting capital {cash(item.capital)}</small></div><strong>{cash(item.equity)}</strong><Button disabled={busy} onClick={()=>resume(item.id)}><Play size={15}/>{item.finished?'View session':'Resume'}</Button><Button disabled={busy} aria-label={`Delete ${item.name}`} onClick={()=>setDeleting(item)}><Trash2 size={16}/></Button></article>)}</section>}
  {Boolean(listing?.deleted?.length)&&<details className="disclosure"><summary>Deleted sessions ({listing.deleted.length})</summary>{listing.deleted.map(item=><div className="bt-session-card" key={item.id}><span>{item.name} · {item.day}</span><Button disabled={busy} onClick={()=>remove(item.id,true)}>Restore</Button></div>)}</details>}
  {deleting&&<Modal title="Delete session?" onClose={()=>!busy&&setDeleting(null)}><p>Remove “{deleting.name}” from your sessions? You can restore it from Deleted sessions.</p><div className="settings-actions"><Button busy={busy} onClick={()=>remove(deleting.id)}>Delete session</Button><Button disabled={busy} onClick={()=>setDeleting(null)}>Cancel</Button></div></Modal>}
  <p className="bt-session-note">Practice only. Sessions save privately in your workspace. Your Strategy Lab trades stay separate.</p>
 </main>{form&&<Modal title="New backtesting session" className="bt-session-modal" onClose={()=>!busy&&setForm(null)}><form className="stack" onSubmit={create}>
  <fieldset disabled={busy} className="bt-session-fields">
  <Field label="Session name"><input value={form.name} placeholder="e.g. New York reversals" maxLength={80} onChange={e=>change('name',e.target.value)}/></Field>
  <div className="form-grid two"><Field label="Trading date"><input required type="date" min={listing.history.first_day} max={listing.history.last_day} value={form.day} onInput={e=>change('day',e.target.value)} onChange={e=>change('day',e.target.value)}/></Field><Field label="Start time (UTC)"><input required type="time" value={form.start_time} onChange={e=>change('start_time',e.target.value)}/></Field></div>
  <div className="form-grid two"><Select label="Contract size / market" values={listing.history.instruments.map(item=>({value:item.symbol,label:`${item.symbol} · ${item.name}`}))} value={form.instrument} onChange={e=>setForm(f=>({...f,instrument:e.target.value,commission:listing.history.instruments.find(item=>item.symbol===e.target.value).commission}))}/><Field label="Starting capital ($)"><input required type="number" min="1" max="1000000000" step="0.01" value={form.capital} onChange={e=>change('capital',e.target.value)}/></Field></div>
  <details className="disclosure"><summary>Costs & fill rules</summary><div className="stack"><div className="form-grid two"><Field label="Commission per contract / side ($)"><input required type="number" min="0" max="100" step="0.01" value={form.commission} onChange={e=>change('commission',e.target.value)}/></Field><Field label="Slippage (ticks)"><input required type="number" min="0" max="20" step="1" value={form.slippage} onChange={e=>change('slippage',e.target.value)}/></Field></div><small>Market orders fill at the next one-minute open. Stop loss wins if both stop and target touch in a candle. Intrabar entries cannot claim an ambiguous same-candle target. Positions stay open across days until you close them or a stop or target is reached. No exchange margin or liquidation model is applied.</small></div></details>
  </fieldset>
  <small className="muted">NQ and ES futures practice. Start times use UTC; the chart clock can show New York or London. {listing.history.indexed_days?`${listing.history.indexed_days.toLocaleString()} available dates · ${listing.history.first_day} to ${listing.history.last_day}.`:'Online availability depends on the uploaded history.'}</small>
  {busy&&<p role="status">Preparing your candles…</p>}{error&&<Notice error>{error}</Notice>}
  <div className="settings-actions"><Button type="submit" variant="primary" busy={busy}>Open session <ArrowUpRight size={16}/></Button><Button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</Button></div>
 </form></Modal>}</div>;
}
