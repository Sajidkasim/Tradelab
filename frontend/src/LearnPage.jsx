import React, {lazy, Suspense, useState} from 'react';
import {Radio} from 'lucide-react';
import {WorkspacePage,useIdentity} from './WorkspacePages';
import {PrimusHeader} from './SiteExperience';
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
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const access=bullpen?.access;
  const isRoomActive=Boolean(meeting&&access?.configured);

  async function join(){
    setBusy(true);
    setError('');
    try{
      const reply=await api('/bullpen?join=true');
      if(!reply?.meeting)throw new Error('The team room is unavailable.');
      setMeeting(reply.meeting);
    }catch(failure){setError(failure.message)}
    finally{setBusy(false)}
  }

  if(isRoomActive)return <div className="pt-site bullpen-workspace">
    <PrimusHeader active="learn"/>
    <Suspense fallback={<p role="status">Opening the Bullpen…</p>}>
      <TradingRoom meeting={meeting} onLeave={()=>setMeeting(null)}/>
    </Suspense>
  </div>;

  return <WorkspacePage active="learn" kicker="THE PRIMUS LIBRARY" title="Learn"
    intro="Take an idea from understanding to practice. Start with the basics, find the words, then explore videos and guides from the Primus team.">
    {access&&<section className="wp-panel bullpen-entry">
      <div><span className="pt-overline">TEAM WORKSPACE</span><h2>Live Trading Bullpen</h2>
        <p>{access.configured?'Share your screen, discuss setups and follow the session together.':'Private team chat still needs to be configured.'}</p>
      </div>
      <Button variant="primary" busy={busy} disabled={!access.configured||!bullpen.connected} onClick={join}>
        <Radio size={17}/> Join Live Trading Floor
      </Button>
      {access.configured&&!bullpen.connected&&<p role="status">Connecting private chat…</p>}
      {error&&<Notice error>{error}</Notice>}
    </section>}
    <LearnFoundations identity={identity}/>
    <ResourceLibrary section="learn" identity={identity}/>
    <section className="wp-panel wp-links"><h2>Bring the lesson to your own process.</h2>
      <a href="/backtesting">Practise in Backtesting ↗</a><a href="/lab">Explore your results ↗</a>
      <a href="/journal">Reflect in your Journal ↗</a>
    </section>
  </WorkspacePage>;
}
