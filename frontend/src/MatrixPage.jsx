import React, {useEffect, useState} from 'react';
import {Activity, ArrowDownRight, ArrowUpRight, Clock3, Gauge, Layers3, Minus, ShieldCheck} from 'lucide-react';
import {PrimusHeader, localSitePreview} from './SiteExperience';
import {api} from './api';
import MatrixLoading from './MatrixLoading';
import './matrix.css';

const tickers = [
  {id:'nq', label:'NQ1!', name:'Nasdaq futures', value:'24,186.25', change:'+0.42%', direction:'up'},
  {id:'vix', label:'VIX', name:'Implied volatility', value:'17.82', change:'−0.71 pts', direction:'down'},
  {id:'dgs10', label:'10Y Yield', name:'DGS10', value:'4.31%', change:'+3 bp', direction:'up'},
  {id:'dxy', label:'DXY', name:'US Dollar Index', value:'101.46', change:'−0.18%', direction:'down'},
  {id:'mag7', label:'Mag 7 Basket', name:'Equal-weight index', value:'108.64', change:'+0.68%', direction:'up'},
];

const swingMetrics = [
  {id:'cot', label:'COT Net Long', detail:'Weekly positioning', value:'18.4%'},
  {id:'credit', label:'High-Yield Credit Spread', detail:'Daily observation', value:'318 bp'},
  {id:'fed', label:'Fed Balance Sheet Liquidity', detail:'Weekly Fed assets', value:'$6.72T'},
  {id:'cpi', label:'Core CPI YoY', detail:'Cooling vs prior release', value:'2.8%'},
];

const intradayMetrics = [
  {id:'yield', label:'10Y Yield · 5-day momentum', detail:'Change across five daily observations', value:'+11 bp'},
  {id:'impulse', label:'VIX short-term impulse', detail:'Three-session change', value:'+6.2%'},
  {id:'curve', label:'Yield curve · daily shift', detail:'Change in 10Y minus 2Y spread', value:'−4 bp'},
];

const addons = [
  {id:'sentiment', label:'CNN Fear & Greed', icon:Gauge, value:'41 / 100', detail:'Fear'},
  {id:'breakeven', label:'10Y Breakeven Inflation', icon:Activity, value:'2.34%', detail:'Daily observation'},
  {id:'volatility', label:'Volatility Structure · VIX / VXV', icon:Layers3, value:'0.91×', detail:'VIX below VXV'},
];

const demoSnapshot = {
  tickers,
  swing:{score:62, bias:'Constructive', metrics:swingMetrics},
  intraday:{sizing:'micro', metrics:intradayMetrics},
  addons,
};

const statuses = {
  demo:'Demo data', live:'Connected', cached:'Cached data', loading:'Refreshing', unavailable:'Unavailable',
};
const sizingLabels = {standard:'STANDARD SIZE', micro:'MICRO ONLY', paused:'PAUSED'};
const panel = 'tw:min-w-0 tw:border tw:border-zinc-800 tw:bg-zinc-950';
const number = 'tw:font-mono tw:tabular-nums';
const muted = 'tw:text-zinc-400';
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone:'America/New_York', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
});

function Badge({children, demo=false}){
  return <span className={`tw:border tw:px-2 tw:py-1 tw:text-xs ${demo?'tw:border-amber-800 tw:text-amber-200':'tw:border-zinc-700 tw:text-zinc-300'}`}>
    {children}
  </span>;
}

function Change({reading}){
  if(!reading?.change)return <span className={muted}>—</span>;
  const up=reading.direction==='up', down=reading.direction==='down';
  const Icon=up?ArrowUpRight:down?ArrowDownRight:Minus;
  return <span className={`tw:inline-flex tw:items-center tw:gap-1 tw:text-xs ${number} ${up?'tw:text-emerald-300':down?'tw:text-rose-300':muted}`}>
    <Icon size={13} aria-hidden="true"/>{reading.change}
  </span>;
}

function TickerBar({readings=[]}){
  return <section aria-label="Macro ticker" className="tw:grid tw:grid-cols-2 tw:gap-2 tw:sm:grid-cols-3 tw:lg:grid-cols-5">
    {tickers.map(({id,label,name})=>{
      const reading=readings.find(item=>item.id===id);
      return <article key={id} className={`${panel} tw:p-3`}>
        <h2 className="tw:text-xs tw:font-semibold">{label}</h2>
        <p className={`tw:mt-1 tw:text-xs ${muted}`}>{reading?.detail??name}</p>
        <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-1">
          <strong className={`tw:text-base ${number}`}>{reading?.value??'—'}</strong><Change reading={reading}/>
        </div>
      </article>;
    })}
  </section>;
}

