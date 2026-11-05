import React, {useEffect, useState} from 'react';
import {api} from './api';
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
const mondayOf = day => shift(day, -((new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7));
const shortDate = day => new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
});

function Reflection({week, onDirty, busy, setBusy}) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api(`/journal/weeks/${week}`, {signal: controller.signal}).then(setDraft).catch(err => {
      if (err.name !== 'AbortError') setError(err.message);
    });
    return () => controller.abort();
  }, [week, retry]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDraft(await api(`/journal/weeks/${week}`, {method: 'PUT', body: draft}));
      onDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    {error && <p role="alert">{error}</p>}
    {draft === null ? (error
      ? <button className="pt-btn" onClick={() => {setError(''); setRetry(value => value + 1)}}>Retry loading reflections</button>
      : <p role="status">Loading reflections…</p>) :
      <form onSubmit={save} className="pj-reflection">
        {[['repeat', 'What should I repeat?'], ['change', 'What will I change?']].map(([field, label]) =>
          <label className="pj-field" key={field}>{label}
            <textarea value={draft[field]} disabled={busy} maxLength={12000} onChange={e => {
              setDraft({...draft, [field]: e.target.value});
              onDirty(true);
              setSaved(false);
            }}/>
          </label>
        )}
        <button className="pt-btn pt-btn-dark" disabled={busy}>{busy ? 'Saving…' : 'Save weekly review'}</button>
        {saved && <span role="status">Weekly review saved.</span>}
      </form>}
  </>;
}

export function WeeklyReview({rows, account, today}) {
  const [week, setWeek] = useState(() => mondayOf(today));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => {event.preventDefault(); event.returnValue = ''};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sunday = shift(week, 6);
  const entries = rows.filter(row => row.day >= week && row.day <= sunday).sort((a, b) => a.day.localeCompare(b.day));
  const total = recordedTotal(entries.flatMap(row => accountResults(row, account)));
  function move(days) {
    if (dirty && !window.confirm('Leave this week without saving your reflections?')) return;
    setDirty(false);
    setWeek(shift(week, days));
  }

  return <section className="pj-review-panel" aria-labelledby="pj-week-title">
    <h2 id="pj-week-title">Weekly Review</h2>
    <div className="pj-week-nav">
      <button className="pt-btn" disabled={busy} onClick={() => move(-7)}>Previous week</button>
      <strong>{shortDate(week)} – {shortDate(sunday)}</strong>
      <button className="pt-btn" disabled={busy} onClick={() => move(7)}>Next week</button>
    </div>
    <p>Days journaled: <strong>{entries.length}</strong> · Total P&L: <strong>{total === null ? 'No recorded results' : money(total)}</strong></p>
    <h3>The week’s notes</h3>
    {!entries.length && <p>No entries this week.</p>}
    <div className="pj-week-notes">{entries.map(row => <article key={row.day}>
      <h4>{shortDate(row.day)}</h4>
      {[['plan', 'Plan'], ['notes', 'Session notes'], ['lesson', 'Review']].map(([field, title]) => row[field]?.trim() &&
        <p key={field}><strong>{title}</strong><br/>{row[field]}</p>)}
      {!row.plan?.trim() && !row.notes?.trim() && !row.lesson?.trim() && <p>No written notes.</p>}
    </article>)}</div>
    <Reflection key={week} week={week} onDirty={setDirty} busy={busy} setBusy={setBusy}/>
  </section>;
}

export function JournalEquity({rows, accounts}) {
  const [selection, setSelection] = useState(null);
  const account = accounts?.some(item => item.id === selection) ? selection : null;
  const starting = (accounts || []).filter(item => account === null || item.id === account)
    .reduce((total, item) => total + item.starting_balance, 0);
  const days = rows.map(row => ({day: row.day, pnl: recordedTotal(accountResults(row, account))}))
    .filter(row => row.pnl !== null).sort((a, b) => a.day.localeCompare(b.day));
  let equity = starting;
  const values = [starting, ...days.map(row => equity += row.pnl)];
  const low = values.reduce((a, b) => Math.min(a, b));
  const high = values.reduce((a, b) => Math.max(a, b));
  const span = high - low || 1;
  const points = values.map((value, index) => `${8 + index * 624 / Math.max(1, days.length)},${high === low ? 90 : 168 - (value - low) * 156 / span}`);
  return <section className="pj-review-panel" aria-labelledby="pj-equity-title">
    <h2 id="pj-equity-title">Journal equity curve</h2>
    <AccountSelector accounts={accounts} value={account} onChange={setSelection} label="Equity curve account" disabled={!accounts}/>
    {account === null && <p>All accounts combines starting balances and includes unassigned trades.</p>}
    {!accounts ? <p>Account balances are unavailable until accounts load.</p> : !days.length ?
      <p>No recorded Journal trade results for this selection yet.</p> :
      <figure className="pj-equity">
        <figcaption>Starting equity <strong>{money(starting)}</strong> · Latest equity <strong>{money(equity)}</strong></figcaption>
        <svg viewBox="0 0 640 180" role="img" aria-label={`Journal equity across ${days.length} recorded days, low ${money(low)}, high ${money(high)}`}>
          <path d="M8 12H632M8 90H632M8 168H632" className="pj-equity-grid"/>
          <polyline points={points.join(' ')} vectorEffect="non-scaling-stroke"/>
        </svg>
        <div className="pj-equity-dates"><span>{shortDate(days[0].day)}</span><span>{shortDate(days.at(-1).day)}</span></div>
        <p>Each point after the starting balance is the equity after that day’s recorded results.</p>
      </figure>}
  </section>;
}
