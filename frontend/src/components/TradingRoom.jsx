import React, {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {MessageSquare, Rows3} from 'lucide-react';
import {Button, Notice} from '../components';
import {REACTIONS, useBullpen} from '../hooks/usePresence';
import {api} from '../api';
import BullpenMacroFeed from './BullpenMacroFeed';
import '../trading-room.css';

const JaaSMeeting = lazy(()=>import('@jitsi/react-sdk').then(module=>({default:module.JaaSMeeting})));
const configOverwrite = {
  prejoinConfig:{enabled:true}, startWithAudioMuted:true, startWithVideoMuted:true,
  resolution:1080, constraints:{video:{height:{ideal:1080,max:1080,min:360}}},
  desktopSharingFrameRate:{min:30,max:30}, hideConferenceSubject:true, hideConferenceTimer:true,
  disableInviteFunctions:true, disableThirdPartyRequests:true,
  toolbarButtons:['microphone','camera','desktop','fullscreen','tileview','settings','hangup'],
};
const frameSize = node=>{node.style.width='100%';node.style.height='100%'};
const constrain = value=>Math.max(40,Math.min(80,value));

const marketWidgets = {
  chart: {
    title:'Market chart', script:'advanced-chart',
    settings:{interval:'5',timezone:'America/New_York',theme:'dark',style:'1',autosize:true,allow_symbol_change:true},
  },
  heatmap: {
    title:'Stock heatmap', script:'stock-heatmap', url:'https://www.tradingview.com/heatmap/stock/',
    settings:{dataSource:'SPX500',grouping:'sector',blockSize:'market_cap_basic',blockColor:'change',colorTheme:'dark',hasTopBar:true,isDataSetEnabled:true,isZoomEnabled:true,hasSymbolTooltip:true},
  },
};

function MarketWidget({kind}){
  const [symbol,setSymbol]=useState('NASDAQ:QQQ');
  const {title,script,url,settings}=marketWidgets[kind];
  const chart=kind==='chart';
  const externalUrl=chart?`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`:url;
  const configuration=chart?{...settings,symbol}:settings;
  const source=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>html,body,.tradingview-widget-container{height:100%;margin:0}.tradingview-widget-container__widget{height:100%}</style>
    <div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div>
    <script async src="https://s3.tradingview.com/external-embedding/embed-widget-${script}.js">${JSON.stringify({width:'100%',height:'100%',locale:'en',...configuration})}</script></div></html>`;
  return <section className={chart?'bullpen-market-widget bullpen-symbol-chart':'bullpen-market-widget'} aria-label={title}>
    {chart&&<label>Chart symbol <select value={symbol} onChange={event=>setSymbol(event.target.value)}>
      <option value="NASDAQ:QQQ">QQQ</option>
      <option value="CME_MINI:NQ1!">NQ futures</option>
      <option value="CME_MINI:ES1!">ES futures</option>
      <option value="AMEX:SPY">SPY</option>
    </select></label>}
    <iframe title={title} srcDoc={source} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/>
    <a href={externalUrl} target="_blank" rel="noopener noreferrer">{chart?'Open chart in TradingView':'Stock heatmap by TradingView'}</a>
    {chart&&<small>Market data may be delayed.</small>}
  </section>;
}

export default function TradingRoom({meeting, onLeave}) {
  const {access,connected,people,messages,reaction,error,setInCall,send}=useBullpen();
  const [tab,setTab]=useState('chat');
  const [view,setView]=useState('call');
  const [split,setSplit]=useState(70);
  const [draft,setDraft]=useState('');
  const [sending,setSending]=useState(false);
  const [joined,setJoined]=useState(false);
  const [videoError,setVideoError]=useState('');
  const layout=useRef(null);
  const handlers=useRef(null);
  const leave=useRef(onLeave);
  const messagesEnd=useRef(null);
  leave.current=onLeave;

  useEffect(()=>()=>{
    handlers.current?.();
    setInCall(false);
  },[setInCall]);
  useEffect(()=>{
    if(tab==='chat'&&joined)messagesEnd.current?.scrollIntoView({block:'nearest'});
  },[messages,tab,joined]);

  function ready(instance){
    handlers.current?.();
    const didJoin=()=>{
      setJoined(true);
      setInCall(true);
      setVideoError('');
      api('/alert-team',{method:'POST'}).catch(()=>{});
    };
    const didLeave=()=>{setInCall(false);leave.current()};
    const didError=event=>{
      if(event?.isFatal) setVideoError('The video room could not connect. Leave and try joining again.');
    };
    instance.addListener('videoConferenceJoined',didJoin);
    instance.addListener('videoConferenceLeft',didLeave);
    instance.addListener('errorOccurred',didError);
    handlers.current=()=>{
      instance.removeListener('videoConferenceJoined',didJoin);
      instance.removeListener('videoConferenceLeft',didLeave);
      instance.removeListener('errorOccurred',didError);
      instance.dispose();
    };
  }

  async function submit(event){
    event.preventDefault();
    const text=draft.trim();
    if(!text||sending)return;
    setSending(true);
    try{
      if(await send('chat',{text}))setDraft(current=>current===draft?'':current);
    }finally{setSending(false)}
  }

  return <section className="bullpen-room" aria-label="Live Trading Bullpen">
    <header className="bullpen-room-head">
      <div><span className="pt-overline">PRIMUS TEAM ROOM</span><h1>Live Trading Floor</h1></div>
      {joined&&<span className="bullpen-live">LIVE</span>}
      <span className="bullpen-people" aria-live="polite">{people.length ? people.join(' · ') : 'Waiting for the team'}</span>
      <Button onClick={onLeave}>Leave Call</Button>
    </header>
    <div className="bullpen-tabs" role="group" aria-label="Main panel">
      <button type="button" aria-pressed={view==='call'} onClick={()=>setView('call')}>Call</button>
      <button type="button" aria-pressed={view==='chart'} onClick={()=>setView('chart')}>Chart</button>
    </div>
    {videoError&&<Notice error>{videoError}</Notice>}
    <div className="bullpen-split" ref={layout} style={{'--bullpen-ratio':split/100}}>
      <div className="bullpen-video">
        <div className="bullpen-call-frame" aria-hidden={view!=='call'}>
        <Suspense fallback={<p role="status">Opening video…</p>}>
          <JaaSMeeting roomName={meeting.roomName} appId={meeting.appId} jwt={meeting.jwt}
            userInfo={{displayName:access.name}} configOverwrite={configOverwrite}
            interfaceConfigOverwrite={{
              DEFAULT_BACKGROUND:getComputedStyle(document.documentElement).getPropertyValue('--tl-surface').trim(), SHOW_JITSI_WATERMARK:false,
              SHOW_BRAND_WATERMARK:false, SHOW_WATERMARK_FOR_GUESTS:false,
              SHOW_POWERED_BY:false, MOBILE_APP_PROMO:false, VIDEO_LAYOUT_FIT:'nocrop',
            }}
            getIFrameRef={frameSize} onApiReady={ready} onReadyToClose={()=>leave.current()}/>
        </Suspense>
        </div>
        {view==='chart'&&<MarketWidget kind="chart"/>}
        {view==='call'&&reaction&&joined&&<span className="bullpen-flying-reaction" key={reaction.id} aria-hidden="true">{reaction.emoji}</span>}
      </div>
      <div className="bullpen-divider" role="separator" tabIndex={0} aria-label="Resize video and sidebar"
        aria-orientation="vertical" aria-valuemin={40} aria-valuemax={80} aria-valuenow={Math.round(split)}
        onDoubleClick={()=>setSplit(70)}
        onPointerDown={event=>{if(event.button===0)event.currentTarget.setPointerCapture(event.pointerId)}}
        onPointerMove={event=>{
          if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
          const bounds=layout.current.getBoundingClientRect();
          setSplit(constrain(100*(event.clientX-bounds.left-5)/(bounds.width-10)));
        }}
        onKeyDown={event=>{
          if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
          event.preventDefault();
          setSplit(value=>event.key==='Home'?40:event.key==='End'?80:constrain(value+(event.key==='ArrowLeft'?-2:2)));
        }}/>
      <aside className="bullpen-side" aria-label="Bullpen sidebar">
        <div className="bullpen-tabs" role="group" aria-label="Sidebar view">
          <button type="button" aria-pressed={tab==='chat'} onClick={()=>setTab('chat')}><MessageSquare size={16}/> Live Chat &amp; Reactions</button>
          <button type="button" aria-pressed={tab==='trades'} onClick={()=>setTab('trades')}><Rows3 size={16}/> Trade Feed</button>
          <button type="button" aria-pressed={tab==='heatmap'} onClick={()=>setTab('heatmap')}>Heatmap</button>
        </div>
        {tab==='chat'?<>
          <div className="bullpen-messages" role="log" aria-label="Team chat">
            {!messages.length&&<p>{joined?'No messages yet. Say hello to the team.':'Join the call to send a message.'}</p>}
            {messages.map(item=><article key={item.id}><strong>{item.name}</strong><p>{item.text}</p></article>)}
            <div ref={messagesEnd}/>
          </div>
          {error&&<p role="status" className="bullpen-connection">{error}</p>}
          <form className="bullpen-composer" onSubmit={submit}>
            <input aria-label="Team message" placeholder="Message the team" value={draft}
              onChange={event=>setDraft(event.target.value)} maxLength={400} disabled={!connected||!joined}/>
            <Button type="submit" busy={sending} disabled={!connected||!joined||!draft.trim()}>Send</Button>
          </form>
          <div className="bullpen-reactions" role="group" aria-label="Send a reaction">
            {REACTIONS.map((emoji,index)=><Button key={emoji} disabled={!connected||!joined}
              aria-label={['Fire','Applause','On target'][index]} onClick={()=>void send('reaction',{emoji})}>{emoji}</Button>)}
          </div>
        </>:tab==='trades'?<BullpenMacroFeed/>:<MarketWidget kind="heatmap"/>}
      </aside>
    </div>
  </section>;
}
