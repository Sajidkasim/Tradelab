import React, {useState} from 'react';
import LabHistory from './LabHistory';
import {money} from './format';

export function AccountSelector({accounts, label, value, onChange, unassigned = false, disabled}) {
  return <label className="pj-field">{label}
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{unassigned ? 'Unassigned' : 'All accounts'}</option>
      {(accounts || []).map(account => <option key={account.id} value={account.id}>{account.name} · {account.account_type}</option>)}
    </select>
  </label>;
}

export function accountResults(row, account) {
  return (row?.trade_results || []).filter(result => account === null || result.account_id === account);
}

export function recordedTotal(results) {
  const recorded = results.filter(result => result.net_pnl != null);
  return recorded.length ? recorded.reduce((total, trade) => total + trade.net_pnl, 0) : null;
}

const shift = (day, days) => {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const balanceMoney = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'});
const periods = {'1W': 7, '1M': 30, '3M': 90, All: null};

function Chips({label, choices, value, onChange}) {
  return <div className="segments" role="group" aria-label={label}>
    {choices.map(choice => <button key={choice.value ?? "all"} type="button"
      className={value === choice.value ? 'selected' : ''} aria-pressed={value === choice.value}
      onClick={() => onChange(choice.value)}>{choice.label}</button>)}
  </div>;
}

export function JournalEquity({rows, accounts, palette, theme}) {
  const [selection, setSelection] = useState(null);
  const [period, setPeriod] = useState('All');
  const account = accounts?.some(item => item.id === selection) ? selection : null;
  const starting = (accounts || []).filter(item => account === null || item.id === account)
    .reduce((total, item) => total + item.starting_balance, 0);
  const days = rows.map(row => ({day: row.day, pnl: recordedTotal(accountResults(row, account))}))
    .filter(row => row.pnl !== null).sort((a, b) => a.day.localeCompare(b.day));
  let balance = starting;
  const series = days.map(row => ({...row, balance: balance += row.pnl}));
  const net = balance - starting;
  const last = series.at(-1)?.day;
  const first = last && (periods[period] ? shift(last, 1 - periods[period]) : shift(series[0].day, -1));
  const visible = series.filter(row => row.day >= first);
  const opening = series.findLast(row => row.day < first)?.balance ?? starting;
  if (first && visible[0]?.day !== first) visible.unshift({day: first, balance: opening, pnl: null});
  const colors = palette[theme];
  const figure = {
    data: [{type: 'scatter', mode: 'lines+markers', x: visible.map(row => row.day),
      y: visible.map(row => row.balance), customdata: visible.map(row => row.pnl === null ? "Opening balance" : "Day P&L: " + money(row.pnl)), marker: {size: 4}}],
    layout: {margin: {l: 73, r: 15, t: 15, b: 36}, xaxis: {type: 'date', tickformat: '%d %b'},
      yaxis: {rangemode: 'normal'},
      shapes: [{type: 'line', xref: 'paper', x0: 0, x1: 1, y0: starting, y1: starting,
        line: {color: colors.muted, dash: 'dot', width: 1}}]},
  };
  return <section className="card chart-card history-card pj-equity-card" aria-labelledby="pj-equity-title">
    <div className="section-title"><div><span className="lab-step">JOURNAL RESULTS</span><h2 id="pj-equity-title">Journal equity curve</h2></div></div>
    <div className="pj-equity-controls">
      <Chips label="Equity curve account" choices={[{label:'All accounts', value:null},
        ...(accounts || []).map(item => ({label:item.name, value:item.id}))]} value={account} onChange={setSelection}/>
      <Chips label="Equity range" choices={Object.keys(periods).map(value => ({label:value, value}))} value={period} onChange={setPeriod}/>
    </div>
    {account === null && <p>All accounts combines starting balances and includes unassigned trades.</p>}
    {accounts && <div className="history-headline">
      <div><span>Current balance</span><strong>{balanceMoney.format(balance)}</strong></div>
      <span className={net < 0 ? 'history-loss' : 'history-gain'}>
        Total P&L {money(net)}{starting > 0 && ` · ${(net / starting * 100).toFixed(2)}%`}
      </span>
    </div>}
    {!accounts ? <p>Account balances are unavailable until accounts load.</p> : !days.length ?
      <p>No recorded Journal trade results for this selection yet.</p> :
      <LabHistory figure={figure} palette={colors} netResult={net} journal/>}
  </section>;
}
