import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare, CalendarClock, Layers, Send, AlertTriangle, Volume2,
  MicOff, MonitorOff, Ban, UserCheck, CheckCircle2, Settings, X,
} from 'lucide-react';
import { Button, Notice } from '../components';
import { REACTIONS, useBullpen } from '../hooks/usePresence';
import { api } from '../api';
import CloudflareStage from './CloudflareStage';
import {
  BullpenLevelsPanel,
  BullpenNewsPanel,
  MARKET_MOVER,
  parseEventMs,
  formatEventTime,
} from './BullpenDeskPanel';
import { getChimesEnabled, setChimesEnabled, playDeskChime } from '../utils/deskChimes';
import '../trading-room.css';

const JaaSMeeting = lazy(() => import('@jitsi/react-sdk').then((module) => ({ default: module.JaaSMeeting })));
const configOverwrite = {
  enableOpusRed: true, enableNoAudioDetection: true,
  prejoinConfig: { enabled: true }, startWithAudioMuted: true, startWithVideoMuted: true,
  resolution: 1080, constraints: { video: { height: { ideal: 1080, max: 1080, min: 360 } } },
  desktopSharingFrameRate: { min: 5, max: 30 }, hideConferenceSubject: true, hideConferenceTimer: true,
  disableInviteFunctions: true, disableThirdPartyRequests: true,
  toolbarButtons: ['microphone', 'desktop', 'fullscreen', 'tileview', 'settings', 'hangup'],
};
const frameSize = (node) => { node.style.width = '100%'; node.style.height = '100%'; };
const constrain = (value) => Math.max(45, Math.min(82, value));

const TRADER_STATUSES = [
  { id: 'watching', label: 'Watching', short: '👀' },
  { id: 'long', label: 'Long', short: '🟢' },
  { id: 'short', label: 'Short', short: '🔴' },
  { id: 'done', label: 'Done', short: '🏁' },
  { id: 'locked', label: 'Locked Out', short: '🛑' },
];

function statusMeta(id) {
  return TRADER_STATUSES.find((s) => s.id === id) || TRADER_STATUSES[0];
}

