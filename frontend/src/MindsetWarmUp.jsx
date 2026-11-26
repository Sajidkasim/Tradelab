import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Flame, Pin, Radar, Volume2, VolumeX, Zap, AlertTriangle, Check, X as XIcon} from 'lucide-react';
import {Button, Modal, Notice, Segments} from './components';
import {api} from './api';
import AffirmationPicker, {affirmations} from './MindsetAffirmations';
import {playBreathCue, playDrillCue} from './mindsetAudio';
import {createRadarSimulation} from './radarPhysics';

const BREATH_MS = 120000;
const TILT_RESET_MS = 60000;
const ROUND_MS = 10000;
const STEPS = ['Breathwork', 'Focus Games', 'Affirmation'];
const GAME_META = {
  memory: {name: 'Pattern Match'},
  search: {name: 'Visual Search'},
  radar: {name: 'Neural Radar'},
};

function clock(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const [creditError, setCreditError] = useState('');
  const [creditPending, setCreditPending] = useState(false);
  const breathAttempt = useRef(null);
  const lastCuePhase = useRef('');
  useEffect(() => {
    if (tiltReset) return;
    const controller = new AbortController();
    breathAttempt.current = api('/mindset/breathwork/start', {method: 'POST', signal: controller.signal})
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
      await api('/mindset/breathwork/finish', {method: 'POST', body: {attempt}});
      onNext();
    } catch {
      setCreditError('Couldn’t record breathwork credit. You can still continue.');
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
    <div className="mw-breath-stage" style={{'--breath-level': level}}>
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
      {!finished && <Button onClick={() => {
        if (paused == null) { setPaused(left); setDeadline(null); }
        else { setDeadline(Date.now() + paused); setPaused(null); }
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

function SearchVectorGlyph({symbol}) {
  const arrowAngles = {
    'north-east': -45,
    'south-east': 45,
    'south-west': 135,
    'north-west': -135,
  };
  if (symbol in arrowAngles) {
    return (
      <svg className="mw-glyph-svg" viewBox="0 0 24 24" aria-hidden="true">
        <g transform={`rotate(${arrowAngles[symbol]} 12 12)`}>
          <line x1="5" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
          <polyline points="12.5,6.5 18.5,12 12.5,17.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
      </svg>
    );
  }
  if (symbol === 'circle') {
    return <svg className="mw-glyph-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="currentColor"/></svg>;
  }
  if (symbol === 'square') {
    return <svg className="mw-glyph-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.2" fill="currentColor"/></svg>;
  }
  if (symbol === 'diamond') {
    return <svg className="mw-glyph-svg" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,4 20,12 12,20 4,12" fill="currentColor"/></svg>;
  }
  if (symbol === 'triangle') {
    return <svg className="mw-glyph-svg" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,4.5 20,18.5 4,18.5" fill="currentColor"/></svg>;
  }
  return (
    <svg className="mw-glyph-svg" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,3.5 14.7,9 20.8,9.9 16.4,14.1 17.4,20.2 12,17.3 6.6,20.2 7.6,14.1 3.2,9.9 9.3,9" fill="currentColor"/>
    </svg>
  );
}

function PatternRound({round, preview, onAnswer, onCue}) {
  const [cells, setCells] = useState([]);
  const [answered, setAnswered] = useState(false);
  const {grid_size: gridSize = 4, cells: target} = round;
  const hit = answered && target.length === cells.length && target.every(cell => cells.includes(cell));

  function answer(value) {
    if (answered || !onAnswer(value)) return;
    setAnswered(true);
  }

  return <>
    <p role="status" className={`mw-round-prompt${answered ? (hit ? ' is-hit' : ' is-miss') : ''}`}>
      {preview
        ? 'Memorise the highlighted tiles.'
        : answered
          ? (hit ? 'Response locked — exact match (+10).' : 'Response locked.')
          : `Select the ${target.length} tiles you remember.`}
    </p>
    <div className={`mw-memory mw-memory-stage${preview ? ' is-preview' : ''}${answered ? (hit ? ' is-hit' : ' is-miss') : ''}`}
      style={{'--grid-size': gridSize}} role="group" aria-label="Pattern Match grid">
      {Array.from({length: gridSize ** 2}, (_, cell) => {
        const isTarget = target.includes(cell);
        const isChosen = cells.includes(cell);
        const selected = preview ? isTarget : isChosen;
        const outcomeState = !answered ? undefined
          : isChosen && isTarget ? 'hit'
            : isChosen && !isTarget ? 'miss'
              : !isChosen && isTarget ? 'reveal'
                : undefined;
        return <button type="button" key={cell} aria-label={`Tile ${cell + 1}`} aria-pressed={selected}
          data-outcome={outcomeState}
          disabled={preview || answered} onClick={() => {
            onCue?.('select');
            setCells(list => list.includes(cell)
              ? list.filter(value => value !== cell)
              : list.length < target.length ? [...list, cell] : list);
          }}/>;
      })}
    </div>
    <div className="mw-pattern-footer">
      {!preview && !answered && <span className="mw-pick-counter">{cells.length} / {target.length} selected</span>}
      <Button variant="primary" disabled={preview || answered || cells.length !== target.length} onClick={() => answer(cells)}>Lock pattern</Button>
    </div>
  </>;
}

function SearchRound({round, onAnswer, onCue}) {
  const [selected, setSelected] = useState(null);
  const correct = selected !== null && round.symbols[selected] === round.target;
  return <>
    <div className="mw-search-target">
      <span>Find</span>
      <strong className="mw-search-target-badge" aria-label={round.target}>
        <SearchVectorGlyph symbol={round.target}/>
      </strong>
    </div>
    <div className={`mw-memory mw-search mw-search-stage${selected !== null ? (correct ? ' is-hit' : ' is-miss') : ''}`}
      style={{'--grid-size': round.grid_size}} role="group" aria-label="Visual Search grid">
      {round.symbols.map((symbol, index) => <button type="button" key={index}
        style={{'--tile-i': index}}
        aria-label={`Tile ${index + 1}: ${symbol}`} disabled={selected !== null}
        aria-pressed={selected === index} data-match={selected === index ? correct : undefined}
        data-reveal={selected !== null && !correct && symbol === round.target ? 'true' : undefined}
        onClick={() => {
          onCue?.('select');
          if (onAnswer([index])) setSelected(index);
        }}>
        <span aria-hidden="true"><SearchVectorGlyph symbol={symbol}/></span>
      </button>)}
    </div>
    <p role="status" className={`mw-round-prompt${selected !== null ? (correct ? ' is-hit' : ' is-miss') : ''}`}>
      {selected === null ? 'Tap the matching tile.' : correct ? 'Match found.' : 'Missed this one.'}
    </p>
  </>;
}

function RadarBriefingPreview({hard}) {
  const previewOrbs = hard
    ? [
      {x: 24, y: 30, target: true}, {x: 74, y: 28, target: true},
      {x: 56, y: 68, target: true}, {x: 28, y: 74, target: true},
      {x: 48, y: 26, decoy: true}, {x: 82, y: 64}, {x: 16, y: 52}, {x: 64, y: 46},
    ]
    : [
      {x: 26, y: 32, target: true}, {x: 72, y: 34, target: true}, {x: 48, y: 72, target: true},
      {x: 22, y: 68}, {x: 78, y: 68}, {x: 50, y: 26},
    ];
  const targets = previewOrbs.filter(o => o.target);
  return (
    <div className={`mw-radar-preview${hard ? ' is-hard' : ''}`} aria-hidden="true">
      <div className="mw-radar-sweep"/>
      <svg className="mw-radar-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <circle cx="50" cy="50" r="22" className="mw-radar-ring"/>
        <circle cx="50" cy="50" r="40" className="mw-radar-ring"/>
        <line x1="50" y1="6" x2="50" y2="94" className="mw-radar-axis"/>
        <line x1="6" y1="50" x2="94" y2="50" className="mw-radar-axis"/>
        {targets.map((a, idx) => {
          const b = targets[(idx + 1) % targets.length];
          return <line key={idx} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="mw-radar-link"/>;
        })}
      </svg>
      {previewOrbs.map((orb, idx) => (
        <span key={idx}
          className={`mw-radar-preview-dot${orb.target ? ' is-target' : ''}${orb.decoy ? ' is-decoy' : ''}`}
          style={{left: `${orb.x}%`, top: `${orb.y}%`, '--orb-i': idx}}
        />
      ))}
      <div className="mw-radar-preview-specs">
        <span>{hard ? '12 orbs · 4 targets' : '8 orbs · 3 targets'}</span>
        <span>{hard ? '⚡ Speed surge + false signals' : 'Elastic collisions'}</span>
      </div>
    </div>
  );
}

function NeuralRadarRound({round, roundStartMs, elapsed, onAnswer, onCue}) {
  const lockMs = round.lock_ms ?? 2100;
  const trackMs = round.track_ms ?? 4200;
  const targetCount = round.targets.length;
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const simRef = useRef(null);
  if (!simRef.current) {
    simRef.current = createRadarSimulation(round.orbs, {
      trackMs,
      speedSurge: Boolean(round.speed_surge),
    });
  }

  const [clockNow, setClockNow] = useState(() => Date.now());
  const [selected, setSelected] = useState([]);
  const [answered, setAnswered] = useState(false);
  const firedCues = useRef(new Set());

  // Smooth 60 FPS loop during active tracking; skips continuous motion under prefers-reduced-motion
  useEffect(() => {
    setClockNow(Date.now());
    if (reduced) return undefined;
    let rafId = 0;
    const tick = () => {
      const now = Date.now();
      setClockNow(now);
      if (now - roundStartMs < lockMs + trackMs + 120) {
        rafId = window.requestAnimationFrame(tick);
      }
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [roundStartMs, lockMs, trackMs, reduced]);

  // Sync with parent 100ms timer too so fake timers (Playwright page.clock.fastForward) advance phases immediately
  const rawLocalMs = Math.max(0, Math.min(ROUND_MS, Math.max(clockNow - roundStartMs, elapsed % ROUND_MS)));
  const phase = rawLocalMs < lockMs ? 'lock' : rawLocalMs < lockMs + trackMs ? 'track' : 'acquire';
  const trackElapsed = phase === 'lock' ? 0 : Math.min(trackMs, rawLocalMs - lockMs);

  // Under reduced motion, render calm stepped snapshots during track phase instead of rapid continuous animation
  const effectiveTrackMs = reduced
    ? (phase === 'lock' ? 0 : phase === 'acquire' ? trackMs : Math.floor(trackElapsed / 900) * 900)
    : trackElapsed;

  const frame = simRef.current.sample(effectiveTrackMs);
  const activeDecoys = useMemo(() => {
    if (phase !== 'track' || !round.decoys?.length) return new Set();
    const set = new Set();
    for (const d of round.decoys) {
      if (trackElapsed >= d.at_ms && trackElapsed <= d.at_ms + 560) set.add(d.orb);
    }
    return set;
  }, [phase, round.decoys, trackElapsed]);

  // Fire subtle Web Audio cues on phase transitions & Hard decoy pulses
  useEffect(() => {
    if (!firedCues.current.has('lock')) {
      firedCues.current.add('lock');
      onCue?.('lock');
    }
  }, [onCue]);

  useEffect(() => {
    if (phase === 'acquire' && !firedCues.current.has('acquire')) {
      firedCues.current.add('acquire');
      onCue?.('phase');
    }
  }, [phase, onCue]);

  useEffect(() => {
    for (const orbIdx of activeDecoys) {
      const key = `decoy-${orbIdx}`;
      if (!firedCues.current.has(key)) {
        firedCues.current.add(key);
        onCue?.('decoy');
      }
    }
  }, [activeDecoys, onCue]);

  const hit = answered && targetCount === selected.length && round.targets.every(t => selected.includes(t));
  const revealTargets = phase === 'lock' || answered;
  const fadingLock = phase === 'track' && trackElapsed < 240;

  function toggleOrb(index) {
    if (phase !== 'acquire' || answered) return;
    onCue?.('select');
    if (selected.includes(index)) {
      setSelected(list => list.filter(item => item !== index));
      return;
    }
    const next = [...selected, index];
    setSelected(next);
    if (next.length === targetCount) {
      if (onAnswer(next)) {
        setAnswered(true);
      }
    }
  }

  const constellation = revealTargets
    ? round.targets.map((orbIdx, i) => {
      const nextOrbIdx = round.targets[(i + 1) % round.targets.length];
      return {a: frame.orbs[orbIdx], b: frame.orbs[nextOrbIdx], key: `${orbIdx}-${nextOrbIdx}`};
    })
    : [];

  const phaseLabel = phase === 'lock'
    ? 'PHASE 1 · LOCK TARGETS'
    : phase === 'track'
      ? 'PHASE 2 · TRACK IN MOTION'
      : answered
        ? (hit ? 'LOCK CONFIRMED · +10' : 'SIGNAL LOST · TARGETS REVEALED')
        : 'PHASE 3 · ACQUIRE TARGETS';

  const statusCopy = phase === 'lock'
    ? `Lock onto the ${targetCount} illuminated targets.`
    : phase === 'track'
      ? (activeDecoys.size > 0
        ? 'Ignore false signal decoy — hold your targets!'
        : frame.surging
          ? 'Speed surge active — stay locked!'
          : `Track all ${targetCount} targets through motion.`)
      : answered
        ? (hit ? 'All targets acquired (+10).' : 'Target mismatch — true targets revealed.')
        : `Select the ${targetCount} tracked targets (${selected.length} / ${targetCount}).`;

  return <div className="mw-radar-wrap">
    <div className="mw-radar-telemetry">
      <span className={`mw-radar-phase-pill is-${phase}${answered ? (hit ? ' is-hit' : ' is-miss') : ''}`}>
        <Radar size={13} aria-hidden="true"/> {phaseLabel}
      </span>
      <div className="mw-radar-alerts">
        {phase === 'track' && frame.surging && (
          <span className="mw-radar-badge is-surge"><Zap size={12} aria-hidden="true"/> SURGE</span>
        )}
        {phase === 'track' && activeDecoys.size > 0 && (
          <span className="mw-radar-badge is-decoy"><AlertTriangle size={12} aria-hidden="true"/> FALSE SIGNAL</span>
        )}
        {phase === 'acquire' && !answered && (
          <span className="mw-radar-badge is-count">{selected.length} / {targetCount}</span>
        )}
      </div>
    </div>

    <div
      className={`mw-radar-arena is-${phase}${frame.surging && phase === 'track' ? ' is-surging' : ''}${activeDecoys.size > 0 ? ' has-decoy' : ''}${answered ? (hit ? ' is-hit' : ' is-miss') : ''}`}
      role="group"
      aria-label="Neural Radar arena"
    >
      <div className="mw-radar-sweep" aria-hidden="true"/>
      <svg className="mw-radar-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <circle cx="50" cy="50" r="18" className="mw-radar-ring"/>
        <circle cx="50" cy="50" r="34" className="mw-radar-ring"/>
        <circle cx="50" cy="50" r="46" className="mw-radar-ring"/>
        <line x1="50" y1="3" x2="50" y2="97" className="mw-radar-axis"/>
        <line x1="3" y1="50" x2="97" y2="50" className="mw-radar-axis"/>

        {/* Laser constellation linking targets during lock-on & post-answer reveal */}
        {constellation.map(({a, b, key}) => (
          <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className={`mw-radar-link${answered ? (hit ? ' is-hit' : ' is-reveal') : ''}`}/>
        ))}

        {/* Tapered comet trails during motion */}
        {phase === 'track' && !reduced && frame.orbs.map((orb, idx) => {
          const pts = orb.trail;
          if (!pts || pts.length < 2) return null;
          const isDecoy = activeDecoys.has(idx);
          const color = isDecoy ? '#f59e0b' : frame.surging ? '#d8fb82' : '#7ef2a6';
          return pts.slice(1).map((pt, segIdx) => {
            const prev = pts[segIdx];
            const ratio = (segIdx + 1) / pts.length;
            const alpha = ratio * ratio * (isDecoy ? 0.8 : 0.56);
            return (
              <line
                key={`${idx}-${segIdx}`}
                x1={prev.x}
                y1={prev.y}
                x2={pt.x}
                y2={pt.y}
                stroke={color}
                strokeOpacity={alpha.toFixed(2)}
                strokeWidth={(0.65 + ratio * 1.9).toFixed(2)}
                strokeLinecap="round"
              />
            );
          });
        })}
      </svg>

      {frame.orbs.map((orb, index) => {
        const isTarget = round.targets.includes(index);
        const isSelected = selected.includes(index);
        const isDecoy = activeDecoys.has(index);
        const showAsTarget = (phase === 'lock' || fadingLock) && isTarget;
        const pickOrder = isSelected ? selected.indexOf(index) + 1 : null;
        let stateClass = '';
        if (answered) {
          if (isSelected && isTarget) stateClass = 'is-hit';
          else if (isSelected && !isTarget) stateClass = 'is-miss';
          else if (!isSelected && isTarget) stateClass = 'is-missed-target';
        } else if (showAsTarget) {
          stateClass = fadingLock ? 'is-target is-fading' : 'is-target';
        } else if (isDecoy) {
          stateClass = 'is-decoy';
        } else if (isSelected) {
          stateClass = 'is-selected';
        }

        return (
          <button
            key={index}
            type="button"
            className={`mw-radar-orb ${stateClass}${orb.collidedRecently && phase === 'track' ? ' is-bounce' : ''}`}
            style={{left: `${orb.x}%`, top: `${orb.y}%`}}
            aria-label={`Orb ${index + 1}`}
            aria-pressed={phase === 'lock' ? isTarget : isSelected}
            disabled={phase !== 'acquire' || answered}
            onClick={() => toggleOrb(index)}
          >
            <span className="mw-radar-orb-core" aria-hidden="true">
              {answered && isSelected && isTarget && <Check size={12} strokeWidth={3}/>}
              {answered && isSelected && !isTarget && <XIcon size={12} strokeWidth={3}/>}
              {!answered && pickOrder != null && pickOrder}
            </span>
            {(showAsTarget || isDecoy || stateClass === 'is-hit' || stateClass === 'is-missed-target') && (
              <span className="mw-radar-orb-pulse" aria-hidden="true"/>
            )}
          </button>
        );
      })}
    </div>

    <p role="status" className={`mw-round-prompt${answered ? (hit ? ' is-hit' : ' is-miss') : ''}`}>
      {statusCopy}
    </p>
  </div>;
}

function FocusGames({day, initialGame = 'memory', highScore, onContinue, onSkip}) {
  const [mode, setMode] = useState(initialGame in GAME_META ? initialGame : 'memory');
  const [levels, setLevels] = useState({memory: 'easy', search: 'easy', radar: 'easy'});
  const [sfxOn, setSfxOn] = useState(true);
  const difficulty = levels[mode];
  const isSearch = mode === 'search';
  const isRadar = mode === 'radar';
  const gameName = GAME_META[mode].name;
  const [attempt, setAttempt] = useState(null);
  const [outcomes, setOutcomes] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const responses = useRef(new Map());
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const remaining = useCountdown(attempt?.deadline);
  const elapsed = attempt ? Math.min(attempt.duration * 1000, Math.max(0, attempt.duration * 1000 - (remaining ?? attempt.duration * 1000))) : 0;
  const roundIndex = attempt ? Math.min(attempt.rounds.length - 1, Math.floor(elapsed / ROUND_MS)) : 0;
  const roundStartMs = attempt ? attempt.deadline - attempt.duration * 1000 + roundIndex * ROUND_MS : 0;
  const finished = Boolean(attempt && remaining === 0);

  function cue(kind) {
    if (sfxOn) playDrillCue(kind);
  }

  async function request(path, body, success) {
    const abort = new AbortController();
    controller.current = abort;
    setError(''); setBusy(true);
    try {
      const value = await api(path, {method: 'POST', body, signal: abort.signal});
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
      setOutcomes({});
      setAttempt({...value, deadline: Date.now() + value.duration * 1000});
    });
  }

  function submit() {
    request('/mindset/score', {attempt_id: attempt.attempt_id, responses: [...responses.current].map(([round, cells]) => ({round, cells}))},
      score => onContinue(attempt.attempt_id, score));
  }

  function evaluateRound(round, cells) {
    if (isSearch) return round.symbols[cells[0]] === round.target;
    if (isRadar) return round.targets.length === cells.length && round.targets.every(target => cells.includes(target));
    return round.cells.length === cells.length && round.cells.every(cell => cells.includes(cell));
  }

  function previewScore() {
    let total = 0;
    for (const [index, cells] of responses.current) {
      if (evaluateRound(attempt.rounds[index], cells)) total += 10;
    }
    return Math.max(0, total);
  }

  function currentStreak() {
    if (!attempt) return 0;
    let streak = 0;
    for (let i = roundIndex; i >= 0; i -= 1) {
      if (outcomes[i] === 'hit') streak += 1;
      else if (outcomes[i] === 'miss' || i < roundIndex) break;
    }
    return streak;
  }

  function bestStreak() {
    if (!attempt) return 0;
    let best = 0;
    let cur = 0;
    for (let i = 0; i < attempt.rounds.length; i += 1) {
      if (outcomes[i] === 'hit') {
        cur += 1;
        if (cur > best) best = cur;
      } else {
        cur = 0;
      }
    }
    return best;
  }

  function answer(cells) {
    const actualElapsed = Date.now() - (attempt.deadline - attempt.duration * 1000);
    if (actualElapsed >= attempt.duration * 1000 || Math.floor(actualElapsed / ROUND_MS) !== roundIndex || responses.current.has(roundIndex)) return false;
    responses.current.set(roundIndex, cells);
    const ok = evaluateRound(attempt.rounds[roundIndex], cells);
    setOutcomes(prev => ({...prev, [roundIndex]: ok ? 'hit' : 'miss'}));
    cue(ok ? 'hit' : 'miss');
    return true;
  }

  const liveScore = attempt ? previewScore() : 0;
  const streak = attempt ? currentStreak() : 0;
  const roundPct = attempt ? Math.max(0, Math.min(100, (1 - (elapsed % ROUND_MS) / ROUND_MS) * 100)) : 100;
  const currentRound = attempt?.rounds[roundIndex];

  return <section className={`mw-step mw-focus-step${isRadar ? ' is-radar-mode' : ''}`}>
    {!attempt && <Segments className="mw-focus-mode" label="Focus game" value={mode} disabled={busy} onChange={setMode} sliding="adaptive"
      values={[
        {value: 'memory', label: 'Pattern Match'},
        {value: 'search', label: 'Visual Search'},
        {value: 'radar', label: 'Neural Radar'},
      ]}/>}
    <div className="mw-game-title-row">
      <h3>{gameName}</h3>
      {!attempt && isRadar && <span className="mw-game-badge">ELITE · MOT</span>}
    </div>
    {!attempt && highScore?.leader && <p className="mw-drill-leader">
      Today’s high score <strong>{highScore.leader.score}/{highScore.leader.max_score} · {highScore.leader.name}</strong>
    </p>}
    {!attempt && <>
      <label className="mw-difficulty">
        <span data-current={difficulty === 'easy'}>Easy</span>
        <input type="checkbox" role="switch" aria-label={`Hard difficulty for ${gameName}`} checked={difficulty === 'hard'}
          disabled={busy} onChange={(event) => setLevels({...levels, [mode]: event.target.checked ? 'hard' : 'easy'})}/>
        <span className="mw-difficulty-track" aria-hidden="true"/>
        <span data-current={difficulty === 'hard'}>Hard</span>
      </label>
      <p>{isRadar
        ? difficulty === 'hard'
          ? 'Track 4 targets across 12 colliding orbs with mid-flight speed surges and false-signal decoys.'
          : 'Lock onto 3 glowing targets, track them through 8 colliding orbs, and acquire them when motion freezes.'
        : isSearch
          ? difficulty === 'hard' ? 'Find the exact arrow among similar directions on a 5 × 5 grid.' : 'Find the matching symbol on a 4 × 4 grid.'
          : difficulty === 'hard' ? 'Memorise five tiles on a 5 × 5 grid. The pattern fades faster.' : 'Memorise four tiles on a 4 × 4 grid, then select them from memory.'}</p>
      {isRadar && <RadarBriefingPreview hard={difficulty === 'hard'}/>}
      <Button variant="primary" busy={busy} onClick={start}>Start 60-second drill</Button>
    </>}
    {attempt && !finished && <>
      <div className="mw-hud">
        <div className="mw-round-meta">
          <div className="mw-hud-left">
            <span>Round {roundIndex + 1} of {attempt.rounds.length}</span>
            <div className="mw-round-pips" aria-hidden="true">
              {attempt.rounds.map((_, idx) => (
                <span key={idx} className={`mw-round-pip${idx === roundIndex ? ' is-active' : ''}${outcomes[idx] ? ` is-${outcomes[idx]}` : idx < roundIndex ? ' is-missed-empty' : ''}`}/>
              ))}
            </div>
          </div>
          <div className="mw-hud-right">
            <span className="mw-hud-score">{liveScore} pts</span>
            {streak >= 2 && <span className="mw-hud-streak"><Flame size={12} aria-hidden="true"/> {streak}×</span>}
            <button type="button" className={`mw-hud-sfx${sfxOn ? ' is-on' : ''}`} aria-label="Toggle drill sound" aria-pressed={sfxOn}
              onClick={() => setSfxOn(v => !v)}>
              {sfxOn ? <Volume2 size={14}/> : <VolumeX size={14}/>}
            </button>
            <strong aria-label="Drill time remaining">{clock(remaining ?? 60000)}</strong>
          </div>
        </div>
        <div className="mw-round-energy" aria-hidden="true">
          <span key={roundIndex} className="mw-round-energy-fill" style={{width: `${roundPct}%`}}/>
        </div>
      </div>

      {isRadar
        ? <NeuralRadarRound key={roundIndex} round={currentRound} roundStartMs={roundStartMs} elapsed={elapsed} onAnswer={answer} onCue={cue}/>
        : isSearch
          ? <SearchRound key={roundIndex} round={currentRound} onAnswer={answer} onCue={cue}/>
          : <PatternRound key={roundIndex} round={currentRound}
            preview={elapsed % ROUND_MS < (difficulty === 'hard' ? 1500 : 2500)} onAnswer={answer} onCue={cue}/>}
    </>}
    {finished && <div className="mw-score-result">
      <div className="mw-score-ring" style={{'--score-pct': `${Math.round((liveScore / 60) * 100)}%`}} aria-hidden="true">
        <span>{liveScore}</span>
        <small>/ 60</small>
      </div>
      <strong role="status">Your score: {liveScore} / 60</strong>
      <div className="mw-score-breakdown" aria-hidden="true">
        {attempt.rounds.map((_, idx) => (
          <span key={idx} className={`mw-score-chip${outcomes[idx] === 'hit' ? ' is-hit' : ' is-miss'}`}>
            R{idx + 1} {outcomes[idx] === 'hit' ? '✓' : '×'}
          </span>
        ))}
        {bestStreak() >= 2 && <span className="mw-score-chip is-streak"><Flame size={11}/> {bestStreak()}× streak</span>}
      </div>
      <Button variant="primary" busy={busy} onClick={submit}>Submit Score &amp; Continue</Button>
    </div>}
    <Button disabled={busy} onClick={onSkip}>Skip to Affirmation</Button>
    {error && <Notice error>{error}</Notice>}
  </section>;
}

export default function MindsetWarmUp({
  day, initialStep = 0, initialGame = 'memory', tiltReset = false, pinnedGoal, savedAffirmation, highScore,
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
      const state = await api('/mindset/complete', {method: 'POST', body: {attempt_id: attemptId, day, ...(selected === undefined ? {} : {affirmation: selected})}, signal: abort.signal});
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
    {!tiltReset && <ol className="mw-steps" aria-label="Warm-up steps" style={{'--mw-step': step}}>
      {STEPS.map((label, index) => <li key={label} data-past={index < step} aria-current={index === step ? 'step' : undefined}>
        {label}
      </li>)}
    </ol>}
    {!tiltReset && pinnedGoal && <aside className="mw-pinned-goal">
      <Pin size={15} aria-hidden="true"/><span>Your Anchor</span><strong>{pinnedGoal.title}</strong>
    </aside>}
    {step === 0 && <Breathwork tiltReset={tiltReset} onClose={close} onNext={() => setStep(1)}/>}
    {step === 1 && <FocusGames day={day} initialGame={initialGame} highScore={highScore} onSkip={() => setStep(2)} onContinue={(id, score) => { setAttemptId(id); setConfirmedScore(score); setStep(2); onScore(); }}/>}
    {step === 2 && <section className="mw-step mw-affirmation">
      <h3>Affirmation &amp; Lock-In</h3>
      {confirmedScore && <p>Drill score · {confirmedScore.score} / {confirmedScore.max_score}</p>}
      <AffirmationPicker value={affirmation} onChange={setAffirmation}/>
      <div className="mw-step-actions"><Button variant="primary" busy={busy} disabled={!affirmation.trim()} onClick={() => complete(affirmation.trim())}>I'm Ready — Complete Warm-Up</Button>
        <Button disabled={busy} onClick={() => complete()}>Skip affirmation &amp; finish</Button></div>
      {error && <Notice error>{error}</Notice>}
    </section>}
  </Modal>;
}