function Desk({title, subtitle, icon:Icon, badge, metrics, readings, children}){
  return <section className={panel}>
    <header className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-zinc-800 tw:px-3 tw:py-3">
      <div className="tw:flex tw:items-start tw:gap-2">
        <Icon size={16} className={muted} aria-hidden="true"/>
        <div><h2 className="tw:text-sm tw:font-semibold">{title}</h2><p className={`tw:text-xs ${muted}`}>{subtitle}</p></div>
      </div>
      {badge}
    </header>
    <dl className="tw:divide-y tw:divide-zinc-800">
      {metrics.map(metric=>{
        const reading=readings?.find(item=>item.id===metric.id);
        return <div key={metric.id} className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:px-3 tw:py-2">
          <dt className="tw:text-xs">{metric.label}<span className={`tw:block ${muted}`}>{reading?.detail??metric.detail}</span></dt>
          <dd className={`tw:text-sm tw:font-semibold ${number}`}>{reading?.value??'—'}</dd>
        </div>;
      })}
    </dl>
    {children}
  </section>;
}

function MacroAddons({readings=[]}){
  return <section aria-labelledby="matrix-addons">
    <h2 id="matrix-addons" className={`tw:mb-2 tw:text-xs tw:font-semibold tw:uppercase tw:tracking-widest ${muted}`}>Macro Addons</h2>
    <div className="tw:grid tw:gap-2 tw:sm:grid-cols-3">
      {addons.map(({id,label,icon:Icon})=>{
        const reading=readings.find(item=>item.id===id);
        return <article key={id} className={`${panel} tw:p-3`}>
          <h3 className="tw:flex tw:items-center tw:gap-2 tw:text-xs"><Icon size={15} className={muted} aria-hidden="true"/>{label}</h3>
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-2">
            <strong className={`tw:text-lg ${number}`}>{reading?.value??'—'}</strong>
            <span className={`tw:text-xs ${muted}`}>{reading?.detail??'No reading'}</span>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

export default function MatrixPage(){
  const [snapshot,setSnapshot]=useState(null);
  const [status,setStatus]=useState('loading');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    api('/matrix/snapshot',{signal:controller.signal}).then(({snapshot:next})=>{
      if(controller.signal.aborted)return;
      setSnapshot(next);
      setStatus(next?'cached':localSitePreview()?'demo':'unavailable');
    }).catch(()=>{
      if(!controller.signal.aborted)setStatus('unavailable');
    });
    return ()=>controller.abort();
  },[attempt]);
  const onRetry=()=>{setStatus('loading');setAttempt(value=>value+1)};
  if(status==='loading'&&!snapshot)return <div className="pt-site matrix-page">
    <PrimusHeader active="matrix"/><MatrixLoading/>
  </div>;
  const demo=status==='demo';
  const data=demo?demoSnapshot:snapshot;
  const unavailable=status==='unavailable'||(!data&&status!=='loading');
  const asOf=data?.asOf?new Date(data.asOf):null;
  const score=data?.swing?.score;
  const validScore=Number.isFinite(score)&&score>=0&&score<=100;
  const sizing=sizingLabels[data?.intraday?.sizing]??'UNAVAILABLE';

  return <div className="pt-site matrix-page">
    <PrimusHeader active="matrix"/>
    <main className="matrix-terminal tw:min-h-screen tw:bg-zinc-950 tw:text-zinc-100">
      <div className="tw:mx-auto tw:grid tw:max-w-[1600px] tw:gap-3 tw:px-3 tw:py-4 tw:sm:px-5">
        <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-3 tw:border-b tw:border-zinc-800 tw:pb-3">
          <div>
            <p className={`tw:text-xs tw:font-semibold tw:uppercase tw:tracking-widest ${muted}`}>PrimusLab / Macro Desk</p>
            <h1 className="tw:text-2xl tw:font-semibold tw:tracking-tight">The Matrix</h1>
            <p className={`tw:text-xs ${muted}`}>NQ / MNQ · Macro context and session risk</p>
          </div>
          <div role="status" className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <Badge demo={demo}>{unavailable?'Unavailable':statuses[status]??'Unavailable'}</Badge>
            {!demo&&asOf&&Number.isFinite(asOf.getTime())&&<time dateTime={asOf.toISOString()} className={`tw:inline-flex tw:items-center tw:gap-1 tw:text-xs ${number} ${muted}`}>
              <Clock3 size={13} aria-hidden="true"/>{dateFormat.format(asOf)} ET
            </time>}
          </div>
        </header>
        {demo&&<p className="tw:border tw:border-amber-900 tw:px-3 tw:py-2 tw:text-xs tw:text-amber-200">Sample figures for layout review. Bias and sizing labels are illustrative.</p>}
        {status==='loading'&&<p role="status" className={`${panel} tw:p-3 tw:text-xs`}>Refreshing macro data… {data&&'Showing the last snapshot.'}</p>}
        {unavailable&&<div role="status" className={`${panel} tw:flex tw:items-center tw:justify-between tw:gap-2 tw:p-3 tw:text-xs`}>
          <span>{data?'Refresh failed. Showing the last snapshot.':'Macro data is unavailable.'}</span>
          {onRetry&&<button type="button" className="tw:border tw:border-zinc-700 tw:px-2 tw:py-1 tw:hover:bg-zinc-800" onClick={onRetry}>Retry</button>}
        </div>}
        <TickerBar readings={data?.tickers}/>
        <div className="tw:grid tw:gap-2 tw:lg:grid-cols-2">
          <Desk icon={Layers3} title="Swing Desk Scorecard" subtitle="Multi-day / weekly hold"
            badge={<Badge>{data?.swing?.bias??'Pending'}</Badge>} metrics={swingMetrics} readings={data?.swing?.metrics}>
            <div className="tw:flex tw:justify-between tw:border-t tw:border-zinc-800 tw:px-3 tw:py-2 tw:text-xs">
              <span className={muted}>Composite score</span><strong className={number}>{validScore?score:'—'} / 100</strong>
            </div>
          </Desk>
          <Desk icon={Activity} title="Intraday Desk Scorecard" subtitle="NY session scalps · NQ / MNQ"
            metrics={intradayMetrics} readings={data?.intraday?.metrics}>
            <div className="tw:border-t tw:border-zinc-800 tw:p-3">
              <div className={`tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border tw:px-3 tw:py-2 tw:text-xs ${data?.intraday?.sizing==='micro'?'tw:border-amber-900 tw:text-amber-200':'tw:border-zinc-700 tw:text-zinc-300'}`}>
                <span className="tw:inline-flex tw:items-center tw:gap-2"><ShieldCheck size={15} aria-hidden="true"/>{demo?'Example sizing status':'Sizing status'}</span>
                <strong className={number}>{sizing}</strong>
              </div>
            </div>
          </Desk>
        </div>
        <MacroAddons readings={data?.addons}/>
        <section className={`${panel} tw:p-3 tw:text-xs`} aria-label="Economic calendar sources">
          <h2 className="tw:text-sm">High-impact US releases</h2>
          {data?.calendar?.length>0?<ul className="tw:mt-2 tw:list-none tw:divide-y tw:divide-zinc-800 tw:p-0">
            {data.calendar.map(event=><li key={`${event.date}:${event.event}`} className="tw:grid tw:gap-1 tw:py-2 tw:sm:grid-cols-3">
              <span>{event.event}</span>
              <span className={number}>{event.date} · FMP</span>
              <span className={number}>Actual {event.actual??'—'} · Consensus {event.estimate??'—'} {event.unit??''}</span>
            </li>)}
          </ul>:<p className={muted}>{data?.calendar?'No high-impact US releases in the current window.':'Calendar feed unavailable.'}</p>}
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-4">
            <a href="https://www.bls.gov/schedule/" target="_blank" rel="noopener noreferrer">BLS · CPI &amp; jobs ↗</a>
            <a href="https://www.bea.gov/news/schedule" target="_blank" rel="noopener noreferrer">BEA · GDP &amp; PCE ↗</a>
            <a href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" target="_blank" rel="noopener noreferrer">Federal Reserve · FOMC ↗</a>
          </div>
        </section>
        {!demo&&data&&<p className={`tw:text-xs ${muted}`}>This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.</p>}
      </div>
    </main>
  </div>;
}
