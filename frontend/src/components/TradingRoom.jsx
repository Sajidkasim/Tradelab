import React, {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {MessageSquare, CalendarClock, Layers, Crosshair, Send} from 'lucide-react';
import {Button, Notice} from '../components';
import {REACTIONS, useBullpen} from '../hooks/usePresence';
import {api} from '../api';
import CloudflareStage from './CloudflareStage';
import {BullpenLevelsPanel, BullpenNewsPanel} from './BullpenDeskPanel';
import '../trading-room.css';

const JaaSMeeting = lazy(()=>import('@jitsi/react-sdk').then(module=>({default:module.JaaSMeeting})));
const configOverwrite = {
  enableOpusRed:true, enableNoAudioDetection:true,
  prejoinConfig:{enabled:true}, startWithAudioMuted:true, startWithVideoMuted:true,
  resolution:1080, constraints:{video:{height:{ideal:1080,max:1080,min:360}}},
  desktopSharingFrameRate:{min:5,max:30}, hideConferenceSubject:true, hideConferenceTimer:true,
  disableInviteFunctions:true, disableThirdPartyRequests:true,
  toolbarButtons:['microphone','desktop','fullscreen','tileview','settings','hangup'],
};
const frameSize = node=>{node.style.width='100%';node.style.height='100%'};
const constrain = value=>Math.max(45,Math.min(82,value));

function nySessionClock(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const hh = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find(p => p.type === 'minute')?.value || 0);
  const mins = hh * 60 + mm;
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ET`;
  const session =
    mins >= 570 && mins < 660 ? 'NY Open' :
    mins >= 660 && mins < 840 ? 'NY Midday' :
    mins >= 840 && mins < 960 ? 'Power Hour' :
    mins >= 180 && mins < 570 ? 'London / Pre-NY' : 'After Hours';
  return `${clock} · ${session}`;
}

function readDeskLayout(name){
  try{
    const saved=JSON.parse(localStorage.getItem(`primus:bullpen:layout:${name}`));
    return {split:Number.isFinite(saved?.split)?constrain(saved.split):74, sidebarLeft:saved?.sidebarLeft===true};
  }catch{return {split:74,sidebarLeft:false}}
}

export default function TradingRoom({meeting, onLeave, minimised=false, onMinimise, onRestore}) {
  const {access,connected,people,messages,reaction,error,setInCall,send}=useBullpen();
  const isCloudflare = meeting?.provider === 'cloudflare';
  const [tab,setTab]=useState('chat');
  const [split,setSplit]=useState(()=>readDeskLayout(access.name).split);
  const [sidebarLeft,setSidebarLeft]=useState(()=>readDeskLayout(access.name).sidebarLeft);
  const [clockLabel,setClockLabel]=useState(()=>nySessionClock(new Date()));
  const [calloutOpen,setCalloutOpen]=useState(false);
  const [callout,setCallout]=useState({symbol:'NQ',side:'LONG',entry:'',sl:'',tp:''});

  useEffect(()=>{
    const timer=setInterval(()=>setClockLabel(nySessionClock(new Date())),30_000);
    return ()=>clearInterval(timer);
  },[]);

  useEffect(()=>{
    const timer=setTimeout(()=>{
      try{localStorage.setItem(`primus:bullpen:layout:${access.name}`,JSON.stringify({split,sidebarLeft}))}catch{}
    },250);
    return ()=>clearTimeout(timer);
  },[access.name,split,sidebarLeft]);

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

  const handleJoined = useCallback(() => {
    setJoined(true);
    setInCall(true);
    setVideoError('');
    api('/alert-team', {method: 'POST'}).catch(() => {});
  }, [setInCall]);

  function ready(instance){
    handlers.current?.();
    const didLeave=()=>{setInCall(false);leave.current()};
    const didError=event=>{
      if(event?.isFatal) setVideoError('The video room could not connect. Leave and try joining again.');
    };
    instance.addListener('videoConferenceJoined',handleJoined);
    instance.addListener('videoConferenceLeft',didLeave);
    instance.addListener('errorOccurred',didError);
    handlers.current=()=>{
      instance.removeListener('videoConferenceJoined',handleJoined);
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

  async function submitCallout(event){
    event.preventDefault();
    if(!callout.entry.trim()||sending)return;
    setSending(true);
    try{
      const parts = [
        `${callout.symbol} ${callout.side} @ ${callout.entry.trim()}`,
        callout.sl.trim() ? `SL ${callout.sl.trim()}` : '',
        callout.tp.trim() ? `TP ${callout.tp.trim()}` : '',
      ].filter(Boolean);
      const ok = await send('chat', {
        text: parts.join(' · '),
        callout: {
          symbol: callout.symbol,
          side: callout.side,
          entry: callout.entry.trim(),
          sl: callout.sl.trim(),
          tp: callout.tp.trim(),
        },
      });
      if (ok) {
        setCallout({symbol: callout.symbol, side: callout.side, entry: '', sl: '', tp: ''});
        setCalloutOpen(false);
      }
    }finally{setSending(false)}
  }

  return <section className={minimised?"bullpen-room is-minimised":"bullpen-room"} aria-label="Live Trading Bullpen">
    <header className="bullpen-room-head">
      <div className="bullpen-head-title">
        <h1>Bullpen</h1>
        {joined&&<span className="bullpen-live">LIVE</span>}
        <span className="bullpen-clock">{clockLabel}</span>
      </div>
      <span className="bullpen-people" aria-live="polite">{people.length ? people.join(' · ') : 'Waiting for the team'}</span>
      <div className="bullpen-head-actions">
        {onMinimise&&<Button onClick={()=>{if(minimised)onRestore();else onMinimise()}}>{minimised?'Restore':'Minimise'}</Button>}
        <Button className="bullpen-move-sidebar" onClick={()=>setSidebarLeft(value=>!value)}>Sidebar {sidebarLeft?'right':'left'}</Button>
        <Button onClick={onLeave}>Leave</Button>
      </div>
    </header>
    {videoError&&<Notice error>{videoError}</Notice>}
    <div className={sidebarLeft?'bullpen-split bullpen-sidebar-left':'bullpen-split'} ref={layout} style={{'--bullpen-ratio':split/100}}>
      <div className="bullpen-video">
        <div className="bullpen-call-frame">
          {isCloudflare ? (
            <CloudflareStage
              meeting={meeting}
              minimised={minimised}
              onJoined={handleJoined}
              onError={setVideoError}
            />
          ) : (
            <Suspense fallback={<p role="status">Opening Bullpen…</p>}>
              <JaaSMeeting roomName={meeting.roomName} appId={meeting.appId} jwt={meeting.jwt}
                userInfo={{displayName:access.name}} configOverwrite={configOverwrite}
                interfaceConfigOverwrite={{
                  DEFAULT_BACKGROUND:getComputedStyle(document.documentElement).getPropertyValue('--tl-surface').trim(), SHOW_JITSI_WATERMARK:false,
                  SHOW_BRAND_WATERMARK:false, SHOW_WATERMARK_FOR_GUESTS:false,
                  SHOW_POWERED_BY:false, MOBILE_APP_PROMO:false, VIDEO_LAYOUT_FIT:'nocrop',
                }}
                getIFrameRef={frameSize} onApiReady={ready} onReadyToClose={()=>leave.current()}/>
            </Suspense>
          )}
        </div>
        {reaction&&joined&&<span className="bullpen-flying-reaction" key={reaction.id} aria-hidden="true">{reaction.emoji}</span>}
      </div>
      <div className="bullpen-divider" role="separator" tabIndex={0} aria-label="Resize stage and sidebar"
        aria-orientation="vertical" aria-valuemin={45} aria-valuemax={82} aria-valuenow={Math.round(split)}
        onDoubleClick={()=>setSplit(74)}
        onPointerDown={event=>{if(event.button===0)event.currentTarget.setPointerCapture(event.pointerId)}}
        onPointerMove={event=>{
          if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
          const bounds=layout.current.getBoundingClientRect();
          const percent=100*(event.clientX-bounds.left-5)/(bounds.width-10);
          setSplit(constrain(sidebarLeft?100-percent:percent));
        }}
        onKeyDown={event=>{
          if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
          event.preventDefault();
          setSplit(value=>event.key==='Home'?45:event.key==='End'?82:constrain(value+(event.key==='ArrowLeft'?-2:2)*(sidebarLeft?-1:1)));
        }}/>
      <aside className="bullpen-side" aria-label="Bullpen desk sidebar">
        <div className="bullpen-tabs" role="group" aria-label="Sidebar view">
          <button type="button" aria-pressed={tab==='chat'} onClick={()=>setTab('chat')}><MessageSquare size={15}/> Chat</button>
          <button type="button" aria-pressed={tab==='levels'} onClick={()=>setTab('levels')}><Layers size={15}/> Levels</button>
          <button type="button" aria-pressed={tab==='news'} onClick={()=>setTab('news')}><CalendarClock size={15}/> Desk &amp; News</button>
        </div>
        {tab==='chat'?<>
          <div className="bullpen-messages" role="log" aria-label="Team chat">
            {!messages.length&&<p className="bullpen-desk-muted">{joined?'No messages yet. Drop a level or trade callout.':'Connecting to the desk…'}</p>}
            {messages.map(item=><article key={item.id} className={item.callout?`bullpen-callout-msg is-${item.callout.side.toLowerCase()}`:''}>
              <strong>{item.name}</strong>
              {item.callout ? (
                <div className="bullpen-callout-card">
                  <span className="bullpen-callout-badge">{item.callout.symbol} · {item.callout.side}</span>
                  <span>Entry <b>{item.callout.entry}</b></span>
                  {item.callout.sl && <span>SL <b>{item.callout.sl}</b></span>}
                  {item.callout.tp && <span>TP <b>{item.callout.tp}</b></span>}
                </div>
              ) : (
                <p>{item.text}</p>
              )}
            </article>)}
            <div ref={messagesEnd}/>
          </div>
          {error&&<p role="status" className="bullpen-connection">{error}</p>}
          {calloutOpen && (
            <form className="bullpen-callout-form" onSubmit={submitCallout}>
              <div className="bullpen-callout-row">
                <select value={callout.symbol} onChange={e=>setCallout(c=>({...c,symbol:e.target.value}))} aria-label="Symbol">
                  {['NQ','ES','GC','EURUSD','QQQ'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                <select value={callout.side} onChange={e=>setCallout(c=>({...c,side:e.target.value}))} aria-label="Direction">
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>
              <div className="bullpen-callout-row">
                <input placeholder="Entry *" value={callout.entry} onChange={e=>setCallout(c=>({...c,entry:e.target.value}))} maxLength={20}/>
                <input placeholder="SL" value={callout.sl} onChange={e=>setCallout(c=>({...c,sl:e.target.value}))} maxLength={20}/>
                <input placeholder="TP" value={callout.tp} onChange={e=>setCallout(c=>({...c,tp:e.target.value}))} maxLength={20}/>
              </div>
              <Button type="submit" variant="primary" busy={sending} disabled={!connected||!joined||!callout.entry.trim()}>Post Callout</Button>
            </form>
          )}
          <form className="bullpen-composer" onSubmit={submit}>
            <button type="button" className={`bullpen-callout-toggle${calloutOpen?' is-open':''}`}
              onClick={()=>setCalloutOpen(v=>!v)} title="Post a trade callout" aria-pressed={calloutOpen} disabled={!connected||!joined}>
              <Crosshair size={16}/>
            </button>
            <input aria-label="Team message" placeholder="Message the desk…" value={draft}
              onChange={event=>setDraft(event.target.value)} maxLength={400} disabled={!connected||!joined}/>
            <Button type="submit" busy={sending} disabled={!connected||!joined||!draft.trim()} aria-label="Send message"><Send size={15}/></Button>
          </form>
          <div className="bullpen-reactions" role="group" aria-label="Send a reaction">
            {REACTIONS.map((emoji,index)=><Button key={emoji} disabled={!connected||!joined}
              aria-label={['Fire','Applause','On target'][index]} onClick={()=>void send('reaction',{emoji})}>{emoji}</Button>)}
          </div>
        </>:tab==='levels'?<BullpenLevelsPanel/>:<BullpenNewsPanel/>}
      </aside>
    </div>
  </section>;
}
