import React, { useState } from 'react';
import { ArrowUpRight, BookOpen, Compass, FlaskConical, NotebookPen, Radio } from 'lucide-react';
import { WorkspacePage, useIdentity } from './WorkspacePages';
import LearnFoundations from './LearnFoundations';
import ResourceLibrary from './ResourceLibrary';
import SetupGallery from './SetupGallery';
import SpotlightTour from './SpotlightTour';
import { Button, Notice } from './components';
import { useBullpen } from './hooks/usePresence';

const LEARN_TOUR_STEPS = [
  {
    target: '[data-learn-tour="foundations"]',
    title: 'Four core foundations',
    text: 'Start with these 4 concise guides — each has a visual diagram, a short exercise, and private completion tracking linked directly to your Journal.',
  },
  {
    target: '[data-learn-tour="glossary"]',
    title: 'Plain-English trading glossary',
    text: 'Search terms like R-multiple, slippage, or drawdown anytime without leaving your desk.',
  },
  {
    target: '[data-learn-tour="library"]',
    title: 'Team playbooks & resource library',
    text: 'Read guides, watch walkthroughs, or publish your own notes and videos for the Primus desk.',
  },
  {
    target: '[data-learn-tour="workflow"]',
    title: 'Take lessons straight into practice',
    text: 'Jump straight from study into Backtesting replay, The Matrix, Strategy Lab, or Today’s Journal.',
  },
];

export default function LearnPage() {
  const { identity } = useIdentity();
  const bullpen = useBullpen();
  const [androidMeeting, setAndroidMeeting] = useState(null);
  const [showTour, setShowTour] = useState(false);
  const isAndroid = navigator.userAgentData?.platform === 'Android' || /Android/i.test(navigator.userAgent);

  const access = bullpen?.access;
  const isRoomActive = Boolean(bullpen?.isRoomActive);
  const liveCount = bullpen?.people?.length || 0;
  const busy = Boolean(bullpen?.joining);
  const error = bullpen?.roomError || '';

  async function join(native = false) {
    const next = await bullpen?.joinRoom({ native });
    if (native && next) setAndroidMeeting(next);
    else if (!native) setAndroidMeeting(null);
  }

  return (
    <WorkspacePage
      active="learn"
      kicker="THE PRIMUS DESK HUB"
      title="Learn"
      intro="Take an idea from understanding to practice. Start with the basics, study team playbooks and setups, and jump straight onto the live desk."
      heroAside={(
        <div className="learn-hub-actions">
          <div className="learn-hub-jumps" role="navigation" aria-label="Learn sections">
            <a href="#learn-start-title">Foundations</a>
            <a href="#glossary-title">Glossary</a>
            <a href="#learn-library">Team Library</a>
          </div>
          <button type="button" className="button learn-tour-btn" onClick={() => setShowTour(true)}>
            <BookOpen size={14} aria-hidden="true" /> Get started
          </button>
        </div>
      )}
    >
      {access && (
        <section className="wp-panel bullpen-entry learn-bullpen-hero">
          <div className="learn-bullpen-copy">
            <span className="pt-overline">
              {liveCount > 0 && <span className="primus-live-dot" aria-hidden="true" />}
              TEAM WORKSPACE {liveCount > 0 ? `· ${liveCount} ON FLOOR` : '· PRIVATE DESK'}
            </span>
            <h2>Live Trading Bullpen</h2>
            <p>
              {access.configured
                ? 'Share your screen, discuss live NY setups, and follow the session together with the Primus desk.'
                : 'JaaS video or private team chat still needs to be configured.'}
            </p>
          </div>
          <div className="learn-bullpen-controls">
            <Button variant="primary" busy={busy} disabled={!access.configured || !bullpen.connected} onClick={() => join()}>
              <Radio size={17} /> {isRoomActive ? 'Restore Live Trading Floor' : 'Join Live Trading Floor'}
            </Button>
            {access.configured && !bullpen.connected && <p role="status">Connecting private chat…</p>}
          </div>
          {access.configured && access.provider !== 'cloudflare' && !isRoomActive && (
            <details className="bullpen-android" open={isAndroid}>
              <summary>Android screen sharing</summary>
              <div className="bullpen-android-actions">
                <p>If you already have Jitsi Meet, prepare the link and open the app to join the Bullpen. Then choose Screen sharing in the call menu.</p>
                {androidMeeting ? (
                  <a className="pt-btn" href={`intent://8x8.vc/${encodeURIComponent(androidMeeting.appId)}/${encodeURIComponent(androidMeeting.roomName)}#jwt=${encodeURIComponent(androidMeeting.jwt)}#Intent;scheme=org.jitsi.meet;package=org.jitsi.meet;S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=org.jitsi.meet')};end`}>
                    Open Jitsi Meet
                  </a>
                ) : (
                  <Button busy={busy} onClick={() => join(true)}>Prepare screen sharing</Button>
                )}
                <a href="https://play.google.com/store/apps/details?id=org.jitsi.meet" target="_blank" rel="noreferrer">
                  Install Jitsi Meet
                </a>
              </div>
            </details>
          )}
          {error && <Notice error>{error}</Notice>}
        </section>
      )}

      <div data-learn-tour="foundations">
        <LearnFoundations identity={identity} />
      </div>

      <SetupGallery identity={identity} />

      <div id="learn-library" data-learn-tour="library">
        <ResourceLibrary section="learn" identity={identity} />
      </div>

      <section data-learn-tour="workflow" className="wp-panel learn-next-grid" aria-label="Continue to workspace">
        <div className="learn-next-head">
          <span className="pt-overline">CONNECTED WORKSPACE</span>
          <h2>Bring the lesson to your own process.</h2>
        </div>
        <div className="learn-next-cards">
          <a className="learn-next-card" href="/backtesting">
            <Compass size={18} aria-hidden="true" />
            <strong>Practise in Backtesting ↗</strong>
            <span>Drill setups bar-by-bar in multi-chart replay.</span>
          </a>
          <a className="learn-next-card" href="/lab">
            <FlaskConical size={18} aria-hidden="true" />
            <strong>Explore your results ↗</strong>
            <span>Check win rate &amp; fixed-R edge in Strategy Lab.</span>
          </a>
          <a className="learn-next-card" href="/journal">
            <NotebookPen size={18} aria-hidden="true" />
            <strong>Reflect in your Journal ↗</strong>
            <span>Log today’s executions and tag what you learned.</span>
          </a>
          <a className="learn-next-card" href="/matrix">
            <ArrowUpRight size={18} aria-hidden="true" />
            <strong>Check The Matrix ↗</strong>
            <span>Review today’s macro bias, sizing gate &amp; catalysts.</span>
          </a>
        </div>
      </section>

      {showTour && (
        <SpotlightTour
          className="learn-tour"
          steps={LEARN_TOUR_STEPS}
          readyTitle="You’re set in the Primus Library"
          readyText="Work through the 4 foundations, publish team notes, or join The Bullpen live."
          readyCta="Start learning"
          onClose={() => setShowTour(false)}
        />
      )}
    </WorkspacePage>
  );
}
