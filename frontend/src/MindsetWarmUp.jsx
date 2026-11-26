import React, {useEffect, useRef, useState} from 'react';
import {Pin, Volume2, VolumeX} from 'lucide-react';
import {Button, Modal, Notice, Segments} from './components';
import {api} from './api';
import AffirmationPicker, {affirmations} from './MindsetAffirmations';
import {playBreathCue} from './mindsetAudio';
import './mindset-exercise.css';

const BREATH_MS = 120000;
const TILT_RESET_MS = 60000;
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

function Breathwork({onNext, tiltReset = false, onClose}) {
  const durationMs = tiltReset ? TILT_RESET_MS : BREATH_MS;
  const [rhythm, setRhythm] = useState(tiltReset ? 2 : 0);
  const [soundOn, setSoundOn] = useState(false);
  const [creditError, setCreditError] = useState("");
  const [creditPending, setCreditPending] = useState(false);
  const breathAttempt = useRef(null);
  const lastCuePhase = useRef('');
  useEffect(() => {
    if (tiltReset) return;
    const controller = new AbortController();
    breathAttempt.current = api("/mindset/breathwork/start", { method: "POST", signal: controller.signal })
      .then((response) => response.attempt).catch(() => null);
    return () => controller.abort();
  }, [tiltReset]);
  async function proceed() {
    if (tiltReset) { onClose?.(); return; }
    if (!finished || creditError) { onNext(); return; }
    setCreditPending(true);
    try {
      const attempt = await breathAttempt.current;
      if (!attempt) throw new Error();
      await api("/mindset/breathwork/finish", { method: "POST", body: { attempt } });
      onNext();
    } catch {
      setCreditError("Couldn’t record breathwork credit. You can still continue.");
    } finally {
      setCreditPending(false);
    }
  }
  const [deadline, setDeadline] = useState(() => Date.now() + durationMs);
  const remaining = Math.min(durationMs, useCountdown(deadline) ?? durationMs);
  const [paused, setPaused] = useState(null);
  const left = paused ?? remaining;
  const finished = left === 0;
  const {phases, use} = RHYTHMS[rhythm];
  let elapsed = ((durationMs - left) / 1000) % phases.reduce((total, phase) => total + phase[1], 0);
  const active = phases.find(([, seconds]) => {
    if (elapsed < seconds) return true;
    elapsed -= seconds;
    return false;
  }) ?? phases[0];
  const [phase, seconds, from, to] = active;
  const progress = Math.min(1, elapsed / seconds);
  const ease = progress * progress * (3 - 2 * progress);
  const level = finished ? .44 : from + (to - from) * ease;
  const cuePhase = finished ? 'Complete' : paused != null ? '' : phase;

  useEffect(() => {
    if (!soundOn || !cuePhase) return;
    if (lastCuePhase.current !== cuePhase) {
      lastCuePhase.current = cuePhase;
      playBreathCue(cuePhase);
    }
  }, [soundOn, cuePhase]);

  return <section className="mw-step mw-breathwork">
    {!tiltReset && <h3>Breathwork</h3>}
    <div className="mw-breath-stage" style={{'--breath-level':level}}>
      <div className="mw-breath-ring" aria-hidden="true"/>
      <div className="mw-breath-label">
        <strong role="status">{finished ? 'Complete' : paused != null ? 'Paused' : phase}</strong>
        <span aria-label="Breathwork time remaining">{clock(left)}</span>
      </div>
      <progress aria-label="Breathwork progress" max={durationMs} value={durationMs - left}/>
    </div>
    <div className="mw-breath-toolbar">
      <label className="mw-rhythm">Breathing technique
        <select aria-describedby="mw-breath-purpose" value={rhythm} onChange={e => {
          setRhythm(Number(e.target.value)); setPaused(null); setDeadline(Date.now() + durationMs);
        }}>{RHYTHMS.map(({name}, index) => <option key={name} value={index}>{name}</option>)}</select>
      </label>
      <button type="button" className={`mw-sound-toggle ${soundOn ? 'is-on' : ''}`} aria-pressed={soundOn}
        onClick={() => {
          const next = !soundOn;
          setSoundOn(next);
          if (next) { lastCuePhase.current = cuePhase; playBreathCue(phase); }
        }}>
        {soundOn ? <Volume2 size={15}/> : <VolumeX size={15}/>}
        <span>Chimes</span>
      </button>
    </div>
    <div className="mw-breath-guide">
      <p id="mw-breath-purpose">{use}</p>
      <div className="mw-breath-counts">{phases.map((item, index) =>
        <span key={index} data-active={item === active && !finished && paused == null}>
          {item[0]} <b>{item[1]}s</b>
        </span>)}</div>
    </div>
    <div className="mw-step-actions">
      {!finished&&<Button onClick={() => {
        if (paused == null) {setPaused(left); setDeadline(null);}
        else {setDeadline(Date.now() + paused); setPaused(null);}
      }}>{paused == null ? 'Pause' : 'Resume'}</Button>}
      {tiltReset ? (
        <Button variant={finished ? 'primary' : undefined} onClick={() => onClose?.()}>
          {finished ? 'Back to Mindset' : 'Done early'}
        </Button>
      ) : (
        <Button variant={finished ? 'primary' : undefined} busy={creditPending} onClick={proceed}>{finished ? 'Next: Focus Games' : 'Skip to Focus Games'}</Button>
      )}
    </div>
    {creditError && <Notice error>{creditError}</Notice>}
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

function FocusGames({day, highScore, onContinue, onSkip}) {
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
    {!attempt && highScore?.leader && <p className="mw-drill-leader">
      Today’s high score <strong>{highScore.leader.score}/{highScore.leader.max_score} · {highScore.leader.name}</strong>
    </p>}
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

export default function MindsetWarmUp({
  day, initialStep=0, tiltReset=false, pinnedGoal, savedAffirmation, highScore,
  checkpoint, onCheckpoint, onClose, onScore, onComplete,
}) {
  const [step, setStep] = useState(tiltReset ? 0 : checkpoint?.step ?? initialStep);
  const [attemptId, setAttemptId] = useState(checkpoint?.attemptId ?? null);
  const [confirmedScore, setConfirmedScore] = useState(checkpoint?.confirmedScore ?? null);
  const [affirmation, setAffirmation] = useState(
    checkpoint?.affirmation ?? (affirmations.includes(savedAffirmation) ? savedAffirmation : affirmations[0])
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);

  function close() {
    if (!tiltReset) onCheckpoint?.({step, attemptId, confirmedScore, affirmation});
    onClose();
  }

  async function complete(selected) {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError('');
    try {
      const state = await api('/mindset/complete', {method:'POST', body:{attempt_id:attemptId, day, ...(selected === undefined ? {} : {affirmation:selected})}, signal:abort.signal});
      if (!abort.signal.aborted) onComplete(state);
    } catch (e) {
      if (!abort.signal.aborted) {
        if (attemptId && e.status === 409 && e.message.startsWith('This drill has expired.')) {
          setAttemptId(null);
          setConfirmedScore(null);
          setError('This drill has expired. You can still complete the warm-up.');
        } else {
          setError(e.message);
        }
        setBusy(false);
      }
    }
  }

  return <Modal title={tiltReset ? '60s Tilt Reset' : 'Pre-Market Warm-Up'} className="mw-modal mw-exercise" onClose={close}>
    {!tiltReset && <ol className="mw-steps" aria-label="Warm-up steps">
      {STEPS.map((label, index) => <li key={label} data-past={index < step} aria-current={index === step ? 'step' : undefined}>
        {label}
      </li>)}
    </ol>}
    {!tiltReset && pinnedGoal && <aside className="mw-pinned-goal">
      <Pin size={15} aria-hidden="true"/><span>Your Anchor</span><strong>{pinnedGoal.title}</strong>
    </aside>}
    {step === 0&&<Breathwork tiltReset={tiltReset} onClose={close} onNext={() => setStep(1)}/>}
    {step === 1&&<FocusGames day={day} highScore={highScore} onSkip={() => setStep(2)} onContinue={(id, score) => {setAttemptId(id); setConfirmedScore(score); setStep(2); onScore();}}/>}
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
