import React, {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {
  ArrowUpRight, Check, ChevronDown, Headphones, Mic, MicOff,
  Play, Plus, Wind,
} from 'lucide-react';
import {WorkspacePage, useIdentity, SignInPanel} from './WorkspacePages';
import ResourceLibrary from './ResourceLibrary';
import VisionBoard from './VisionBoard';
import {Notice, Button} from './components';
import {api} from './api';
import {money} from './format';
import PrepProgress from './PrepProgress';
import CompoundEdge from './CompoundEdge';
import {FocusSoundscape} from './mindsetAudio';
import {createVoiceRecorder, formatVoiceDuration, voiceExtensionForMime} from './voiceCapture';
import './mindset-warmup.css';

const BrainExplorer = lazy(() => import('./BrainExplorer'));
const MindsetWarmUp = lazy(() => import('./MindsetWarmUp'));
const WARM_UP_STEPS = ['Breathwork', 'Focus Games', 'Affirmation'];
const ENERGY_OPTIONS = [
  {value: 'rested', label: 'Rested'},
  {value: 'tired', label: 'Tired'},
  {value: 'fumes', label: 'On fumes'},
];
const HEADSPACE_OPTIONS = [
  {value: 'calm', label: 'Calm'},
  {value: 'distracted', label: 'Distracted'},
  {value: 'emotional', label: 'Emotional'},
];
const STARTER_HABITS = [
  'Stop after 2 consecutive losses',
  'No phone 30m before open',
  'Complete post-session Journal review',
  '20m walk or workout',
];

function WarmUpHero({state, checkpoint, onStart, onTiltReset, soundMode, onSoundMode, checkIn, children}) {
  const completed = state?.completed && !checkpoint;
  return <section className="mw-pre-market" aria-labelledby="warm-up-title">
    <div className="mw-launch">
      <div className="mw-launch-heading">
        <h1 id="warm-up-title" tabIndex={-1}>Pre-market</h1>
        {state && <div className="mw-utilities">
          <button type="button" onClick={onTiltReset} aria-haspopup="dialog">
            <Wind size={16} aria-hidden="true"/> 60s Reset
          </button>
          <details className="mw-sound">
            <summary aria-label="Focus audio" title="Focus audio">
              <Headphones size={17} aria-hidden="true"/>
              {soundMode !== 'off' && <span className="mw-sound-active" aria-hidden="true"/>}
            </summary>
            <div className="mw-sound-options" role="group" aria-label="Focus soundscape">
              {Object.entries({off: 'Audio off', brown: 'Brown noise', binaural: 'Focus hum'}).map(([mode, label]) =>
                <button key={mode} type="button" aria-pressed={soundMode === mode} onClick={event => {
                  onSoundMode(mode);
                  const disclosure = event.currentTarget.closest('details');
                  disclosure.open = false;
                  disclosure.querySelector('summary').focus();
                }}>{label}</button>)}
            </div>
          </details>
        </div>}
      </div>
      {state && <>
        <div className="mw-launch-actions">
          {completed
            ? <a className="mw-launch-primary" href="/journal">Open today’s Journal <ArrowUpRight size={16} aria-hidden="true"/></a>
            : <button className="mw-launch-primary" type="button" aria-haspopup="dialog" onClick={() => onStart()}>
                <Play size={16} aria-hidden="true"/> {checkpoint ? 'Resume Warm-Up' : 'Start Warm-Up'}
              </button>}
          <span className="mw-launch-status" role="status">
            {completed ? <><Check size={15} aria-hidden="true"/> Warm-Up Complete</> : checkpoint ? WARM_UP_STEPS[checkpoint.step] : 'About 5 min'}
          </span>
        </div>
        {state.affirmation && <div className="mw-session-focus"><span>Today’s rule</span><strong>{state.affirmation}</strong></div>}
        <div className="mw-step-links" role="group" aria-label="Open a warm-up step">
          {WARM_UP_STEPS.map((name, index) =>
            <button key={name} type="button" aria-haspopup="dialog" onClick={() => onStart(index)}>
              {name}<ArrowUpRight size={13} aria-hidden="true"/>
            </button>)}
        </div>
      </>}
      {checkIn}
    </div>
    {children && <div className="mw-prep-controls">{children}</div>}
  </section>;
}

function ReadinessStrip({state, onChange, status}) {
  const energy = state.energy || '';
  const headspace = state.headspace || '';
  const tilted = headspace === 'emotional' || headspace === 'distracted' || energy === 'fumes';

  return <details className="mw-check-in">
    <summary>Check in <span>{selected.join(' · ')}</span><ChevronDown size={16} aria-hidden="true"/></summary>
    <div className="mw-readiness-strip">
      <div className="mw-readiness-groups">
        <div className="mw-readiness-group">
          <span className="mw-readiness-label">Energy</span>
          <div role="group" aria-label="Energy level">
            {ENERGY_OPTIONS.map(opt => (
              <button key={opt.value} type="button" aria-pressed={energy === opt.value}
                onClick={() => onChange({...state, energy: energy === opt.value ? '' : opt.value})}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mw-readiness-group">
          <span className="mw-readiness-label">Headspace</span>
          <div role="group" aria-label="Current headspace">
            {HEADSPACE_OPTIONS.map(opt => (
              <button key={opt.value} type="button" aria-pressed={headspace === opt.value}
                className={opt.value === 'emotional' ? 'tone-warn' : ''}
                onClick={() => onChange({...state, headspace: headspace === opt.value ? '' : opt.value})}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {tilted && (
        <div className="mw-tilt-guard" role="note">
          <span>Elevated tilt risk</span>
        </div>
      )}
      {status === 'failed' && <p role="alert">Check-in could not be saved. <Button onClick={() => onChange(state)}>Retry</Button></p>}
    </div>
  </details>;
}

function MorningBrief({voiceCloudEnabled}) {
  const [note, setNote] = useState('');
  const [brief, setBrief] = useState(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const speechRef = useRef(null);

  const SpeechCtor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const canCloudVoice = voiceCloudEnabled && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
  const voiceSupported = canCloudVoice || Boolean(SpeechCtor);

  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch {}
    try { speechRef.current?.stop(); } catch {}
  }, []);

  useEffect(() => {
    if (!recording) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function runBrief() {
    setLoadingBrief(true);
    setBriefError('');
    try {
      const res = await api('/mindset/morning-brief', {method: 'POST', body: {note: note.trim()}});
      setBrief(res);
    } catch (err) {
      setBriefError(err.message);
    } finally {
      setLoadingBrief(false);
    }
  }

  async function toggleVoice() {
    if (transcribing) return;
    if (recording) {
      setRecording(false);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      if (speechRef.current) { try { speechRef.current.stop(); } catch {} speechRef.current = null; }
      return;
    }
    if (canCloudVoice) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({audio: true});
        const recorder = createVoiceRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const mimeType = recorder.mimeType || 'audio/webm';
          const ext = voiceExtensionForMime(mimeType);
          const blob = new Blob(chunksRef.current, {type: mimeType});
          chunksRef.current = [];
          if (!blob.size) return;
          setTranscribing(true);
          try {
            const form = new FormData();
            form.append('file', blob, `checkin.${ext}`);
            const res = await api('/journal/transcribe', {method: 'POST', body: form});
            if (res?.text) setNote(prev => (prev ? `${prev} ${res.text}` : res.text).slice(0, 600));
          } catch (err) {
            setBriefError(err.message);
          } finally {
            setTranscribing(false);
          }
        };
        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
      } catch {
        setBriefError('Microphone permission was denied.');
      }
      return;
    }
    if (SpeechCtor) {
      try {
        const recognition = new SpeechCtor();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.onresult = event => {
          const text = Array.from(event.results).map(r => r[0]?.transcript?.trim()).filter(Boolean).join(' ');
          if (text) setNote(prev => (prev ? `${prev} ${text}` : text).slice(0, 600));
        };
        recognition.onerror = () => setRecording(false);
        recognition.onend = () => setRecording(false);
        speechRef.current = recognition;
        recognition.start();
        setRecording(true);
      } catch {
        setBriefError('Voice check-in could not start.');
      }
    }
  }

  return <section className="wp-panel mw-card mw-brief-card" aria-labelledby="mw-brief-title">
      <h2 id="mw-brief-title">Morning Primax Brief</h2>
      <div className="mw-brief-compose">
        <input
          type="text"
          maxLength={600}
          aria-label="Pre-market check-in note"
          placeholder="Optional · how are you feeling before the open?"
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !loadingBrief) runBrief(); }}
        />
        {voiceSupported && (
          <button type="button" className={`mw-voice-pill ${recording ? 'is-recording' : ''}`}
            disabled={transcribing || loadingBrief} aria-pressed={recording} onClick={toggleVoice}
            title="Voice check-in">
            {recording ? <MicOff size={14}/> : <Mic size={14}/>}
            <span>{transcribing ? 'Transcribing…' : recording ? `${formatVoiceDuration(elapsed)} · Stop` : 'Voice'}</span>
          </button>
        )}
        <Button type="button" variant="primary" busy={loadingBrief} onClick={runBrief}>
          {brief ? 'Refresh brief' : 'Generate brief'}
        </Button>
      </div>
      {briefError && <Notice error>{briefError}</Notice>}
      {brief && (
        <div className="mw-brief-result">
          <strong>{brief.headline}</strong>
          <ul>
            {(brief.bullets || []).map((item, idx) => <li key={idx}>{item}</li>)}
          </ul>
          {brief.recalled?.length > 0 && (
            <div className="mw-brief-recalled">
              <span>Recalled:</span>
              {brief.recalled.map(m => (
                <a key={m.day} href={`/journal?day=${encodeURIComponent(m.day)}`} title={m.preview || m.day}>
                  {m.day}{m.mindset ? ` · ${m.mindset}` : ''}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
  </section>;
}

function RoutineChecklist({state, onEdit, onSave, status, habits = false, disabled = false}) {
  const heading = habits ? 'daily-habits' : 'prep-checklist';
  const name = habits ? 'habit' : 'checklist item';
  const [editing, setEditing] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const items = state.items;
  const checked = items.filter(({id}) => state.checklist.includes(id)).length;
  const ready = items.length > 0 && checked === items.length;
  function toggleCheck(id, selected) {
    const next = selected ? [...state.checklist, id] : state.checklist.filter(value => value !== id);
    setCelebrate(selected && checked === items.length - 1);
    onSave({...state, checklist: next});
  }
  function addStarterHabit(label) {
    const id = crypto.randomUUID().replaceAll('-', '');
    onSave({...state, items: [...items, {id, label}]});
  }
  const valid = items.every(({label}) => label.trim());
  function remove(id) {
    setCelebrate(false);
    onEdit({items: items.filter(item => item.id !== id), checklist: state.checklist.filter(value => value !== id)});
  }
  return <section className={`wp-panel mw-card mw-checklist-card${ready ? ' is-ready' : ''}`} aria-labelledby={heading}>
    <div className="mw-card-title">
      <h2 id={heading}>{habits ? 'Daily Habit Tracker' : 'Pre-Session Checklist'}</h2>
      <span className={`lab-val-chip ${ready ? 'is-pos' : ''}`}>{checked} / {items.length}</span>
    </div>
    <PrepProgress checked={checked} total={items.length} label={habits ? 'Habit progress' : undefined}
      accessibleLabel={habits ? 'Daily habit progress' : undefined}/>
    <div className="mw-checklist">
      {items.map(({id, label}, index) => editing ? <div className="mw-check-edit" key={id}>
        <input aria-label={`${habits ? 'Habit' : 'Checklist item'} ${index + 1}`} maxLength={120} required value={label}
          onChange={e => onEdit({items: items.map(item => item.id === id ? {...item, label: e.target.value} : item)})}/>
        <Button type="button" aria-label={`Remove ${name} ${index + 1}`} onClick={() => remove(id)}>Remove</Button>
      </div> : <label key={id} className={state.checklist.includes(id) ? 'is-checked' : ''}>
        <input type="checkbox" disabled={disabled} checked={state.checklist.includes(id)} onChange={e => toggleCheck(id, e.target.checked)}/>
        <strong>{label}</strong>
      </label>)}
    </div>
    <div className="mw-checklist-tools">
      {editing && <Button type="button" disabled={items.length >= (habits ? 40 : 200)} onClick={() => onEdit({items: [...items, {id: crypto.randomUUID().replaceAll('-', ''), label: ''}]})}>{habits ? 'Add habit' : 'Add checklist item'}</Button>}
      <Button type="button" aria-expanded={editing} disabled={disabled || (editing && !valid)} onClick={() => {
        setCelebrate(false);
        if (editing) onSave(state);
        setEditing(!editing);
      }}>{editing ? 'Done editing' : habits ? 'Edit habits' : 'Edit checklist'}</Button>
    </div>
    {!editing && !items.length && <>
      <p>{habits ? 'Add the habits you want to repeat each day.' : 'Add the checks you want to repeat before each session.'}</p>
      {habits && (
        <div className="mw-starter-habits" aria-label="Suggested starter habits">
          {STARTER_HABITS.map(label => (
            <button key={label} type="button" disabled={disabled} onClick={() => addStarterHabit(label)}>
              <Plus size={13} aria-hidden="true"/> {label}
            </button>
          ))}
        </div>
      )}
    </>}
    {editing && !valid && <p>Give each new item a name before saving.</p>}
    <div role="status">
      {ready && !editing && <div className={`mw-check-finish${celebrate ? ' is-celebrating' : ''}`}>
        <span className="mw-check-finish-icon" aria-hidden="true"><Check size={17} strokeWidth={2.5}/></span>
        <strong>{habits ? 'All habits complete' : 'Session Ready'}</strong>
      </div>}
    </div>
    <div className="mw-check-save" role="status">
      {status === 'saving' && (habits ? 'Saving habits…' : 'Saving checklist…')}
      {status === 'saved' && (habits ? 'Habits saved' : 'Checklist saved')}
      {status === 'failed' && !editing && !habits && <>Checklist could not be saved. <Button onClick={() => onSave(state)}>Retry</Button></>}
    </div>
  </section>;
}

function HabitTracker() {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [newDay, setNewDay] = useState(false);

  async function load(signal) {
    setError('');
    try {
      setState(await api('/mindset/habits', {signal}));
      setNewDay(false);
      setStatus('');
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(failure.message);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  async function save(next) {
    setState(next);
    setError('');
    setStatus('saving');
    try {
      setState(await api('/mindset/habits', {method: 'PUT', body: next}));
      setStatus('saved');
      window.dispatchEvent(new Event('primus:habits-saved'));
    } catch (failure) {
      setStatus('failed');
      setNewDay(failure.status === 409);
      setError(failure.message);
    }
  }

  return <div>
    {state && <RoutineChecklist key={state.day} habits state={state} status={status} disabled={status === 'saving' || newDay}
      onSave={save} onEdit={changes => setState(current => ({...current, ...changes}))}/>}
    {!state && !error && <p role="status">Loading daily habits…</p>}
    {error && <Notice error>{error} <Button onClick={() => !state || newDay ? load() : save(state)}>{newDay ? 'Load today’s habits' : 'Retry'}</Button></Notice>}
  </div>;
}

function PrivateWarmUp({pinnedGoal, voiceCloudEnabled}) {
  const [state, setState] = useState(null);
  const [highScore, setHighScore] = useState(null);
  const [mirror, setMirror] = useState(null);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [launch, setLaunch] = useState(null);
  const [checkpoint, setCheckpoint] = useState(null);
  const [soundMode, setSoundMode] = useState('off');
  const soundscape = useRef(null);
  const reader = useRef(null);
  const writer = useRef(null);
  const queuedPrep = useRef(null);
  const leaderboard = useRef(null);

  useEffect(() => {
    soundscape.current = new FocusSoundscape();
    return () => { soundscape.current?.stop(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api('/mindset/mirror', {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) setMirror(data); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function changeSoundMode(next) {
    if (next === 'off') {
      soundscape.current?.stop();
      setSoundMode('off');
    } else {
      const ok = soundscape.current?.start(next);
      setSoundMode(ok ? next : 'off');
    }
  }

  async function loadScore(current) {
    leaderboard.current?.abort();
    setHighScore(null);
    if (!current.team_eligible) return;
    const abort = new AbortController();
    leaderboard.current = abort;
    try {
      const value = await api('/mindset/high-score', {signal: abort.signal});
      if (!abort.signal.aborted && value.day === current.day) setHighScore(value);
    } catch {
      if (!abort.signal.aborted) setHighScore({failed: true});
    }
  }

  async function load() {
    reader.current?.abort();
    writer.current?.abort();
    writer.current = null;
    queuedPrep.current = null;
    setState(null); setLaunch(null); setCheckpoint(null); setError(''); setSaveStatus('');
    const abort = new AbortController();
    reader.current = abort;
    try {
      const value = await api('/mindset/warmup', {signal: abort.signal});
      if (!abort.signal.aborted) {setState(value); loadScore(value);}
    } catch (e) {
      if (!abort.signal.aborted) setError(e.message);
    }
  }

  useEffect(() => {
    load();
    return () => {reader.current?.abort(); writer.current?.abort(); leaderboard.current?.abort();};
  }, []);

  useEffect(() => {
    if (!state?.resets_at) return;
    const reset = Date.parse(state.resets_at);
    const timer = window.setTimeout(load, Math.max(0, reset - Date.now()) + 250);
    const check = () => {if (!document.hidden && Date.now() >= reset) load();};
    document.addEventListener('visibilitychange', check);
    return () => {window.clearTimeout(timer); document.removeEventListener('visibilitychange', check);};
  }, [state?.resets_at]);

  async function save(next) {
    setState(next);
    queuedPrep.current = next;
    if (writer.current) return;
    const request = new AbortController();
    writer.current = request;
    setSaveStatus('saving');
    try {
      while (queuedPrep.current && !request.signal.aborted) {
        const {day, energy, headspace, checklist, items} = queuedPrep.current;
        queuedPrep.current = null;
        try {
          await api('/mindset/warmup', {method: 'PUT', body: {day, energy, headspace, checklist, items}, signal: request.signal});
          if (!request.signal.aborted && !queuedPrep.current) {
            setSaveStatus('saved');
            window.dispatchEvent(new Event('primus:prep-saved'));
          }
        } catch {
          if (!request.signal.aborted && !queuedPrep.current) setSaveStatus('failed');
        }
      }
    } finally {
      if (writer.current === request) writer.current = null;
    }
  }

  return <>
    <aside className="sl-page-dock" aria-label="Mindset quick views">
      <button type="button" className="sl-dock-btn is-active" aria-label="Morning Desk"
        onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
        <Home size={18} strokeWidth={1.75} aria-hidden="true"/>
        <span className="sl-dock-tip" aria-hidden="true">Morning Desk</span>
      </button>
      <button type="button" className="sl-dock-btn" aria-label="Open Warm-Up Drills" disabled={!state}
        onClick={() => {setTiltResetOpen(false); setOpenStep(0);}}>
        <Play size={18} strokeWidth={1.75} aria-hidden="true"/>
        <span className="sl-dock-tip" aria-hidden="true">Warm-Up &amp; Drills</span>
      </button>
      <button type="button" className="sl-dock-btn" aria-label="Jump to Brief and Habits"
        onClick={() => document.getElementById('mw-brief-title')?.scrollIntoView({behavior: 'smooth'})}>
        <CheckSquare size={18} strokeWidth={1.75} aria-hidden="true"/>
        <span className="sl-dock-tip" aria-hidden="true">Brief &amp; Habits</span>
      </button>
      <button type="button" className="sl-dock-btn" aria-label="Jump to Vision and Brain"
        onClick={() => document.getElementById('mw-anchor-section')?.scrollIntoView({behavior: 'smooth'})}>
        <Brain size={18} strokeWidth={1.75} aria-hidden="true"/>
        <span className="sl-dock-tip" aria-hidden="true">Anchor &amp; Brain</span>
      </button>
      <button type="button" className="sl-dock-btn" aria-label="Quick 60s Tilt Reset" disabled={!state}
        onClick={() => {setOpenStep(null); setTiltResetOpen(true);}}>
        <Wind size={18} strokeWidth={1.75} aria-hidden="true"/>
        <span className="sl-dock-tip" aria-hidden="true">60s Tilt Reset</span>
      </button>
    </aside>

    <StudioHeader
      state={state}
      checkpoint={checkpoint}
      onStart={step => setLaunch({step: step ?? checkpoint?.step ?? 0, checkpoint: step == null ? checkpoint : null})}
      onTiltReset={() => setLaunch({tiltReset: true, step: 0})}
      soundMode={soundMode}
      onSoundMode={changeSoundMode}
      checkIn={state && <ReadinessStrip key={state.day} state={state} onChange={save} status={saveStatus}/>}
    >
      {state && <RoutineChecklist key={state.day} state={state} status={saveStatus} onSave={save}
        onEdit={changes => setState(current => ({...current, ...changes}))}/>}
    </WarmUpHero>
    {state && <>
      <div className="mw-prep-grid">
        <CompoundEdge/>
        <div className="mw-insights"><PrepPerformance/><MorningBrief voiceCloudEnabled={voiceCloudEnabled}/></div>
      </div>
      <HabitTracker/>
    </>}
    {!state && !error && <p role="status">Loading morning prep…</p>}
    {error && <Notice error>{error}{!state && <Button onClick={load}>Retry morning prep</Button>}</Notice>}
    {launch && state && <Suspense fallback={<p role="status">Opening warm-up…</p>}>
      <MindsetWarmUp
        key={launch.tiltReset ? 'tilt-reset' : `step-${launch.step}`}
        initialStep={launch.step}
        checkpoint={launch.checkpoint}
        onCheckpoint={setCheckpoint}
        highScore={state.team_eligible ? highScore : null}
        tiltReset={launch.tiltReset}
        pinnedGoal={pinnedGoal}
        day={state.day}
        savedAffirmation={state.affirmation}
        onClose={() => setLaunch(null)}
        onScore={() => loadScore(state)}
        onComplete={value => {
          setState(current => ({...current, completed: value.completed, affirmation: value.affirmation ?? current.affirmation}));
          setLaunch(null);
          setCheckpoint(null);
          window.dispatchEvent(new Event('primus:prep-saved'));
        }}
      />
    </Suspense>}
  </>;
}

export default function MindsetPage() {
  const {identity, error, reload} = useIdentity();
  const [goalSelection, setGoalSelection] = useState(null);
  const pinnedGoal = goalSelection?.identity === identity ? goalSelection.goal : null;
  return <WorkspacePage active="mindset" title="Mindset" hideHeading className="mw-page">
    {identity?.authenticated
      ? <PrivateWarmUp pinnedGoal={pinnedGoal} voiceCloudEnabled={Boolean(identity.voice_journal_enabled)}/>
      : <WarmUpHero/>
    {error && <Notice error>{error}<Button onClick={reload}>Retry sign-in check</Button></Notice>}
    {!identity && !error && <p role="status">Checking your private workspace…</p>}
    <div id="mw-anchor-section" className="mw-board-grid">
      {identity?.authenticated
        ? <VisionBoard imagesEnabled={identity.images_enabled} onPinnedChange={goal => setGoalSelection({identity, goal})}/>
        : identity && <SignInPanel identity={identity} path="/mindset" reload={reload} title="Sign in for your morning prep and vision board"/>}
      <ResourceLibrary section="mindset" identity={identity}/>
    </div>
    <div id="mw-brain-section">
      <Suspense fallback={<p role="status">Opening Brain Explorer…</p>}><BrainExplorer/></Suspense>
    </div>
  </WorkspacePage>;
}
