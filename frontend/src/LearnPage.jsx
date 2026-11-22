import React, {useState} from 'react';
import {Radio} from 'lucide-react';
import {WorkspacePage,useIdentity} from './WorkspacePages';
import LearnFoundations from './LearnFoundations';
import ResourceLibrary from './ResourceLibrary';
import {Button, Notice} from './components';
import {useBullpen} from './hooks/usePresence';

export default function LearnPage() {
  const {identity}=useIdentity();
  const bullpen=useBullpen();
  const [androidMeeting,setAndroidMeeting]=useState(null);
  const isAndroid=navigator.userAgentData?.platform==='Android'||/Android/i.test(navigator.userAgent);

  const access=bullpen?.access;
  const isRoomActive=Boolean(bullpen?.isRoomActive);
  const busy=Boolean(bullpen?.joining);
  const error=bullpen?.roomError||'';

  async function join(native=false){
    const next=await bullpen?.joinRoom({native});
    if(native&&next) setAndroidMeeting(next);
    else if(!native) setAndroidMeeting(null);
  }

  return <WorkspacePage active="learn" kicker="THE PRIMUS LIBRARY" title="Learn"
    intro="Take an idea from understanding to practice. Start with the basics, find the words, then explore videos and guides from the Primus team.">
    {access&&<section className="wp-panel bullpen-entry">
      <div><span className="pt-overline">TEAM WORKSPACE</span><h2>Live Trading Bullpen</h2>
        <p>{access.configured?'Share your screen, discuss setups and follow the session together.':'JaaS video or private team chat still needs to be configured.'}</p>
      </div>
      <Button variant="primary" busy={busy} disabled={!access.configured||!bullpen.connected} onClick={()=>join()}>
        <Radio size={17}/> {isRoomActive?'Restore Live Trading Floor':'Join Live Trading Floor'}
      </Button>
      {access.configured&&access.provider!=='cloudflare'&&!isRoomActive&&<details className="bullpen-android" open={isAndroid}>
        <summary>Android screen sharing</summary>
        <div className="bullpen-android-actions">
        <p>If you already have Jitsi Meet, prepare the link and open the app to join the Bullpen. Then choose Screen sharing in the call menu.</p>
        {androidMeeting?<a className="pt-btn" href={`intent://8x8.vc/${encodeURIComponent(androidMeeting.appId)}/${encodeURIComponent(androidMeeting.roomName)}#jwt=${encodeURIComponent(androidMeeting.jwt)}#Intent;scheme=org.jitsi.meet;package=org.jitsi.meet;S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=org.jitsi.meet')};end`}>Open Jitsi Meet</a>:<Button busy={busy} onClick={()=>join(true)}>Prepare screen sharing</Button>}
        <a href="https://play.google.com/store/apps/details?id=org.jitsi.meet" target="_blank" rel="noreferrer">Install Jitsi Meet</a>
        </div>
      </details>}
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
