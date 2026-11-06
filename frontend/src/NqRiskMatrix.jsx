import React, {useState} from 'react';
import {api} from './api';
import {Button, Notice} from './components';

const dollars = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'});

export default function NqRiskMatrix(){
  const [result,setResult]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function calculate(event){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setResult(null);
    try{
      setResult(await api('/learn/risk-matrix',{
        method:'POST',
        body:{
          balance:Number(form.get('balance')),
          risk_percent:Number(form.get('risk')),
          stop_ticks:Math.ceil(Number(form.get('stop'))*4),
        },
      }));
    }catch{
      setError('Could not calculate position size. Check your inputs and try again.');
    }finally{
      setBusy(false);
    }
  }

  return <section className="wp-panel" aria-labelledby="learn-risk-title">
    <span className="pt-overline">LEVEL 2 / RISK MECHANICS</span>
    <h2 id="learn-risk-title">NQ Risk Matrix</h2>
    <p>Compare NQ and MNQ position sizes for the same dollar risk budget.</p>
    <form className="learn-risk-fields" onSubmit={calculate} onChange={()=>{setResult(null);setError('')}}>
      <label>Account balance ($)<input name="balance" type="number" required min=".01" max="1000000000" step=".01" defaultValue="50000" disabled={busy}/></label>
      <label>Risk (%)<input name="risk" type="number" required min=".01" max="100" step=".01" defaultValue=".5" disabled={busy}/></label>
      <label>Stop distance (points)<input name="stop" type="number" required min=".01" max="1000000" step="any" defaultValue="20" disabled={busy}/></label>
      <Button type="submit" busy={busy} disabled={busy}>Calculate size</Button>
    </form>
    {error&&<Notice error>{error}</Notice>}
    {result&&<div aria-live="polite">
      <p>Risk budget <strong>{dollars.format(result.NQ.risk_budget)}</strong> · Stop used <strong>{result.NQ.stop_ticks/4} points</strong></p>
      <dl className="learn-risk-fields">
        {Object.entries(result).map(([symbol, sizing])=><div key={symbol}>
          <dt>{symbol}</dt>
          <dd><strong>{sizing.contracts}</strong> maximum whole contracts</dd>
          <dd>{dollars.format(sizing.risk_per_contract)} planned risk per contract</dd>
        </div>)}
      </dl>
    </div>}
    <p>Stops round up to the next quarter point. Check broker margin and account limits separately, and allow for fees and slippage.</p>
    <details>
      <summary>Learn More</summary>
      <dl>
        <dt><strong>Margin and leverage</strong></dt>
        <dd>Margin is what your broker requires to hold a position. Each point moves P&amp;L by $20 per NQ or $2 per MNQ.</dd>
        <dt><strong>Drawdown</strong></dt>
        <dd>A fall from a $52,000 equity peak to $50,000 is a $2,000 drawdown, about 3.85%.</dd>
        <dt><strong>R-multiples</strong></dt>
        <dd>If your initial risk was $100 and your net profit was $200, your result was +2R.</dd>
        <dt><strong>Slippage</strong></dt>
        <dd>A stop can fill beyond its trigger. One point of adverse slippage adds $20 per NQ or $2 per MNQ.</dd>
      </dl>
    </details>
  </section>;
}
