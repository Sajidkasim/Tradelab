import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, Compass, Sun, Moon, ChartNoAxesCombined, Search, Plus, X, Settings2, Scan, Trash2} from 'lucide-react';
import {api} from './api';
import {createPortal} from 'react-dom';
import ReplayTrading from './ReplayTrading';
import ReplayCanvasTools from './ReplayCanvasTools';
import {holdReplayViewport} from './replayViewport';
import {nextReplayCursor, REPLAY_ZONES, clockParts, replayZone, replayClockLabel} from './replayClock';
import {Modal, Button, Select, Field} from './components';
import {aggregateMinuteBars, CHART_TIMEFRAMES, timeframeLabel, savedTimeframes, validTimeframe, chartHistory, upperBound} from './backtestingBars';
import './backtesting.css';

const chartTheme = mode => ({
  background: mode === 'dark' ? '#16191c' : '#fcfcfb',
  textColor: mode === 'dark' ? '#cbd1d5' : '#525953',
  gridColor: mode === 'dark' ? '#262b30' : '#eceeea',
  borderColor: mode === 'dark' ? '#30363b' : '#e1e4de',
  upColor: '#389483', downColor: '#d36871',
  fontFamily: 'Inter, system-ui, sans-serif',
});
const drawingTools = ['trendline', 'hline', 'hray', 'box', 'fibretracement', 'text', 'position'];
const popular = ['sma', 'ema', 'vwap', 'rsi', 'macd', 'bb', 'atr', 'volume'];

