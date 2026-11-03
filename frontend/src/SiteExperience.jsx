import React, { lazy, Suspense, createContext, useContext, useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight, Compass, FlaskConical, NotebookPen, Menu as MenuIcon, X, ChevronDown, Moon, Sun } from 'lucide-react';
import compass from '../../assets/primus-compass.png';
import JournalPage from './JournalPage';
import { api, setCsrf } from './api';
import TradingViewWidget from './TradingViewWidget';
import './site-preview.css';
import './workspace-pages.css';

export const localSitePreview = () => document.querySelector('meta[name="primus-site-preview"]')?.content === 'true';
export const sitePreview = () => localSitePreview() || document.querySelector('meta[name="primus-site-enabled"]')?.content === 'true';

const LearnPage=lazy(()=>import('./LearnPage'));
const MindsetPage=lazy(()=>import('./MindsetPage'));
const MarketLabPage=lazy(()=>import('./MarketLabPage'));
const BacktestingPage = lazy(() => import('./BacktestingPage'));

const SiteThemeContext = createContext(null);

export function PrimusHeader({ active = 'home', actions, theme, onThemeToggle }) {
  const [open, setOpen] = useState(false);
  const siteTheme = useContext(SiteThemeContext);
  const currentTheme=theme||siteTheme?.theme;
  const toggleTheme=onThemeToggle||siteTheme?.toggle;
  const themeControl=toggleTheme&&<button className="pt-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${currentTheme==='dark'?'light':'dark'} mode`}>{currentTheme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button>;
  const [member,setMember]=useState(null);
  useEffect(()=>{if(actions)return;let active=true;api('/session').then(value=>{if(active){setMember(value);setCsrf(value.csrf)}}).catch(()=>{});return()=>{active=false}},[Boolean(actions)]);
  async function signOut(){try{await api('/logout',{method:'POST'});location.assign('/')}catch{location.assign('/lab')}}
  return <header className={`pt-header ${actions ? "has-tools" : ""}`}>
    <a className="pt-wordmark" href="/" aria-label="PrimusTrader home"><Compass size={29} strokeWidth={1.2}/><span>PRIMUS<span>TRADER</span></span></a>
    <button className="pt-mobile-toggle" aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<X/>:<MenuIcon/>}</button>
    <nav className={open?'is-open':''} aria-label="Primus navigation">
      <a href="/" aria-current={active==='home'?'page':undefined}>Home</a>
      <a href="/journal" aria-current={active==='journal'?'page':undefined}>Journal</a>
      <a href="/lab" aria-current={active==='lab'?'page':undefined}>Strategy Lab <ArrowUpRight size={14}/></a>
      {(localSitePreview()||document.querySelector('meta[name="primus-replay-enabled"]'))&&<a href="/backtesting" aria-current={active==='backtesting'?'page':undefined}>Backtesting (Beta)</a>}
      <a href="/learn" aria-current={active==='learn'?'page':undefined}>Learn</a>
      <a href="/market-lab" aria-current={active==='market-lab'?'page':undefined}>Market Lab</a>
      <a href="/mindset" aria-current={active==='mindset'?'page':undefined}>Mindset</a>
      {member?.can_lock&&<button className="pt-mobile-workspace" onClick={signOut}>Sign out</button>}
    </nav>
    {actions ? <div className="pt-header-tools">{themeControl}{actions}</div> : <div className="pt-header-controls">{themeControl}{member&&!member.authenticated&&<a className="pt-header-action" href="/lab">Sign in <ArrowUpRight size={15}/></a>}{member?.can_lock&&<button className="pt-header-signout" onClick={signOut}>Sign out</button>}</div>}
  </header>;
}

const traders = [
  {name:'Sajid Kasim', initials:'SK', role:'Strategy & Research', alias:'The Strategist', focus:'The idea. The setup. The evidence.'},
  {name:'Safwaan Alad', initials:'SA', role:'Macro Research', alias:'The Navigator', focus:'The bigger picture behind the move.'},
  {name:'Mubeen Patel', initials:'MP', role:'Data & Analysis', alias:'The Analyst', focus:'Turning observations into questions.'},
  {name:'Mustafa Dal', initials:'MD', role:'Price Action Research', alias:'The Tape Reader', focus:'Reading the detail in every session.'},
  {name:'Amir Patel', initials:'AP', role:'Risk & Process', alias:'The Risk Keeper', focus:'A considered process, every time.'},
];

