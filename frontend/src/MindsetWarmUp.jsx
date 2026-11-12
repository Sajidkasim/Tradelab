import React, {useEffect, useRef, useState} from 'react';
import {Button, Modal, Notice} from './components';
import {api} from './api';
import AffirmationPicker, {affirmations} from './MindsetAffirmations';
import {decisions} from './takeOrPassScenarios';

const BREATH_MS = 120000;
const STEPS = ['Breathwork', 'Brain Sharpener', 'Affirmation'];
const MODES = [{id:'decisions', name:'Take or Pass'}, {id:'memory', name:'Pattern Match'}];
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
  {name:'4–4–6 rhythm', phases:[['Inhale',4,.44,1],['Hold',4,1,1],['Exhale',6,1,.44]]},
  {name:'Box breathing', phases:[['Inhale',4,.44,1],['Hold',4,1,1],['Exhale',4,1,.44],['Hold',4,.44,.44]]},
  {name:'Slow exhale', phases:[['Inhale',4,.44,1],['Exhale',6,1,.44]]},
  {name:'Equal breathing', phases:[['Inhale',5,.44,1],['Exhale',5,1,.44]]},
];

function Breathwork({onNext}) {
  const [rhythm, setRhythm] = useState(0);
  const [deadline, setDeadline] = useState(() => Date.now() + BREATH_MS);
  const remaining = Math.min(BREATH_MS, useCountdown(deadline) ?? BREATH_MS);
  const [paused, setPaused] = useState(null);
  const left = paused ?? remaining;
  const finished = left === 0;
  const {phases} = RHYTHMS[rhythm];
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
      <select value={rhythm} onChange={e => {
        setRhythm(Number(e.target.value)); setPaused(null); setDeadline(Date.now() + BREATH_MS);
      }}>{RHYTHMS.map(({name}, index) => <option key={name} value={index}>{name}</option>)}</select>
    </label>
    <p>{phases.map(([label, duration]) => `${label} ${duration}s`).join(' · ')}</p>
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
      <Button variant="primary" onClick={onNext}>{finished ? 'Next: Brain Warm-Up' : 'Skip to Brain Warm-Up'}</Button>
    </div>
  </section>;
}

function DecisionChart({round, visible}) {
  const ref = useRef(null);
  useEffect(() => {
    const context = ref.current?.getContext('2d');
    if (!context) return;
    const style = getComputedStyle(ref.current);
    const ink = style.color;
    const green = style.getPropertyValue('--tl-sage').trim() || '#5fa18c';
    const y = value => 158 - value * 1.64;
    context.clearRect(0, 0, 430, 185);
    context.font = '12px system-ui';
    [[round.level, 'Marked low'], [round.delivery, 'Confirm line']].forEach(([value, label], index) => {
      context.strokeStyle = ink;
      context.fillStyle = ink;
      context.globalAlpha = 0.65;
      context.setLineDash(index === 0 ? [4, 4] : [2, 4]);
      context.beginPath(); context.moveTo(14, y(value)); context.lineTo(313, y(value)); context.stroke();
      context.fillText(label, 323, y(value) + 4);
    });
    context.setLineDash([]);
    context.globalAlpha = 1;
    round.candles.slice(0, visible).forEach((bar, i) => {
      const x = 30 + i * 48;
      context.strokeStyle = context.fillStyle = bar.close >= bar.open ? green : '#b66b59';
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(x, y(bar.high)); context.lineTo(x, y(bar.low)); context.stroke();
      context.fillRect(x - 12, Math.min(y(bar.open), y(bar.close)), 24, Math.max(3, Math.abs(y(bar.close) - y(bar.open))));
      context.fillStyle = ink;
      context.fillText(String(i+1), x - 3, 174);
    });
  }, [round, visible]);
  const bars = round.candles.slice(0, visible);
  return <canvas ref={ref} width="430" height="185" role="img"
    aria-label={`Marked low ${round.level}, confirmation line ${round.delivery}. ${bars.map((bar, index) => `Candle ${index+1}: low ${bar.low}, high ${bar.high}, close ${bar.close}`).join('. ')}.`} />;
}

