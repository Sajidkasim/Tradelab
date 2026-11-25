import React, { useState } from 'react';
import { ArrowUpRight, Check, Layers, PlayCircle, RotateCcw } from 'lucide-react';
import { PrimusMonolith, PrimusTopoField } from './PrimusAtmosphere';

export const DESK_MEMBERS = [
  {
    id: 'sajid',
    firstName: 'Sajid',
    name: 'Sajid Kasim',
    initials: 'SK',
    shape: 'ovoid',
    role: 'Strategy',
    summary: 'Defines setup rules and confirmation triggers.',
    question: 'What had to happen before the setup was valid?',
    note: 'London low needed to be swept and reclaimed with a 1m displacement close above 21,405. Before that break, there is no trade — only a level.',
    metrics: [
      ['Setup', 'NY Sweep + 1m MSS'],
      ['Trigger', 'Close > 21,405'],
    ],
    ctaLabel: 'Review setup in Lab',
    ctaHref: '/lab',
    verdict: 'Liquidity swept and reclaimed with 1m displacement',
  },
  {
    id: 'safwaan',
    firstName: 'Safwaan',
    name: 'Safwaan Alad',
    initials: 'SA',
    shape: 'bevel',
    role: 'Macro',
    summary: 'Tracks macro releases and market positioning.',
    question: 'Which release set the session backdrop?',
    note: '08:30 US data printed inline and VIX stayed calm under 16. With DXY soft and no Tier-1 shock ahead, the sizing gate stayed on Standard.',
    metrics: [
      ['Catalyst', '08:30 Inline · VIX Calm'],
      ['Sizing Gate', 'Standard'],
    ],
    ctaLabel: 'Open The Matrix',
    ctaHref: '/matrix',
    verdict: 'Macro backdrop calm — Standard sizing gate open',
  },
  {
    id: 'mubeen',
    firstName: 'Mubeen',
    name: 'Mubeen Patel',
    initials: 'MP',
    shape: 'sphere',
    role: 'Data',
    summary: 'Tests sample follow-through and expectancy.',
    question: 'How often did comparable sessions follow through?',
    note: 'Across 42 logged NY-open London-low sweeps in calm volatility, holding for the overnight high delivered positive expectancy when entries waited for the retest.',
    metrics: [
      ['Sample', '42 Logged Sweeps'],
      ['Expectancy', '64% Win · 2.1R Avg'],
    ],
    ctaLabel: 'View Journal Performance',
    ctaHref: '/journal?view=performance',
    verdict: 'Historical sample supports holding to overnight high',
  },
  {
    id: 'mustafa',
    firstName: 'Mustafa',
    name: 'Mustafa Dal',
    initials: 'MD',
    shape: 'pillar',
    role: 'Price Action',
    summary: 'Reads sweeps, absorption wicks, and entry candles.',
    question: 'Which candle changed the read on the tape?',
    note: 'Bar 10 swept stops below 21,390 and snapped straight back with a long lower wick — sellers trapped. The quiet retest into the 1m FVG was the clean entry.',
    metrics: [
      ['Signal', 'Trap Wick @ 21,386'],
      ['Entry', '1m FVG Retest'],
    ],
    ctaLabel: 'Open Backtesting Replay',
    ctaHref: '/backtesting',
    verdict: 'Trap wick absorbed stops; FVG retest offered clean fill',
  },
  {
    id: 'amir',
    firstName: 'Amir',
    name: 'Amir Patel',
    initials: 'AP',
    shape: 'lens',
    role: 'Risk',
    summary: 'Sets invalidation, sizing, and stop discipline.',
    question: 'Where is the trade idea clearly invalidated?',
    note: 'Stop sits fixed below the sweep low at 21,384 (1R). No widening stops if it stalls mid-range, and no moving to break-even before structure clears 21,455.',
    metrics: [
      ['Invalidation', '21,384 (Fixed 1R)'],
      ['Target', '21,540 (+2.4R)'],
    ],
    ctaLabel: 'Open Mindset & Risk',
    ctaHref: '/mindset',
    verdict: 'Fixed invalidation at 21,384 — zero stop micromanagement',
  },
];

