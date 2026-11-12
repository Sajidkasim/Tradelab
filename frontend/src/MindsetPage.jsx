import React, {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {Check} from 'lucide-react';
import {WorkspacePage, useIdentity, SignInPanel} from './WorkspacePages';
import ResourceLibrary from './ResourceLibrary';
import VisionBoard from './VisionBoard';
import {Notice, Button} from './components';
import {api} from './api';
import AuraCheckIn from './AuraCheckIn';
import './mindset-warmup.css';

const BrainExplorer = lazy(() => import('./BrainExplorer'));
const MindsetWarmUp = lazy(() => import('./MindsetWarmUp'));
const PREVIEW_STEPS = [
  {name:'Breathwork', time:'2 min', text:'Choose a rhythm and follow the breath.'},
  {name:'Focus Games', time:'1 min', text:'Recall a pattern or spot a matching symbol.'},
  {name:'Affirmation', time:'At your pace', text:'Settle on the rule you’ll take into the session.'},
];
function WarmUpHero({state, highScore, onStart}) {
  const [preview, setPreview] = useState(0);
  const step = PREVIEW_STEPS[preview];
  return <section className="mw-hero" aria-labelledby="warm-up-title">
    <div className="mw-hero-content">
      <h1 id="warm-up-title"><span>Pre-Market</span>{' '}<span>Warm-Up</span></h1>
      <p>12–15 minutes to settle your nervous system, sharpen focus, and lock in your rules before the bell.</p>
      <p className="mw-timing">3 minutes guided, followed by your chart and risk checks.</p>
      <Button variant="primary" className="mw-primary" disabled={!state} onClick={onStart}>Start Pre-Market Warm-Up</Button>
      <div className="mw-hero-status">
        <span className="mw-pill"><strong>Today's High Score</strong><span>{state?.team_eligible
          ? highScore?.leader ? `${highScore.leader.score} / ${highScore.leader.max_score} · ${highScore.leader.name}`
            : highScore?.failed ? 'Unavailable' : highScore ? 'No scores yet' : 'Loading…'
          : 'Bullpen team only'}</span></span>
        {state?.completed&&<span className="mw-pill mw-complete">Warm-Up Complete</span>}
      </div>
    </div>
    <div className="mw-hero-preview">
      <div className="mw-preview-options" role="group" aria-label="Preview warm-up steps">
        {PREVIEW_STEPS.map(({name}, index) => <button key={name} type="button" aria-pressed={index === preview}
          onClick={() => setPreview(index)}>{name}</button>)}
      </div>
      <div key={step.name} className={`mw-preview-scene mw-preview-scene-${preview}`} aria-hidden="true">
        {preview===0 ? [.32,.5,.7,.93,.7,.5,.32].map((height, index) => <i key={index} style={{'--preview-height':height,'--preview-delay':`${index*.12}s`}}/>)
          : preview===1 ? Array.from({length:16}, (_, index) => <i key={index} className={[1,6,8,15].includes(index) ? 'lit' : undefined}/>)
          : <span>Wait for confirmation.</span>}
      </div>
      <div className="mw-preview-caption" aria-live="polite"><span>{step.text}</span><strong>{step.time}</strong></div>
    </div>
  </section>;
}

function MorningCards({state, onEdit, onSave, busy, dirty, saved}) {
  const [editing, setEditing] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const items = state.items;
  const checked = items.filter(({id}) => state.checklist.includes(id)).length;
  const ready = items.length > 0 && checked === items.length;
  function toggleCheck(id, selected) {
    const next = selected ? [...state.checklist, id] : state.checklist.filter(value => value !== id);
    setCelebrate(selected && checked === items.length - 1);
    onEdit('checklist', next);
  }
  const valid = items.every(({label}) => label.trim());
  function remove(id) {
    setCelebrate(false);
    onEdit('items', items.filter(item => item.id !== id));
    onEdit('checklist', state.checklist.filter(value => value !== id));
  }
  return <form className="mw-prep-form" onSubmit={onSave}>
    <div className="mw-prep-grid">
      <AuraCheckIn/>
      <section className={`wp-panel mw-card mw-checklist-card${ready ? ' is-ready' : ''}`} aria-labelledby="prep-checklist">
        <h2 id="prep-checklist">Pre-Session Checklist</h2>
        {items.length > 0&&<div className="mw-check-progress">
          <div className="mw-check-progress-label" aria-hidden="true"><span>Prep progress</span><strong>{checked} of {items.length} complete</strong></div>
          <div className="mw-check-track" role="progressbar" aria-label="Pre-session checklist progress"
            aria-valuemin={0} aria-valuenow={checked} aria-valuemax={items.length} aria-valuetext={`${checked} of ${items.length} complete`}>
            <span className="mw-check-fill" style={{'--checklist-progress':checked / items.length}}/>
          </div>
        </div>}
        <div className="mw-checklist">
          {items.map(({id, label}, index) => editing ? <div className="mw-check-edit" key={id}>
            <input aria-label={`Checklist item ${index + 1}`} maxLength={120} required value={label}
              onChange={e => onEdit('items', items.map(item => item.id === id ? {...item, label:e.target.value} : item))}/>
            <Button type="button" aria-label={`Remove checklist item ${index + 1}`} onClick={() => remove(id)}>Remove</Button>
          </div> : <label key={id}>
            <input type="checkbox" checked={state.checklist.includes(id)} onChange={e => toggleCheck(id, e.target.checked)}/>
            <strong>{label}</strong>
          </label>)}
        </div>
        <div className="mw-checklist-tools">
          {editing&&<Button type="button" disabled={items.length>=200} onClick={() => onEdit('items', [...items, {id:crypto.randomUUID().replaceAll('-',''), label:''}])}>Add checklist item</Button>}
          <Button type="button" aria-expanded={editing} onClick={() => {setCelebrate(false); setEditing(value => !value);}}>{editing ? 'Done editing' : 'Edit checklist'}</Button>
        </div>
        {!editing&&!items.length&&<p>Add the checks you want to repeat before each session.</p>}
        {editing&&!valid&&<p>Give each new item a name before saving.</p>}
        <div role="status">
          {ready&&!editing&&<div className={`mw-check-finish${celebrate ? ' is-celebrating' : ''}`}>
            <span className="mw-check-finish-icon" aria-hidden="true"><Check size={17} strokeWidth={2.5}/></span>
            <strong>Session Ready</strong>
          </div>}
        </div>
      </section>
    </div>
    <div className="mw-save-row"><Button variant="primary" type="submit" disabled={!dirty||!valid} busy={busy}>Save morning prep</Button>
      {saved&&<span role="status">Morning prep saved.</span>}</div>
  </form>;
}

