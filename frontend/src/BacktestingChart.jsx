import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, Compass, Sun, Moon, ChartNoAxesCombined, Search, Plus, X, Settings2, Scan, Trash2, Newspaper} from 'lucide-react';
import {api} from './api';
import {createPortal} from 'react-dom';
import ReplayTrading from './ReplayTrading';
import ReplayNewsDrawer from './ReplayNewsDrawer';
import {replayNewsDay} from './replayNews';
import ReplayCanvasTools from './ReplayCanvasTools';
import {captureReplayView,restoreReplayView,installFreeReplayNavigation} from './replayViewport';
import DrawingFavoritesBar,{toolNames} from './DrawingFavoritesBar';
import Feedback from './Feedback';
import {indicatorVisible,intervalChoices,visibilityController} from './replayPreferences';
import SessionRanges,{SessionRangeSettings} from './SessionRanges';
import {sessionOptions} from './replaySessionRanges';
import {recordTiming} from './replayTiming';
import {installDrawingPerformance,latestLayoutWriter} from './replayDrawingPerformance';
import {ReplayHistoryFeed} from './ReplayHistoryFeed';
import {streamReplayBars} from './replayChartStream';
import {startReplayClock,nextReplayCursor, REPLAY_ZONES, clockParts, replayZone, replayClockLabel} from './replayClock';
import {Modal, Button, Select, Field} from './components';
import {CHART_TIMEFRAMES, timeframeLabel, savedTimeframes, validTimeframe} from './backtestingBars';
import './backtesting.css';
import {installDrawingGeometry} from './replayDrawingGeometry';
import DrawingActions from './DrawingActions';
import DrawingContextMenu from './DrawingContextMenu';
import {installReplayDrawingInteractions} from './replayDrawingInteractions';

const chartTheme = mode => ({
  background: mode === 'dark' ? '#16191c' : '#fcfcfb',
  textColor: mode === 'dark' ? '#cbd1d5' : '#525953',
  gridColor: mode === 'dark' ? '#262b30' : '#eceeea',
  borderColor: mode === 'dark' ? '#30363b' : '#e1e4de',
  upColor: '#389483', downColor: '#d36871',
  fontFamily: 'Inter, system-ui, sans-serif',
});
const drawingTools = ['trendline', 'hline', 'hray', 'box', 'fibretracement', 'text', 'position'];
const popular = ['sma', 'ema', 'vwap', 'rsi', 'macd', 'bb', 'atr'];