// Deterministic NQ NY-open illustration bars: [openY, closeY, highY, lowY] in SVG coords (lower Y = higher price)
const CANDLES = [
  [124, 134, 116, 142], // 0: 08:30 macro catalyst
  [134, 128, 122, 140], // 1
  [128, 142, 124, 150], // 2
  [142, 136, 130, 148], // 3
  [136, 154, 132, 162], // 4
  [154, 166, 148, 174], // 5
  [166, 158, 152, 174], // 6
  [158, 178, 154, 186], // 7
  [178, 198, 174, 206], // 8: 09:30 drive into London low
  [198, 214, 194, 238], // 9: sweep + absorption trap wick (Decision pause point!)
  [214, 174, 168, 220], // 10: 1m displacement break (MSS)
  [174, 186, 170, 194], // 11: FVG pullback entry
  [186, 156, 150, 190], // 12
  [156, 164, 148, 170], // 13: mid-range pause
  [164, 124, 118, 168], // 14
  [124, 102, 94, 130],  // 15
  [102, 74, 66, 108],   // 16: overnight high tag
];

const DECISION_INDEX = 9;

const CHALLENGE_FEEDBACK = {
  wait: {
    verdict: 'Sharp read — patience wins here.',
    detail: 'Waiting one more bar for the 1m displacement close above 21,405 confirmed trapped sellers and turned a guess into a defined-risk FVG entry.',
  },
  long: {
    verdict: 'Right direction — early on timing.',
    detail: 'Buying the first wick catches the bottom on lucky days, but waiting for displacement (Bar 11) avoids getting run over when sweeps keep trending.',
  },
  pass: {
    verdict: 'Disciplined pass — never a bad habit.',
    detail: 'Passing until you see clean confirmation protects capital. When the 1m displacement prints right after, you can always re-evaluate with clear invalidation.',
  },
};

