import React, {useState} from 'react';
import {api} from './api';
import {Button, Notice} from './components';
import NqRiskMatrix from './NqRiskMatrix';

function CandleStudy({bars}){
  const low=Math.min(...bars.map(bar=>bar.low));
  const high=Math.max(...bars.map(bar=>bar.high));
  const y=price=>178-156*(price-low)/(high-low||1);
  return <svg viewBox="0 0 640 200" role="img" aria-label="Revealed NQ one-minute candles" className="learn-drill-chart">
    {bars.map((bar,index)=>{
      const x=12+index*18;
      const up=bar.close>=bar.open;
      return <g key={bar.time} className={up?'learn-candle-up':'learn-candle-down'}>
        <line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} stroke="currentColor"/>
        <rect x={x-5} width="10" y={Math.min(y(bar.open),y(bar.close))} fill={up?'none':'currentColor'}
          stroke="currentColor" height={Math.max(1,Math.abs(y(bar.open)-y(bar.close)))}/>
      </g>;
    })}
  </svg>;
}

function ReplayDrill(){
  const [data,setData]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [cursor,setCursor]=useState(19);
  const [position,setPosition]=useState(null);
  const [completed,setCompleted]=useState(null);
  const bars=data?.bars;
  const candle=bars?.[cursor];
  const last=cursor===bars?.length-1;

  async function start(){
    setBusy(true);
    setError('');
    try{
      setData(await api('/learn/replay-drill'));
      setCursor(19);
      setPosition(null);
      setCompleted(null);
    }catch{
      setError('NQ replay history is unavailable here. Sign in and try again, or open Backtesting.');
    }finally{setBusy(false)}
  }

  return <section className="wp-panel">
    <span className="pt-overline">LEVEL 1 / THE SANDBOX</span>
    <h2>NQ Bar Replay Drill</h2>
    <p>Practise a one-contract long or short using historical one-minute candles. Entries and exits in this exercise use the current revealed candle close.</p>
    <Button onClick={start} busy={busy} disabled={busy}>{data?'Restart drill':'Load replay drill'}</Button>
    {error&&<Notice error>{error}</Notice>}
    {candle&&<>
      <p>{data.contract} · {data.day} UTC · Candle {cursor+1} of {bars.length}</p>
      <CandleStudy bars={bars.slice(Math.max(0,cursor-33),cursor+1)}/>
      <p aria-live="polite">Close {candle.close.toFixed(2)} · {position?`${position.side} from ${position.price.toFixed(2)}`:'Flat'}
        {completed!==null&&` · Last exit ${completed.toFixed(2)} points before costs`}</p>
      <div className="wp-links">
        <Button disabled={last} onClick={()=>setCursor(index=>Math.min(index+1,bars.length-1))}>Next Candle</Button>
        <Button disabled={Boolean(position)||last} onClick={()=>setPosition({side:'Long',price:candle.close})}>Long</Button>
        <Button disabled={Boolean(position)||last} onClick={()=>setPosition({side:'Short',price:candle.close})}>Short</Button>
        <Button disabled={!position} onClick={()=>{
          setCompleted((candle.close-position.price)*(position.side==='Long'?1:-1));
          setPosition(null);
        }}>Close position</Button>
      </div>
    </>}
    <details><summary>Learn More</summary>
      <p>The body shows open and close, and the wicks show high and low. A volume profile groups volume by price. One-minute OHLCV alone does not give the exact volume at each price.</p>
      <p>Write down your entry and invalidation before clicking Next Candle. Looking at future candles before deciding introduces look-ahead bias.</p>
    </details>
  </section>;
}

function CapitalSimulator(){
  const [tier,setTier]=useState('50000');
  const [drawdown,setDrawdown]=useState('');
  const [cap,setCap]=useState('');
  const floor=Number(tier)-Number(drawdown);
  return <section className="wp-panel">
    <span className="pt-overline">LEVEL 3 / FUNDED CAPITAL REALITY</span>
    <h2>Prop Firm Simulator</h2>
    <p>Enter the limits from your evaluation plan. Firm rules vary by product and can change.</p>
    <div className="learn-risk-fields">
      <label>Account tier <select value={tier} onChange={event=>setTier(event.target.value)}>
        <option value="50000">$50,000</option><option value="100000">$100,000</option><option value="150000">$150,000</option>
      </select></label>
      <label>Trailing drawdown ($)<input type="number" min="1" max={Number(tier)} value={drawdown} onChange={event=>setDrawdown(event.target.value)}/></label>
      <label>Firm contract cap<input type="number" min="1" step="1" value={cap} onChange={event=>setCap(event.target.value)}/></label>
    </div>
    {Number(drawdown)>0&&floor>=0&&<p>Initial drawdown buffer <strong>${Number(drawdown).toLocaleString()}</strong> · Initial loss threshold <strong>${floor.toLocaleString()}</strong></p>}
    {Number.isSafeInteger(Number(cap))&&Number(cap)>0&&<p>Firm limit entered <strong>{cap} contracts</strong>. Use the Risk Matrix to check your planned stop against a separate trade budget.</p>}
    <details><summary>Learn More</summary>
      <p>Check whether the threshold follows intraday equity or end-of-day balances, and whether it stops trailing. A consistency rule may limit how much one day contributes to payout eligibility. Compare evaluation fees, payout terms, and profit splits before choosing a plan.</p>
    </details>
  </section>;
}

export default function LearnCapitalPath(){
  return <>
    <header className="wp-section-heading"><h2>The Path to Capital</h2></header>
    <ReplayDrill/>
    <NqRiskMatrix/>
    <CapitalSimulator/>
  </>;
}
