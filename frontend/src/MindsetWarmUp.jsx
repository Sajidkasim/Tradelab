import React, {useEffect, useRef, useState} from 'react';
import {Button, Modal, Notice, Segments} from './components';
import {api} from './api';
import AffirmationPicker, {affirmations} from './MindsetAffirmations';

const BREATH_MS = 120000;
const STEPS = ['Breathwork', 'Focus Games', 'Affirmation'];
function clock(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function useCountdown(deadline) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline == null) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(() => {
      update();
      if (Date.now() >= deadline) window.clearInterval(timer);
    }, 100);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [deadline]);
  return deadline == null ? null : Math.max(0, deadline - now);
}

const RHYTHMS = [
  {
    name: 'Reset a rushed mind (4-4-6)',
    use: 'A counted reset with a brief hold and a longer exhale. Try it when you feel rushed.',
    phases: [['Inhale', 4, .44, 1], ['Hold', 4, 1, 1], ['Exhale', 6, 1, .44]],
  },
  {
    name: 'Sharpen focus & attention (Box)',
    use: 'Four equal counts give you a steady point of focus before you execute.',
    phases: [['Inhale', 4, .44, 1], ['Hold', 4, 1, 1], ['Exhale', 4, 1, .44], ['Hold', 4, .44, .44]],
  },
  {
    name: 'Kill FOMO & lower heart rate',
    use: 'Use a longer exhale with no holds to pause when you feel the urge to chase.',
    phases: [['Inhale', 4, .44, 1], ['Exhale', 6, 1, .44]],
  },
  {
    name: 'Find your center',
    use: 'A smooth, balanced rhythm to help you stay steady during a slow market.',
    phases: [['Inhale', 5, .44, 1], ['Exhale', 5, 1, .44]],
  },
];

function Breathwork({onNext}) {
  const [rhythm, setRhythm] = useState(0);
  const [deadline, setDeadline] = useState(() => Date.now() + BREATH_MS);
  const remaining = Math.min(BREATH_MS, useCountdown(deadline) ?? BREATH_MS);
  const [paused, setPaused] = useState(null);
  const left = paused ?? remaining;
  const finished = left === 0;
  const {phases, use, name} = RHYTHMS[rhythm];
  let elapsed = ((BREATH_MS - left) / 1000) % phases.reduce((total, phase) => total + phase[1], 0);
  const active = phases.find(([, seconds]) => {
    if (elapsed < seconds) return true;
    elapsed -= seconds;
    return false;
  }) ?? phases[0];
  const [phase, seconds, from, to] = active;
  const progress = Math.min(1, elapsed / seconds);
  const ease = progress * progress * (3 - 2 * progress);
  const level = finished ? .44 : from + (to - from) * ease;
  return <section className="mw-step">
    <h3>Breathwork</h3>
    <label className="mw-rhythm">Breathing technique
      <select aria-describedby="mw-breath-purpose" value={rhythm} onChange={e => {
        setRhythm(Number(e.target.value)); setPaused(null); setDeadline(Date.now() + BREATH_MS);
      }}>{RHYTHMS.map(({name}, index) => <option key={name} value={index}>{name}</option>)}</select>
    </label>
    <div className="mw-breath-guide">
      <strong>{name}</strong>
      <p id="mw-breath-purpose">{use}</p>
      <div className="mw-breath-counts">{phases.map(([label, duration], index) =>
        <span key={index}>{label} <b>{duration}s</b></span>)}</div>
    </div>
    <div className="mw-breath-stage" style={{'--breath-level':level}}>
      <div className="mw-breath-wave" aria-hidden="true">{[.55,.7,.86,1,.86,.7,.55].map((height, index) =>
        <span key={index} style={{'--wave-height':height}} />)}</div>
      <div className="mw-breath-label">
        <strong role="status">{finished ? 'Complete' : paused != null ? 'Paused' : phase}</strong>
        <span aria-label="Breathwork time remaining">{clock(left)}</span>
      </div>
    </div>
    <div className="mw-step-actions">
      {!finished&&<Button onClick={() => {
        if (paused == null) {setPaused(left); setDeadline(null);}
        else {setDeadline(Date.now() + paused); setPaused(null);}
      }}>{paused == null ? 'Pause' : 'Resume'}</Button>}
      <Button variant="primary" onClick={onNext}>{finished ? 'Next: Focus Games' : 'Skip to Focus Games'}</Button>
    </div>
  </section>;
}