export default function DeskPerspectives({ livePeople = [] }) {
  const [selectedId, setSelectedId] = useState('sajid');
  const [stackAll, setStackAll] = useState(false);
  const [challengeMode, setChallengeMode] = useState(false);
  const [userCall, setUserCall] = useState(null);

  const liveSet = new Set(livePeople || []);
  const active = DESK_MEMBERS.find((m) => m.id === selectedId) || DESK_MEMBERS[0];

  const showLens = (id) => !challengeMode && (stackAll || selectedId === id);
  const hideFutureBars = challengeMode && !userCall;

  function pickMember(id) {
    setSelectedId(id);
    setStackAll(false);
    setChallengeMode(false);
    setUserCall(null);
  }

  function handleCardMove(event) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    const card = event.currentTarget;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--card-mx', `${(((event.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    card.style.setProperty('--card-my', `${(((event.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  }

  function toggleStackAll() {
    setChallengeMode(false);
    setUserCall(null);
    setStackAll((v) => !v);
  }

  function toggleChallenge() {
    setStackAll(false);
    setUserCall(null);
    setChallengeMode((v) => !v);
  }

  return (
    <div className="pt-desk-wrap">
      <div className="pt-traders" role="tablist" aria-label="Select a Primus desk perspective">
        {DESK_MEMBERS.map((member) => {
          const isSelected = !stackAll && !challengeMode && selectedId === member.id;
          const isLive = liveSet.has(member.firstName);
          return (
            <article
              key={member.id}
              className={`pt-trader ${isSelected ? 'is-selected' : ''} ${stackAll ? 'is-stacked' : ''}`}
              onMouseMove={handleCardMove}
            >
              <button
                type="button"
                role="tab"
                className="pt-trader-btn"
                aria-selected={isSelected}
                aria-controls="pt-desk-board"
                onClick={() => pickMember(member.id)}
              >
                {isLive && (
                  <span className="pt-trader-live">
                    <span className="primus-live-dot" aria-hidden="true" /> On the floor
                  </span>
                )}
                <PrimusMonolith shape={member.shape} initials={member.initials} />
                <h3>{member.name}</h3>
                <span className="pt-role">{member.role}</span>
                <p>{member.summary}</p>
              </button>
            </article>
          );
        })}
      </div>

      <section
        id="pt-desk-board"
        className="pt-desk-board"
        aria-label="One session, five desk perspectives"
      >
        <PrimusTopoField variant="card" />

        <div className="pt-desk-bar">
          <div className="pt-desk-bar-left">
            <span className="pt-desk-pill">
              <span className="primus-live-dot" aria-hidden="true" />
              ONE SESSION · FIVE LENSES
            </span>
            <span className="pt-desk-session">NQ1! · NY OPEN · LONDON LOW SWEEP</span>
          </div>
          <div className="pt-desk-bar-actions">
            <button
              type="button"
              className="pt-desk-mode-btn"
              aria-pressed={stackAll}
              onClick={toggleStackAll}
            >
              <Layers size={13} aria-hidden="true" /> Stack all 5
            </button>
            <button
              type="button"
              className="pt-desk-mode-btn is-accent"
              aria-pressed={challengeMode}
              onClick={toggleChallenge}
            >
              <PlayCircle size={13} aria-hidden="true" /> {challengeMode ? 'Exit challenge' : 'Test your read'}
            </button>
          </div>
        </div>

        <div className="pt-desk-grid">
          {/* Shared NQ Session Chart */}
          <div className="pt-desk-chart-wrap">
            <svg
              className="pt-desk-chart"
              viewBox="0 0 680 300"
              role="img"
              aria-label="Illustrative NQ session chart showing a London low sweep, displacement, and continuation to the overnight high"
            >
              <defs>
                <linearGradient id="pt-desk-expectancy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="pt-desk-veil" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#0a0f0d" stopOpacity="0.96" />
                  <stop offset="100%" stopColor="#080c0a" stopOpacity="0.99" />
                </linearGradient>
              </defs>

              {/* Horizontal price grid */}
              {[66, 118, 170, 212, 256].map((y) => (
                <line key={y} x1="20" y1={y} x2="660" y2={y} stroke="#b6d1b6" strokeOpacity="0.08" />
              ))}

              {/* Reference Levels */}
              <line x1="20" y1="70" x2="660" y2="70" stroke="#9eb3a3" strokeOpacity="0.28" strokeDasharray="3 6" />
              <text x="26" y="62" fill="#9eb3a3" fontSize="9" fontFamily="monospace" letterSpacing="1">
                OVERNIGHT HIGH · 21,540
              </text>

              <line x1="20" y1="212" x2="660" y2="212" stroke="#c8f169" strokeOpacity="0.38" strokeDasharray="4 6" />
              <text x="26" y="204" fill="#c8f169" fillOpacity="0.82" fontSize="9" fontFamily="monospace" letterSpacing="1">
                LONDON LOW · 21,390
              </text>

              {/* LENS: Safwaan — Macro 08:30 catalyst line & calm VIX regime */}
              {showLens('safwaan') && (
                <g className="pt-lens-layer">
                  <rect x="28" y="34" width="60" height="232" fill="#34d399" fillOpacity="0.06" />
                  <line x1="58" y1="34" x2="58" y2="266" stroke="#34d399" strokeWidth="1.2" strokeDasharray="3 4" />
                  <rect x="66" y="36" width="176" height="22" rx="4" fill="#132922" stroke="#34d399" strokeOpacity="0.55" />
                  <text x="76" y="50" fill="#34d399" fontSize="9.5" fontFamily="monospace" fontWeight="600">
                    08:30 DATA · VIX &lt; 16 CALM
                  </text>
                </g>
              )}

              {/* LENS: Mubeen — Data expectancy target band */}
              {showLens('mubeen') && (
                <g className="pt-lens-layer">
                  <rect x="372" y="70" width="276" height="122" fill="url(#pt-desk-expectancy)" stroke="#34d399" strokeOpacity="0.28" strokeDasharray="3 4" rx="4" />
                  <rect x="444" y="84" width="190" height="24" rx="4" fill="#0f241d" stroke="#34d399" strokeOpacity="0.55" />
                  <text x="454" y="100" fill="#d9f5e6" fontSize="9.5" fontFamily="monospace" fontWeight="600">
                    64% FOLLOW-THROUGH · 2.1R
                  </text>
                </g>
              )}

              {/* LENS: Sajid — Strategy MSS trigger line & sweep zone */}
              {showLens('sajid') && (
                <g className="pt-lens-layer">
                  <rect x="316" y="212" width="104" height="30" fill="#c8f169" fillOpacity="0.09" rx="3" />
                  <line x1="330" y1="178" x2="540" y2="178" stroke="#c8f169" strokeWidth="1.4" />
                  <line x1="418" y1="146" x2="418" y2="178" stroke="#c8f169" strokeOpacity="0.65" strokeDasharray="2 3" />
                  <rect x="350" y="122" width="136" height="22" rx="4" fill="#c8f169" />
                  <text x="360" y="136" fill="#0f1411" fontSize="9.5" fontFamily="monospace" fontWeight="700">
                    1M MSS VALIDATED
                  </text>
                </g>
              )}

              {/* LENS: Amir — Risk invalidation line & 1R stop / target */}
              {showLens('amir') && (
                <g className="pt-lens-layer">
                  <rect x="382" y="190" width="110" height="52" fill="#fb7185" fillOpacity="0.12" />
                  <line x1="300" y1="242" x2="650" y2="242" stroke="#fb7185" strokeWidth="1.5" strokeDasharray="5 4" />
                  <rect x="448" y="248" width="178" height="22" rx="4" fill="#2c1419" stroke="#fb7185" strokeOpacity="0.65" />
                  <text x="458" y="262" fill="#fda4af" fontSize="9.5" fontFamily="monospace" fontWeight="600">
                    INVALIDATION · 21,384 (1R)
                  </text>
                </g>
              )}

              {/* Candlesticks */}
              {CANDLES.map(([o, c, h, l], i) => {
                const x = 58 + i * 36;
                const up = c < o;
                const bodyTop = Math.min(o, c);
                const bodyHeight = Math.max(4, Math.abs(c - o));
                const hidden = hideFutureBars && i > DECISION_INDEX;
                return (
                  <g
                    key={i}
                    className={`pt-desk-candle ${hidden ? 'is-veiled' : ''}`}
                    stroke={up ? '#c8f169' : '#748f82'}
                    fill={up ? '#c8f169' : '#182c24'}
                  >
                    <line x1={x} y1={h} x2={x} y2={l} strokeWidth="1.4" />
                    <rect x={x - 6} y={bodyTop} width="12" height={bodyHeight} rx="1.5" />
                  </g>
                );
              })}

              {/* LENS: Mustafa — Precision reticle on trap wick & FVG pullback */}
              {showLens('mustafa') && (
                <g className="pt-lens-layer">
                  <circle cx={58 + 9 * 36} cy="226" r="22" fill="none" stroke="#c8f169" strokeWidth="1.2" strokeOpacity="0.65" />
                  <circle cx={58 + 9 * 36} cy="226" r="3.5" fill="#c8f169" />
                  <rect x={58 + 11 * 36 - 14} y="182" width="66" height="16" fill="#c8f169" fillOpacity="0.18" stroke="#c8f169" strokeOpacity="0.6" rx="2" />
                  <text x={58 + 11 * 36 - 4} y="193" fill="#e6f9b4" fontSize="8.5" fontFamily="monospace" fontWeight="600">
                    1M FVG
                  </text>
                  <rect x="192" y="246" width="186" height="22" rx="4" fill="#15241e" stroke="#c8f169" strokeOpacity="0.55" />
                  <text x="202" y="260" fill="#c8f169" fontSize="9.5" fontFamily="monospace" fontWeight="600">
                    ABSORPTION WICK · TRAPPED
                  </text>
                </g>
              )}

              {/* Challenge mode veil hiding candles after the decision pause */}
              {hideFutureBars && (
                <g>
                  <rect x={58 + DECISION_INDEX * 36 + 18} y="24" width="320" height="252" fill="url(#pt-desk-veil)" />
                  <line
                    x1={58 + DECISION_INDEX * 36 + 18}
                    y1="24"
                    x2={58 + DECISION_INDEX * 36 + 18}
                    y2="276"
                    stroke="#c8f169"
                    strokeWidth="2"
                  />
                  <text
                    x={58 + DECISION_INDEX * 36 + 38}
                    y="148"
                    fill="#d7e4d4"
                    fontSize="11"
                    fontFamily="monospace"
                    letterSpacing="1.2"
                  >
                    PAUSED AT 09:33 NY
                  </text>
                  <text
                    x={58 + DECISION_INDEX * 36 + 38}
                    y="168"
                    fill="#94a89c"
                    fontSize="10"
                    fontFamily="Inter, sans-serif"
                  >
                    Make your call to reveal the next bars →
                  </text>
                </g>
              )}
            </svg>
            <div className="pt-desk-chart-foot">
              <span>Illustrative NQ NY-open study · Not live market data</span>
              <span>Click any member above to switch the lens</span>
            </div>
          </div>

          {/* Right Dossier: Active Member Lens, Stacked Desk View, or Challenge */}
          <div className="pt-desk-dossier" key={challengeMode ? `ch-${userCall}` : stackAll ? 'stack' : active.id}>
            {challengeMode ? (
              <div className="pt-desk-challenge">
                <span className="pt-desk-kicker">MAKE THE CALL · 09:33 NY</span>
                <h4>Price just swept London low and snapped back. What do you do?</h4>
                <div className="pt-desk-call-row" role="group" aria-label="Make your call">
                  {[
                    ['long', 'Long now'],
                    ['wait', 'Wait for break'],
                    ['pass', 'Pass'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`pt-desk-call-btn ${userCall === id ? 'is-picked' : ''}`}
                      aria-pressed={userCall === id}
                      onClick={() => setUserCall(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {userCall ? (
                  <div className="pt-desk-reveal">
                    <strong>{CHALLENGE_FEEDBACK[userCall].verdict}</strong>
                    <p>{CHALLENGE_FEEDBACK[userCall].detail}</p>
                    <div className="pt-desk-reveal-actions">
                      <button type="button" className="pt-desk-mode-btn" onClick={() => setUserCall(null)}>
                        <RotateCcw size={12} aria-hidden="true" /> Replay pause
                      </button>
                      <button type="button" className="pt-desk-mode-btn is-accent" onClick={toggleStackAll}>
                        See all 5 lenses
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="pt-desk-challenge-hint">
                    Pick a call to reveal the next 7 candles and compare your read with the desk.
                  </p>
                )}
              </div>
            ) : stackAll ? (
              <div className="pt-desk-stack">
                <span className="pt-desk-kicker">COMBINED DESK VIEW</span>
                <h4>Five minds. One aligned trade.</h4>
                <ul className="pt-desk-checklist">
                  {DESK_MEMBERS.map((m) => (
                    <li key={m.id}>
                      <Check size={14} aria-hidden="true" />
                      <div>
                        <strong>{m.firstName} · {m.role}</strong>
                        <span>{m.verdict}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <a className="pt-desk-cta" href="/backtesting">
                  Practise in Backtesting Replay <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              </div>
            ) : (
              <div className="pt-desk-single">
                <span className="pt-desk-kicker">
                  {active.name.toUpperCase()} · {active.role.toUpperCase()}
                </span>
                <h4>{active.question}</h4>
                <p>{active.note}</p>
                <div className="pt-desk-metrics">
                  {active.metrics.map(([label, val]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{val}</strong>
                    </div>
                  ))}
                </div>
                <a className="pt-desk-cta" href={active.ctaHref}>
                  {active.ctaLabel} <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