export default function BacktestingChart({reportReady,drawingTool,selectDrawingTool,magnetMode,selectMagnetMode,theme, onThemeToggle, sample, session, projection, cursor, onCursor, onContinue, onAction, onSessionBack, onSave, saving, saveError, sessionBusy,layout={},secondary=false,twoCharts=false,onSplit,journal={},registerLayoutSave,paneId,paneState,onPaneChange,selected,onSelect,toolbarHost,controlsHost,chartGroup,onToggleCrosshair,onToggleIntervals,owner=false,registerChart,onCrosshair,saveOtherLayout=()=>Promise.resolve()}) {
  const drawingGeometry=useRef(null);
  const [drawingEditor,setDrawingEditor]=useState(null);
  const [drawingMenu,setDrawingMenu]=useState(null);
  const [priceScale,setPriceScale]=useState({mode:'price',log:false});
  const closeDrawingMenu=useCallback(()=>setDrawingMenu(null),[]);
  const openDrawingEditor=useCallback((id,tab,template)=>setDrawingEditor({id,tab,template}),[]);
  const symbol=paneState.symbol,timeframe=paneState.timeframe;
  const setSymbol=value=>{historyFeed.current?.cancel();onPaneChange(paneId,{symbol:value})};
  const setTimeframe=value=>{historyFeed.current?.cancel();onPaneChange(paneId,{timeframe:value})};
  const groupRef=useRef(chartGroup);groupRef.current=chartGroup;
  const [clockZone,setClockZone]=useState(()=>replayZone(layout.clockDisplayVersion===2?layout.clockZone:undefined));
  const [sessionRangeOptions,setSessionRangeOptions]=useState(()=>sessionOptions(layout.sessionRanges)),[sessionRangeEditor,setSessionRangeEditor]=useState(false);
  const [toolsEditor,setToolsEditor]=useState(false);
  const favoriteBarPosition=useRef(layout.favoriteBarPosition||{x:70,y:70});
  const visibility=useRef(null);if(!visibility.current)visibility.current=visibilityController();
  const [newsOpen,setNewsOpen]=useState(false);
  useEffect(()=>{if(selected===false)setNewsOpen(false)},[selected]);
  const [follow,setFollow]=useState(false),[clearDrawings,setClearDrawings]=useState(false);
  const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState('1'),[step,setStep]=useState('1');
  const timeline=sample.markets[session.root].bars;
  const replayTime=timeline[cursor].time;
  const confirmedFrame=projection.frames[cursor-session.spec.start_cursor];
  const [submittingOrder,setSubmittingOrder]=useState(null);
  const frame=submittingOrder?{...confirmedFrame,order:submittingOrder,ticket:{pending:true,reference:submittingOrder.price??timeline[cursor].close,side:submittingOrder.side,qty:submittingOrder.qty,stop_price:submittingOrder.stop??timeline[cursor].close,target_price:submittingOrder.target??timeline[cursor].close,stop_result:null,target_result:null}}:confirmedFrame;
  async function submitAction(kind,order){
    if(kind==='order')setSubmittingOrder({...order,submitting:true});
    try{return await onAction(kind,order)}finally{if(kind==='order')setSubmittingOrder(null)}
  }
  const finished=cursor===session.last_cursor;
  const lastRendered=useRef(null),marketRequest=useRef(null),marketSettled=useRef(Promise.resolve()),symbolViews=useRef(new Map());
  const [marketVersion,setMarketVersion]=useState(0);
  const jumpToLatest=useRef(false);
  const [shortcuts,setShortcuts]=useState(()=>savedTimeframes(JSON.stringify(layout.shortcuts)));
  const [timeframeEditor,setTimeframeEditor]=useState(null),[customInterval,setCustomInterval]=useState('3'),[customUnit,setCustomUnit]=useState('minutes'),[timeframeError,setTimeframeError]=useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [picker, setPicker] = useState(false), [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState([]), [studies, setStudies] = useState([]);
  const host = useRef(null), chartRef = useRef(null), drawings = useRef(layout.drawings||{});
  const feed=useRef(null),lastLayout=useRef(''),layoutQueue=useRef(Promise.resolve());
  const selectedRef=useRef(selected);selectedRef.current=selected;
  const layoutDirty=useRef(false),gesture=useRef(false),layoutTimer=useRef(null),saveCurrent=useRef(null),layoutWriter=useRef(null);
  if(!layoutWriter.current)layoutWriter.current=latestLayoutWriter(value=>api(`/backtesting/sessions/${session.id}/layout?pane=${secondary?'secondary':'primary'}&defaults=${selectedRef.current}`,{method:'PUT',body:{layout:value}}));
  function dirtyLayout(){layoutDirty.current=true;clearTimeout(layoutTimer.current);layoutTimer.current=setTimeout(()=>{if(!gesture.current)saveCurrent.current?.(false).catch(()=>{})},1000)}
  const [watermark,setWatermark]=useState(()=>layout.watermark!==false);
  const watermarkValue=useRef(watermark);watermarkValue.current=watermark;
  const [minuteWatermarks,setMinuteWatermarks]=useState(()=>layout.minuteWatermarks||{'1':true,'5':true});
  const minuteWatermarkRef=useRef(minuteWatermarks);minuteWatermarkRef.current=minuteWatermarks;
  const [orderQty,setOrderQty]=useState(1);
  const selection = useRef({symbol, timeframe, theme, replayTime});
  selection.current = {symbol, timeframe, theme, replayTime};
  const [historyStatus,setHistoryStatus]=useState(null);
  const replayRead=useRef(null);replayRead.current={cursor,time:replayTime,markets:sample.markets};
  const historyFeed=useRef(null);if(!historyFeed.current)historyFeed.current=new ReplayHistoryFeed(session.id,()=>replayRead.current,value=>setHistoryStatus({...value}));
  const bars = useMemo(() => historyFeed.current.view(symbol,timeframe)||[], [sample,symbol,timeframe,replayTime,ready,marketVersion,historyStatus]);
  const edgeTimer=useRef(null),edgeBusy=useRef(false),edgeNavigation=useRef(0);
  const market = sample?.markets[symbol];
  const timeframeName = timeframeLabel(timeframe);
  const syncStudies = useCallback(() => {
    const chart = chartRef.current;
    if (chart) setStudies(chart.indicators().map(handle => ({id: handle.id, title: handle.title, type: handle.nativeType})));
  }, []);

  // Keep one chart alive: market/timeframe switches retain indicators and settings.
  useEffect(() => {
    if (!sample) return;
    let alive = true, chart;
    const unsubscribers = [];
    setError(''); setReady(false); setBusy(true);setFollow(false);
    import('@luxalgo/vela').then(async vela => {
      const {Vela}=vela;
      if (!alive) return;
      const current = selection.current;
      const subscribers=new Set();
      const source={getBars:async(ticker,tf)=>{try{return await historyFeed.current.initial(ticker.startsWith('NQ')?'NQ':'ES',String(tf))}catch(error){if(alive&&error.name!=='AbortError')setError(error.message);throw error}},subscribe:(_ticker,_tf,cb)=>{subscribers.add(cb);return()=>subscribers.delete(cb)}};
      feed.current=subscribers;
      chart = new Vela(host.current, {
        symbol: `practice:${sample.markets[current.symbol].contract}`, timeframe: current.timeframe,
        nativeBackend:'canvas2d', live: true, bars:750, theme: chartTheme(current.theme), height: '100%',
        drawings: {tools: drawingTools, toolbar: !secondary}, volume: false, animations: false,
      });
      chartRef.current = chart;
      registerChart(paneId,chart);
      unsubscribers.push(chart.renderer.onCrosshairMove(event=>onCrosshair(paneId,event)));
      chart.data.registerProvider('practice',source);
      const sync = () => {if (alive) syncStudies()};
      unsubscribers.push(chart.on('indicator:added', sync), chart.on('indicator:removed', sync));
      unsubscribers.push(chart.on('indicator:visibility',({id,visible})=>{visibility.current.remember(id,visible);visibility.current.apply(chart,selection.current.timeframe)}));
      unsubscribers.push(chart.on('indicator:error', ({error}) => {if (alive) setError(error.message)}));
      await chart.ready();
      chart.setLocale({locale:'en-GB',hourCycle:'h23'});
      if (!alive) return;
      const config = chart.renderer.getConfig();
      if (config) chart.renderer.applyConfig({...config, timeScale: {...config.timeScale, timezone: clockZone}});
      chart.renderer.setSettingsSections([{title:'Replay',placement:'symbol',rows:[{kind:'toggle',label:'Timeframe watermark',get:()=>watermarkValue.current,set:value=>{setWatermark(value);dirtyLayout()}},{kind:'toggle',label:'1-minute watermark',get:()=>minuteWatermarkRef.current['1']!==false,set:value=>{setMinuteWatermarks(v=>({...v,'1':value}));dirtyLayout()}},{kind:'toggle',label:'5-minute watermark',get:()=>minuteWatermarkRef.current['5']!==false,set:value=>{setMinuteWatermarks(v=>({...v,'5':value}));dirtyLayout()}}]}]);
      if(layout.config)chart.renderer.applyConfig({...layout.config,timeScale:{...layout.config.timeScale,timezone:clockZone}});
      chart.drawings.setToolTemplates(layout.drawingTemplates||{});chart.drawings.setToolDefaults(layout.drawingDefaults||{});chart.drawings.setFavorites(layout.drawingToolFavorites||[]);
      chart.drawings.setStayMode(false);
      chart.drawings.setTool(drawingTool.current);
      chart.drawings.setSnapMode(magnetMode.current);
      unsubscribers.push(chart.on('drawing:snap', ({mode})=>selectMagnetMode(mode)));
      const removeDrawingInteractions=installReplayDrawingInteractions(chart,openDrawingEditor,host.current,setDrawingMenu);
      unsubscribers.push(chart.on('drawing:tool', ({type})=>selectDrawingTool(type)));
      if(layout.drawings?.[chart.market.symbol])chart.drawings.fromJSON(layout.drawings[chart.market.symbol]);
      for(const item of layout.studies||[])if(item.type&&item.type!=='volume'){const h=chart.addNativeIndicator(item.type,{inputs:item.inputs||{}});visibility.current.rules.set(h.id,{maximum:item.maximum||'',visible:item.visible!==false})}
      visibility.current.apply(chart,current.timeframe);
      setPriceScale(chart.renderer.getConfig().priceScale);
      const native=chart.renderer.renderer;
      // Clamp saved zoom before the first projection, while retaining horizontal pan.
      unsubscribers.push(installFreeReplayNavigation(chart,host.current,()=>{edgeNavigation.current++;clearTimeout(edgeTimer.current);edgeTimer.current=setTimeout(()=>loadEdge(chart),150)}));
      if(layout.viewport&&native?.applyViewport)native.applyViewport(layout.viewport);
      if(layout.priceScale&&native?.scene?.panes?.get('price'))native.scene.panes.get('price').manualScale=layout.priceScale;
      drawingGeometry.current=installDrawingGeometry(chart);
      const removeDrawingPerformance=installDrawingPerformance(chart);
      unsubscribers.push(drawingGeometry.current,()=>{removeDrawingPerformance();removeDrawingInteractions()});
      for(const event of ['drawing:favorites','drawing:templates','drawing:defaults','drawing:created','drawing:edited','drawing:removed','drawing:selected','indicator:added','indicator:removed','indicator:inputs','indicator:visibility','indicator:moved','pane:changed','priceStyle:change','viewport:changed'])unsubscribers.push(chart.on(event,dirtyLayout));
      // Includes settings edits, undo/redo and wheel/price-scale gestures. A layout
      // snapshot is never constructed while a pointer is held down.
      const start=()=>{gesture.current=true;edgeNavigation.current++},end=()=>{if(gesture.current){gesture.current=false;dirtyLayout()}},wheel=()=>{edgeNavigation.current++;dirtyLayout()};
      const navigate=e=>{if(e.type==='keydown'||e.buttons||e.pointerType==='touch')edgeNavigation.current++};
      host.current.addEventListener('pointermove',navigate,true);host.current.addEventListener('keydown',navigate,true);
      unsubscribers.push(()=>{element.removeEventListener('pointermove',navigate,true);element.removeEventListener('keydown',navigate,true)});
      const element=host.current;element.addEventListener('pointerdown',start,true);element.addEventListener('wheel',wheel,{passive:true});
      window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);window.addEventListener('blur',end);
      unsubscribers.push(()=>{element.removeEventListener('pointerdown',start,true);element.removeEventListener('wheel',wheel);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);window.removeEventListener('blur',end);clearTimeout(layoutTimer.current)});
      unsubscribers.push(chart.on('viewport:changed',()=>{clearTimeout(edgeTimer.current);edgeTimer.current=setTimeout(()=>loadEdge(chart),150)}));
      const available = await chart.availableNativeIndicators();
      if (!alive) return;
      lastRendered.current=historyFeed.current.view(current.symbol,current.timeframe)||[];setCatalog(available); syncStudies(); setReady(true); setBusy(false);
    }).catch(e => {if (alive) {setError(e.message); setBusy(false)}});
    return () => {
      alive = false; unsubscribers.forEach(unsubscribe => unsubscribe());
      if (chartRef.current === chart) chartRef.current = null;
      registerChart(paneId,null);
      clearTimeout(edgeTimer.current);historyFeed.current.cancel();chart?.destroy();
    };
  }, [session.id, syncStudies]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart || !market) return;
    if(marketRequest.current)return;
    if (chart.market.symbol === `practice:${market.contract}` && chart.market.timeframe === timeframe && lastRendered.current===bars) return;
    const previousSymbol = chart.market.symbol;
    const wanted=`practice:${market.contract}`;
    const same=previousSymbol===wanted&&chart.market.timeframe===timeframe;
    const previousBars=lastRendered.current;
    if(same&&previousBars){
      const historyMoved=previousBars.length!==bars.length||previousBars[0]?.time!==bars[0]?.time;
      streamReplayBars(chart,feed.current,previousBars,bars,{follow,jump:jumpToLatest.current});
      jumpToLatest.current=false;
      lastRendered.current=bars;
      // A stable restore may emit no viewport event. Continue filling an
      // overshot pan explicitly; feed hysteresis prevents reciprocal fetches.
      if(historyMoved){clearTimeout(edgeTimer.current);edgeTimer.current=setTimeout(()=>loadEdge(chart),150)}
      return;
    }
    setBusy(true);setError('');
    if(previousSymbol!==wanted){
      drawings.current[previousSymbol]=chart.drawings.toJSON();
      chart.drawings.fromJSON(drawings.current[wanted]||{version:1,drawings:[]});
    }
    if(same){setBusy(false);return}
    const currentView=captureReplayView(chart);symbolViews.current.set(previousSymbol,currentView);
    const snapshot=previousSymbol===wanted?currentView:symbolViews.current.get(wanted)||({...currentView,price:null});
    historyFeed.current.anchor=snapshot?.to??null;
    marketRequest.current={symbol:wanted,timeframe};
    const switchStarted=performance.now();
    marketSettled.current=historyFeed.current.initial(symbol,timeframe).then(()=>{if(selection.current.symbol!==symbol||selection.current.timeframe!==timeframe)return;drawingGeometry.current?.trace?.('before');return chart.setMarket({symbol:wanted,timeframe})}).then(()=>{
      if(chartRef.current===chart&&selection.current.symbol===symbol&&selection.current.timeframe===timeframe){restoreReplayView(chart,snapshot);drawingGeometry.current?.trace?.('after');lastRendered.current=historyFeed.current.view(symbol,timeframe)||[];setBusy(false);syncStudies()}
    }).catch(e=>{if(chartRef.current===chart&&e.name!=='AbortError'){setError(e.message);setBusy(false)}}).finally(()=>{recordTiming('switch:'+timeframe,switchStarted);marketRequest.current=null;if(chartRef.current===chart)setMarketVersion(value=>value+1)});
  }, [ready, market, timeframe, bars, syncStudies, follow,marketVersion]);

  useEffect(()=>{if(!busy&&(ready||error))reportReady(paneId)},[ready,busy,error,paneId,reportReady]);

  useEffect(()=>{if(!ready||busy)return;const timer=setTimeout(()=>historyFeed.current.prefetch(symbol),250);return()=>clearTimeout(timer)},[ready,busy,symbol]);

  async function loadEdge(chart){
    if(edgeBusy.current||chartRef.current!==chart)return;
    const selected=selection.current,slot=historyFeed.current.slot(selected.symbol,selected.timeframe);
    if(!slot?.bars.length)return;
    const range=captureReplayView(chart);if(!range)return;
    const navigation=edgeNavigation.current;
    const direction=historyFeed.current.pagingDirection(selected.symbol,selected.timeframe,range,navigation);
    if(!direction)return;edgeBusy.current=true;
    try{
      // onStatus renders the bounded series once through the existing stream effect.
      await historyFeed.current.page(selected.symbol,selected.timeframe,direction,navigation);
      if(chartRef.current===chart&&selection.current.symbol===selected.symbol&&selection.current.timeframe===selected.timeframe)setError('');
    }catch(error){if(error.name!=='AbortError'&&chartRef.current===chart&&selection.current.symbol===selected.symbol&&selection.current.timeframe===selected.timeframe)setError(error.message)}finally{edgeBusy.current=false}
  }

  useEffect(()=>{if(ready)chartRef.current?.renderer.applyConfig({timeScale:{timezone:clockZone}});localStorage.setItem('primus-replay-clock-v2',clockZone)},[clockZone,ready]);
  useEffect(() => {if (ready) chartRef.current?.setTheme(chartTheme(theme))}, [theme, ready]);
  useEffect(() => {document.title = `${session.name} — Primus Backtesting`}, [session.name]);
  async function next(){
    if(finished&&session.next_day){try{await onContinue();onCursor(cursor+1)}catch(e){setError(e.message)};return}
    onCursor(nextReplayCursor(timeline,cursor,Number(step)));
  }
  const playback=useRef(null),continuing=useRef(null);
  playback.current={enabled:playing&&!secondary&&ready&&!busy&&!sessionBusy&&!saveError,speed,step,timeline,cursor,finished,nextDay:session.next_day,lastCursor:session.last_cursor,onCursor,onContinue};
  useEffect(()=>{
    if(saveError||(finished&&!session.next_day))setPlaying(false);
  },[saveError,finished,session.next_day]);
  useEffect(()=>{
    if(secondary||!playing)return;
    continuing.current=null;
    return startReplayClock({read:()=>({...playback.current,enabled:playback.current.enabled&&!document.hidden}),advance:steps=>{
      const state=playback.current;
      if(state.finished){
        if(!state.nextDay||continuing.current)return;
        continuing.current=state.timeline.at(-1).time;
        return Promise.resolve().then(()=>state.onContinue()).then(()=>{
          state.onCursor(state.cursor+1);
        }).catch(e=>{setError(e.message);setPlaying(false)});
      }
      // Multiple due ticks become a single React/chart update for this frame.
      let at=state.cursor;
      for(let i=0;i<steps&&at<state.lastCursor;i++)at=nextReplayCursor(state.timeline,at,Number(state.step));
      state.cursor=at;state.finished=at===state.lastCursor;
      state.onCursor(at);
    }});
  },[playing,secondary,session.id]);
  useEffect(()=>{continuing.current=null},[timeline]);

  function saveLayout(force=true,patch={}){
    const chart=chartRef.current;if(!ready||!chart)return Promise.resolve();
    if(busy){if(!force)return Promise.resolve();return marketSettled.current.then(()=>new Promise(resolve=>requestAnimationFrame(resolve))).then(()=>chartRef.current===chart?saveCurrent.current(force,patch):undefined)}
    if(!force&&(!layoutDirty.current||gesture.current))return layoutQueue.current;
    layoutDirty.current=false;const started=performance.now();
    drawings.current[chart.market.symbol]=chart.drawings.toJSON();
    const native=chart.renderer.renderer;
    const value={chartGroup:groupRef.current,chartContextVersion:sample.chart_context_version||0,split:twoCharts,symbol,timeframe,clockZone,watermark,minuteWatermarks,shortcuts,sessionRanges:sessionRangeOptions,clockDisplayVersion:2,drawings:drawings.current,favoriteBarPosition:favoriteBarPosition.current,drawingFavorites:layout.drawingFavorites||[],drawingToolFavorites:chart.drawings.favorites(),drawingTemplates:chart.drawings.toolTemplates(),drawingDefaults:chart.drawings.toolDefaults(),config:chart.renderer.getConfig(),viewport:native?.coords?.getViewport?.(),priceScale:native?.scene?.panes?.get('price')?.manualScale,studies:chart.indicators().filter(h=>h.nativeType&&h.nativeType!=='volume').map(h=>({type:h.nativeType,inputs:h.inputValues(),visible:visibility.current.rules.get(h.id)?.visible??h.visible,maximum:visibility.current.rules.get(h.id)?.maximum||''})),...patch};
    const encoded=JSON.stringify(value);recordTiming('drawings:layout-snapshot',started);if(encoded===lastLayout.current)return layoutQueue.current;
    lastLayout.current=encoded;
    onPaneChange(paneId,{visibleRange:chart.getVisibleRange?.(),drawings:value.drawings,priceScale:value.priceScale,viewport:value.viewport});
    const task=layoutWriter.current(value).catch(e=>{layoutDirty.current=true;lastLayout.current='';setError(e.message);throw e});layoutQueue.current=task;return task;
  }
  saveCurrent.current=saveLayout;
  useEffect(()=>{registerLayoutSave?.((...args)=>saveCurrent.current(...args));return()=>registerLayoutSave?.(null)},[ready,busy,symbol,timeframe,clockZone,twoCharts]);
  useEffect(()=>{dirtyLayout()},[symbol,timeframe,clockZone,twoCharts,chartGroup?.activeChartId,chartGroup?.syncCrosshair,chartGroup?.syncIntervals]);
  useEffect(()=>{if(ready&&chartRef.current)visibility.current.apply(chartRef.current,timeframe)},[timeframe,ready]);
  useEffect(()=>{const timer=setInterval(()=>saveCurrent.current?.(false).catch(()=>{}),10000);return()=>clearInterval(timer)},[]);

  const wasPlaying=useRef(false);
  useEffect(()=>{if(wasPlaying.current&&!playing&&!secondary)saveLayout().then(saveOtherLayout).then(onSave).catch(()=>{});wasPlaying.current=playing},[playing]);
  function deleteAllDrawings(){
    const chart=chartRef.current;if(!chart)return;
    chart.drawings.removeMany(chart.drawings.all().map(d=>d.id));drawings.current[chart.market.symbol]=chart.drawings.toJSON();setClearDrawings(false);
    saveLayout().catch(e=>setError(e.message));
  }
  function openIndicators() {
    setPlaying(false);chartRef.current?.renderer.closeDialogs(); syncStudies(); setSearch(''); setPicker(true);
  }
  function addStudy(item) {
    try {chartRef.current.addNativeIndicator(item.type); syncStudies()} catch(e) {setError(e.message)}
  }
  function removeStudy(id) {
    chartRef.current?.indicators().find(item => item.id === id)?.remove(); syncStudies();
  }
  function editStudy(id) {
    setPicker(false);
    requestAnimationFrame(() => chartRef.current?.renderer.openIndicatorSettings(id));
  }
  const matches = catalog.filter(item => (item.type !== "volume" || search.trim()) && `${item.title} ${item.type}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b) => (popular.includes(a.type) ? 0 : 1) - (popular.includes(b.type) ? 0 : 1) || a.title.localeCompare(b.title));

  return <div className={`backtesting-workspace bt-chart-pane ${selected?'is-selected':''}`} data-pane-id={paneId} onPointerDownCapture={e=>{if(e.currentTarget.contains(e.target))onSelect()}}>
    {selected&&toolbarHost&&createPortal(<header className="bt-toolbar" aria-label="Chart controls">
      <a href="/backtesting" className="bt-back" aria-label="Back to sessions" title="Save & back to sessions" onClick={e=>{e.preventDefault();setPlaying(false);saveLayout().then(saveOtherLayout).then(onSessionBack).catch(()=>{})}}><ArrowLeft size={19}/><span>Back</span></a>
      <a className="bt-brand" href="/" aria-label="PrimusTrader home"><Compass size={21}/><span>PRIMUS · BETA</span></a>
      <div className="bt-market"><Select label="Market" values={['NQ','ES']} value={symbol} disabled={!ready || busy} onChange={e => setSymbol(e.target.value)}/></div>
      <div className="bt-timeframes" role="group" aria-label="Chart timeframe" title="Built from one-minute data. Second-based candles are not available.">
        {shortcuts.map(value=>({value,label:timeframeLabel(value)})).map(item => <button key={item.value} disabled={!ready} aria-pressed={timeframe === item.value} onClick={() => setTimeframe(item.value)}>{item.label}</button>)}
      <button aria-label="Manage timeframes" title="Save your timeframe shortcuts" onClick={()=>{setPlaying(false);setTimeframeEditor([...shortcuts]);setTimeframeError('')}}><Plus size={16}/></button></div>
      <div className="bt-tools"><button onClick={()=>selectDrawingTool(null)} title="Stop drawing and select objects">Select drawings</button>{<button aria-label="Toggle two charts" aria-pressed={twoCharts} onClick={onSplit}>Ⅱ</button>}{twoCharts&&<button aria-label="Sync intervals" aria-pressed={chartGroup.syncIntervals} onClick={onToggleIntervals}>Sync intervals {chartGroup.syncIntervals?'On':'Off'}</button>}{twoCharts&&<button aria-label="Sync crosshair" aria-pressed={chartGroup.syncCrosshair} onClick={onToggleCrosshair}>Sync crosshair</button>}
        <button aria-label="Economic news" aria-expanded={newsOpen} onClick={()=>setNewsOpen(v=>!v)}><Newspaper size={16}/><span>News</span></button>
        <button aria-pressed={follow} aria-label="Follow price" title="Follow new candles while keeping your zoom" onClick={()=>setFollow(v=>!v)}><Scan size={16}/><span className="bt-follow-label">{follow?'Following':'View locked'}</span></button>
        <Feedback owner={owner}/>{!secondary&&<button aria-label="Drawing favorites" disabled={!ready||busy} onClick={()=>setToolsEditor(true)}>★ Favorites</button>}<button aria-label="Indicators" className="bt-indicators-button" disabled={!ready || busy} onClick={openIndicators}><ChartNoAxesCombined size={18}/><span>Indicators</span></button>
        <button disabled={!ready || busy} className="bt-icon" aria-label="Fit chart to session" title="Fit session" onClick={() => chartRef.current?.setVisibleRangePreset('ALL')}><Scan size={18}/></button>
        <button disabled={!ready || busy} className="bt-icon" aria-label="Chart settings" title="Chart settings" onClick={() => chartRef.current?.renderer.openSettings()}><Settings2 size={18}/></button>
        <button className="bt-icon" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title="Change theme" onClick={onThemeToggle}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
      </div>
    </header>,toolbarHost)}
    {twoCharts&&<div className="bt-pane-heading"><button className="bt-pane-tag" aria-pressed={selected} onClick={onSelect}>{symbol} · {timeframeName}</button></div>}
    <main className="bt-canvas-area" aria-label="Backtesting chart workspace">
      <button className="bt-clear-drawings" aria-label="Delete all drawings" title="Delete all drawings" disabled={!ready||busy} onClick={()=>{setPlaying(false);setClearDrawings(true)}}><Trash2 size={17}/></button>
      {busy&&ready&&<div className="bt-loading-note" role="status">Loading {timeframeName}…</div>}
      <div className="replay-chart" ref={host} aria-label={`${symbol} historical candle chart`}/>
      {!sample.history_version&&!market.four_hour_history&&['1D','1W','1M'].includes(timeframe)&&<div className="bt-history-note">This older session has one-day history. Start a new session for earlier daily, weekly and monthly candles.</div>}
      {ready&&drawingMenu&&<DrawingContextMenu chart={chartRef.current} point={drawingMenu} onClose={closeDrawingMenu} openSettings={openDrawingEditor}/>}
      {ready&&drawingEditor&&<DrawingActions key={drawingEditor.id} chart={chartRef.current} id={drawingEditor.id}
        initialTab={drawingEditor.tab} initialTemplate={drawingEditor.template} onClose={()=>setDrawingEditor(null)}/>}
      {ready&&!secondary&&<DrawingFavoritesBar chart={chartRef.current} position={favoriteBarPosition.current} onPosition={value=>{favoriteBarPosition.current=value;dirtyLayout()}}/>}
      {ready&&<SessionRanges timeframe={timeframe} id={paneId} chart={chartRef.current} sample={sample} symbol={symbol} session={session} cursor={cursor} clock={replayTime} options={sessionRangeOptions}/>}
      {watermark&&minuteWatermarks[timeframe]!==false&&<div className="bt-timeframe-watermark" aria-label="Timeframe watermark">{timeframeName}</div>}
      {ready&&!busy&&<ReplayCanvasTools chart={chartRef.current} cursor={cursor} version={session.version} host={host} frame={frame} session={session} price={timeline[cursor].close} qty={orderQty} disabled={sessionBusy||finished||symbol!==session.root} onAction={submitAction} pause={()=>setPlaying(false)} onError={setError}/>}
      {error && <div className="bt-error" role="alert"><span>{error}</span><button aria-label="Dismiss chart message" onClick={() => setError('')}><X size={16}/></button></div>}
    </main>
    {createPortal(<ReplayNewsDrawer open={newsOpen} onClose={()=>setNewsOpen(false)} replayDate={replayNewsDay(replayTime+60000)} replayTime={replayTime+60000}/>,document.body)}
    {!secondary&&controlsHost&&createPortal(<ReplayTrading journal={journal} qty={orderQty} setQty={setOrderQty} session={session} frame={frame} projection={projection} cursor={cursor} price={timeline[cursor].close} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} step={step} setStep={setStep} next={next} onContinue={onContinue} bars={timeline} onCursor={at=>{jumpToLatest.current=true;onCursor(at)}} onAction={submitAction} onSave={()=>saveLayout().then(saveOtherLayout).then(onSave)} onError={setError} disabled={!ready||busy||sessionBusy} finished={finished} saving={saving} saveError={saveError} comparison={symbol!==session.root}/>,controlsHost)}
    <footer className="bt-clock-footer">
      <time dateTime={new Date(replayTime+60000).toISOString()} aria-label="Replay time">{clockParts(replayTime+60000,clockZone).day} · {replayClockLabel(replayTime+60000,clockZone)}</time>
      <Select label="Chart timezone" values={REPLAY_ZONES} value={clockZone} onChange={e=>setClockZone(e.target.value)}/>
      {['percent','log'].map(mode=><button key={mode} type="button" disabled={!ready}
        aria-label={mode==='percent'?'Percentage scale':'Logarithmic scale'}
        aria-pressed={mode==='percent'?priceScale.mode==='percent':Boolean(priceScale.log)}
        onClick={()=>{
          const renderer=chartRef.current.renderer;
          const current=renderer.getConfig().priceScale;
          const patch=mode==='percent'?{mode:current.mode==='percent'?'price':'percent',log:false}:
            {mode:'price',log:!current.log};
          renderer.applyConfig({priceScale:{...current,...patch}});
          setPriceScale(renderer.getConfig().priceScale);
          dirtyLayout();
        }}>{mode==='percent'?'%':'log'}</button>)}
    </footer>
    <div className="bt-chart-announcements">
      <span className="bt-save-status">{saveError?'Not saved · retry Save':saving?'Saving…':session.cursor===cursor?'Saved':'Unsaved progress'}</span>
      <span role="status" aria-label="Chart status">{error?'Check chart message':busy?'Loading chart…':'Chart ready'}</span>
    </div>
    {clearDrawings&&<Modal title="Delete all drawings?" onClose={()=>setClearDrawings(false)}><p>Remove all drawings from this chart? Trades, positions and trade markers stay unchanged.</p><div className="settings-actions"><Button variant="primary" onClick={deleteAllDrawings}>Delete drawings</Button><Button onClick={()=>setClearDrawings(false)}>Cancel</Button></div></Modal>}
    {timeframeEditor&&<Modal title="Your timeframes" onClose={()=>setTimeframeEditor(null)}>
      <p>Choose your chart shortcuts. Saved on this browser for future sessions.</p>
      <div className="bt-timeframe-options">{[...new Set([...CHART_TIMEFRAMES.map(x=>x.value),...timeframeEditor])].sort((a,b)=>Number(a)-Number(b)).map(value=><label key={value}><input type="checkbox" checked={timeframeEditor.includes(value)} onChange={e=>setTimeframeEditor(list=>e.target.checked?[...list,value]:list.filter(v=>v!==value))}/>{timeframeLabel(value)}</label>)}</div>
      <form className="bt-custom-timeframe-form" onSubmit={e=>{e.preventDefault();const value=Number(customInterval)*(customUnit==='hours'?60:1);if(!Number.isInteger(value)||!validTimeframe(String(value))){setTimeframeError('Use whole minutes, from 1 minute to 12 hours.');return}setTimeframeEditor(list=>[...new Set([...list,String(value)])]);setTimeframeError('')}}>
        <Field label="Custom interval"><input aria-label="Custom interval" type="number" min="1" step="1" value={customInterval} onChange={e=>setCustomInterval(e.target.value)}/></Field>
        <Select label="Interval unit" values={['minutes','hours']} value={customUnit} onChange={e=>setCustomUnit(e.target.value)}/><Button type="submit">Add timeframe</Button>
      </form>
      <div className="notice"><strong>New York 4H candles</strong><p>4H opens at 18:00, 22:00, 02:00, 06:00, 10:00 and 14:00 New York time, including daylight saving. Daily, weekly and monthly candles retain their existing calendar boundaries. Contract changes are unadjusted. The first available period can be incomplete.</p></div>
      {timeframeError&&<p role="alert">{timeframeError}</p>}
      <div className="settings-actions"><Button variant="primary" onClick={async()=>{if(!timeframeEditor.length||timeframeEditor.length>10){setTimeframeError('Choose between 1 and 10 shortcuts.');return}const next=[...timeframeEditor].sort((a,b)=>Number(a)-Number(b));try{await saveLayout(true,{shortcuts:next,...(!next.includes(timeframe)?{timeframe:next[0]}:{})})}catch(e){setTimeframeError(e.message);return}setShortcuts(next);if(!next.includes(timeframe))setTimeframe(next[0]);setTimeframeEditor(null)}}>Save timeframes</Button><Button onClick={()=>setTimeframeEditor(null)}>Cancel</Button></div>
    </Modal>}
    {toolsEditor&&<Modal title="Favorite tools" onClose={()=>setToolsEditor(false)}><p>Star tools for quick access on the movable chart bar.</p>{drawingTools.map(type=><label className="bt-favorite-tool" key={type}><input type="checkbox" defaultChecked={chartRef.current.drawings.isFavorite(type)} onChange={e=>chartRef.current.drawings.setFavorite(type,e.target.checked)}/>{toolNames[type]}</label>)}</Modal>}
    {sessionRangeEditor&&<SessionRangeSettings value={sessionRangeOptions} onClose={()=>setSessionRangeEditor(false)} onSave={async value=>{await saveLayout(true,{sessionRanges:value});setSessionRangeOptions(value)}}/>}
    {picker && <Modal title="Indicators" className="bt-indicator-modal" onClose={() => setPicker(false)}>
      <label className="bt-indicator-search"><Search size={18}/><input autoFocus type="search" aria-label="Find an indicator" placeholder="Search EMA, RSI, VWAP…" value={search} onChange={e => setSearch(e.target.value)}/></label>
      {(!search||'sessions'.includes(search.toLowerCase()))&&<div className="bt-study-row"><div><strong>Sessions</strong><small>Asia · London · NY AM · New York time</small></div><Button disabled={sessionRangeOptions.enabled} onClick={async()=>{const value={...sessionRangeOptions,enabled:true};await saveLayout(true,{sessionRanges:value});setSessionRangeOptions(value)}}>{sessionRangeOptions.enabled?'Added':'Add'}</Button></div>}
      {sessionRangeOptions.enabled&&<section className="bt-active-studies"><h3>On your chart</h3><div className="bt-study-row"><span>Sessions</span><button aria-label="Settings for Sessions" onClick={()=>{setPicker(false);setSessionRangeEditor(true)}}><Settings2 size={16}/></button><button aria-label="Remove Sessions" onClick={async()=>{const value={...sessionRangeOptions,enabled:false};await saveLayout(true,{sessionRanges:value});setSessionRangeOptions(value)}}><X size={16}/></button></div></section>}
      {!search && studies.length > 0 && <section className="bt-active-studies" aria-label="Indicators on chart"><h3>On your chart</h3>{studies.map(item => <div className="bt-study-row" key={item.id}><span>{item.title}</span><Select label={`Maximum timeframe for ${item.title}`} values={[{value:'',label:'All intervals'},...intervalChoices([...shortcuts,visibility.current.rules.get(item.id)?.maximum].filter(Boolean)).map(value=>({value,label:timeframeLabel(value)}))]} value={visibility.current.rules.get(item.id)?.maximum||''} onChange={e=>{const rule=visibility.current.rules.get(item.id)||{visible:chartRef.current.indicators().find(h=>h.id===item.id)?.visible!==false};visibility.current.rules.set(item.id,{...rule,maximum:e.target.value});visibility.current.apply(chartRef.current,timeframe);syncStudies();dirtyLayout()}}/><button aria-label={`Settings for ${item.title}`} onClick={() => editStudy(item.id)}><Settings2 size={16}/></button><button aria-label={`Remove ${item.title}`} onClick={() => removeStudy(item.id)}><X size={16}/></button></div>)}</section>}
      <div className="bt-indicator-list" aria-label="Available indicators">{matches.map(item => {
        const present = studies.some(study => study.type === item.type);
        return <div className="bt-study-row" key={item.type}><div><strong>{item.title}</strong>{!item.supported && <small>Not available for this sample</small>}</div><button aria-label={`Add ${item.title}`} disabled={!item.supported || (present && !item.multiInstance)} onClick={() => addStudy(item)}>{present && !item.multiInstance ? 'Added' : <><Plus size={15}/> Add</>}</button></div>;
      })}{matches.length === 0 && !'sessions'.includes(search.toLowerCase()) && <p>No indicators match “{search}”.</p>}</div>
      <div className="bt-indicator-footer"><small>Indicators only use candles revealed so far. Daily pivots may need earlier sessions.</small><Button onClick={() => setPicker(false)}>Done</Button></div>
    </Modal>}
  </div>;
}