function MarketDrawing(){
  return <svg viewBox="0 0 630 350" role="img" aria-label="Illustrative price-action study, not live market data">
    <defs><linearGradient id="pt-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#c5dca2" stopOpacity=".2"/><stop offset="1" stopColor="#c5dca2" stopOpacity="0"/></linearGradient></defs>
    {[60,120,180,240,300].map(y=><path key={y} d={`M0 ${y}H630`} stroke="currentColor" opacity=".09"/>)}
    {[60,150,240,330,420,510,600].map(x=><path key={x} d={`M${x} 0V350`} stroke="currentColor" opacity=".06"/>)}
    <path d="M0 275L35 265 65 285 95 236 125 243 155 210 185 225 215 175 245 190 275 158 305 173 335 150 365 164 395 112 425 128 455 86 485 103 515 67 545 82 575 48 605 58 630 20V350H0Z" fill="url(#pt-area)"/>
    {Array.from({length:24},(_,i)=>{const x=18+i*25;const y=265-i*9+Math.sin(i*1.8)*23;const up=i%3!==1;return <g className="pt-preview-candle" style={{'--candle-step':`${i*22}ms`}} key={i} stroke={up?'#c5dca2':'#789385'} fill={up?'#c5dca2':'#183127'}><path d={`M${x} ${y-15}V${y+35}`}/><rect x={x-4} y={y} width="8" height="20"/></g>})}
    <path className="pt-preview-trace" pathLength="1" d="M0 275L35 265 65 285 95 236 125 243 155 210 185 225 215 175 245 190 275 158 305 173 335 150 365 164 395 112 425 128 455 86 485 103 515 67 545 82 575 48 605 58 630 20" fill="none" stroke="#d3e6af" strokeWidth="2"/>
    <circle className="pt-preview-signal" cx="395" cy="112" r="12" stroke="#d3e6af" fill="none"/>
    <path d="M0 192H630" stroke="#d6dfc9" strokeDasharray="4 6" opacity=".4"/>
    <text x="16" y="183" fill="#b9c3b9" fontSize="10" fontFamily="monospace">KEY LEVEL / OBSERVE THE REACTION</text>
  </svg>;
}

function HeroStudy(){
  return <div className="pt-study" aria-label="Animated illustration of a trading setup, not live market data">
    <div className="pt-study-glow" aria-hidden="true"/>
    <div className="pt-study-heading"><img src={compass} alt=""/><div><span>THE PRIMUS APPROACH</span><strong>Find the reaction.</strong></div><span className="pt-study-number">STUDY / 001</span></div>
    <svg className="pt-study-chart" viewBox="0 0 630 350" role="img" aria-label="Illustrative candles approach a key level, then move higher after confirmation">
      <defs><linearGradient id="pt-study-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d3e6af" stopOpacity=".2"/><stop offset="1" stopColor="#d3e6af" stopOpacity="0"/></linearGradient></defs>
      {[55,120,185,250,315].map(y=><path key={y} d={`M20 ${y}H610`} stroke="#adc8ad" strokeOpacity=".1"/>)}
      {[80,180,280,380,480,580].map(x=><path key={x} d={`M${x} 30V320`} stroke="#adc8ad" strokeOpacity=".06"/>)}
      <rect x="20" y="221" width="590" height="34" fill="#d3e6af" fillOpacity=".07"/>
      <path d="M20 238H610" stroke="#d3e6af" strokeOpacity=".5" strokeDasharray="3 7"/>
      <text x="33" y="278" fill="#adc0ad" fontSize="10" letterSpacing="2">01 / KEY LEVEL</text>
      <path className="pt-study-area" d="M35 105L75 90 115 130 155 119 195 169 235 185 275 229 315 213 355 178 395 190 435 145 475 129 515 151 555 94 595 66V320H35Z" fill="url(#pt-study-fill)"/>
      {[105,90,130,119,169,185,229,213,178,190,145,129,151,94,66].map((y,i)=>{const x=35+i*40;const up=i>0&&y<[105,90,130,119,169,185,229,213,178,190,145,129,151,94,66][i-1];return <g className="pt-study-candle" key={i} style={{'--candle-delay':`${i*65}ms`}} stroke={up?'#d3e6af':'#79998a'} fill={up?'#d3e6af':'#19382b'}><path d={`M${x} ${y-16}V${y+24}`}/><rect x={x-5} y={y-6} width="10" height="20"/></g>})}
      <path className="pt-study-trace" d="M35 105L75 90 115 130 155 119 195 169 235 185 275 229 315 213 355 178 395 190 435 145 475 129 515 151 555 94 595 66" fill="none" stroke="#d3e6af" strokeOpacity=".45" strokeWidth="1.5" pathLength="1"/>
      <g className="pt-study-callout"><circle cx="275" cy="235" r="25" fill="none" stroke="#d3e6af" strokeOpacity=".25"/><circle cx="275" cy="235" r="4" fill="#d3e6af"/><path d="M295 216L327 165H398" fill="none" stroke="#d3e6af" strokeOpacity=".6"/><rect x="319" y="126" width="151" height="40" rx="3" fill="#d3e6af"/><text x="333" y="151" fill="#10231c" fontSize="11" fontWeight="600" letterSpacing="1">02 / THE REACTION</text></g>
      <g className="pt-study-end"><circle cx="595" cy="66" r="10" fill="#d3e6af" fillOpacity=".12"/><circle cx="595" cy="66" r="3.5" fill="#d3e6af"/></g>
    </svg>
    <div className="pt-study-process"><span><b>01</b> Observe the level</span><span><b>02</b> Record the setup</span><span><b>03</b> Test the idea</span></div>
    <div className="pt-study-caption"><span>A little structure. A clearer perspective.</span><span>ILLUSTRATION · NOT LIVE</span></div>
  </div>;
}

