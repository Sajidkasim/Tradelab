import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Play,Plus,ArrowUpRight,FlaskConical,CalendarDays,Trash2} from 'lucide-react';
import {WorkspaceEntrance} from './PrimusSignIn';
import {api,setCsrf} from './api';
import {PrimusHeader,localSitePreview} from './SiteExperience';
import {Modal,Button,Notice,Select,Field} from './components';
import ReplayEconomicCalendar from './ReplayEconomicCalendar';
import {clockParts} from './replayClock';
import ReplayClosePosition from './ReplayClosePosition';
import BacktestingChart from './BacktestingChart';
import Feedback from './Feedback';
import compassLogo from '../../assets/primus-compass.png';
import {prepareReplayCharts} from './prepareReplayCharts';
import './backtesting.css';
import {changePane,toggleIntervalSync} from './replayPreferences';
const cash=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const clock=value=>new Date(value).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});

const layoutChoices = [
 {count:1,label:'Single'},
 {count:2,label:'Side by side'},
 {count:3,label:'Three charts'},
];
const marketNames = {NQ:'NQ · Nasdaq E-mini',MNQ:'MNQ · Nasdaq Micro',ES:'ES · S&P 500 E-mini'};
const clampSplit = value => Math.min(80, Math.max(20, value));
const savedSplit = (value, fallback) => Number.isFinite(value) ? clampSplit(value) : fallback;

function ChartDivider({host, label, orientation, value, reset, onResize}) {
 const vertical = orientation === 'vertical';
 const decrease = vertical ? 'ArrowLeft' : 'ArrowUp';
 const increase = vertical ? 'ArrowRight' : 'ArrowDown';
 return <div className={`bt-split-handle bt-split-handle-${orientation}`}
  role="separator" aria-label={label} aria-orientation={orientation}
  aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(value)} tabIndex={0}
  onPointerDown={event=>{if(event.button===0)event.currentTarget.setPointerCapture(event.pointerId)}}
  onPointerMove={event=>{
   if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
   const rect=host.current.getBoundingClientRect();
   const distance=vertical?event.clientX-rect.left:event.clientY-rect.top;
   const length=vertical?rect.width:rect.height;
   if(length>36)onResize(clampSplit(100*(distance-18)/(length-36)));
  }}
  onDoubleClick={()=>onResize(reset)}
  onKeyDown={event=>{
   if(![decrease,increase,'Home','End'].includes(event.key))return;
   event.preventDefault();
   onResize(event.key==='Home'?20:event.key==='End'?80:clampSplit(value+(event.key===decrease?-2:2)));
  }}/>;
}