function TakeOrPass({onDone}) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState(null);
  const [score, setScore] = useState(0);
  const round = decisions[index];
  if (!round) return <div className="mw-score-result">
    <strong role="status">{score} / {decisions.length} decisions matched the rule</strong>
    <Button variant="primary" onClick={onDone}>Continue to Affirmation</Button>
  </div>;
  return <div className="mw-decision-practice">
    <p>Practise a long setup on a synthetic chart. Wait for a sweep, a reclaim and a close above the confirmation line. Take at confirmation, or pass if the setup fails or the entry has already gone.</p>
    <div className="mw-round-meta"><span>Scenario {index+1} of {decisions.length}</span><span>Untimed practice</span></div>
    <div className="mw-candle-frame"><DecisionChart round={round} visible={round.reveal + (answer ? 1 : 0)}/></div>
    <div className="mw-step-actions" role="group" aria-label="Your decision">
      {['Take','Wait','Pass'].map(choice => <Button key={choice} disabled={answer !== null} aria-pressed={answer === choice}
        onClick={() => {setAnswer(choice); if (choice === round.answer) setScore(value => value+1);}}>{choice}</Button>)}
    </div>
    {answer&&<div className="mw-decision-feedback" role="status">
      <strong>{answer === round.answer ? 'Matches the rule' : `Rule calls for ${round.answer}`}</strong>
      <p>{round.explanation}</p>
    </div>}
    {answer&&<Button variant="primary" onClick={() => {setIndex(index+1); setAnswer(null);}}>
      {index === decisions.length-1 ? 'See practice score' : 'Next scenario'}
    </Button>}
  </div>;
}

function DrillRound({round, preview, onAnswer}) {
  const [cells, setCells] = useState([]);
  const [answered, setAnswered] = useState(false);
  function answer(value) {
    if (answered || !onAnswer(value)) return;
    setAnswered(true);
  }
  return <>
    <p role="status">{preview ? 'Memorise the four highlighted tiles.' : answered ? 'Response locked.' : 'Select the four tiles you remember.'}</p>
    <div className="mw-memory" role="group" aria-label="Pattern Match grid">
      {Array.from({length:16}, (_, cell) => {
        const selected = preview ? round.cells.includes(cell) : cells.includes(cell);
        return <button type="button" key={cell} aria-label={`Tile ${cell + 1}`} aria-pressed={selected}
          disabled={preview || answered} onClick={() => setCells(list => list.includes(cell)
            ? list.filter(value => value !== cell) : list.length < 4 ? [...list, cell] : list)} />;
      })}
    </div>
    <Button variant="primary" disabled={preview || answered || cells.length !== 4} onClick={() => answer(cells)}>Lock pattern</Button>
  </>;
}

function BrainSharpener({day, onContinue, onSkip}) {
  const [mode, setMode] = useState('decisions');
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
    request('/mindset/drill', {day, mode:'memory'}, value => {
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
      if (round.cells.every(cell => cells.includes(cell))) total += 10;
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
    <h3>Brain Sharpener</h3>
    {!attempt&&<div className="mw-mode-buttons" role="group" aria-label="Drill mode">
      {MODES.map(item => <Button key={item.id} aria-pressed={mode === item.id} disabled={busy} onClick={() => setMode(item.id)}>{item.name}</Button>)}
    </div>}
    {mode==='decisions' ? <TakeOrPass onDone={onSkip}/> : <>
      <p>Memorise four tiles. When they clear, select the same four and lock your answer. Each exact match earns 10 points.</p>
    {!attempt&&<Button variant="primary" busy={busy} onClick={start}>Start 60-second drill</Button>}
    {attempt&&!finished&&<>
      <div className="mw-round-meta"><span>Round {roundIndex + 1} of {attempt.rounds.length}</span><strong aria-label="Drill time remaining">{clock(remaining ?? 60000)}</strong></div>
      <DrillRound key={roundIndex} round={attempt.rounds[roundIndex]} preview={elapsed % roundMs < 2500} onAnswer={answer}/>
    </>}
    {finished&&<div className="mw-score-result">
      <strong role="status">Your score: {previewScore()} / 60</strong>
      <Button variant="primary" busy={busy} onClick={submit}>Submit Score &amp; Continue</Button>
    </div>}
    </>}
    <Button disabled={busy} onClick={onSkip}>Skip to Affirmation</Button>
    {error&&<Notice error>{error}</Notice>}
  </section>;
}

export default function MindsetWarmUp({day, savedAffirmation, onClose, onScore, onComplete}) {
  const [step, setStep] = useState(0);
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
    <ol className="mw-steps" aria-label="Warm-up steps">
      {STEPS.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}>
        <span>0{index + 1}</span> {label}
      </li>)}
    </ol>
    {step === 0&&<Breathwork onNext={() => setStep(1)}/>}
    {step === 1&&<BrainSharpener day={day} onSkip={() => setStep(2)} onContinue={(id, score) => {setAttemptId(id); setConfirmedScore(score); setStep(2); onScore();}}/>}
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