function PrivateWarmUp({pinnedGoal}) {
  const [state, setState] = useState(null);
  const [highScore, setHighScore] = useState(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const reader = useRef(null);
  const writer = useRef(null);
  const leaderboard = useRef(null);

  async function loadScore(current) {
    leaderboard.current?.abort();
    setHighScore(null);
    if (!current.team_eligible) return;
    const abort = new AbortController();
    leaderboard.current = abort;
    try {
      const value = await api('/mindset/high-score', {signal:abort.signal});
      if (!abort.signal.aborted && value.day === current.day) setHighScore(value);
    } catch {
      if (!abort.signal.aborted) setHighScore({failed:true});
    }
  }

  async function load() {
    reader.current?.abort();
    writer.current?.abort();
    setState(null); setOpen(false); setBusy(false); setError(''); setSaved(false); setDirty(false);
    const abort = new AbortController();
    reader.current = abort;
    try {
      const value = await api('/mindset/warmup', {signal:abort.signal});
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

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const abort = new AbortController();
    writer.current = abort;
    setBusy(true); setError('');
    const {day, energy, headspace, checklist, items} = state;
    try {
      const value = await api('/mindset/warmup', {method:'PUT', body:{day, energy, headspace, checklist, items}, signal:abort.signal});
      if (!abort.signal.aborted) {setState(value); setDirty(false); setSaved(true);}
    } catch (e) {
      if (!abort.signal.aborted) setError(e.message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  return <>
    <WarmUpHero state={state} highScore={highScore} onStart={() => setOpen(true)}/>
    {state&&<fieldset className="mw-prep-shell" disabled={busy}>
      <MorningCards state={state} busy={busy} dirty={dirty} saved={saved} onSave={save}
        onEdit={(key, value) => {setState(current => ({...current, [key]:value})); setDirty(true); setSaved(false);}}/>
    </fieldset>}
    {!state&&!error&&<p role="status">Loading morning prep…</p>}
    {error&&<Notice error>{error}{!state&&<Button onClick={load}>Retry morning prep</Button>}</Notice>}
    {open&&state&&<Suspense fallback={<p role="status">Opening warm-up…</p>}>
      <MindsetWarmUp pinnedGoal={pinnedGoal} day={state.day} savedAffirmation={state.affirmation} onClose={() => setOpen(false)} onScore={() => loadScore(state)} onComplete={value => {
        setState(current => ({...current, completed:value.completed, affirmation:value.affirmation ?? current.affirmation}));
        setOpen(false);
      }}/>
    </Suspense>}
  </>;
}

export default function MindsetPage() {
  const {identity, error, reload} = useIdentity();
  const [goalSelection, setGoalSelection] = useState(null);
  const pinnedGoal = goalSelection?.identity === identity ? goalSelection.goal : null;
  return <WorkspacePage active="mindset" title="Mindset" hideHeading>
    {identity?.authenticated ? <PrivateWarmUp pinnedGoal={pinnedGoal}/> : <WarmUpHero/>}
    {error&&<Notice error>{error}<Button onClick={reload}>Retry sign-in check</Button></Notice>}
    {!identity&&!error&&<p role="status">Checking your private workspace…</p>}
    {identity?.authenticated ? <VisionBoard imagesEnabled={identity.images_enabled} onPinnedChange={goal => setGoalSelection({identity, goal})}/>
      : identity&&<SignInPanel identity={identity} path="/mindset" reload={reload} title="Sign in for your morning prep and vision board"/>}
    <ResourceLibrary section="mindset" identity={identity}/>
    <Suspense fallback={<p role="status">Opening Brain Explorer…</p>}><BrainExplorer/></Suspense>
  </WorkspacePage>;
}