export default function BacktestingSessions({theme,onThemeToggle}) {
 const [identity,setIdentity]=useState(null);
 const [opening,setOpening]=useState(false);
 const openingTicket=useRef(0);
 const [openingStage,setOpeningStage]=useState('Fetching saved session…');
 const [retryOpening,setRetryOpening]=useState(0);
 const [renderedPanes,setRenderedPanes]=useState({});
 const reportReady=useCallback(id=>setRenderedPanes(panes=>panes[id]?panes:{...panes,[id]:true}),[]);
 const [splitPercent,setSplitPercent]=useState(50);
 const [threeWidth,setThreeWidth]=useState(64);
 const [threeHeight,setThreeHeight]=useState(50);
 const splitHost=useRef(null);
 const magnetMode=useRef('off');
 const selectMagnetMode=useCallback(mode=>{
  magnetMode.current=mode;
  for(const chart of Object.values(chartInstances.current)){
   if(chart&&chart.drawings.getSnapMode()!==mode)chart.drawings.setSnapMode(mode);
  }
 },[]);
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
 const [paneCount,setPaneCount]=useState(1);
 const twoCharts=paneCount>1;
 const layoutSwitch=useRef(false);
 const [chartWorkspace,setChartWorkspace]=useState({charts:[],activeChartId:'primary',syncCrosshair:false,syncIntervals:false});
 const [toolbarHost,setToolbarHost]=useState(null),[controlsHost,setControlsHost]=useState(null);
 const chartInstances=useRef({}),crosshairSync=useRef(false);
 crosshairSync.current=chartWorkspace.syncCrosshair;
 const updatePane=useCallback((id,patch)=>setChartWorkspace(state=>changePane(state,id,patch)),[]);
 const registerChart=useCallback((id,chart)=>{chartInstances.current[id]=chart},[]);
 const syncPointer=useCallback((id,event)=>{if(!crosshairSync.current)return;for(const [other,chart] of Object.entries(chartInstances.current))if(other!==id)chart?.renderer.setExternalCrosshair(event.time??null,null)},[]);
 function toggleCrosshair(){setChartWorkspace(state=>({...state,syncCrosshair:!state.syncCrosshair}));for(const chart of Object.values(chartInstances.current))chart?.renderer.setExternalCrosshair(null)}
 async function setLayoutCount(count){
  if(count===paneCount||layoutSwitch.current)return;
  layoutSwitch.current=true;
  try{
   await Promise.all(Object.values(layoutSavers.current).map(save=>save?.()));
   const saved=await api(`/backtesting/sessions/${active.session.id}/layouts`);
   setChartWorkspace(state=>({...state,activeChartId:'primary',charts:state.charts.map((pane,index)=>{
    if(index<paneCount||index>=count)return pane;
    const own=saved['layout_'+pane.id];
    if(own?.symbol&&active.sample.markets[own.symbol])return {...pane,...own};
    const {drawings,priceScale,viewport,symbol,...inherited}=saved.layout||{};
    return {...pane,...inherited,drawings:pane.drawings||{}};
   })}));
   setPaneCount(count);
   for(const chart of Object.values(chartInstances.current))chart?.renderer.setExternalCrosshair(null);
  }catch(e){setSaveError(e.message)}
  finally{layoutSwitch.current=false}
 }

 const layoutSavers=useRef({}),prefetch=useRef(null);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const manualCursor=useRef(null);
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
  setSplitPercent(savedSplit(group.splitPercent,50));
  setThreeWidth(savedSplit(group.threeWidth,64));
  setThreeHeight(savedSplit(group.threeHeight,50));
  const count=[1,2,3].includes(group.paneCount)?group.paneCount:
   data.layout?.split?2:1+(data.session.comparison_charts?.length||0);
  const available=Object.keys(data.sample.markets);
  const charts=[
   ['primary',data.layout,data.session.root],
   ['secondary',data.layout_secondary,available.includes('ES')?'ES':data.session.root],
   ['tertiary',data.layout_tertiary,available.find(symbol=>symbol!==data.session.root&&symbol!==data.layout_secondary?.symbol)],
  ].map(([id,layout,fallback])=>({...layout,id,
   symbol:available.includes(layout?.symbol)?layout.symbol:fallback||data.session.root,
   timeframe:layout?.timeframe||'1',
  }));
  setChartWorkspace({charts,activeChartId:charts.slice(0,count).some(pane=>pane.id===group.activeChartId)?group.activeChartId:'primary',syncCrosshair:Boolean(group.syncCrosshair),syncIntervals:Boolean(group.syncIntervals)});
  manualCursor.current=null;
  setPaneCount(count);latest.current={data,cursor:data.session.cursor};setActive(data);setCursor(data.session.cursor);setSaveError('');history.replaceState({},'',`/backtesting?session=${data.session.id}${new URLSearchParams(location.search).get('drawingDebug')==='1'?'&drawingDebug=1':''}`)
 }
 useEffect(()=>{
  let alive=true;const ticket=++openingTicket.current;
  (async()=>{const identity=await api('/session');setCsrf(identity.csrf);setIdentity(identity);if(!identity.authenticated)return;await list();const sid=new URLSearchParams(location.search).get('session');if(sid){setOpening(true);setOpeningStage('Fetching saved session…');const data=await api(`/backtesting/sessions/${encodeURIComponent(sid)}`);if(alive)await opened(data,ticket)}})().catch(e=>{if(alive){setError(e.message);setOpening(false)}});
  return()=>{alive=false};
 },[list,retryOpening]);
 function enqueue(job){const task=queue.current.catch(()=>{}).then(job);queue.current=task;return task}
 const save=useCallback(()=>enqueue(async()=>{
  const {data,cursor:at}=latest.current;if(!data||at===data.session.cursor)return;
  const manual=manualCursor.current;
  setSaving(true);
  try{const reply=await api(`/backtesting/sessions/${data.session.id}/progress`,{method:'PUT',body:{version:data.session.version,cursor:at,manual_interaction:manual?.sid===data.session.id&&manual.at<=at}});if(manualCursor.current===manual)manualCursor.current=null;accept(reply);setSaveError('')}
  catch(e){setSaveError(e.message);throw e}
  finally{setSaving(false)}
 }),[accept]);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>{save().catch(()=>{})},3000);return()=>clearInterval(timer)},[active?.session.id,save]);
 useEffect(()=>{
  const exit=()=>{const {data,cursor:at}=latest.current;if(!data||saving||locked.current||at===data.session.cursor)return;api(`/backtesting/sessions/${data.session.id}/progress`,{method:'PUT',keepalive:true,body:{version:data.session.version,cursor:at}}).catch(()=>{})};
  window.addEventListener('pagehide',exit);return()=>window.removeEventListener('pagehide',exit);
 },[saving]);
 const [closeTicket,setCloseTicket]=useState(false);
 const [newsOpen,setNewsOpen]=useState(false);
 const newsToggle=useRef(null);
 function closeNews(){setNewsOpen(false);newsToggle.current?.focus()}
 async function action(kind,order){
  const background=kind==='amend';
  if(!background){locked.current=true;setBusy(true)}setSaveError('');
  try{await enqueue(async()=>{const {data,cursor:at}=latest.current;const reply=await api(`/backtesting/sessions/${data.session.id}/action`,{method:'POST',body:{version:data.session.version,cursor:at,kind,event_id:crypto.randomUUID(),...(kind==='close'?order:order?{order}:{})}});accept(reply)})}
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
 async function leave(){try{await Promise.all(Object.values(layoutSavers.current).map(saveLayout=>saveLayout?.()));await save();setNewsOpen(false);setActive(null);history.replaceState({},'','/backtesting');await list()}catch{}}
 function confirmDelete(items){setError('');setPurging(items);setPurgeName('')}
 async function purge(){setBusy(true);setError('');try{await api('/backtesting/sessions/delete',{method:'POST',body:{ids:purging.map(item=>item.id),confirmation:purgeName}});setPurging(null);setPurgeName('');setSelectedSessions([]);await list()}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function resume(id){const ticket=++openingTicket.current;setOpeningStage('Fetching saved session…');setOpening(true);setBusy(true);setError('');try{await opened(await api(`/backtesting/sessions/${id}`),ticket)}catch(e){setError(e.message);setOpening(false)}finally{setBusy(false)}}
 async function create(event){event.preventDefault();
  const {paneCount,...values}=form;
  const comparison_charts=values.comparison_charts.slice(0,paneCount-1);
  if(comparison_charts.some(symbol=>!comparisonMarkets.includes(symbol))){setError('Choose comparison markets available for this date.');return}
  const ticket=++openingTicket.current;setOpeningStage('Creating replay session…');setBusy(true);setError('');try{const data=await api('/backtesting/sessions',{method:'POST',body:{...values,comparison_charts,capital:Number(form.capital),commission:Number(form.commission),slippage:Number(form.slippage)}});await opened(data,ticket);setForm(null)}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function newSession(){setError('');setBusy(true);try{const fresh=await api('/backtesting/sessions');setListing(fresh);setForm({name:'',day:fresh.history.sample_day,start_time:'13:30',instrument:'NQ',capital:50000,paneCount:1,comparison_charts:['ES','NQ'],commission:fresh.history.instruments.find(x=>x.symbol==='NQ')?.commission??0.5,slippage:0})}catch(e){setError(e.message)}finally{setBusy(false)}}
 function change(field,value){setForm(f=>({...f,[field]:value}))}
 const primaryMarket={MNQ:'NQ',MES:'ES'}[form?.instrument]||form?.instrument;
 const comparisonMarkets=['NQ','ES'].includes(primaryMarket)
  ?[primaryMarket,primaryMarket==='NQ'?'ES':'NQ',...(listing.history.qqq_days?.includes(form.day)?['QQQ']:[])]
  :[primaryMarket];
 const selectedMarket=listing?.history.instruments.find(item=>item.symbol===form?.instrument);
 const initialChartsReady=Boolean(active&&chartWorkspace.charts.length>=paneCount&&chartWorkspace.charts.slice(0,paneCount).every(pane=>renderedPanes[pane.id]));
 useEffect(()=>{if(initialChartsReady)setOpening(false)},[initialChartsReady]);
 const loading=<div className="loading-screen pt-loading" role="status" aria-live="polite">
  <div className="pt-loading-logo"><img src={compassLogo} alt="Primus compass"/><span aria-hidden="true"/></div>
  <h1>Primus Trader</h1><p>{openingStage}</p><small>Saved trades and drawings stay in your session.</small><button className="button" onClick={()=>{openingTicket.current++;setOpening(false);setActive(null);history.replaceState({},'','/backtesting');list().catch(e=>setError(e.message))}}>Back to sessions</button><button className="button" onClick={()=>location.reload()}>Retry opening session</button>
 </div>;
 const entrancePreview=localSitePreview()&&new URLSearchParams(location.search).get('preview')==='signin';
 if(identity&&(!identity.authenticated||entrancePreview))return <WorkspaceEntrance workspace="backtesting" session={entrancePreview?{...identity,auth_mode:'google'}:identity} ready={!entrancePreview&&Boolean(identity.csrf)} onUnlocked={()=>location.reload()}/>;
 if(opening&&!active)return loading;
 if(active){
  const closeFrame=active.projection.frames[cursor-active.session.spec.start_cursor];
  const replayTime=active.sample.markets[active.session.root].bars[cursor].time+60000;
  const tradingPane=chartWorkspace.charts.slice(0,paneCount).find(pane=>pane.symbol===active.session.root)?.id;
  const common={tradingPane,closeTicket,newsOpen,newsToggle,onToggleNews:()=>setNewsOpen(value=>!value),onOpenClose:()=>setCloseTicket(true),reportReady,drawingTool,selectDrawingTool,magnetMode,selectMagnetMode,owner:identity?.owner===true,theme,onThemeToggle,twoCharts,paneCount,onLayoutCount:setLayoutCount,journal:active.journal||{},sample:active.sample,session:active.session,projection:active.projection,cursor,onCursor:(at,manual)=>{if(!locked.current){if(manual&&at>latest.current.cursor)manualCursor.current={sid:active.session.id,at};latest.current.cursor=at;setCursor(at)}},onContinue:continueSession,onAction:action,onSessionBack:leave,onSave:save,saving,saveError,sessionBusy:busy,toolbarHost,controlsHost,onPaneChange:updatePane,registerChart,onCrosshair:syncPointer,chartGroup:{paneCount,splitPercent,threeWidth,threeHeight,activeChartId:chartWorkspace.activeChartId,syncCrosshair:chartWorkspace.syncCrosshair,syncIntervals:chartWorkspace.syncIntervals},onToggleIntervals:()=>setChartWorkspace(toggleIntervalSync),onToggleCrosshair:toggleCrosshair};
  return <>{opening&&loading}<div className="backtesting-workspace bt-layout" inert={opening||undefined} style={opening?{position:"fixed",inset:0,visibility:"hidden"}:undefined}>
   <div className="bt-shared-toolbar" ref={setToolbarHost}/>
   <div className="bt-workspace-body"><div ref={splitHost} className={`bt-panes${twoCharts?' bt-panes-split':''}${paneCount===3?' bt-panes-three':''}`} style={{'--bt-split-ratio':(paneCount===3?threeWidth:splitPercent)/100,'--bt-row-ratio':threeHeight/100}}>
    {twoCharts&&<ChartDivider host={splitHost} label="Resize split charts" orientation="vertical"
      value={paneCount===3?threeWidth:splitPercent} reset={paneCount===3?64:50}
      onResize={paneCount===3?setThreeWidth:setSplitPercent}/>}
    {paneCount===3&&<ChartDivider host={splitHost} label="Resize right charts" orientation="horizontal"
      value={threeHeight} reset={50} onResize={setThreeHeight}/>}
    {chartWorkspace.charts.slice(0,paneCount).map(pane=><BacktestingChart {...common} key={active.session.id+pane.id} paneId={pane.id} paneState={pane} selected={chartWorkspace.activeChartId===pane.id} onSelect={()=>setChartWorkspace(state=>state.activeChartId===pane.id?state:{...state,activeChartId:pane.id})} secondary={pane.id!=='primary'} layout={pane} registerLayoutSave={fn=>{layoutSavers.current[pane.id]=fn}} saveOtherLayout={()=>Promise.all(Object.entries(layoutSavers.current).filter(([id])=>id!==pane.id).map(([,save])=>save?.()))}/>)}
   </div>
   {newsOpen&&<ReplayEconomicCalendar day={clockParts(replayTime,'America/New_York').day} replayTime={replayTime} onClose={closeNews}/>}
   </div>
   <div className="bt-shared-playback" ref={setControlsHost}/>
  </div>
   {closeTicket&&closeFrame?.position&&<ReplayClosePosition position={closeFrame.position} session={active.session}
    disabled={busy||(cursor===active.session.last_cursor&&!active.session.next_day&&!closeFrame.position.partial_target)} onClose={()=>setCloseTicket(false)} onAction={action}/>}</>;
 }

 return <div className="pt-site bt-session-site"><PrimusHeader active="backtesting"/><main className="pt-wrap bt-sessions-page">
  <header className="bt-sessions-heading">
    <div>
      <span className="pt-overline">PRIMUS / BACKTESTING</span>
      <h1>Your practice desk.</h1>
      <p>Replay a trading day and test your setups with a practice balance.</p>
    </div>
    <Button variant="primary" className="bt-new-session" disabled={!listing||busy} onClick={newSession}><Plus size={17}/>New session</Button>
  </header>
  {error&&!form&&<Notice error>{error} <Button onClick={()=>{setError('');setRetryOpening(n=>n+1)}}>Retry loading</Button></Notice>}
  {!listing?<p role="status">Loading your sessions…</p>:listing.sessions.length===0?<div className="bt-session-empty"><FlaskConical size={32}/><h2>Your first session starts here.</h2><p>Choose a market and date to start replaying.</p></div>:<section className="bt-saved-sessions" aria-label="Saved backtesting sessions"><h2>Recent sessions <span>{listing.sessions.length}</span></h2>{listing.sessions.map(item=><article className="bt-session-card" key={item.id}><input type="checkbox" aria-label={`Select ${item.name}`} checked={selectedSessions.includes(item.id)} onChange={e=>setSelectedSessions(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/><div className="bt-session-symbol">{item.instrument}</div><div className="bt-session-info"><h3>{item.name}</h3><p><CalendarDays size={13}/>{item.day} · {clock(item.clock)} UTC · {item.finished?'Completed':'In progress'}</p><small>{item.closed} closed trades · Starting capital {cash(item.capital)}</small></div><strong>{cash(item.equity)}</strong><Button disabled={busy} onClick={()=>resume(item.id)}><Play size={15}/>{item.finished?'View session':'Resume'}</Button><Button disabled={busy} aria-label={`Delete ${item.name}`} onClick={()=>confirmDelete([item])}><Trash2 size={16}/></Button></article>)}</section>}
  {listing && selectedSessions.length > 0 && <div className="bt-bulk-actions" role="group" aria-label="Session selection actions">
    <strong>{selectedSessions.length} selected</strong>
    <Button onClick={()=>setSelectedSessions([])} disabled={busy}>Clear selection</Button>
    <Button disabled={busy} onClick={()=>confirmDelete(listing.sessions.filter(item=>selectedSessions.includes(item.id)))}>Delete selected ({selectedSessions.length})</Button>
    <Button disabled={busy} onClick={()=>confirmDelete([...listing.sessions,...(listing.deleted||[])])}>Delete all sessions</Button>
  </div>}
  {listing && !listing.sessions.length && listing.deleted?.length > 0 &&
    <Button disabled={busy} onClick={()=>confirmDelete(listing.deleted)}>Clear deleted sessions</Button>}
  {purging&&<Modal title="Permanently delete sessions?" onClose={()=>!busy&&setPurging(null)}><p>Delete {purging.length} session{purging.length===1?'':'s'} permanently, including drawings and session notes? Shared price history and trades already sent to Strategy Lab or Journal stay saved. This cannot be undone.</p><p>{purging.slice(0,5).map(item=>item.name).join(', ')}{purging.length>5?'…':''}</p><Field label={`Type DELETE ${purging.length} to confirm`}><input autoComplete="off" value={purgeName} onChange={e=>setPurgeName(e.target.value)}/></Field>{error&&<Notice error>{error}</Notice>}<div className="settings-actions"><Button busy={busy} disabled={purgeName!==`DELETE ${purging.length}`} onClick={purge}>Delete permanently</Button><Button disabled={busy} onClick={()=>setPurging(null)}>Cancel</Button></div></Modal>}
  <footer className="bt-sessions-footer">
    <div className="settings-actions"><Feedback owner={identity?.owner===true}/></div>
  </footer>
 </main>{form&&<Modal title="New backtesting session" className="bt-session-modal" onClose={()=>!busy&&setForm(null)}><form className="stack" onSubmit={create}>
  <fieldset disabled={busy} className="bt-session-fields">
  <section className="bt-session-section" aria-labelledby="bt-market-heading">
    <h3 id="bt-market-heading">Market &amp; timing</h3>
    <Select label="Trading market" values={listing.history.instruments.map(item=>({value:item.symbol,label:marketNames[item.symbol]||item.symbol}))}
      value={form.instrument} onChange={e=>{
        const market=listing.history.instruments.find(item=>item.symbol===e.target.value);
        setForm(f=>({...f,instrument:market.symbol,commission:market.commission,start_time:market.default_start||'13:30',
          day:(f.day<(market.first_day||listing.history.first_day)||f.day>(market.last_day||listing.history.last_day))?(market.last_day||listing.history.sample_day):f.day}));
      }}/>
    {form.instrument==='MNQ'&&<small>10 MNQ match 1 NQ in dollar exposure per point. Scale out in whole micro contracts.</small>}
    <div className="form-grid two">
      <Field label="Trading date"><input required type="date" min={selectedMarket?.first_day||listing.history.first_day}
        max={selectedMarket?.last_day||listing.history.last_day} value={form.day} onInput={e=>change('day',e.target.value)} onChange={e=>change('day',e.target.value)}/></Field>
      <Field label="Start time (UTC)"><input required type="time" value={form.start_time} onChange={e=>change('start_time',e.target.value)}/></Field>
    </div>
  </section>
  <section className="bt-session-section" aria-labelledby="bt-layout-heading">
    <h3 id="bt-layout-heading">Chart layout</h3>
    <div className="bt-layout-choices" role="group" aria-labelledby="bt-layout-heading">
      {layoutChoices.map(({count,label})=><button className="bt-layout-choice" key={count} type="button"
        aria-pressed={form.paneCount===count} onClick={()=>setForm(current=>({...current,paneCount:count,
          comparison_charts:[0,1].map(index=>comparisonMarkets.includes(current.comparison_charts[index])&&
            (index<current.paneCount-1 || current.paneCount===count)
            ?current.comparison_charts[index]:comparisonMarkets[index+1]||primaryMarket),
        }))}>
        <span className={`bt-layout-preview bt-layout-preview-${count}`} aria-hidden="true">
          {Array.from({length:count},(_,index)=><span key={index}/>)}
        </span>
        {label}
      </button>)}
    </div>
    {form.paneCount>1&&<>
      <div className="form-grid two">
        {form.comparison_charts.slice(0,form.paneCount-1).map((symbol,index)=><Select key={index}
          label={index===0?'Comparison chart 1':'Comparison chart 2'} values={comparisonMarkets}
          value={comparisonMarkets.includes(symbol)?symbol:''} empty="Choose a market"
          onChange={event=>change('comparison_charts',form.comparison_charts.map((value,position)=>position===index?event.target.value:value))}/>)}
      </div>
      {['NQ','ES'].includes(primaryMarket)&&<small>{comparisonMarkets.includes('QQQ')
        ?'QQQ is available as a comparison chart.'
        :'QQQ comparison is unavailable for this date.'}</small>}
    </>}
  </section>
  <section className="bt-session-section" aria-labelledby="bt-details-heading">
    <h3 id="bt-details-heading">Session details</h3>
    <div className="form-grid two">
      <Field label="Session name"><input value={form.name} placeholder="Optional" maxLength={80} onChange={e=>change('name',e.target.value)}/></Field>
      <Field label="Starting capital ($)"><input required type="number" min="1" max="1000000000" step="0.01" value={form.capital} onChange={e=>change('capital',e.target.value)}/></Field>
    </div>
  </section>
  <details className="disclosure"><summary>Costs & fill rules</summary><div className="stack"><div className="form-grid two"><Field label="Commission per contract / side ($)"><input required type="number" min="0" max="100" step="0.01" value={form.commission} onChange={e=>change('commission',e.target.value)}/></Field><Field label="Slippage (ticks)"><input required type="number" min="0" max="20" step="1" value={form.slippage} onChange={e=>change('slippage',e.target.value)}/></Field></div><small>Market orders fill at the next one-minute open. Stop loss wins if both stop and target touch in a candle. Intrabar entries cannot claim an ambiguous same-candle target. Positions stay open across days until you close them or a stop or target is reached. No exchange margin or liquidation model is applied.</small></div></details>
  </fieldset>
  {busy&&<p role="status">Preparing your candles…</p>}{error&&<Notice error>{error}</Notice>}
  <div className="settings-actions"><Button type="submit" variant="primary" busy={busy}>Open session <ArrowUpRight size={16}/></Button><Button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</Button></div>
 </form></Modal>}</div>;
}
