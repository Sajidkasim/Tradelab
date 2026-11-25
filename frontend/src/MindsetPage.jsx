import React, {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {
  AlertTriangle, ArrowUpRight, Check, Headphones, Mic, MicOff,
  Play, Plus, ShieldAlert, Sparkles, Wind,
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
import {PrimusTopoField} from './components/PrimusAtmosphere';
import './mindset-warmup.css';

const BrainExplorer = lazy(() => import('./BrainExplorer'));
const MindsetWarmUp = lazy(() => import('./MindsetWarmUp'));
const PREVIEW_STEPS = [
  {name: 'Breathwork', time: '2 min', text: 'Choose a rhythm and follow the breath.'},
  {name: 'Focus Games', time: '1 min', text: 'Recall a pattern or spot a matching symbol.'},
  {name: 'Affirmation', time: 'At your pace', text: 'Settle on the rule you’ll take into the session.'},
];
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

function WarmUpHero({state, highScore, onStart, onTiltReset, soundMode, onSoundMode}) {
  const [preview, setPreview] = useState(0);
  const step = PREVIEW_STEPS[preview];
  return <section className="mw-hero" aria-labelledby="warm-up-title">
    <PrimusTopoField variant="card"/>
    <div className="mw-hero-content">
      <h1 id="warm-up-title"><span>Pre-Market</span>{' '}<span>Warm-Up</span></h1>
      <p>Take about five minutes to reset, sharpen your focus and choose a rule for the session.</p>
      {state && (
        <div className="mw-hero-cta">
          <Button type="button" variant="primary" onClick={() => onStart(0)}>
            <Play size={15} aria-hidden="true"/> {state.completed ? 'Run Warm-Up again' : 'Start Warm-Up'}
          </Button>
          <Button type="button" onClick={onTiltReset}>
            <Wind size={15} aria-hidden="true"/> 60s Tilt Reset
          </Button>
          <a className="mw-journal-link" href="/journal">
            Open Today’s Journal <ArrowUpRight size={14} aria-hidden="true"/>
          </a>
        </div>
      )}
      {state?.affirmation && (
        <div className="mw-session-rule">
          <span>Today’s rule</span>
          <strong>“{state.affirmation}”</strong>
        </div>
      )}
      <div className="mw-hero-status">
        <span className="mw-pill"><strong>Today's High Score</strong><span>{state?.team_eligible
          ? highScore?.leader ? `${highScore.leader.score} / ${highScore.leader.max_score} · ${highScore.leader.name}`
            : highScore?.failed ? 'Unavailable' : highScore ? 'No scores yet' : 'Loading…'
          : 'Bullpen team only'}</span></span>
        {state?.completed && <span className="mw-pill mw-complete">Warm-Up Complete</span>}
        <div className="mw-audio-bar" role="group" aria-label="Focus soundscape">
          <Headphones size={14} aria-hidden="true"/>
          {[
            ['off', 'Audio off'],
            ['brown', 'Brown noise'],
            ['binaural', 'Focus hum'],
          ].map(([mode, label]) => (
            <button key={mode} type="button" aria-pressed={soundMode === mode} onClick={() => onSoundMode(mode)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
    <div className="mw-hero-preview">
      <div className="mw-preview-options" role="group" aria-label="Open a warm-up step">
        {PREVIEW_STEPS.map(({name}, index) => <button key={name} type="button" aria-pressed={index === preview}
          disabled={!state} aria-haspopup="dialog" onClick={() => {setPreview(index); onStart(index);}}>{name}</button>)}
      </div>
      <div key={step.name} className={`mw-preview-scene mw-preview-scene-${preview}`} aria-hidden="true">
        {preview === 0 ? [.32, .5, .7, .93, .7, .5, .32].map((height, index) => <i key={index} style={{'--preview-height': height, '--preview-delay': `${index * .12}s`}}/>)
          : preview === 1 ? Array.from({length: 16}, (_, index) => <i key={index} className={[1, 6, 8, 15].includes(index) ? 'lit' : undefined}/>)
          : <span>Wait for confirmation.</span>}
      </div>
      <div className="mw-preview-caption" aria-live="polite"><span>{step.text}</span><strong>{step.time}</strong></div>
    </div>
  </section>;
}

function ReadinessStrip({state, onChange, onTiltReset}) {
  const energy = state.energy || '';
  const headspace = state.headspace || '';
  const tilted = headspace === 'emotional' || headspace === 'distracted' || energy === 'fumes';

  return <section className={`wp-panel mw-readiness-strip ${tilted ? 'is-caution' : ''}`} aria-label="Pre-market readiness check">
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
        <ShieldAlert size={16} aria-hidden="true"/>
        <span>Elevated tilt risk — consider cutting size or running a 60s reset before NY open.</span>
        <button type="button" onClick={onTiltReset}>Run 60s Reset</button>
      </div>
    )}
  </section>;
}

function MorningBriefAndMirror({voiceCloudEnabled, state}) {
  const [note, setNote] = useState('');
  const [brief, setBrief] = useState(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [mirror, setMirror] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const speechRef = useRef(null);

  const SpeechCtor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const canCloudVoice = voiceCloudEnabled && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
  const voiceSupported = canCloudVoice || Boolean(SpeechCtor);

  useEffect(() => {
    const controller = new AbortController();
    api('/mindset/mirror', {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) setMirror(data); })
      .catch(() => {});
    return () => {
      controller.abort();
      try { recorderRef.current?.stop(); } catch {}
      try { speechRef.current?.stop(); } catch {}
    };
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

  return <div className="mw-intel-grid">
    <section className="wp-panel mw-card mw-brief-card" aria-labelledby="mw-brief-title">
      <div className="mw-card-title">
        <h2 id="mw-brief-title">Morning Primax Brief</h2>
        <span className="mw-intel-tag"><Sparkles size={13} aria-hidden="true"/> Personalised</span>
      </div>
      <p className="mw-muted-copy">Combines your recent Journal lessons, headspace ({state?.headspace || 'not set'}), and recalled sessions into a 3-point mental game plan.</p>
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
    </section>

    <section className="wp-panel mw-card mw-mirror-card" aria-labelledby="mw-mirror-title">
      <div className="mw-card-title">
        <h2 id="mw-mirror-title">Prep vs. Performance</h2>
        <span className="mw-intel-tag">Your Journal data</span>
      </div>
      {!mirror || mirror.total_journal_days === 0 ? (
        <p className="mw-muted-copy">Log a few sessions in your <a href="/journal">Daily Journal</a> alongside your morning prep to see how preparation impacts your plan adherence and P&amp;L.</p>
      ) : (
        <div className="mw-mirror-grid">
          <div className="mw-mirror-box is-good">
            <span className="mw-mirror-label">With Morning Prep</span>
            <strong>{mirror.prepped.plan_pct != null ? `${mirror.prepped.plan_pct}% on-plan` : `${mirror.prepped.days}d logged`}</strong>
            <small>
              {mirror.prepped.pnl_days > 0
                ? `${mirror.prepped.win_pct}% green · ${money(mirror.prepped.net_pnl)}`
                : `${mirror.prepped.days} prepped ${mirror.prepped.days === 1 ? 'day' : 'days'}`}
            </small>
          </div>
          <div className="mw-mirror-box">
            <span className="mw-mirror-label">Skipped Prep</span>
            <strong>{mirror.unprepped.plan_pct != null ? `${mirror.unprepped.plan_pct}% on-plan` : `${mirror.unprepped.days}d logged`}</strong>
            <small>
              {mirror.unprepped.pnl_days > 0
                ? `${mirror.unprepped.win_pct}% green · ${money(mirror.unprepped.net_pnl)}`
                : `${mirror.unprepped.days} unprepped ${mirror.unprepped.days === 1 ? 'day' : 'days'}`}
            </small>
          </div>
          <div className="mw-mirror-box">
            <span className="mw-mirror-label">Focused / Patient</span>
            <strong className={mirror.calm.net_pnl > 0 ? 'gain' : mirror.calm.net_pnl < 0 ? 'loss' : ''}>
              {mirror.calm.days > 0 ? money(mirror.calm.net_pnl) : '—'}
            </strong>
            <small>{mirror.calm.days} calm {mirror.calm.days === 1 ? 'session' : 'sessions'}</small>
          </div>
          <div className="mw-mirror-box">
            <span className="mw-mirror-label">Distracted / Frustrated</span>
            <strong className={mirror.tilted.net_pnl > 0 ? 'gain' : mirror.tilted.net_pnl < 0 ? 'loss' : ''}>
              {mirror.tilted.days > 0 ? money(mirror.tilted.net_pnl) : '—'}
            </strong>
            <small>{mirror.tilted.days} tilted {mirror.tilted.days === 1 ? 'session' : 'sessions'}</small>
          </div>
        </div>
      )}
    </section>
  </div>;
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
    <h2 id={heading}>{habits ? 'Daily Habit Tracker' : 'Pre-Session Checklist'}</h2>
    <PrepProgress checked={checked} total={items.length} label={habits ? 'Habit progress' : undefined}
      accessibleLabel={habits ? 'Daily habit progress' : undefined}/>
    <div className="mw-checklist">
      {items.map(({id, label}, index) => editing ? <div className="mw-check-edit" key={id}>
        <input aria-label={`${habits ? 'Habit' : 'Checklist item'} ${index + 1}`} maxLength={120} required value={label}
          onChange={e => onEdit({items: items.map(item => item.id === id ? {...item, label: e.target.value} : item)})}/>
        <Button type="button" aria-label={`Remove ${name} ${index + 1}`} onClick={() => remove(id)}>Remove</Button>
      </div> : <label key={id}>
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
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [openStep, setOpenStep] = useState(null);
  const [tiltResetOpen, setTiltResetOpen] = useState(false);
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
    setState(null); setOpenStep(null); setTiltResetOpen(false); setError(''); setSaveStatus('');
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
      // Send writes in order so a quick series of toggles cannot save a stale snapshot last.
      while (queuedPrep.current && !request.signal.aborted) {
        const {day, energy, headspace, checklist, items} = queuedPrep.current;
        queuedPrep.current = null;
        try {
          await api('/mindset/warmup', {method: 'PUT', body: {day, energy, headspace, checklist, items}, signal: request.signal});
          if (!request.signal.aborted && !queuedPrep.current) setSaveStatus('saved');
        } catch {
          if (!request.signal.aborted && !queuedPrep.current) setSaveStatus('failed');
        }
      }
    } finally {
      if (writer.current === request) writer.current = null;
    }
  }

  return <>
    <WarmUpHero
      state={state}
      highScore={highScore}
      onStart={step => {setTiltResetOpen(false); setOpenStep(step);}}
      onTiltReset={() => {setOpenStep(null); setTiltResetOpen(true);}}
      soundMode={soundMode}
      onSoundMode={changeSoundMode}
    />
    {state && (
      <nav className="mw-section-ribbon" aria-label="Mindset sections">
        <a href="#mw-prep-section">Checklist &amp; Aura</a>
        <a href="#mw-brief-title">Primax &amp; Mirror</a>
        <a href="#daily-habits">Daily Habits</a>
        <a href="#mw-anchor-section">Anchor &amp; Library</a>
        <a href="#mw-brain-section">3D Brain</a>
      </nav>
    )}
    {state && <ReadinessStrip state={state} onChange={save} onTiltReset={() => {setOpenStep(null); setTiltResetOpen(true);}}/>}
    {state && <div id="mw-prep-section" className="mw-prep-grid">
      <CompoundEdge/>
      <RoutineChecklist key={state.day} state={state} status={saveStatus} onSave={save}
        onEdit={changes => setState(current => ({...current, ...changes}))}/>
    </div>}
    {state && <MorningBriefAndMirror voiceCloudEnabled={voiceCloudEnabled} state={state}/>}
    <HabitTracker/>
    {!state && !error && <p role="status">Loading morning prep…</p>}
    {error && <Notice error>{error}{!state && <Button onClick={load}>Retry morning prep</Button>}</Notice>}
    {(openStep !== null || tiltResetOpen) && state && <Suspense fallback={<p role="status">Opening warm-up…</p>}>
      <MindsetWarmUp
        key={tiltResetOpen ? 'tilt-reset' : `step-${openStep}`}
        initialStep={openStep ?? 0}
        tiltReset={tiltResetOpen}
        pinnedGoal={pinnedGoal}
        day={state.day}
        savedAffirmation={state.affirmation}
        onClose={() => {setOpenStep(null); setTiltResetOpen(false);}}
        onScore={() => loadScore(state)}
        onComplete={value => {
          setState(current => ({...current, completed: value.completed, affirmation: value.affirmation ?? current.affirmation}));
          setOpenStep(null);
          setTiltResetOpen(false);
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
      : <WarmUpHero soundMode="off" onSoundMode={() => {}}/>}
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