function PatternRound({round, preview, onAnswer}) {
  const [cells, setCells] = useState([]);
  const [answered, setAnswered] = useState(false);
  const {grid_size: gridSize = 4, cells: target} = round;
  function answer(value) {
    if (answered || !onAnswer(value)) return;
    setAnswered(true);
  }
  return <>
    <p role="status">{preview ? 'Memorise the highlighted tiles.' : answered ? 'Response locked.' : `Select the ${target.length} tiles you remember.`}</p>
    <div className="mw-memory" style={{'--grid-size':gridSize}} role="group" aria-label="Pattern Match grid">
      {Array.from({length:gridSize ** 2}, (_, cell) => {
        const selected = preview ? target.includes(cell) : cells.includes(cell);
        return <button type="button" key={cell} aria-label={`Tile ${cell + 1}`} aria-pressed={selected}
          disabled={preview || answered} onClick={() => setCells(list => list.includes(cell)
            ? list.filter(value => value !== cell) : list.length < target.length ? [...list, cell] : list)} />;
      })}
    </div>
    <Button variant="primary" disabled={preview || answered || cells.length !== target.length} onClick={() => answer(cells)}>Lock pattern</Button>
  </>;
}

const SEARCH_GLYPHS = {
  circle: '●', square: '■', diamond: '◆', triangle: '▲', star: '★',
  'north-east': '↗', 'south-east': '↘', 'south-west': '↙', 'north-west': '↖',
};

function SearchRound({round, onAnswer}) {
  const [selected, setSelected] = useState(null);
  const correct = selected !== null && round.symbols[selected] === round.target;
  return <>
    <p className="mw-search-target">Find <strong aria-label={round.target}>{SEARCH_GLYPHS[round.target]}</strong></p>
    <div className="mw-memory mw-search" style={{'--grid-size':round.grid_size}} role="group" aria-label="Visual Search grid">
      {round.symbols.map((symbol, index) => <button type="button" key={index}
        aria-label={`Tile ${index + 1}: ${symbol}`} disabled={selected !== null}
        aria-pressed={selected === index} data-match={selected === index ? correct : undefined}
        onClick={() => { if (onAnswer([index])) setSelected(index); }}>
        <span aria-hidden="true">{SEARCH_GLYPHS[symbol]}</span>
      </button>)}
    </div>
    <p role="status">{selected === null ? 'Tap the matching tile.' : correct ? 'Match found.' : 'Missed this one.'}</p>
  </>;
}

