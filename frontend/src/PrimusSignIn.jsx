import React,{useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,LockKeyhole,Eye,EyeOff,LoaderCircle} from 'lucide-react';
import {api,setCsrf} from './api';
import PrimusCompass from './components/PrimusCompass';
import {PrimusTopoField,PrimusSunbeams} from './components/PrimusAtmosphere';
import './primus-signin.css';

function MarketStudy(){
 const prices=[146,139,162,151,184,177,210,199,226,211,178,191,149,157,125,132,96,106,76,87,57];
 return <figure className="ps-study" aria-label="Illustration of price approaching a level and finding a reaction, not live trading data">
  <div className="ps-study-top"><span><i/> THE PRICE OF PATIENCE</span><span>STUDY / 001</span></div>
  <svg viewBox="0 0 620 300" fill="none" aria-hidden="true">
   <defs><linearGradient id="ps-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d4e5b4" stopOpacity=".16"/><stop offset="1" stopColor="#d4e5b4" stopOpacity="0"/></linearGradient></defs>
   {[60,120,180,240].map(y=><path key={y} d={`M10 ${y}H610`} stroke="#e3eddb" strokeOpacity=".07"/>)}
   {[80,180,280,380,480,580].map(x=><path key={x} d={`M${x} 20V270`} stroke="#e3eddb" strokeOpacity=".05"/>)}
   <rect x="10" y="213" width="600" height="31" fill="#d4e5b4" fillOpacity=".07"/>
   <path d="M10 228H610" stroke="#d4e5b4" strokeOpacity=".4" strokeDasharray="4 6"/>
   <path d={`M${prices.map((y,i)=>`${30+i*27},${y}`).join(' L')} L570,278 L30,278 Z`} fill="url(#ps-area)"/>
   {prices.map((y,i)=>{const x=30+i*27,up=i>0&&y<prices[i-1];return <g key={i} className="ps-candle" style={{'--ps-delay':`${i*35}ms`}} stroke={up?'#d4e5b4':'#6c8b7c'} fill={up?'#d4e5b4':'#1d372e'}><path d={`M${x} ${y-13}V${y+22}`}/><rect x={x-4} y={y-4} width="8" height="14" rx="1"/></g>})}
   <circle cx="246" cy="227" r="24" stroke="#d4e5b4" strokeOpacity=".3"/>
   <circle cx="246" cy="227" r="4" fill="#d4e5b4"/>
   <path d="M264 210L302 153H359" stroke="#d4e5b4" strokeOpacity=".7"/>
   <rect x="298" y="122" width="139" height="32" rx="4" fill="#d4e5b4"/>
   <text x="310" y="142" fill="#18352d" fontSize="10" fontFamily="sans-serif" letterSpacing="1">WAIT. THEN RESPOND.</text>
   <text x="20" y="266" fill="#9db29f" fontSize="9" fontFamily="sans-serif" letterSpacing="1.8">THE LEVEL IS A QUESTION. THE REACTION IS INFORMATION.</text>
  </svg>
  <figcaption><span>Observe the level. Own the decision.</span><span>ILLUSTRATION / NOT LIVE DATA</span></figcaption>
 </figure>;
}
const entrances={
 home:{edition:'THE PRIVATE TRADING DESK',eyebrow:'LESS NOISE. MORE INTENTION.',headline:<>The market moves.<br/><em>You choose<br/> the moment.</em></>,description:'A place to practise with purpose, record the decision and come back a little clearer.',kicker:'YOUR PRIMUS TRADER WORKSPACE',title:<>Back to<br/> your <em>process.</em></>,intro:'Your Journal. Your research. Your next session. A little space to focus on what matters.',quote:<>The work is in the waiting.<br/>The growth is in the review.</>,steps:[['Replay','Study the setup.'],['Record','Keep your perspective.'],['Refine','Learn from your results.']],destination:'/journal'},
 journal:{edition:'THE DAILY PRACTICE',eyebrow:'THE TRADE ENDS. THE LEARNING DOESN’T.',headline:<>Every session.<br/><em>A story<br/> worth keeping.</em></>,description:'The plan before the open. The decision in the moment. The lesson you take into tomorrow.',kicker:'YOUR PRIVATE JOURNAL',title:<>Make room<br/> to <em>reflect.</em></>,intro:'Your plans, trade notes and screenshots, together in one private Journal.',quote:<>Record the decision.<br/>Remember the reason.</>,steps:[['Plan','Set your intention.'],['Record','Capture the decision.'],['Reflect','Keep the lesson.']],destination:'/journal'},
 lab:{edition:'THE STRATEGY LAB',eyebrow:'CURIOSITY, WITH A PROCESS.',headline:<>Start with<br/> a question.<br/><em>Study the evidence.</em></>,description:'Explore your setups, compare your recorded results and give your next decision a stronger foundation.',kicker:'YOUR PRIVATE STRATEGY LAB',title:<>A clearer view<br/> of <em>your edge.</em></>,intro:'Your recorded trades, setup filters and performance analytics. Research that starts with your own results.',quote:<>Good questions come first.<br/>Understanding follows the evidence.</>,steps:[['Question','Define the setup.'],['Compare','Explore your results.'],['Refine','Keep asking why.']],destination:'/lab'},
 backtesting:{edition:'THE REPLAY DESK / BETA',eyebrow:'REAL HISTORY. ROOM TO PRACTISE.',headline:<>Meet the market.<br/><em>One candle<br/> at a time.</em></>,description:'Replay NQ and ES, practise your execution and return to your saved session with a little more perspective.',kicker:'YOUR PRIVATE BACKTESTING DESK',title:<>Find your pace.<br/><em>Practise your edge.</em></>,intro:'Historical replay, simulated trades and risk controls. A separate practice balance for your next session.',quote:<>Practise the process.<br/>Review the decision.</>,steps:[['Replay','Choose a starting day.'],['Practise','Manage the trade.'],['Review','Return to the session.']],destination:'/backtesting'},
};
function JournalStudy(){return <figure className="ps-journal-study" aria-label="Journal preview"><div className="ps-paper"><div className="ps-paper-top"><span>SESSION NOTES</span><span>YOUR PERSPECTIVE / 001</span></div>{[['BEFORE THE OPEN','What am I waiting for?'],['IN THE MOMENT','Why did I take the trade?'],['AFTER THE CLOSE','What will I carry forward?']].map(([label,title],i)=><div className="ps-paper-section" key={label}><span>0{i+1} / {label}</span><strong>{title}</strong><i/><i/></div>)}<footer>Plan. Trade. Reflect. Repeat.</footer></div><figcaption>Space for the story behind the numbers.</figcaption></figure>}
function LabStudy(){return <figure className="ps-lab-study" aria-label="Strategy research illustration, not actual performance"><div className="ps-study-top"><span>FROM IDEA TO UNDERSTANDING</span><span>RESEARCH / 001</span></div><div className="ps-research-flow"><span>THE QUESTION</span><p>Which conditions<br/><em>make the difference?</em></p><div className="ps-research-tags"><span>Strategy</span><span>Key level</span><span>Confirmation</span></div></div><svg viewBox="0 0 580 155" fill="none" aria-hidden="true">{[35,75,115].map(y=><path key={y} d={`M10 ${y}H570`} stroke="#d4e5b4" strokeOpacity=".1"/>)}{[54,86,63,105,78,120,90,132,110,137].map((h,i)=><g key={i}><rect x={25+i*54} y={145-h} width="16" height={h} fill="#d4e5b4" fillOpacity={.25+i*.04} rx="2"/><rect x={44+i*54} y={145-h*.6} width="9" height={h*.6} fill="#809d89" fillOpacity=".3" rx="2"/></g>)}</svg><figcaption>Illustrative comparison. Your recorded results tell their own story.</figcaption></figure>}
function ReplayStudy(){return <div className="ps-replay-study"><MarketStudy/><div className="ps-replay-transport" aria-label="Illustrative replay controls"><span className="ps-play-symbol" aria-hidden="true">▷</span><div><strong>NQ / ES</strong><span>Historical replay</span></div><div className="ps-replay-track"><i/></div><span>PAUSE. OBSERVE. CONTINUE.</span></div></div>}
function GoogleMark(){return <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.9-1.8-5.7-4.2H2.9v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.3 13.7a6 6 0 0 1 0-3.4V7.6H2.9a10 10 0 0 0 0 8.8l3.4-2.7Z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.8 9.8 0 0 0 12 2a10 10 0 0 0-9.1 5.6l3.4 2.7C7.1 7.9 9.4 6.1 12 6.1Z"/></svg>}

export default function PrimusSignIn(){
 const [session,setSession]=useState(null),[error,setError]=useState('');
 async function load(){setError('');try{const value=await api('/session');setCsrf(value.csrf);if(value.authenticated){location.replace('/journal');return}setSession(value)}catch(e){setError(e.message)}}
 useEffect(()=>{document.title='Sign in — Primus Trader';load()},[]);
 if(!session)return <main className="loading-screen" role="status">{error?<><p role="alert">{error}</p><button className="button" onClick={load}>Try again</button></>:'Preparing your private entrance…'}</main>;
 return <WorkspaceEntrance session={session} onUnlocked={()=>location.replace('/journal')}/>;
}

export function WorkspaceEntrance({workspace='home',session,ready=true,onUnlocked,returnTo}){
 const content=entrances[workspace]||entrances.home;
 const destination=returnTo??content.destination;
 const [error,setError]=useState(()=>new URLSearchParams(location.search).get('login')==='blocked'?'Access is blocked. Please contact the owner.':new URLSearchParams(location.search).get('login')==='retry'?'Sign-in was not completed. Please try again.':''),[busy,setBusy]=useState(false),[password,setPassword]=useState(''),[visible,setVisible]=useState(false);
 async function submit(e){e.preventDefault();if(busy||!ready||!session?.csrf)return;setBusy(true);setError('');try{
  if(session.auth_mode==='google'){const result=await api('/login/google?return_to='+encodeURIComponent(destination),{method:'POST'});location.assign(result.url);return}
  const result=await api('/unlock',{method:'POST',body:{password}});setCsrf(result.csrf);setPassword('');await onUnlocked();setBusy(false);
 }catch(e){setError(e.message);setBusy(false)}}
 const google=session?.auth_mode==='google';
 return <main className={`ps-entry ps-entrance-${workspace}`}>
  <section className="ps-editorial" aria-labelledby="ps-story-title">
   <PrimusTopoField variant="signin"/>
   <header className="ps-brand"><a href="/" aria-label="Primus Trader home"><PrimusCompass size={30}/><span>PRIMUS <b>TRADER</b></span></a><span className="ps-edition">{content.edition}</span></header>
   <div className="ps-story"><span className="ps-eyebrow">{content.eyebrow}</span><h1 id="ps-story-title">{content.headline}</h1><p>{content.description}</p></div>
   {workspace==='journal'?<JournalStudy/>:workspace==='lab'?<LabStudy/>:workspace==='backtesting'?<ReplayStudy/>:<MarketStudy/>}
   <footer className="ps-process">{content.steps.map(([title,copy],i)=><div key={title}><span>0{i+1}</span><p><strong>{title}</strong><small>{copy}</small></p></div>)}</footer>
  </section>
  <section className="ps-access" aria-labelledby="ps-title">
   <PrimusSunbeams/>
   <a className="ps-back" href="/"><ArrowLeft size={15}/> Back to the homepage</a>
   <div className="ps-form-wrap">
    <div className="ps-seal" aria-hidden="true"><PrimusCompass size={38} interactive/></div>
    <span className="ps-access-kicker">{content.kicker}</span>
    <h2 id="ps-title">{content.title}</h2>
    <p className="ps-intro">{content.intro}</p>
    {<form onSubmit={submit} className="ps-form">
     {!google&&<label className="ps-password">Password<div><input type={visible?'text':'password'} autoComplete="current-password" required maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error?'ps-error':undefined}/><button type="button" onClick={()=>setVisible(!visible)} aria-label={visible?'Hide password':'Show password'} aria-pressed={visible}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>}
     {error&&<p className="ps-error" id="ps-error" role="alert">{error}</p>}
     <button className="ps-continue" type="submit" disabled={busy||!ready||!session.csrf}>{busy?<LoaderCircle size={19} className="ps-spin"/>:google?<GoogleMark/>:<LockKeyhole size={18}/>}<span>{busy?'Opening your workspace…':google?'Continue with Google':'Continue'}</span>{!busy&&<ArrowRight size={18}/>}</button>
     <div className="ps-private"><LockKeyhole size={15}/><p>Your own space, every time.<small>Other members cannot see your trades or journal notes.</small></p></div>
     {google&&<details className="ps-security"><summary>About sign-in security</summary><p>Your first sign-in creates your private workspace. For account security, the owner can see sign-in activity, browser/device hints and connection addresses. <a href="/privacy">Read our privacy details.</a></p></details>}
    </form>}
    <div className="ps-note"><span aria-hidden="true">“</span><p>{content.quote}</p></div>
   </div>
   <footer className="ps-access-footer"><span>Built around your process.</span><a href="/privacy">Privacy <ArrowRight size={12}/></a></footer>
  </section>
 </main>;
}