export default function BacktestingChart({theme, onThemeToggle, sample, session, projection, cursor, onCursor, onContinue, onAction, onSessionBack, onSave, saving, saveError, sessionBusy,layout={},secondary=false,twoCharts=false,onSplit,journal={},registerLayoutSave,paneId,paneState,onPaneChange,selected,onSelect,toolbarHost,controlsHost,chartGroup,onToggleCrosshair,registerChart,onCrosshair,saveOtherLayout=()=>Promise.resolve()}) {
  const symbol=paneState.symbol,timeframe=paneState.timeframe;
  const setSymbol=value=>onPaneChange(paneId,{symbol:value});
  const setTimeframe=value=>onPaneChange(paneId,{timeframe:value});
  const groupRef=useRef(chartGroup);groupRef.current=chartGroup;
  const [clockZone,setClockZone]=useState(()=>replayZone(layout.clockDisplayVersion===2?layout.clockZone:localStorage.getItem('primus-replay-clock-v2')));
  const [follow,setFollow]=useState(false),[clearDrawings,setClearDrawings]=useState(false);
  const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState('1'),[step,setStep]=useState('1');
  const sampleRef=useRef(sample);sampleRef.current=sample;
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
  const lastRendered=useRef(null),marketRequest=useRef(null);
  const [marketVersion,setMarketVersion]=useState(0);
  const jumpToLatest=useRef(false);
  const [shortcuts,setShortcuts]=useState(()=>savedTimeframes(localStorage.getItem('primus-replay-timeframes')));
  const [timeframeEditor,setTimeframeEditor]=useState(null),[customInterval,setCustomInterval]=useState('3'),[customUnit,setCustomUnit]=useState('minutes'),[timeframeError,setTimeframeError]=useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [picker, setPicker] = useState(false), [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState([]), [studies, setStudies] = useState([]);
  const host = useRef(null), chartRef = useRef(null), drawings = useRef(layout.drawings||{});
  const feed=useRef(null),lastLayout=useRef(''),layoutQueue=useRef(Promise.resolve());
  const [watermark,setWatermark]=useState(()=>localStorage.getItem('primus-replay-watermark')!=='off');
  const watermarkValue=useRef(watermark);watermarkValue.current=watermark;
  const [orderQty,setOrderQty]=useState(1);
  const selection = useRef({symbol, timeframe, theme, replayTime});
  selection.current = {symbol, timeframe, theme, replayTime};
  const bars = useMemo(() => sample ? chartHistory(sample.markets[symbol],replayTime,timeframe) : [], [sample, symbol, timeframe, replayTime]);
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
    setError(''); setReady(false); setBusy(true);
    import('@luxalgo/vela').then(async ({Vela}) => {
      if (!alive) return;
      const current = selection.current;
      const subscribers=new Set();
      const source={getBars:async(ticker,tf)=>{const root=ticker.startsWith('NQ')?'NQ':'ES';return chartHistory(sampleRef.current.markets[root],selection.current.replayTime,tf)},subscribe:(_ticker,_tf,cb)=>{subscribers.add(cb);return()=>subscribers.delete(cb)}};
      feed.current=subscribers;
      chart = new Vela(host.current, {
        symbol: `practice:${sample.markets[current.symbol].contract}`, timeframe: current.timeframe,
        live: true, theme: chartTheme(current.theme), height: '100%',
        drawings: {tools: drawingTools}, animations: false,
      });
      chartRef.current = chart;
      registerChart(paneId,chart);
      unsubscribers.push(chart.renderer.onCrosshairMove(event=>onCrosshair(paneId,event)));
      chart.data.registerProvider('practice',source);
      const sync = () => {if (alive) syncStudies()};
      unsubscribers.push(chart.on('indicator:added', sync), chart.on('indicator:removed', sync));
      unsubscribers.push(chart.on('indicator:error', ({error}) => {if (alive) setError(error.message)}));
      await chart.ready();
      chart.setLocale({locale:'en-GB',hourCycle:'h23'});
      if (!alive) return;
      const config = chart.renderer.getConfig();
      if (config) chart.renderer.applyConfig({...config, timeScale: {...config.timeScale, timezone: clockZone}});
      chart.renderer.setSettingsSections([{title:'Replay',placement:'symbol',rows:[{kind:'toggle',label:'Timeframe watermark',get:()=>watermarkValue.current,set:value=>{setWatermark(value);localStorage.setItem('primus-replay-watermark',value?'on':'off')}}]}]);
      if(layout.config)chart.renderer.applyConfig({...layout.config,timeScale:{...layout.config.timeScale,timezone:clockZone}});
      if(layout.drawings?.[chart.market.symbol])chart.drawings.fromJSON(layout.drawings[chart.market.symbol]);
      for(const item of layout.studies||[])if(item.type)chart.addNativeIndicator(item.type,{inputs:item.inputs||{}}).setVisible(item.visible!==false);
      const native=chart.renderer.renderer;
      if(layout.viewport&&native?.applyViewport)native.applyViewport(layout.viewport);
      if(layout.priceScale&&native?.scene?.panes?.get('price'))native.scene.panes.get('price').manualScale=layout.priceScale;
      if(String(current.timeframe)==='240'&&(sample.chart_context_version||0)>0&&layout.chartContextVersion!==sample.chart_context_version&&bars.length>180)chart.setVisibleRange({from:bars.at(-180).time,to:bars.at(-1).time});
      const available = await chart.availableNativeIndicators();
      if (!alive) return;
      setCatalog(available); syncStudies(); setReady(true); setBusy(false);
    }).catch(e => {if (alive) {setError(e.message); setBusy(false)}});
    return () => {
      alive = false; unsubscribers.forEach(unsubscribe => unsubscribe());
      if (chartRef.current === chart) chartRef.current = null;
      registerChart(paneId,null);
      chart?.destroy();
    };
  }, [session.id, syncStudies]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart || !market) return;
    if(marketRequest.current)return;
    if (chart.market.symbol === `practice:${market.contract}` && chart.market.timeframe === timeframe && lastRendered.current===bars) return;
    setBusy(true); setError('');
    const previousSymbol = chart.market.symbol;
    const wanted=`practice:${market.contract}`;
    const same=previousSymbol===wanted&&chart.market.timeframe===timeframe;
    const previousBars=lastRendered.current;
    lastRendered.current=bars;
    if(same&&previousBars){
      // Streaming updates retain candle spacing, horizontal pan and manual price scale.
      const restoreView=!follow&&!jumpToLatest.current?holdReplayViewport(chart,bars.length-previousBars.length):()=>{};
      const last=previousBars.at(-1)?.time??-Infinity;
      let from=Math.max(0,previousBars.length-1);while(from>0&&bars[from]?.time>last)from--;
      for(let i=from;i<bars.length;i++)for(const cb of feed.current||[])cb(bars[i]);
      restoreView();
      if(jumpToLatest.current){chart.panBy(10000);jumpToLatest.current=false}
      setBusy(false);return;
    }
    if(previousSymbol!==wanted){
      drawings.current[previousSymbol]=chart.drawings.toJSON();
      chart.drawings.fromJSON(drawings.current[wanted]||{version:1,drawings:[]});
    }
    marketRequest.current={symbol:wanted,timeframe};
    chart.setMarket({symbol:wanted,timeframe}).then(()=>{
      if(chartRef.current===chart){if(String(timeframe)==='240'&&bars.length>180)chart.setVisibleRange({from:bars.at(-180).time,to:bars.at(-1).time});setBusy(false);syncStudies()}
    }).catch(e=>{if(chartRef.current===chart){setError(e.message);setBusy(false)}}).finally(()=>{marketRequest.current=null;if(chartRef.current===chart)setMarketVersion(value=>value+1)});
  }, [ready, market, timeframe, bars, syncStudies, follow,marketVersion]);

  useEffect(()=>{if(ready)chartRef.current?.renderer.applyConfig({timeScale:{timezone:clockZone}});localStorage.setItem('primus-replay-clock-v2',clockZone)},[clockZone,ready]);
  useEffect(() => {if (ready) chartRef.current?.setTheme(chartTheme(theme))}, [theme, ready]);
  useEffect(() => {document.title = `${session.name} — Primus Backtesting`}, [session.name]);
  async function next(){
    if(finished&&session.next_day){try{await onContinue();onCursor(cursor+1)}catch(e){setError(e.message)};return}
    onCursor(nextReplayCursor(timeline,cursor,Number(step)));
  }
  useEffect(()=>{
    if(saveError||(finished&&!session.next_day)){setPlaying(false);return}
    if(secondary||!playing||!ready||sessionBusy)return;
    if(finished){next();return}
    const timer=setTimeout(()=>onCursor(nextReplayCursor(timeline,cursor,Number(step))),1000/Number(speed));
    return()=>clearTimeout(timer);
  },[playing,busy,ready,sessionBusy,saveError,cursor,finished,speed,step,onCursor,timeline,session.next_day]);

  function saveLayout(){
    const chart=chartRef.current;if(!ready||!chart||busy)return Promise.resolve();
    drawings.current[chart.market.symbol]=chart.drawings.toJSON();
    const native=chart.renderer.renderer;
    const value={chartGroup:groupRef.current,chartContextVersion:sample.chart_context_version||0,split:twoCharts,symbol,timeframe,clockZone,clockDisplayVersion:2,drawings:drawings.current,config:chart.renderer.getConfig(),viewport:native?.coords?.getViewport?.(),priceScale:native?.scene?.panes?.get('price')?.manualScale,studies:chart.indicators().filter(h=>h.nativeType).map(h=>({type:h.nativeType,inputs:h.inputValues(),visible:h.visible}))};
    const encoded=JSON.stringify(value);if(encoded===lastLayout.current)return layoutQueue.current;
    lastLayout.current=encoded;
    onPaneChange(paneId,{visibleRange:chart.getVisibleRange?.(),drawings:value.drawings,priceScale:value.priceScale,viewport:value.viewport});
    const task=layoutQueue.current.catch(()=>{}).then(()=>api(`/backtesting/sessions/${session.id}/layout?pane=${secondary?'secondary':'primary'}`,{method:'PUT',body:{layout:value}})).catch(e=>{lastLayout.current='';setError(e.message);throw e});layoutQueue.current=task;return task;
  }
  useEffect(()=>{registerLayoutSave?.(saveLayout);return()=>registerLayoutSave?.(null)},[ready,busy,symbol,timeframe,clockZone,twoCharts]);
  useEffect(()=>{const timer=setInterval(()=>saveLayout().catch(()=>{}),3000);return()=>clearInterval(timer)},[ready,busy,symbol,timeframe,clockZone,twoCharts]);

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
  const matches = catalog.filter(item => `${item.title} ${item.type}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b) => (popular.includes(a.type) ? 0 : 1) - (popular.includes(b.type) ? 0 : 1) || a.title.localeCompare(b.title));

  return <div className={`backtesting-workspace bt-chart-pane ${selected?'is-selected':''}`} data-pane-id={paneId} onPointerDownCapture={e=>{if(e.currentTarget.contains(e.target))onSelect()}}>
    {selected&&toolbarHost&&createPortal(<header className="bt-toolbar" aria-label="Chart controls">
      <a href="/backtesting" className="bt-back" aria-label="Back to sessions" title="Save & back to sessions" onClick={e=>{e.preventDefault();setPlaying(false);saveLayout().then(saveOtherLayout).then(onSessionBack).catch(()=>{})}}><ArrowLeft size={19}/><span>Back</span></a>
      <a className="bt-brand" href="/" aria-label="PrimusTrader home"><Compass size={21}/><span>PRIMUS · BETA</span></a>
      <div className="bt-market"><Select label="Market" values={['NQ','ES']} value={symbol} disabled={!ready || busy} onChange={e => setSymbol(e.target.value)}/></div>
      <div className="bt-timeframes" role="group" aria-label="Chart timeframe" title="Built from one-minute data. Second-based candles are not available.">
        {shortcuts.map(value=>({value,label:timeframeLabel(value)})).map(item => <button key={item.value} disabled={!ready || busy} aria-pressed={timeframe === item.value} onClick={() => setTimeframe(item.value)}>{item.label}</button>)}
      <button aria-label="Manage timeframes" title="Save your timeframe shortcuts" onClick={()=>{setPlaying(false);setTimeframeEditor([...shortcuts]);setTimeframeError('')}}><Plus size={16}/></button></div>
      <div className="bt-tools">{<button aria-label="Toggle two charts" aria-pressed={twoCharts} onClick={onSplit}>Ⅱ</button>}{twoCharts&&<button aria-label="Sync crosshair" aria-pressed={chartGroup.syncCrosshair} onClick={onToggleCrosshair}>Sync crosshair</button>}
        <button aria-pressed={follow} aria-label="Follow price" title="Follow new candles while keeping your zoom" onClick={()=>setFollow(v=>!v)}><Scan size={16}/><span className="bt-follow-label">{follow?'Following':'View locked'}</span></button>
        <button aria-label="Indicators" className="bt-indicators-button" disabled={!ready || busy} onClick={openIndicators}><ChartNoAxesCombined size={18}/><span>Indicators</span></button>
        <button disabled={!ready || busy} className="bt-icon" aria-label="Fit chart to session" title="Fit session" onClick={() => chartRef.current?.setVisibleRangePreset('ALL')}><Scan size={18}/></button>
        <button disabled={!ready || busy} className="bt-icon" aria-label="Chart settings" title="Chart settings" onClick={() => chartRef.current?.renderer.openSettings()}><Settings2 size={18}/></button>
        <button className="bt-icon" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title="Change theme" onClick={onThemeToggle}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
      </div>
    </header>,toolbarHost)}
    {twoCharts&&<div className="bt-pane-heading"><button className="bt-pane-tag" aria-pressed={selected} onClick={onSelect}>{symbol} · {timeframeName}</button></div>}
    <main className="bt-canvas-area" aria-label="Backtesting chart workspace">
      <button className="bt-clear-drawings" aria-label="Delete all drawings" title="Delete all drawings" disabled={!ready||busy} onClick={()=>{setPlaying(false);setClearDrawings(true)}}><Trash2 size={17}/></button>
      <div className="replay-chart" ref={host} aria-label={`${symbol} historical candle chart`}/>
      {!sample.history_version&&!market.four_hour_history&&['1D','1W','1M'].includes(timeframe)&&<div className="bt-history-note">This older session has one-day history. Start a new session for earlier daily, weekly and monthly candles.</div>}
      {watermark&&<div className="bt-timeframe-watermark" aria-label="Timeframe watermark">{timeframeName}</div>}
      {ready&&!busy&&<ReplayCanvasTools chart={chartRef.current} cursor={cursor} version={session.version} host={host} frame={frame} session={session} price={timeline[cursor].close} qty={orderQty} disabled={sessionBusy||finished||symbol!==session.root} onAction={submitAction} pause={()=>setPlaying(false)} onError={setError}/>}
      {error && <div className="bt-error" role="alert"><span>{error}</span><button aria-label="Dismiss chart message" onClick={() => setError('')}><X size={16}/></button></div>}
    </main>
    {!secondary&&controlsHost&&createPortal(<ReplayTrading journal={journal} qty={orderQty} setQty={setOrderQty} session={session} frame={frame} projection={projection} cursor={cursor} price={timeline[cursor].close} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} step={step} setStep={setStep} next={next} onContinue={onContinue} bars={timeline} onCursor={at=>{jumpToLatest.current=true;onCursor(at)}} onAction={submitAction} onSave={()=>saveLayout().then(saveOtherLayout).then(onSave)} onError={setError} disabled={!ready||busy||sessionBusy} finished={finished} saving={saving} saveError={saveError} comparison={symbol!==session.root}/>,controlsHost)}
    <footer className="bt-statusbar">
      <div><strong title={sample.selection}>{market?.contract || symbol}</strong><span>{timeframeName}</span><span className="bt-bar-count">{bars.length.toLocaleString('en-GB')} bars</span></div>
      <time className="bt-sample" aria-label="Replay time" role="button" tabIndex={0} title="Switch clock: UTC, New York, London" onClick={()=>setClockZone(z=>REPLAY_ZONES[(REPLAY_ZONES.findIndex(x=>x.value===z)+1)%REPLAY_ZONES.length].value)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setClockZone(z=>REPLAY_ZONES[(REPLAY_ZONES.findIndex(x=>x.value===z)+1)%REPLAY_ZONES.length].value)}}} dateTime={new Date(replayTime+60000).toISOString()}>{clockParts(replayTime+60000,clockZone).day} · {replayClockLabel(replayTime+60000,clockZone)}</time>
      <Select label="Chart timezone" values={REPLAY_ZONES} value={clockZone} onChange={e=>setClockZone(e.target.value)}/>
      <span className="bt-save-status" title={saveError||'Progress saves automatically every 3 seconds and when you leave.'}>{saveError?'Not saved · retry Save':saving?'Saving…':session.cursor===cursor?'Saved':'Unsaved progress'}</span>
      <span className="bt-chart-status" data-error={Boolean(error)} data-busy={busy} role="status" aria-label="Chart status">{error ? 'Check chart message' : busy ? 'Loading chart…' : finished&&!session.next_day?'End of dataset':'Chart ready'}</span>
      <a href="https://velacharts.dev" target="_blank" rel="noreferrer" className="bt-attribution">Vela / LuxAlgo</a>
    </footer>
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
      <div className="settings-actions"><Button variant="primary" onClick={()=>{if(!timeframeEditor.length||timeframeEditor.length>10){setTimeframeError('Choose between 1 and 10 shortcuts.');return}const next=[...timeframeEditor].sort((a,b)=>Number(a)-Number(b));localStorage.setItem('primus-replay-timeframes',JSON.stringify(next));setShortcuts(next);if(!next.includes(timeframe))setTimeframe(next[0]);setTimeframeEditor(null)}}>Save timeframes</Button><Button onClick={()=>setTimeframeEditor(null)}>Cancel</Button></div>
    </Modal>}
    {picker && <Modal title="Indicators" className="bt-indicator-modal" onClose={() => setPicker(false)}>
      <label className="bt-indicator-search"><Search size={18}/><input autoFocus type="search" aria-label="Find an indicator" placeholder="Search EMA, RSI, VWAP…" value={search} onChange={e => setSearch(e.target.value)}/></label>
      {!search && studies.length > 0 && <section className="bt-active-studies" aria-label="Indicators on chart"><h3>On your chart</h3>{studies.map(item => <div className="bt-study-row" key={item.id}><span>{item.title}</span><button aria-label={`Settings for ${item.title}`} onClick={() => editStudy(item.id)}><Settings2 size={16}/></button><button aria-label={`Remove ${item.title}`} onClick={() => removeStudy(item.id)}><X size={16}/></button></div>)}</section>}
      <div className="bt-indicator-list" aria-label="Available indicators">{matches.map(item => {
        const present = studies.some(study => study.type === item.type);
        return <div className="bt-study-row" key={item.type}><div><strong>{item.title}</strong>{!item.supported && <small>Not available for this sample</small>}</div><button aria-label={`Add ${item.title}`} disabled={!item.supported || (present && !item.multiInstance)} onClick={() => addStudy(item)}>{present && !item.multiInstance ? 'Added' : <><Plus size={15}/> Add</>}</button></div>;
      })}{matches.length === 0 && <p>No indicators match “{search}”.</p>}</div>
      <div className="bt-indicator-footer"><small>Indicators only use candles revealed so far. Daily pivots may need earlier sessions.</small><Button onClick={() => setPicker(false)}>Done</Button></div>
    </Modal>}
  </div>;
}