function FocusGames({day, onContinue, onSkip}) {
  const [mode, setMode] = useState('memory');
  const [levels, setLevels] = useState({memory:'easy', search:'easy'});
  const difficulty = levels[mode];
  const isSearch = mode === 'search';
  const gameName = isSearch ? 'Visual Search' : 'Pattern Match';
  const [attempt, setAttempt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const responses = useRef(new Map());
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const remaining = useCountdown(attempt?.deadline);
  const roundMs = 10000;
  const elapsed = attempt ? Math.min(attempt.duration * 1000, Math.max(0, attempt.duration * 1000 - (remaining ?? attempt.duration * 1000))) : 0;
  const roundIndex = Math.floor(elapsed / roundMs);
  const finished = Boolean(attempt && remaining === 0);

  async function request(path, body, success) {
    const abort = new AbortController();
    controller.current = abort;
    setError(''); setBusy(true);
    try {
      const value = await api(path, {method:'POST', body, signal:abort.signal});
      if (!abort.signal.aborted) success(value);
    } catch (e) {
      if (!abort.signal.aborted) setError(e.message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  function start() {
    request('/mindset/drill', {day, mode, difficulty}, value => {
      responses.current.clear();
      setAttempt({...value, deadline:Date.now() + value.duration * 1000});
    });
  }

  function submit() {
    request('/mindset/score', {attempt_id:attempt.attempt_id, responses:[...responses.current].map(([round, cells]) => ({round, cells}))},
      score => onContinue(attempt.attempt_id, score));
  }

  function previewScore() {
    let total = 0;
    for (const [index, cells] of responses.current) {
      const round = attempt.rounds[index];
      const correct = isSearch ? round.symbols[cells[0]] === round.target
        : round.cells.every(cell => cells.includes(cell));
      if (correct) total += 10;
    }
    return Math.max(0, total);
  }

  function answer(cells) {
    const actualElapsed = Date.now() - (attempt.deadline - attempt.duration * 1000);
    if (actualElapsed >= attempt.duration * 1000 || Math.floor(actualElapsed / roundMs) !== roundIndex || responses.current.has(roundIndex)) return false;
    responses.current.set(roundIndex, cells);
    return true;
  }

  return <section className="mw-step">
    {!attempt && <Segments label="Focus game" value={mode} disabled={busy} onChange={setMode}
      values={[{value:'memory', label:'Pattern Match'}, {value:'search', label:'Visual Search'}]}/>}
    <h3>{gameName}</h3>
    {!attempt && <>
      <label className="mw-difficulty">
        <span data-current={difficulty === 'easy'}>Easy</span>
        <input type="checkbox" role="switch" aria-label={`Hard difficulty for ${gameName}`} checked={difficulty === 'hard'}
          disabled={busy} onChange={(event) => setLevels({...levels, [mode]:event.target.checked ? 'hard' : 'easy'})}/>
        <span className="mw-difficulty-track" aria-hidden="true"/>
        <span data-current={difficulty === 'hard'}>Hard</span>
      </label>
      <p>{isSearch
        ? difficulty === 'hard' ? 'Find the exact arrow among similar directions on a 5 × 5 grid.' : 'Find the matching symbol on a 4 × 4 grid.'
        : difficulty === 'hard' ? 'Memorise five tiles on a 5 × 5 grid. The pattern fades faster.' : 'Memorise four tiles on a 4 × 4 grid, then select them from memory.'}</p>
      <Button variant="primary" busy={busy} onClick={start}>Start 60-second drill</Button>
    </>}
    {attempt&&!finished&&<>
      <div className="mw-round-meta"><span>Round {roundIndex + 1} of {attempt.rounds.length}</span><strong aria-label="Drill time remaining">{clock(remaining ?? 60000)}</strong></div>
      {isSearch
        ? <SearchRound key={roundIndex} round={attempt.rounds[roundIndex]} onAnswer={answer}/>
        : <PatternRound key={roundIndex} round={attempt.rounds[roundIndex]}
          preview={elapsed % roundMs < (difficulty === 'hard' ? 1500 : 2500)} onAnswer={answer}/>}
    </>}
    {finished&&<div className="mw-score-result">
      <strong role="status">Your score: {previewScore()} / 60</strong>
      <Button variant="primary" busy={busy} onClick={submit}>Submit Score &amp; Continue</Button>
    </div>}
    <Button disabled={busy} onClick={onSkip}>Skip to Affirmation</Button>
    {error&&<Notice error>{error}</Notice>}
  </section>;
}

export default function MindsetWarmUp({day, initialStep=0, pinnedGoal, savedAffirmation, onClose, onScore, onComplete}) {
  const [step, setStep] = useState(initialStep);
  const [attemptId, setAttemptId] = useState(null);
  const [confirmedScore, setConfirmedScore] = useState(null);
  const [affirmation, setAffirmation] = useState(affirmations.includes(savedAffirmation) ? savedAffirmation : affirmations[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function complete(selected) {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError('');
    try {
      const state = await api('/mindset/complete', {method:'POST', body:{attempt_id:attemptId, day, ...(selected === undefined ? {} : {affirmation:selected})}, signal:abort.signal});
      if (!abort.signal.aborted) onComplete(state);
    } catch (e) {
      if (!abort.signal.aborted) {setError(e.message); setBusy(false);}
    }
  }

  return <Modal title="Pre-Market Warm-Up" className="mw-modal" onClose={onClose}>
    {pinnedGoal && <aside className="mw-pinned-goal"><span>Your Anchor</span><strong>{pinnedGoal.title}</strong></aside>}
    <ol className="mw-steps" aria-label="Warm-up steps">
      {STEPS.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}>
        <span>0{index + 1}</span> {label}
      </li>)}
    </ol>
    {step === 0&&<Breathwork onNext={() => setStep(1)}/>}
    {step === 1&&<FocusGames day={day} onSkip={() => setStep(2)} onContinue={(id, score) => {setAttemptId(id); setConfirmedScore(score); setStep(2); onScore();}}/>}
    {step === 2&&<section className="mw-step mw-affirmation">
      <h3>Affirmation &amp; Lock-In</h3>
      {confirmedScore&&<p>Drill score · {confirmedScore.score} / {confirmedScore.max_score}</p>}
      <AffirmationPicker value={affirmation} onChange={setAffirmation}/>
      <div className="mw-step-actions"><Button variant="primary" busy={busy} disabled={!affirmation.trim()} onClick={() => complete(affirmation.trim())}>I'm Ready — Complete Warm-Up</Button>
        <Button disabled={busy} onClick={() => complete()}>Skip affirmation &amp; finish</Button></div>
      {error&&<Notice error>{error}</Notice>}
    </section>}
  </Modal>;
}
