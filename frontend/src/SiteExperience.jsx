import React, { lazy, Suspense, createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, ArrowRight, BookOpen, Brain, Compass, FlaskConical,
  NotebookPen, Menu as MenuIcon, X, ChevronDown, Moon, Sun, Search,
} from 'lucide-react';
import compass from '../../assets/primus-compass.png';
import LearningTrail from './LearningTrail';
import WorkspaceResume from './WorkspaceResume';
import PrimusSignIn from './PrimusSignIn';
import MatrixLoading from './MatrixLoading';
import CommandPalette from './CommandPalette';
import { api, setCsrf } from './api';
import PrimusCompass from './components/PrimusCompass';
import { PrimusTopoField, PrimusLightSeam, PrimusSunbeams, PrimusMonolith } from './components/PrimusAtmosphere';
import './site-preview.css';
import './workspace-pages.css';
import {useIdentity} from './WorkspacePages';
import {useBullpen} from './hooks/usePresence';

export const localSitePreview = () => document.querySelector('meta[name="primus-site-preview"]')?.content === 'true';
export const sitePreview = () => localSitePreview() || document.querySelector('meta[name="primus-site-enabled"]')?.content === 'true';

const JournalPage = lazy(() => import('./JournalPage'));
const MatrixPage = lazy(() => import('./MatrixPage'));
const LearnPage = lazy(() => import('./LearnPage'));
const MindsetPage = lazy(() => import('./MindsetPage'));
const BacktestingPage = lazy(() => import('./BacktestingPage'));

const SiteThemeContext = createContext(null);

const MOBILE_DOCK_ITEMS = [
  { id: 'journal', label: 'Journal', href: '/journal', icon: NotebookPen },
  { id: 'matrix', label: 'Matrix', href: '/matrix', icon: Compass },
  { id: 'lab', label: 'Lab', href: '/lab', icon: FlaskConical },
  { id: 'mindset', label: 'Mindset', href: '/mindset', icon: Brain },
  { id: 'learn', label: 'Learn', href: '/learn', icon: BookOpen },
];

