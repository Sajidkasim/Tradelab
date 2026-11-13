import React, {lazy, Suspense, useEffect, useState} from 'react';
import {Radio} from 'lucide-react';
import {WorkspacePage,useIdentity} from './WorkspacePages';
import {PrimusHeader} from './SiteExperience';
import CompoundEdge from './CompoundEdge';
import LearnFoundations from './LearnFoundations';
import ResourceLibrary from './ResourceLibrary';
import {Button, Notice} from './components';
import {api} from './api';
import {useBullpen} from './hooks/usePresence';
import './trading-room.css';

const TradingRoom = lazy(()=>import('./components/TradingRoom'));

export default function LearnPage() {
  const {identity}=useIdentity();
  const bullpen=useBullpen();
  const [meeting,setMeeting]=useState(null);
  const [androidMeeting,setAndroidMeeting]=useState(null);
  const isAndroid=/Android/i.test(navigator.userAgent);

  const [minimised,setMinimised]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const access=bullpen?.access;
  const isRoomActive=Boolean(meeting&&access?.configured);

  useEffect(()=>{
    if(!isRoomActive)return;
    const warn=event=>{event.preventDefault();event.returnValue=''};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[isRoomActive]);

  async function join(native=false){
    if(isRoomActive){setMinimised(false);return}
    setMinimised(false);
    setBusy(true);
    setError('');
    try{
      const reply=await api('/bullpen?join=true');
      if(!reply?.meeting)throw new Error('The team room is unavailable.');
      if(native) setAndroidMeeting(reply.meeting);
      else {setAndroidMeeting(null);setMeeting(reply.meeting)}
    }catch(failure){setError(failure.message)}
    finally{setBusy(false)}
  }

  function leave(){setMeeting(null);setMinimised(false)}

  return <>
   <div className={`pt-site bullpen-workspace${minimised?' is-minimised':''}`} hidden={!isRoomActive}>
    <div className="bullpen-room-site-header"><PrimusHeader active="learn"/></div>
    {isRoomActive&&<Suspense fallback={<p role="status">Opening the Bullpen…</p>}>
      <TradingRoom meeting={meeting} onLeave={leave} minimised={minimised} onMinimise={()=>setMinimised(true)} onRestore={()=>setMinimised(false)}/>
    </Suspense>}
   </div>
   <div hidden={isRoomActive&&!minimised}>
   <WorkspacePage active="learn" kicker="THE PRIMUS LIBRARY" title="Learn"
    heroAside={identity?.authenticated && <CompoundEdge variant="expanded" />}
    intro="Take an idea from understanding to practice. Start with the basics, find the words, then explore videos and guides from the Primus team.">
    {access&&<section className="wp-panel bullpen-entry">
      <div><span className="pt-overline">TEAM WORKSPACE</span><h2>Live Trading Bullpen</h2>
        <p>{access.configured?'Share your screen, discuss setups and follow the session together.':'JaaS video or private team chat still needs to be configured.'}</p>
      </div>
      <Button variant="primary" busy={busy} disabled={!access.configured||!bullpen.connected} onClick={()=>join()}>
        <Radio size={17}/> {isRoomActive?'Restore Live Trading Floor':'Join Live Trading Floor'}
      </Button>
      {isAndroid&&access.configured&&!isRoomActive&&<div className="bullpen-android">
        <p>Install the screen-sharing plugin once. Then open it from here to join the same Bullpen room and choose Screen sharing in the call menu.</p>
        {androidMeeting?<a className="pt-btn" href={`intent://8x8.vc/${encodeURIComponent(androidMeeting.appId)}/${encodeURIComponent(androidMeeting.roomName)}#jwt=${encodeURIComponent(androidMeeting.jwt)}#Intent;scheme=org.jitsi.meet;package=org.jitsi.meet;S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=org.jitsi.meet')};end`}>Open plugin for screen share</a>:<Button busy={busy} onClick={()=>join(true)}>Prepare screen sharing</Button>}
        <a href="https://play.google.com/store/apps/details?id=org.jitsi.meet" target="_blank" rel="noreferrer">Install plugin</a>
      </div>}
      {access.configured&&!bullpen.connected&&<p role="status">Connecting private chat…</p>}
      {error&&<Notice error>{error}</Notice>}
    </section>}
    <LearnFoundations identity={identity}/>


    <ResourceLibrary section="learn" identity={identity}/>
    <section className="wp-panel wp-links"><h2>Bring the lesson to your own process.</h2>
      <a href="/backtesting">Practise in Backtesting ↗</a><a href="/lab">Explore your results ↗</a>
      <a href="/journal">Reflect in your Journal ↗</a>
    </section>
  </WorkspacePage>
  </div></>;
}
