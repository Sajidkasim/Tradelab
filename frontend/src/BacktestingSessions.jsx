import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Play,Plus,ArrowUpRight,FlaskConical,CalendarDays,Trash2} from 'lucide-react';
import Unlock from './Unlock';
import {api,setCsrf} from './api';
import {PrimusHeader} from './SiteExperience';
import {Modal,Button,Notice,Select,Field} from './components';
import BacktestingChart from './BacktestingChart';
import Feedback from './Feedback';
import compassLogo from '../../assets/primus-compass.png';
import {prepareReplayCharts} from './prepareReplayCharts';
import './backtesting.css';
import {changePane,toggleIntervalSync} from './replayPreferences';
const cash=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const clock=value=>new Date(value).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});

export default function BacktestingSessions({theme,onThemeToggle}) {
 const [identity,setIdentity]=useState(null);
 const [opening,setOpening]=useState(false);
 const openingTicket=useRef(0);
 const [openingStage,setOpeningStage]=useState('Fetching saved session…');
 const [retryOpening,setRetryOpening]=useState(0);
 const [renderedPanes,setRenderedPanes]=useState({});
 const reportReady=useCallback(id=>setRenderedPanes(panes=>panes[id]?panes:{...panes,[id]:true}),[]);
 const [splitPercent,setSplitPercent]=useState(50);
 const splitHost=useRef(null);
 const magnetMode=useRef('off');
 const selectMagnetMode=useCallback(mode=>{
  magnetMode.current=mode;
  for(const chart of Object.values(chartInstances.current)){
   if(chart&&chart.drawings.getSnapMode()!==mode)chart.drawings.setSnapMode(mode);
  }
 },[]);
 function resizeSplit(event){
  const rect=splitHost.current.getBoundingClientRect();
  setSplitPercent(Math.min(80,Math.max(20,100*(event.clientX-rect.left-18)/(rect.width-36))));
 }
 const drawingTool=useRef(null);
 const selectDrawingTool=useCallback((type)=>{
  drawingTool.current=type;
  for(const chart of Object.values(chartInstances.current)){
   if(chart&&chart.drawings.getTool()!==type)chart.drawings.setTool(type);
  }
 },[]);
 const [listing,setListing]=useState(null),[active,setActive]=useState(null),[cursor,setCursor]=useState(0);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState(null);
 const [selectedSessions,setSelectedSessions]=useState([]);
 const [purging,setPurging]=useState(null),[purgeName,setPurgeName]=useState('');
 const [twoCharts,setTwoCharts]=useState(false);
 const [chartWorkspace,setChartWorkspace]=useState({charts:[],activeChartId:'primary',syncCrosshair:false,syncIntervals:false});
 const [toolbarHost,setToolbarHost]=useState(null),[controlsHost,setControlsHost]=useState(null);
 const chartInstances=useRef({}),crosshairSync=useRef(false);
 crosshairSync.current=chartWorkspace.syncCrosshair;
 const updatePane=useCallback((id,patch)=>setChartWorkspace(state=>changePane(state,id,patch)),[]);
 const registerChart=useCallback((id,chart)=>{chartInstances.current[id]=chart},[]);
 const syncPointer=useCallback((id,event)=>{if(!crosshairSync.current)return;for(const [other,chart] of Object.entries(chartInstances.current))if(other!==id)chart?.renderer.setExternalCrosshair(event.time??null,null)},[]);
 function toggleCrosshair(){setChartWorkspace(state=>({...state,syncCrosshair:!state.syncCrosshair}));for(const chart of Object.values(chartInstances.current))chart?.renderer.setExternalCrosshair(null)}
 async function toggleSplit(){try{if(twoCharts){await layoutSavers.current.secondary?.();setTwoCharts(false)}else{await layoutSavers.current.primary?.();const saved=await api(`/backtesting/sessions/${active.session.id}/layouts`);const {drawings,priceScale,...inherited}=saved.layout||{};setChartWorkspace(state=>({...state,charts:state.charts.map(p=>p.id==='secondary'?{...inherited,id:'secondary',symbol:p.symbol||'ES',drawings:p.drawings||{}}:p)}));setTwoCharts(true)}for(const chart of Object.values(chartInstances.current))chart?.renderer.setExternalCrosshair(null);setChartWorkspace(state=>({...state,activeChartId:'primary'}))}catch(e){setError(e.message)}}

 const layoutSavers=useRef({}),prefetch=useRef(null);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const latest=useRef({data:null,cursor:0}),queue=useRef(Promise.resolve()),locked=useRef(false);
 latest.current={data:active,cursor};
 const accept=useCallback(reply=>{const next={...latest.current.data,...reply};latest.current.data=next;setActive(next)},[]);
 const list=useCallback(async()=>{setListing(await api('/backtesting/sessions'))},[]);
 async function opened(data,ticket=openingTicket.current){
  if(ticket!==openingTicket.current)return;
  setOpeningStage('Preparing replay history…');
  if(data.session.next_day&&data.session.last_cursor-data.session.cursor<3000){
   const reply=await api(`/backtesting/sessions/${data.session.id}/continue`,{method:'POST',body:{version:data.session.version,cursor:data.session.cursor,days:3}});data={...data,...reply};
  }
  await prepareReplayCharts(data.sample);
  if(ticket!==openingTicket.current)return;
  setOpeningStage('Preparing candle chart…');
  setRenderedPanes({});
  drawingTool.current=null;
  const group=data.layout?.chartGroup||{};
  setChartWorkspace({charts:[{...data.layout,id:'primary',symbol:data.layout?.symbol||data.session.root,timeframe:data.layout?.timeframe||'1'}, {...data.layout_secondary,id:'secondary',symbol:data.layout_secondary?.symbol||'ES',timeframe:data.layout_secondary?.timeframe||'1'}],activeChartId:data.layout?.split&&group.activeChartId==='secondary'?'secondary':'primary',syncCrosshair:Boolean(group.syncCrosshair),syncIntervals:Boolean(group.syncIntervals)});
  setTwoCharts(Boolean(data.layout?.split));latest.current={data,cursor:data.session.cursor};setActive(data);setCursor(data.session.cursor);setSaveError('');history.replaceState({},'',`/backtesting?session=${data.session.id}${new URLSearchParams(location.search).get('drawingDebug')==='1'?'&drawingDebug=1':''}`)
 }
 useEffect(()=>{
  let alive=true;const ticket=++openingTicket.current;
  (async()=>{const identity=await api('/session');setCsrf(identity.csrf);setIdentity(identity);if(!identity.authenticated)return;await list();const sid=new URLSearchParams(location.search).get('session');if(sid){setOpening(true);setOpeningStage('Fetching saved session…');const data=await api(`/backtesting/sessions/${encodeURIComponent(sid)}`);if(alive)await opened(data,ticket)}})().catch(e=>{if(alive){setError(e.message);setOpening(false)}});
  return()=>{alive=false};
 },[list,retryOpening]);
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
 function confirmDelete(items){setError('');setPurging(items);setPurgeName('')}
 async function purge(){setBusy(true);setError('');try{await api('/backtesting/sessions/delete',{method:'POST',body:{ids:purging.map(item=>item.id),confirmation:purgeName}});setPurging(null);setPurgeName('');setSelectedSessions([]);await list()}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function resume(id){const ticket=++openingTicket.current;setOpeningStage('Fetching saved session…');setOpening(true);setBusy(true);setError('');try{await opened(await api(`/backtesting/sessions/${id}`),ticket)}catch(e){setError(e.message);setOpening(false)}finally{setBusy(false)}}
 async function create(event){event.preventDefault();const ticket=++openingTicket.current;setOpeningStage('Creating replay session…');setBusy(true);setError('');try{const data=await api('/backtesting/sessions',{method:'POST',body:{...form,capital:Number(form.capital),commission:Number(form.commission),slippage:Number(form.slippage)}});await opened(data,ticket);setForm(null)}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function newSession(){setError('');setBusy(true);try{const fresh=await api('/backtesting/sessions');setListing(fresh);setForm({name:'',day:fresh.history.sample_day,start_time:'13:30',instrument:'NQ',capital:50000,commission:fresh.history.instruments.find(x=>x.symbol==='NQ')?.commission??0.5,slippage:0})}catch(e){setError(e.message)}finally{setBusy(false)}}
 function change(field,value){setForm(f=>({...f,[field]:value}))}
 const initialChartsReady=Boolean(active&&renderedPanes.primary&&(!twoCharts||renderedPanes.secondary));
 useEffect(()=>{if(initialChartsReady)setOpening(false)},[initialChartsReady]);
 const loading=<div className="loading-screen pt-loading" role="status" aria-live="polite">
  <div className="pt-loading-logo"><img src={compassLogo} alt="Primus compass"/><span aria-hidden="true"/></div>
  <h1>Primus Trader</h1><p>{openingStage}</p><small>Saved trades and drawings stay in your session.</small><button className="button" onClick={()=>{openingTicket.current++;setOpening(false);setActive(null);history.replaceState({},'','/backtesting');list().catch(e=>setError(e.message))}}>Back to sessions</button><button className="button" onClick={()=>location.reload()}>Retry opening session</button>
 </div>;
 if(identity&&!identity.authenticated)return <><PrimusHeader active="backtesting"/><Unlock workspace="backtesting" ready={Boolean(identity.csrf)} authMode={identity.auth_mode} onUnlocked={()=>location.reload()}/></>;
 if(opening&&!active)return loading;
 if(active){
  const common={reportReady,drawingTool,selectDrawingTool,magnetMode,selectMagnetMode,owner:identity?.owner===true,theme,onThemeToggle,twoCharts,onSplit:toggleSplit,journal:active.journal||{},sample:active.sample,session:active.session,projection:active.projection,cursor,onCursor:at=>{if(!locked.current){latest.current.cursor=at;setCursor(at)}},onContinue:continueSession,onAction:action,onSessionBack:leave,onSave:save,saving,saveError,sessionBusy:busy,toolbarHost,controlsHost,onPaneChange:updatePane,registerChart,onCrosshair:syncPointer,chartGroup:{activeChartId:chartWorkspace.activeChartId,syncCrosshair:chartWorkspace.syncCrosshair,syncIntervals:chartWorkspace.syncIntervals},onToggleIntervals:()=>setChartWorkspace(toggleIntervalSync),onToggleCrosshair:toggleCrosshair};
  return <>{opening&&loading}<div className="backtesting-workspace bt-layout" inert={opening||undefined} style={opening?{position:"fixed",inset:0,visibility:"hidden"}:undefined}>
   <div className="bt-shared-toolbar" ref={setToolbarHost}/>
   <div ref={splitHost} className={twoCharts?'bt-panes bt-panes-split':'bt-panes'} style={{'--bt-split-ratio':splitPercent/100}}>
    {twoCharts&&<div className="bt-split-handle" role="separator" aria-label="Resize split charts"
      aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(splitPercent)} tabIndex={0}
      onPointerDown={event=>{if(event.button===0)event.currentTarget.setPointerCapture(event.pointerId)}}
      onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))resizeSplit(event)}}
      onDoubleClick={()=>setSplitPercent(50)}
      onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();setSplitPercent(value=>event.key==='Home'?20:event.key==='End'?80:Math.max(20,Math.min(80,value+(event.key==='ArrowLeft'?-2:2))))}}/>}
    {chartWorkspace.charts.filter(pane=>pane.id==='primary'||twoCharts).map(pane=><BacktestingChart {...common} key={active.session.id+pane.id} paneId={pane.id} paneState={pane} selected={chartWorkspace.activeChartId===pane.id} onSelect={()=>setChartWorkspace(state=>state.activeChartId===pane.id?state:{...state,activeChartId:pane.id})} secondary={pane.id==='secondary'} layout={pane} registerLayoutSave={fn=>{layoutSavers.current[pane.id]=fn}} saveOtherLayout={()=>layoutSavers.current[pane.id==='primary'?'secondary':'primary']?.()||Promise.resolve()}/>)}
   </div>
   <div className="bt-shared-playback" ref={setControlsHost}/>
  </div></>;
 }

 return <div className="pt-site"><PrimusHeader active="backtesting" actions={<span className="bt-local-label">{identity?.local?'Local practice':'Private practice'}</span>}/><main className="pt-wrap bt-sessions-page">
  <div className="bt-sessions-heading"><div><span className="pt-overline">PRIMUS / BACKTESTING (BETA)</span><h1>Your practice desk.</h1><small>Backtesting (Beta)</small><p>Pick a starting day. Set your capital. Continue across trading days in the same session.</p></div><div className="settings-actions"><Feedback owner={identity?.owner===true}/><Button variant="primary" disabled={!listing||busy} onClick={newSession}><Plus size={17}/>New session</Button></div></div>
  {error&&!form&&<Notice error>{error} <Button onClick={()=>{setError('');setRetryOpening(n=>n+1)}}>Retry loading</Button></Notice>}{listing?.history.indexed_days&&<p className="bt-session-note">Available history · {listing.history.indexed_days.toLocaleString()} dates · {listing.history.first_day} to {listing.history.last_day}. Ready for your practice sessions.</p>}
  {!listing?<p role="status">Loading your sessions…</p>:listing.sessions.length===0?<div className="bt-session-empty"><FlaskConical size={32}/><h2>Your first session starts here.</h2><p>Use real NQ or ES candles with a separate practice balance.</p><Button variant="primary" onClick={newSession}>Create a session</Button></div>:<section className="bt-saved-sessions" aria-label="Saved backtesting sessions"><h2>Recent sessions <span>{listing.sessions.length}</span></h2>{listing.sessions.map(item=><article className="bt-session-card" key={item.id}><input type="checkbox" aria-label={`Select ${item.name}`} checked={selectedSessions.includes(item.id)} onChange={e=>setSelectedSessions(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/><div className="bt-session-symbol">{item.instrument}</div><div className="bt-session-info"><h3>{item.name}</h3><p><CalendarDays size={13}/>{item.day} · {clock(item.clock)} UTC · {item.finished?'Completed':'In progress'}</p><small>{item.closed} closed trades · Starting capital {cash(item.capital)}</small></div><strong>{cash(item.equity)}</strong><Button disabled={busy} onClick={()=>resume(item.id)}><Play size={15}/>{item.finished?'View session':'Resume'}</Button><Button disabled={busy} aria-label={`Delete ${item.name}`} onClick={()=>confirmDelete([item])}><Trash2 size={16}/></Button></article>)}</section>}
  {Boolean(listing&&(listing.sessions.length||listing.deleted?.length))&&<div className="settings-actions"><Button disabled={busy||!selectedSessions.length} onClick={()=>confirmDelete(listing.sessions.filter(item=>selectedSessions.includes(item.id)))}>Delete selected ({selectedSessions.length})</Button><Button disabled={busy} onClick={()=>confirmDelete([...listing.sessions,...(listing.deleted||[])])}>Delete all sessions</Button></div>}
  {purging&&<Modal title="Permanently delete sessions?" onClose={()=>!busy&&setPurging(null)}><p>Delete {purging.length} session{purging.length===1?'':'s'} permanently, including drawings and session notes? Shared price history and trades already sent to Strategy Lab or Journal stay saved. This cannot be undone.</p><p>{purging.slice(0,5).map(item=>item.name).join(', ')}{purging.length>5?'…':''}</p><Field label={`Type DELETE ${purging.length} to confirm`}><input autoComplete="off" value={purgeName} onChange={e=>setPurgeName(e.target.value)}/></Field>{error&&<Notice error>{error}</Notice>}<div className="settings-actions"><Button busy={busy} disabled={purgeName!==`DELETE ${purging.length}`} onClick={purge}>Delete permanently</Button><Button disabled={busy} onClick={()=>setPurging(null)}>Cancel</Button></div></Modal>}
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