function nySessionClock(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const mm = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const mins = hh * 60 + mm;
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ET`;
  const session =
    mins >= 570 && mins < 660 ? 'NY Open' :
    mins >= 660 && mins < 840 ? 'NY Midday' :
    mins >= 840 && mins < 960 ? 'Power Hour' :
    mins >= 180 && mins < 570 ? 'London / Pre-NY' : 'After Hours';
  return `${clock} · ${session}`;
}

function readDeskLayout(name) {
  try {
    const saved = JSON.parse(localStorage.getItem(`primus:bullpen:layout:${name}`));
    return { split: Number.isFinite(saved?.split) ? constrain(saved.split) : 74, sidebarLeft: saved?.sidebarLeft === true };
  } catch { return { split: 74, sidebarLeft: false }; }
}

function readPeerVolumes() {
  try {
    const raw = JSON.parse(localStorage.getItem('primus:floor:volumes'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

function formatMmSs(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function TradingRoom({ meeting, onLeave, minimised = false, onMinimise, onRestore }) {
  const {
    access, connected, people, peers, messages, reaction,
    deskVersion, deskEvent, error, setInCall, patchPresenceMeta, send,
  } = useBullpen();
  const isCloudflare = meeting?.provider === 'cloudflare';

  const [tab, setTab] = useState('chat');
  const [split, setSplit] = useState(() => readDeskLayout(access.name).split);
  const [sidebarLeft, setSidebarLeft] = useState(() => readDeskLayout(access.name).sidebarLeft);
  const [theater, setTheater] = useState(false);
  const [clockLabel, setClockLabel] = useState(() => nySessionClock(new Date()));
  const [traderStatus, setTraderStatus] = useState('watching');
  const [chimesOn, setChimesOn] = useState(() => getChimesEnabled());
  const [peerVolumes, setPeerVolumes] = useState(() => readPeerVolumes());
  const [speakingMap, setSpeakingMap] = useState({});
  const [openMenu, setOpenMenu] = useState(null); // peer name or null
  const [desk, setDesk] = useState({ day: '', biases: {}, levels: [], disabled: [], warmed_up: [] });
  const [modBusy, setModBusy] = useState(false);

  // Macro snapshot + calendar (shared with News tab & drives 5-min Red-Folder warning bar)
  const [macroSnapshot, setMacroSnapshot] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [macroLoading, setMacroLoading] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [dismissedAlertId, setDismissedAlertId] = useState('');

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [joined, setJoined] = useState(false);
  const [videoError, setVideoError] = useState('');

  const layout = useRef(null);
  const handlers = useRef(null);
  const leave = useRef(onLeave);
  const messagesEnd = useRef(null);
  const prevPeopleRef = useRef([]);
  const alertedEventIdsRef = useRef(new Set());
  const rosterRef = useRef(null);
  leave.current = onLeave;

  const isDisabled = useMemo(
    () => !access?.moderator && Array.isArray(desk.disabled) && desk.disabled.includes(access?.name),
    [access?.moderator, access?.name, desk.disabled],
  );

  useEffect(() => {
    const timer = setInterval(() => setClockLabel(nySessionClock(new Date())), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(`primus:bullpen:layout:${access.name}`, JSON.stringify({ split, sidebarLeft })); } catch {}
    }, 250);
    return () => clearTimeout(timer);
  }, [access.name, split, sidebarLeft]);

  useEffect(() => {
    try { localStorage.setItem('primus:floor:volumes', JSON.stringify(peerVolumes)); } catch {}
  }, [peerVolumes]);

  // Sync own Trader Status into Supabase Presence
  useEffect(() => {
    if (!joined) return;
    patchPresenceMeta({ traderStatus });
  }, [joined, patchPresenceMeta, traderStatus]);

  // Close roster popover on outside click
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (event) => {
      if (rosterRef.current && !rosterRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openMenu]);

  // Load shared desk state (levels, disabled list, Mindset warm-up roster)
  useEffect(() => {
    let active = true;
    api('/bullpen/desk').then((data) => {
      if (active && data) setDesk(data);
    }).catch(() => {});
    return () => { active = false; };
  }, [deskVersion]);

  // Subtle chime when a teammate posts a new key level
  useEffect(() => {
    if (!deskEvent || !joined) return;
    if (deskEvent.action === 'level' && deskEvent.name !== access?.name) {
      playDeskChime('level', chimesOn);
    }
  }, [access?.name, chimesOn, deskEvent, joined]);

  // Subtle chime when a teammate joins the room
  useEffect(() => {
    if (!joined) {
      prevPeopleRef.current = people;
      return;
    }
    const prev = new Set(prevPeopleRef.current);
    const newlyJoined = people.some((n) => n !== access?.name && !prev.has(n));
    if (newlyJoined) {
      playDeskChime('join', chimesOn);
    }
    prevPeopleRef.current = people;
  }, [access?.name, chimesOn, joined, people]);

  // Load Matrix snapshot + US Economic Calendar (drives News tab + 5-min Red-Folder Warning Bar)
  useEffect(() => {
    let active = true;
    async function loadMacro() {
      try {
        const res = await api('/matrix/snapshot');
        if (!active) return;
        const snap = res?.snapshot || (res?.tickers || res?.swing ? res : null);
        setMacroSnapshot(snap);
        const fmp = Array.isArray(snap?.calendar) ? snap.calendar : [];
        if (fmp.length) {
          setCalendar(fmp);
        } else {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
          const econ = await api(`/backtesting/economic-calendar?day=${today}&scope=month`).catch(() => null);
          if (active && Array.isArray(econ?.events)) {
            setCalendar(econ.events);
          }
        }
      } catch {
        // Leave empty gracefully
      } finally {
        if (active) setMacroLoading(false);
      }
    }
    void loadMacro();
    const timer = setInterval(loadMacro, 180_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const upcomingEvents = useMemo(() => calendar
    .map((event, index) => {
      const title = event.title || event.event || event.name || 'US Release';
      return { id: event.id || `${title}-${index}`, title, ms: parseEventMs(event) };
    })
    .filter((event) => Number.isFinite(event.ms))
    .sort((first, second) => first.ms - second.ms), [calendar]);

  const nextEvent = upcomingEvents.find((event) => event.ms >= nowTick);
  const imminentRedFolder = upcomingEvents.find(({title, ms}) =>
    MARKET_MOVER.test(title) && ms - nowTick <= 5 * 60_000 && ms - nowTick >= -2 * 60_000);
  const pinnedLevels = (desk.levels || []).filter((level) => level.status !== 'invalidated').slice(0, 3);

  // Tick every second only when near a red-folder event (otherwise every 15s)
  useEffect(() => {
    const interval = imminentRedFolder ? 1000 : 15_000;
    const timer = setInterval(() => setNowTick(Date.now()), interval);
    return () => clearInterval(timer);
  }, [imminentRedFolder]);

  // Play red-folder pre-news chime once per upcoming catalyst
  useEffect(() => {
    if (!imminentRedFolder || !joined) return;
    if (!alertedEventIdsRef.current.has(imminentRedFolder.id)) {
      alertedEventIdsRef.current.add(imminentRedFolder.id);
      playDeskChime('alert', chimesOn);
    }
  }, [chimesOn, imminentRedFolder, joined]);

  useEffect(() => () => {
    handlers.current?.();
    setInCall(false);
  }, [setInCall]);

  useEffect(() => {
    if (tab === 'chat' && joined) messagesEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, tab, joined]);

  const handleJoined = useCallback(() => {
    setJoined(true);
    setInCall(true);
    setVideoError('');
    api('/alert-team', { method: 'POST' }).catch(() => {});
  }, [setInCall]);

  const handleSpeakingChange = useCallback((name, isSpeaking) => {
    if (!name) return;
    setSpeakingMap((prev) => (prev[name] === isSpeaking ? prev : { ...prev, [name]: isSpeaking }));
  }, []);

  const toggleChimes = useCallback(() => {
    setChimesOn((prev) => {
      const next = !prev;
      setChimesEnabled(next);
      return next;
    });
  }, []);

  function ready(instance) {
    handlers.current?.();
    const didLeave = () => { setInCall(false); leave.current(); };
    const didError = (event) => {
      if (event?.isFatal) setVideoError('The video room could not connect. Leave and try joining again.');
    };
    instance.addListener('videoConferenceJoined', handleJoined);
    instance.addListener('videoConferenceLeft', didLeave);
    instance.addListener('errorOccurred', didError);
    handlers.current = () => {
      instance.removeListener('videoConferenceJoined', handleJoined);
      instance.removeListener('videoConferenceLeft', didLeave);
      instance.removeListener('errorOccurred', didError);
      instance.dispose();
    };
  }

  async function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || isDisabled) return;
    setSending(true);
    try {
      if (await send('chat', { text })) setDraft((current) => (current === draft ? '' : current));
    } finally { setSending(false); }
  }

  async function dropHeadlineInChat(item) {
    if (isDisabled || !connected || !joined) return false;
    const text = `📰 [${item.source}] ${item.title}`.slice(0, 395);
    return send('chat', { text });
  }

  async function moderateMember(targetName, action) {
    if (!access?.moderator || modBusy) return;
    setModBusy(true);
    try {
      if (action === 'disable' || action === 'enable') {
        const updated = await api('/bullpen/desk', {
          method: 'PUT',
          body: { set_disabled: { name: targetName, disabled: action === 'disable' } },
        });
        setDesk(updated);
      }
      await send('moderation', { action, target: targetName });
      setOpenMenu(null);
    } finally {
      setModBusy(false);
    }
  }

  // Merge presence peers + self fallback so roster always shows current user
  const roster = useMemo(() => {
    if (peers?.length) return peers;
    return access?.name ? [{ name: access.name, traderStatus }] : [];
  }, [access?.name, peers, traderStatus]);

  const warmedSet = useMemo(() => new Set(desk.warmed_up || []), [desk.warmed_up]);
  const disabledSet = useMemo(() => new Set(desk.disabled || []), [desk.disabled]);

  const showRedFolderBar = !minimised && imminentRedFolder && dismissedAlertId !== imminentRedFolder.id;

  return (
    <section
      className={`bullpen-room${minimised ? ' is-minimised' : ''}${theater && !minimised ? ' is-theater' : ''}`}
      aria-label="Live Trading Floor"
    >
      {/* 5-Min Red-Folder Pre-News Warning Strip */}
      {showRedFolderBar && (
        <div
          className={`bullpen-redfolder-bar${imminentRedFolder.ms <= nowTick ? ' is-live' : ''}`}
          role="alert"
        >
          <div className="bullpen-redfolder-copy">
            <AlertTriangle size={15} />
            <strong>
              {imminentRedFolder.ms <= nowTick
                ? 'RED-FOLDER LIVE NOW'
                : `RED-FOLDER IN ${formatMmSs(imminentRedFolder.ms - nowTick)}`}
            </strong>
            <span>— {imminentRedFolder.title} ({formatEventTime(imminentRedFolder.ms)})</span>
          </div>
          <button
            type="button"
            className="bullpen-redfolder-close"
            onClick={() => setDismissedAlertId(imminentRedFolder.id)}
            aria-label="Dismiss red-folder warning"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <header className="bullpen-room-head">
        <div className="bullpen-head-title">
          <h1>Trading Floor</h1>
          {joined && <span className="bullpen-live bullpen-room-count">{roster.length} in room</span>}
          <span className="bullpen-clock">{clockLabel}</span>
        </div>

        {/* Interactive Team Roster with Speaking Glow, Warm-up Dot, Status Pills, Volume & Moderator Menu */}
        <div className="bullpen-roster" ref={rosterRef} aria-label="Traders in room">
          {roster.map((peer) => {
            const isMe = peer.name === access?.name;
            const st = statusMeta(isMe ? traderStatus : peer.traderStatus);
            const isSpeaking = Boolean(speakingMap[peer.name]);
            const isWarmed = warmedSet.has(peer.name);
            const isPeerDisabled = disabledSet.has(peer.name);
            const vol = Math.round((peerVolumes[peer.name] ?? 1) * 100);
            const menuOpen = openMenu === peer.name;

            return (
              <div key={peer.name} className="bullpen-roster-item">
                <button
                  type="button"
                  className={`bullpen-person-pill is-status-${st.id}${isSpeaking ? ' is-speaking' : ''}${isPeerDisabled ? ' is-disabled' : ''}`}
                  onClick={() => setOpenMenu((cur) => (cur === peer.name ? null : peer.name))}
                  aria-expanded={menuOpen}
                  title={isMe ? 'Click to set your trader status' : `Click to adjust ${peer.name}'s volume${access?.moderator ? ' or moderate' : ''}`}
                >
                  {isWarmed && (
                    <span className="bullpen-warmup-dot" title="Mindset Warm-up completed today" aria-label="Mindset Warm-up complete" />
                  )}
                  <span className="bullpen-person-name">{peer.name}</span>
                  <span className="bullpen-person-status" title={st.label}>{st.short}</span>
                  {peer.deafened && <span className="bullpen-person-flag" title="Deafened">🔇</span>}
                  {isPeerDisabled && <span className="bullpen-person-flag is-danger" title="Disabled by moderator">🚫</span>}
                </button>

                {menuOpen && (
                  <div className="bullpen-person-popover" role="dialog" aria-label={isMe ? 'Your status' : `${peer.name} controls`}>
                    {isMe ? (
                      <>
                        <div className="bullpen-pop-title">Your Live Status</div>
                        <div className="bullpen-status-grid">
                          {TRADER_STATUSES.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              className={`bullpen-status-opt is-${opt.id}${traderStatus === opt.id ? ' is-active' : ''}`}
                              onClick={() => { setTraderStatus(opt.id); setOpenMenu(null); }}
                            >
                              <span>{opt.short}</span> {opt.label}
                            </button>
                          ))}
                        </div>
                        {isWarmed && (
                          <div className="bullpen-pop-meta"><CheckCircle2 size={12} /> Mindset Warm-up complete</div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="bullpen-pop-title">
                          {peer.name}
                          <small>{st.label}{peer.deafened ? ' · Deafened' : ''}</small>
                        </div>
                        {isWarmed && (
                          <div className="bullpen-pop-meta"><CheckCircle2 size={12} /> Mindset Warm-up complete</div>
                        )}
                        <label className="bullpen-vol-row">
                          <span><Volume2 size={13} /> Volume</span>
                          <strong>{vol}%</strong>
                          <input
                            type="range"
                            min="0"
                            max="150"
                            step="5"
                            value={vol}
                            onChange={(e) => setPeerVolumes((prev) => ({
                              ...prev,
                              [peer.name]: Number(e.target.value) / 100,
                            }))}
                          />
                        </label>
                        {access?.moderator && (
                          <div className="bullpen-mod-actions">
                            <div className="bullpen-pop-title">Moderator</div>
                            <button type="button" disabled={modBusy} onClick={() => moderateMember(peer.name, 'force_mute')}>
                              <MicOff size={13} /> Force Mute Mic
                            </button>
                            <button type="button" disabled={modBusy} onClick={() => moderateMember(peer.name, 'stop_share')}>
                              <MonitorOff size={13} /> Stop Their Share
                            </button>
                            <button
                              type="button"
                              className={isPeerDisabled ? 'is-enable' : 'is-danger'}
                              disabled={modBusy}
                              onClick={() => moderateMember(peer.name, isPeerDisabled ? 'enable' : 'disable')}
                            >
                              {isPeerDisabled ? <UserCheck size={13} /> : <Ban size={13} />}
                              {isPeerDisabled ? 'Re-enable Member' : 'Disable Member'}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="bullpen-head-actions">
          {!minimised && !isCloudflare && (
            <details className="bullpen-legacy-settings">
              <summary className="button"><Settings size={14} /> Settings</summary>
              <div className="bullpen-legacy-settings-options">
                <Button onClick={() => setTheater((value) => !value)} aria-pressed={theater}>Theater mode</Button>
                <Button className="bullpen-settings-sidebar" onClick={() => setSidebarLeft((value) => !value)}>
                  Move sidebar {sidebarLeft ? 'right' : 'left'}
                </Button>
              </div>
            </details>
          )}
          {onMinimise && <Button onClick={() => { if (minimised) onRestore(); else onMinimise(); }}>{minimised ? 'Restore' : 'Minimise'}</Button>}
          <Button onClick={onLeave}>Leave</Button>
        </div>
      </header>

      {videoError && <Notice error>{videoError}</Notice>}

      <div className={sidebarLeft ? 'bullpen-split bullpen-sidebar-left' : 'bullpen-split'} ref={layout} style={{ '--bullpen-ratio': split / 100 }}>
        <div className="bullpen-video">
          <div className="bullpen-call-frame">
            {isCloudflare ? (
              <CloudflareStage
                meeting={meeting}
                minimised={minimised}
                theater={theater}
                onToggleTheater={() => setTheater((v) => !v)}
                sidebarLeft={sidebarLeft}
                onToggleSidebar={() => setSidebarLeft((value) => !value)}
                speakingMap={speakingMap}
                deskOverview={<div className="bullpen-voice-overview" aria-label="Desk overview">
                  <section>
                    <button type="button" className="bullpen-brief-link" onClick={() => { setTheater(false); setTab('levels'); }}>
                      <Layers size={15} /> Pinned levels
                    </button>
                    {pinnedLevels.length ? <ul>{pinnedLevels.map((level) =>
                      <li key={level.id}><strong>{level.symbol} {level.price}</strong> <span>{level.label}</span></li>)}</ul>
                      : <p>No levels pinned.</p>}
                  </section>
                  <section>
                    <button type="button" className="bullpen-brief-link" onClick={() => { setTheater(false); setTab('news'); }}>
                      <CalendarClock size={15} /> Next scheduled news
                    </button>
                    {nextEvent ? <p><strong>{nextEvent.title}</strong><time dateTime={new Date(nextEvent.ms).toISOString()}>
                      {formatEventTime(nextEvent.ms)}
                    </time></p> : <p>{macroLoading ? 'Loading calendar…' : 'No upcoming events.'}</p>}
                  </section>
                </div>}
                peerVolumes={peerVolumes}
                onSpeakingChange={handleSpeakingChange}
                isDisabled={isDisabled}
                chimesOn={chimesOn}
                onToggleChimes={toggleChimes}
                onJoined={handleJoined}
                onError={setVideoError}
              />
            ) : (
              <Suspense fallback={<p role="status">Opening Trading Floor…</p>}>
                <JaaSMeeting roomName={meeting.roomName} appId={meeting.appId} jwt={meeting.jwt}
                  userInfo={{ displayName: access.name }} configOverwrite={configOverwrite}
                  interfaceConfigOverwrite={{
                    DEFAULT_BACKGROUND: getComputedStyle(document.documentElement).getPropertyValue('--tl-surface').trim(),
                    SHOW_JITSI_WATERMARK: false, SHOW_BRAND_WATERMARK: false, SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_POWERED_BY: false, MOBILE_APP_PROMO: false, VIDEO_LAYOUT_FIT: 'nocrop',
                  }}
                  getIFrameRef={frameSize} onApiReady={ready} onReadyToClose={() => leave.current()} />
              </Suspense>
            )}
          </div>
          {reaction && joined && <span className="bullpen-flying-reaction" key={reaction.id} aria-hidden="true">{reaction.emoji}</span>}
        </div>

        <div className="bullpen-divider" role="separator" tabIndex={0} aria-label="Resize stage and sidebar"
          aria-orientation="vertical" aria-valuemin={45} aria-valuemax={82} aria-valuenow={Math.round(split)}
          onDoubleClick={() => setSplit(74)}
          onPointerDown={(event) => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds = layout.current.getBoundingClientRect();
            const percent = 100 * (event.clientX - bounds.left - 5) / (bounds.width - 10);
            setSplit(constrain(sidebarLeft ? 100 - percent : percent));
          }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            setSplit((value) => (event.key === 'Home' ? 45 : event.key === 'End' ? 82 : constrain(value + (event.key === 'ArrowLeft' ? -2 : 2) * (sidebarLeft ? -1 : 1))));
          }} />

        <aside className="bullpen-side" aria-label="Trading Floor desk sidebar">
          <div className="bullpen-tabs" role="group" aria-label="Sidebar view">
            <button type="button" aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}><MessageSquare size={14} /> Chat</button>
            <button type="button" aria-pressed={tab === 'levels'} onClick={() => setTab('levels')}><Layers size={14} /> Levels</button>
            <button type="button" aria-pressed={tab === 'news'} onClick={() => setTab('news')}><CalendarClock size={14} /> News</button>
          </div>
          {tab === 'chat' ? (
            <>
              <div className="bullpen-messages" role="log" aria-label="Team chat">
                {!messages.length && <p className="bullpen-desk-muted">{joined ? 'No messages yet.' : 'Connecting to the desk…'}</p>}
                {messages.map((item) => (
                  <article key={item.id}>
                    <strong>{item.name}</strong>
                    <p>{item.text}</p>
                  </article>
                ))}
                <div ref={messagesEnd} />
              </div>
              {error && <p role="status" className="bullpen-connection">{error}</p>}
              <form className="bullpen-composer" onSubmit={submit}>
                <input
                  aria-label="Team message"
                  placeholder={isDisabled ? 'Disabled by moderator' : 'Message the desk…'}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={400}
                  disabled={!connected || !joined || isDisabled}
                />
                <Button type="submit" busy={sending} disabled={!connected || !joined || isDisabled || !draft.trim()} aria-label="Send message">
                  <Send size={15} />
                </Button>
              </form>
              <div className="bullpen-reactions" role="group" aria-label="Send a reaction">
                {REACTIONS.map((emoji, index) => (
                  <Button key={emoji} disabled={!connected || !joined || isDisabled}
                    aria-label={['Fire', 'Applause', 'On target'][index]}
                    onClick={() => void send('reaction', { emoji })}>{emoji}</Button>
                ))}
              </div>
            </>
          ) : tab === 'levels' ? (
            <BullpenLevelsPanel desk={desk} onDeskUpdate={setDesk} isDisabled={isDisabled} />
          ) : (
            <BullpenNewsPanel
              snapshot={macroSnapshot}
              calendar={calendar}
              loading={macroLoading}
              onDropHeadline={dropHeadlineInChat}
              isDisabled={isDisabled}
            />
          )}
        </aside>
      </div>
    </section>
  );
}