export function PrimusHeader({ active = 'home', actions, theme, onThemeToggle }) {
  const [open, setOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const bullpen = useBullpen();
  const siteTheme = useContext(SiteThemeContext);
  const currentTheme = theme || siteTheme?.theme;
  const toggleTheme = onThemeToggle || siteTheme?.toggle;
  const themeControl = toggleTheme && (
    <button className="pt-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode`}>
      {currentTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
  const cmdButton = (
    <button type="button" className="pt-cmd-trigger" onClick={() => setCmdOpen(true)} aria-label="Quick navigation">
      <Search size={13} aria-hidden="true" />
      <span>Jump</span>
      <kbd>⌘K</kbd>
    </button>
  );
  const [member, setMember] = useState(null);
  useEffect(() => {
    if (actions) return;
    let mounted = true;
    api('/session').then((value) => { if (mounted) { setMember(value); setCsrf(value.csrf); } }).catch(() => {});
    return () => { mounted = false; };
  }, [Boolean(actions)]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function signOut() {
    try { await api('/logout', { method: 'POST' }); location.assign('/'); }
    catch { location.assign('/lab'); }
  }

  const replayEnabled = Boolean(localSitePreview() || document.querySelector('meta[name="primus-replay-enabled"]'));
  const showMobileDock = active !== 'home' && active !== 'backtesting';

  return <>
    <header className={`pt-header ${actions ? 'has-tools' : ''}`}>
      <a className="pt-wordmark" href="/" aria-label="PrimusTrader home"><PrimusCompass size={26} /><span>PRIMUS<span>TRADER</span></span></a>
      <button className="pt-mobile-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <MenuIcon />}</button>
      <nav onClick={(event) => { if (event.target.closest('a')) setOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); event.currentTarget.previousElementSibling?.focus(); } }} className={open ? 'is-open' : ''} aria-label="Primus navigation">
        <a className="pt-nav-primary" href="/journal" aria-current={active === 'journal' ? 'page' : undefined}>Journal</a>
        <a className="pt-nav-primary" href="/lab" aria-current={active === 'lab' ? 'page' : undefined}>Strategy Lab</a>
        <hr className="pt-mobile-nav-divider" />
        <a href="/mindset" aria-current={active === 'mindset' ? 'page' : undefined}>Mindset</a>
        {replayEnabled && <a href="/backtesting" aria-current={active === 'backtesting' ? 'page' : undefined}>Backtesting</a>}
        <a href="/learn" aria-current={active === 'learn' ? 'page' : undefined}>
          Learn {Boolean(bullpen?.people.length) && <span className="bullpen-live"><span className="primus-live-dot" aria-hidden="true" /> LIVE · {bullpen.people.length}</span>}
        </a>
        <a href="/matrix" aria-current={active === 'matrix' ? 'page' : undefined}>The Matrix</a>
        {member?.can_lock && <button className="pt-mobile-workspace" onClick={signOut}>Sign out</button>}
      </nav>
      {actions ? (
        <div className="pt-header-tools">{cmdButton}{themeControl}{actions}</div>
      ) : (
        <div className="pt-header-controls">
          {cmdButton}
          {themeControl}
          {member && !member.authenticated && <a className="pt-header-action" href="/signin">Sign in <ArrowUpRight size={14} /></a>}
          {member?.can_lock && <button className="pt-header-signout" onClick={signOut}>Sign out</button>}
        </div>
      )}
    </header>
    <LearningTrail />
    {showMobileDock && (
      <nav className="primus-mobile-dock" aria-label="Mobile workspace bar">
        {MOBILE_DOCK_ITEMS.map(({ id, label, href, icon: Icon }) => (
          <a key={id} href={href} aria-current={active === id ? 'page' : undefined}>
            <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    )}
    <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} theme={currentTheme} onToggleTheme={toggleTheme} />
  </>;
}

const traders = [
  { firstName: 'Sajid', name: 'Sajid Kasim', initials: 'SK', shape: 'ovoid', role: 'Strategy', summary: 'Defines setup rules and confirmation triggers.' },
  { firstName: 'Safwaan', name: 'Safwaan Alad', initials: 'SA', shape: 'bevel', role: 'Macro', summary: 'Tracks macro releases and market positioning.' },
  { firstName: 'Mubeen', name: 'Mubeen Patel', initials: 'MP', shape: 'sphere', role: 'Data', summary: 'Tests sample follow-through and expectancy.' },
  { firstName: 'Mustafa', name: 'Mustafa Dal', initials: 'MD', shape: 'pillar', role: 'Price Action', summary: 'Reads sweeps, absorption wicks, and entry candles.' },
  { firstName: 'Amir', name: 'Amir Patel', initials: 'AP', shape: 'lens', role: 'Risk', summary: 'Sets invalidation, sizing, and stop discipline.' },
];

function BacktestingSeamPreview() {
  return (
    <div className="pt-replay-preview" aria-hidden="true">
      <span className="pt-replay-plate-top" />
      <span className="pt-replay-plate-bottom" />
      <span className="pt-replay-seam-core" />
      <div className="pt-replay-head">
        <span>NQ1! · 1M REPLAY</span>
        <b>1× BAR-BY-BAR</b>
      </div>
      <svg className="pt-replay-wave" viewBox="0 0 320 76" fill="none">
        {[18, 38, 58].map((y) => (
          <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#b6d1b6" strokeOpacity="0.09" />
        ))}
        {[14, 30, 46, 62, 78, 94, 110, 126, 142, 158, 174, 190, 206, 222, 238, 254, 270, 286, 302].map((x, i) => {
          const y = 46 - Math.sin(i * 0.55) * 14 - i * 0.7;
          const up = i % 3 !== 1;
          return (
            <g key={x} stroke={up ? '#c8f169' : '#6f8b7d'} fill={up ? '#c8f169' : '#172922'}>
              <line x1={x} y1={y - 9} x2={x} y2={y + 16} strokeWidth="1" />
              <rect x={x - 3} y={y} width="6" height="10" rx="1" />
            </g>
          );
        })}
        <g className="pt-replay-cursor">
          <line x1="126" y1="4" x2="126" y2="72" stroke="#c8f169" strokeWidth="1.2" strokeDasharray="2 3" />
          <circle cx="126" cy="38" r="8" stroke="#c8f169" strokeOpacity="0.45" fill="rgba(200,241,105,0.12)" />
          <circle cx="126" cy="38" r="2.8" fill="#c8f169" />
        </g>
      </svg>
      <div className="pt-replay-foot">
        <span>NQ · ES · XAU · FX · QQQ</span>
        <span>DETERMINISTIC</span>
      </div>
    </div>
  );
}

function MarketDrawing(){
  return <svg viewBox="0 0 630 350" role="img" aria-label="Illustrative price-action study, not live market data">
    <defs><linearGradient id="pt-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#c8f169" stopOpacity=".2"/><stop offset="1" stopColor="#c8f169" stopOpacity="0"/></linearGradient></defs>
    {[60,120,180,240,300].map(y=><path key={y} d={`M0 ${y}H630`} stroke="currentColor" opacity=".09"/>)}
    {[60,150,240,330,420,510,600].map(x=><path key={x} d={`M${x} 0V350`} stroke="currentColor" opacity=".06"/>)}
    <path d="M0 275L35 265 65 285 95 236 125 243 155 210 185 225 215 175 245 190 275 158 305 173 335 150 365 164 395 112 425 128 455 86 485 103 515 67 545 82 575 48 605 58 630 20V350H0Z" fill="url(#pt-area)"/>
    {Array.from({length:24},(_,i)=>{const x=18+i*25;const y=265-i*9+Math.sin(i*1.8)*23;const up=i%3!==1;return <g className="pt-preview-candle" style={{'--candle-step':`${i*22}ms`}} key={i} stroke={up?'#c8f169':'#789385'} fill={up?'#c8f169':'#183127'}><path d={`M${x} ${y-15}V${y+35}`}/><rect x={x-4} y={y} width="8" height="20"/></g>})}
    <path className="pt-preview-trace" pathLength="1" d="M0 275L35 265 65 285 95 236 125 243 155 210 185 225 215 175 245 190 275 158 305 173 335 150 365 164 395 112 425 128 455 86 485 103 515 67 545 82 575 48 605 58 630 20" fill="none" stroke="#c8f169" strokeWidth="2"/>
    <circle className="pt-preview-signal" cx="395" cy="112" r="12" stroke="#c8f169" fill="none"/>
    <path d="M0 192H630" stroke="#d6dfc9" strokeDasharray="4 6" opacity=".4"/>
    <text x="16" y="183" fill="#b9c3b9" fontSize="10" fontFamily="monospace">KEY LEVEL / OBSERVE THE REACTION</text>
  </svg>;
}

function HeroStudy({ windowRef }){
  const [deskTab, setDeskTab] = useState('study');
  return (
    <div className="pt-hero-3d-stage">
      <div ref={windowRef} className="pt-portal-window" aria-label="Interactive preview of the PrimusTrader desk">
        <div className="pt-portal-bar">
          <div className="pt-portal-tabs" role="tablist" aria-label="Desk preview views">
            {[
              ['study', 'Setup Study'],
              ['matrix', 'The Matrix'],
              ['journal', 'Daily Journal'],
            ].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={deskTab === id} onClick={() => setDeskTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <span className="pt-portal-pill"><span className="primus-live-dot" aria-hidden="true" /> PRIMUS DESK</span>
        </div>

        {deskTab === 'study' && (
          <div className="pt-portal-body" key="study">
            <div className="pt-study-heading">
              <img src={compass} alt="" />
              <div><span>THE PRIMUS APPROACH</span><strong>Find the reaction.</strong></div>
              <span className="pt-study-number">STUDY / 001</span>
            </div>
            <svg className="pt-study-chart" viewBox="0 0 630 310" role="img" aria-label="Illustrative candles approach a key level, then move higher after confirmation">
              <defs><linearGradient id="pt-study-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#c8f169" stopOpacity=".22" /><stop offset="1" stopColor="#c8f169" stopOpacity="0" /></linearGradient></defs>
              {[48, 108, 168, 228, 288].map((y) => <path key={y} d={`M20 ${y}H610`} stroke="#adc8ad" strokeOpacity=".1" />)}
              {[80, 180, 280, 380, 480, 580].map((x) => <path key={x} d={`M${x} 24V294`} stroke="#adc8ad" strokeOpacity=".06" />)}
              <rect x="20" y="198" width="590" height="32" fill="#c8f169" fillOpacity=".07" />
              <path d="M20 214H610" stroke="#c8f169" strokeOpacity=".5" strokeDasharray="3 7" />
              <text x="33" y="252" fill="#adc0ad" fontSize="10" letterSpacing="2">01 / KEY LEVEL</text>
              <path className="pt-study-area" d="M35 95L75 82 115 120 155 109 195 154 235 168 275 208 315 193 355 160 395 172 435 130 475 114 515 135 555 82 595 56V294H35Z" fill="url(#pt-study-fill)" />
              {[95, 82, 120, 109, 154, 168, 208, 193, 160, 172, 130, 114, 135, 82, 56].map((y, i) => {
                const x = 35 + i * 40;
                const prev = [95, 82, 120, 109, 154, 168, 208, 193, 160, 172, 130, 114, 135, 82, 56][i - 1];
                const up = i > 0 && y < prev;
                return <g className="pt-study-candle" key={i} style={{ '--candle-delay': `${i * 55}ms` }} stroke={up ? '#c8f169' : '#79998a'} fill={up ? '#c8f169' : '#19382b'}><path d={`M${x} ${y - 15}V${y + 22}`} /><rect x={x - 5} y={y - 6} width="10" height="18" /></g>;
              })}
              <path className="pt-study-trace" d="M35 95L75 82 115 120 155 109 195 154 235 168 275 208 315 193 355 160 395 172 435 130 475 114 515 135 555 82 595 56" fill="none" stroke="#c8f169" strokeOpacity=".55" strokeWidth="1.6" pathLength="1" />
              <g className="pt-study-callout"><circle cx="275" cy="212" r="22" fill="none" stroke="#c8f169" strokeOpacity=".28" /><circle cx="275" cy="212" r="4" fill="#c8f169" /><path d="M294 194L326 148H396" fill="none" stroke="#c8f169" strokeOpacity=".6" /><rect x="319" y="110" width="150" height="38" rx="4" fill="#c8f169" /><text x="333" y="134" fill="#101513" fontSize="11" fontWeight="600" letterSpacing="1">02 / THE REACTION</text></g>
              <g className="pt-study-end"><circle cx="595" cy="56" r="10" fill="#c8f169" fillOpacity=".16" /><circle cx="595" cy="56" r="3.5" fill="#c8f169" /></g>
            </svg>
            <div className="pt-study-process"><span><b>01</b> Observe the level</span><span><b>02</b> Record the setup</span><span><b>03</b> Test the idea</span></div>
            <div className="pt-study-caption"><span>A little structure. A clearer perspective.</span><span>ILLUSTRATION · NOT LIVE</span></div>
          </div>
        )}

        {deskTab === 'matrix' && (
          <div className="pt-portal-body" key="matrix">
            <div className="pt-portal-kpis">
              <div className="pt-portal-kpi"><span>SIZING GATE</span><strong>STANDARD</strong><small>VIX regime calm</small></div>
              <div className="pt-portal-kpi"><span>NQ BIAS</span><strong>79 / 100</strong><small>6 weighted pillars</small></div>
              <div className="pt-portal-kpi"><span>IMPLIED MOVE</span><strong>±234 pts</strong><small>1σ NY range</small></div>
            </div>
            <div className="pt-portal-rows">
              {[
                ['NQ', 'Nasdaq-100 Futures', 'Strong Bullish', '79/100', false],
                ['ES', 'S&P 500 Futures', 'Bullish', '71/100', false],
                ['XAU', 'COMEX Gold', 'Bullish', '67/100', false],
                ['DXY', 'US Dollar Index', 'Strong Bearish', '25/100', true],
              ].map(([sym, name, bias, score, neg]) => (
                <div key={sym} className="pt-portal-row">
                  <strong>{sym}</strong>
                  <em>{name}</em>
                  <span className={`pt-portal-tag ${neg ? 'is-neg' : ''}`}>{bias}</span>
                  <strong>{score}</strong>
                </div>
              ))}
            </div>
            <div className="pt-study-caption"><span>Pre-market risk, COT positioning &amp; US catalysts.</span><a href="/matrix" style={{ color: '#c8f169' }}>OPEN THE MATRIX ↗</a></div>
          </div>
        )}

        {deskTab === 'journal' && (
          <div className="pt-portal-body" key="journal">
            <div className="pt-portal-kpis">
              <div className="pt-portal-kpi"><span>MULTI-ACCOUNT</span><strong>Eval + Funded</strong><small>Copy-trade splits</small></div>
              <div className="pt-portal-kpi"><span>CHART VISION</span><strong>Instant OCR</strong><small>Auto-reads TV charts</small></div>
              <div className="pt-portal-kpi"><span>VOICE + PRIMAX</span><strong>Debrief</strong><small>Synced to Strategy Lab</small></div>
            </div>
            <div className="pt-portal-note">
              “Waited for the 9:30 sweep below London low. VIX stayed calm and Mag 7 aligned — held full target without moving stops early.”
              <footer><span>NQ1! · NY Open Sweep + MSS</span><b>Plan → Trade → Reflect</b></footer>
            </div>
            <div className="pt-study-caption"><span>Private day-by-day execution log &amp; Prop Firm ROI ledger.</span><a href="/journal" style={{ color: '#c8f169' }}>OPEN JOURNAL ↗</a></div>
          </div>
        )}
      </div>
    </div>
  );
}

function HomePage(){
  const bullpen = useBullpen();
  const heroRef = useRef(null);
  const heroWindowRef = useRef(null);
  useEffect(()=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('pt-revealed');observer.unobserve(entry.target)}}),{threshold:.12});
    document.querySelectorAll('.pt-site .pt-section-heading,.pt-site .pt-trader,.pt-site .pt-tool').forEach(el=>observer.observe(el));
    return()=>observer.disconnect();
  },[]);
  const [clock,setClock]=useState(new Date());
  useEffect(()=>{
    document.title='PrimusTrader — Study. Trade. Reflect.';
    const timer=setInterval(()=>setClock(new Date()),1000);
    return()=>clearInterval(timer);
  },[]);

  function handleHeroMove(event) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width;
    const y = (event.clientY - r.top) / r.height;
    el.style.setProperty('--hero-mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--hero-my', `${(y * 100).toFixed(1)}%`);
    if (heroWindowRef.current && window.innerWidth >= 900) {
      const rx = (0.5 - y) * 5;
      const ry = (x - 0.5) * 6.5;
      heroWindowRef.current.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    }
  }
  function handleHeroLeave() {
    if (heroWindowRef.current) heroWindowRef.current.style.transform = 'rotateX(0deg) rotateY(0deg)';
  }
  function handleCardMove(event) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const card = event.currentTarget;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--card-mx', `${(((event.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    card.style.setProperty('--card-my', `${(((event.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  }
  const livePeople = new Set(bullpen?.people || []);

  return <div className="pt-site">
    <PrimusHeader/>
    <main>
      <section ref={heroRef} className="pt-hero pt-wrap" onMouseMove={handleHeroMove} onMouseLeave={handleHeroLeave}>
        <PrimusTopoField variant="hero" />
        <div className="pt-hero-spotlight" aria-hidden="true" />
        <div className="pt-hero-copy">
          <h1>Less noise.<br/>More <em>perspective.</em></h1>
          <p>A home for traders who study the market, question their process and learn from the trades behind them.</p>
          <div className="pt-hero-actions"><a className="pt-btn pt-btn-lime" href="/journal">Open your Journal <ArrowUpRight size={19}/></a></div>
          <a className="pt-meet-link" href="#traders"><span className="pt-avatar-stack">{traders.slice(0,4).map(t=><span key={t.initials}>{t.initials}</span>)}</span><span>Meet the minds behind Primus <ArrowDownSmall/></span></a>
        </div>
        <div className="pt-hero-study">
          <HeroStudy windowRef={heroWindowRef}/>
          <a className="pt-btn pt-study-cta" href="/lab">Open Strategy Lab <ArrowUpRight size={18}/></a>
        </div>
      </section>
      <PrimusLightSeam />
      <div className="pt-clock-strip"><div className="pt-wrap"><span>LONDON <b>{clock.toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</b></span><span>NEW YORK <b>{clock.toLocaleTimeString('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</b></span><a href="/matrix?tab=briefing">Market news &amp; calendar <ArrowUpRight size={13}/></a></div></div>
      <WorkspaceResume/>
      <div className="pt-atmosphere-band">
        <PrimusSunbeams />
        <section className="pt-wrap pt-section pt-section-traders" id="traders">
          <div className="pt-section-heading"><div><h2>Five minds.<br/><em>One direction.</em></h2></div><p>Different perspectives, one shared desk — and a process that stays your own.</p></div>
          <div className="pt-traders">
            {traders.map((t) => (
              <article key={t.name} className="pt-trader" onMouseMove={handleCardMove}>
                {livePeople.has(t.firstName) && (
                  <span className="pt-trader-live">
                    <span className="primus-live-dot" aria-hidden="true" /> On the floor
                  </span>
                )}
                <PrimusMonolith shape={t.shape} initials={t.initials} />
                <h3>{t.name}</h3>
                <span className="pt-role">{t.role}</span>
                <p>{t.summary}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
      <section className="pt-tools-section"><div className="pt-wrap pt-section">
        <div className="pt-section-heading"><div><span className="pt-overline">YOUR WORKSPACE</span><h2>A place for the data.<br/>And the <em>decisions.</em></h2></div><p>The Lab asks what works. The Journal gives you room to understand what happened. Backtesting lets you practise the setup in replay.</p></div>
        <div className="pt-tools">
          <a className="pt-tool pt-tool-journal" href="/journal"><div className="pt-tool-top"><NotebookPen size={24}/><span>THE DAILY PRACTICE</span><ArrowUpRight/></div><h3>Your trades have<br/>a story. <em>Keep it.</em></h3><p>Plan your session. Add your screenshots. Write down the lesson while it’s still fresh.</p><div className="pt-paper-preview"><span>SESSION NOTES / A PREVIEW</span><strong>What did the market teach you?</strong><div className="pt-paper-line"><span aria-hidden="true">Wait for the level. Then the reaction.</span></div><div className="pt-paper-rule"/><span className="pt-paper-tag">Plan → Trade → Reflect <NotebookPen size={12}/></span></div><span className="pt-tool-bottom">Open Journal <ArrowRight size={18}/></span></a>
          <a className="pt-tool pt-tool-lab" href="/lab"><PrimusTopoField variant="card" /><div className="pt-tool-top"><FlaskConical size={24}/><span>THE RESEARCH PROCESS</span><ArrowUpRight/></div><h3>An idea is a start.<br/><em>Test the setup.</em></h3><p>Explore strategies, levels and confirmations. Let your own recorded results shape the questions.</p><div className="pt-lab-preview"><span>STRATEGY → LEVEL → CONFIRMATION</span><MarketDrawing/><div className="pt-preview-tags" aria-hidden="true"><span>Key level</span><span>Confirmation</span><span>Review</span></div></div><span className="pt-tool-bottom">Enter Strategy Lab <ArrowRight size={18}/></span></a>
          <a className="pt-tool pt-tool-backtesting" href="/backtesting"><div className="pt-tool-top"><PrimusCompass size={24}/><span>FREE BACKTESTING</span><ArrowUpRight/></div><h3>Replay the market.<br/><em>Practise your edge.</em></h3><p>Multi-chart historical replay across futures, FX, gold, and QQQ — with deterministic fills and Lab export.</p><BacktestingSeamPreview /><span className="pt-tool-bottom">Start backtesting <ArrowRight size={18}/></span></a>
        </div>
      </div></section>
      <section className="pt-closing"><PrimusSunbeams /><div className="pt-closing-emblem" aria-hidden="true"><PrimusCompass size={46} interactive/></div><span className="pt-overline">A PROCESS WORTH RETURNING TO.</span><h2>Study. Trade.<br/><em>Reflect. Repeat.</em></h2><a className="pt-btn pt-btn-lime" href="/journal">Make room for the next lesson <ArrowUpRight size={18}/></a></section>
    </main>
    <footer className="pt-footer pt-wrap"><a className="pt-wordmark" href="/"><PrimusCompass size={23}/><span>PRIMUS<span>TRADER</span></span></a><p>Independent trading research. Personal tools. Shared curiosity.</p><a href="/privacy">Privacy</a><span>© {clock.getFullYear()} PrimusTrader</span></footer>
    {localSitePreview()&&<div className="pt-preview-label">LOCAL CONCEPT PREVIEW · NOT PUBLISHED</div>}
  </div>;
}
function ArrowDownSmall(){return <ChevronDown size={13}/>}

export default function SiteExperience({ pathname = location.pathname } = {}){
  const [theme,setTheme]=useState(()=>localStorage.getItem('primus-theme')==='dark'?'dark':'light');
  useEffect(()=>{document.documentElement.dataset.theme=theme;delete document.documentElement.dataset.appearance;localStorage.setItem('primus-theme',theme)},[theme]);
  return <SiteThemeContext.Provider value={{theme,toggle:()=>setTheme(value=>value==='dark'?'light':'dark')}}>{pathname==='/signin'?<PrimusSignIn/>:['/learn','/mindset','/matrix'].includes(pathname)?<Suspense fallback={pathname==='/matrix'?<MatrixLoading/>:<div className="loading-screen">Opening your workspace…</div>}>{pathname==='/learn'?<LearnPage/>:pathname==='/matrix'?<MatrixPage theme={theme}/>:<MindsetPage/>}</Suspense>:pathname==='/backtesting'?<Suspense fallback={<div className="loading-screen">Loading chart…</div>}><BacktestingPage theme={theme} onThemeToggle={()=>setTheme(value=>value==='dark'?'light':'dark')}/></Suspense>:pathname.startsWith('/journal')?<Suspense fallback={<div className="loading-screen">Opening your Journal…</div>}><JournalPage theme={theme}/></Suspense>:<HomePage/>}</SiteThemeContext.Provider>;
}