function HomePage(){
  const {theme} = useContext(SiteThemeContext);
  const [marketTab,setMarketTab]=useState('news');
  useEffect(()=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('pt-revealed');observer.unobserve(entry.target)}}),{threshold:.12});
    document.querySelectorAll('.pt-site .pt-section-heading,.pt-site .pt-trader,.pt-site .pt-tool').forEach(el=>observer.observe(el));
    return()=>observer.disconnect();
  },[]);
  const [clock,setClock]=useState(new Date());
  useEffect(()=>{document.title='PrimusTrader — Study. Trade. Reflect.';const timer=setInterval(()=>setClock(new Date()),60000);return()=>clearInterval(timer)},[]);
  return <div className="pt-site">
    <PrimusHeader/>
    <main>
      <section className="pt-hero pt-wrap">
        <div className="pt-hero-copy">
          <div className="pt-overline"><span className="pt-status-dot"/> INDEPENDENT MINDS. A SHARED PURSUIT.</div>
          <h1>Less noise.<br/>More <em>perspective.</em></h1>
          <p>A home for traders who study the market, question their process and learn from the trades behind them.</p>
          <div className="pt-hero-actions"><a className="pt-btn pt-btn-lime" href="/journal">Open your Journal <ArrowUpRight size={19}/></a><a className="pt-text-link" href="/lab">Explore the Lab <ArrowRight size={17}/></a></div>
          <a className="pt-meet-link" href="#traders"><span className="pt-avatar-stack">{traders.slice(0,4).map(t=><span key={t.initials}>{t.initials}</span>)}</span><span>Meet the minds behind Primus <ArrowDownSmall/></span></a>
        </div>
        <HeroStudy/>
      </section>
      <div className="pt-clock-strip"><div className="pt-wrap"><span>THE WORLD DOESN’T TRADE IN ONE TIME ZONE.</span><span>LONDON <b>{clock.toLocaleTimeString('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit'})}</b></span><span>NEW YORK <b>{clock.toLocaleTimeString('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'})}</b></span><a href="#briefing">Your market briefing <ChevronDown size={14}/></a></div></div>
      <section className="pt-wrap pt-section" id="traders">
        <div className="pt-section-heading"><div><span className="pt-overline">01 / THE PEOPLE</span><h2>Five minds.<br/><em>One direction.</em></h2></div><p>Primus starts with the people at the desk. Different perspectives, a shared place to study and a process that stays your own.</p></div>
        <div className="pt-traders">{traders.map((t,i)=><article key={t.name} className="pt-trader"><div className="pt-profile-mark"><span>0{i+1}</span><Compass size={17} strokeWidth={1}/></div><div className="pt-monogram">{t.initials}<span>↗</span></div><span className="pt-alias">{t.alias}</span><h3>{t.name}</h3><span className="pt-role">{t.role}</span><p>{t.focus}</p></article>)}</div>
      </section>
      <section className="pt-wrap pt-section" id="briefing">
        <div className="pt-section-heading"><div><span className="pt-overline">02 / THE MARKET BRIEFING</span><h2>Know the <em>backdrop.</em></h2></div><p>Market headlines and scheduled economic releases, provided by TradingView. Context before the session.</p></div>
        <div className="pt-briefing"><div className="pt-briefing-sidebar"><span className="pt-overline">AT YOUR DESK</span><h3>One less tab<br/>to keep open.</h3><div className="pt-briefing-tabs" role="group" aria-label="Market briefing">{[['news','Market news'],['calendar','Economic calendar']].map(([id,label])=><button key={id} aria-pressed={marketTab===id} onClick={()=>setMarketTab(id)}>{label}<ArrowUpRight size={17}/></button>)}</div><p>Check event times in the calendar. Headlines and market data may be delayed.</p></div><TradingViewWidget key={`${marketTab}-${theme}`} kind={marketTab} theme={theme}/></div>
      </section>
      <section className="pt-tools-section"><div className="pt-wrap pt-section">
        <div className="pt-section-heading"><div><span className="pt-overline">03 / YOUR WORKSPACE</span><h2>A place for the data.<br/>And the <em>decisions.</em></h2></div><p>The Lab asks what works. The Journal gives you room to understand what happened. Two tools, one trading process.</p></div>
        <div className="pt-tools">
          <a className="pt-tool pt-tool-journal" href="/journal"><div className="pt-tool-top"><NotebookPen size={24}/><span>THE DAILY PRACTICE</span><ArrowUpRight/></div><h3>Your trades have<br/>a story. <em>Keep it.</em></h3><p>Plan your session. Add your screenshots. Write down the lesson while it’s still fresh.</p><div className="pt-paper-preview"><span>SESSION NOTES / A PREVIEW</span><strong>What did the market teach you?</strong><div className="pt-paper-line"><span aria-hidden="true">Wait for the level. Then the reaction.</span></div><div className="pt-paper-rule"/><span className="pt-paper-tag">Plan → Trade → Reflect <NotebookPen size={12}/></span></div><span className="pt-tool-bottom">Open Journal <ArrowRight size={18}/></span></a>
          <a className="pt-tool pt-tool-lab" href="/lab"><div className="pt-tool-top"><FlaskConical size={24}/><span>THE RESEARCH PROCESS</span><ArrowUpRight/></div><h3>An idea is a start.<br/><em>Test the setup.</em></h3><p>Explore strategies, levels and confirmations. Let your own recorded results shape the questions.</p><div className="pt-lab-preview"><span>STRATEGY → LEVEL → CONFIRMATION</span><MarketDrawing/><div className="pt-preview-tags" aria-hidden="true"><span>Key level</span><span>Confirmation</span><span>Review</span></div></div><span className="pt-tool-bottom">Enter Strategy Lab <ArrowRight size={18}/></span></a>
          <a className="pt-tool pt-tool-backtesting" href="/backtesting"><div className="pt-tool-top"><Compass size={24}/><span>FREE BACKTESTING</span><ArrowUpRight/></div><h3>Replay the market.<br/><em>Practise your edge.</em></h3><p>Test your ideas with free historical replay. Currently in beta; chart availability is limited.</p><span className="pt-tool-bottom">Start backtesting <ArrowRight size={18}/></span></a>
        </div>
      </div></section>
      <section className="pt-closing pt-wrap"><Compass size={42} strokeWidth={1}/><span className="pt-overline">A PROCESS WORTH RETURNING TO.</span><h2>Study. Trade.<br/><em>Reflect. Repeat.</em></h2><a className="pt-btn pt-btn-lime" href="/journal">Make room for the next lesson <ArrowUpRight size={18}/></a></section>
    </main>
    <footer className="pt-footer pt-wrap"><a className="pt-wordmark" href="/"><Compass size={23}/><span>PRIMUS<span>TRADER</span></span></a><p>Independent trading research. Personal tools. Shared curiosity.</p><a href="/privacy">Privacy</a><span>© {clock.getFullYear()} PrimusTrader</span></footer>
    {localSitePreview()&&<div className="pt-preview-label">LOCAL CONCEPT PREVIEW · NOT PUBLISHED</div>}
  </div>;
}
function ArrowDownSmall(){return <ChevronDown size={13}/>}

export default function SiteExperience(){
  const [theme,setTheme]=useState(()=>localStorage.getItem('primus-theme')==='dark'?'dark':'light');
  useEffect(()=>{document.documentElement.dataset.theme=theme;delete document.documentElement.dataset.appearance;localStorage.setItem('primus-theme',theme)},[theme]);
  return <SiteThemeContext.Provider value={{theme,toggle:()=>setTheme(value=>value==='dark'?'light':'dark')}}>{['/learn','/market-lab','/mindset'].includes(location.pathname)?<Suspense fallback={<div className="loading-screen">Opening your workspace…</div>}>{location.pathname==='/learn'?<LearnPage/>:location.pathname==='/market-lab'?<MarketLabPage/>:<MindsetPage/>}</Suspense>:location.pathname==='/backtesting'?<Suspense fallback={<div className="loading-screen">Loading chart…</div>}><BacktestingPage theme={theme} onThemeToggle={()=>setTheme(value=>value==='dark'?'light':'dark')}/></Suspense>:location.pathname.startsWith('/journal')?<JournalPage/>:<HomePage/>}</SiteThemeContext.Provider>;
}
