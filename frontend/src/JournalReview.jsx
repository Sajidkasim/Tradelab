import React, { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import LabHistory from './LabHistory';
import { money } from './format';

export const ACCOUNT_SCOPES = [
  { value: 'active', label: 'Active' },
  { value: 'funded', label: 'Funded' },
  { value: 'eval', label: 'Eval' },
  { value: 'personal', label: 'Personal' },
  { value: 'passed', label: 'Passed' },
  { value: 'blown', label: 'Blown' },
  { value: 'all', label: 'All' },
];

export function tradeAccountIds(trade) {
  return trade.account_ids?.length ? trade.account_ids : trade.account_id == null ? [] : [trade.account_id];
}

export function filterAccountsByScope(accounts, scope = 'active') {
  const list = accounts || [];
  if (scope === 'all') return list;
  if (scope === 'active') return list.filter(a => (a.status || 'active') === 'active');
  if (scope === 'funded') return list.filter(a => (a.status || 'active') === 'active' && a.account_type === 'Funded');
  if (scope === 'eval') return list.filter(a => (a.status || 'active') === 'active' && a.account_type === 'Eval');
  if (scope === 'personal') return list.filter(a => (a.status || 'active') === 'active' && a.account_type === 'Personal');
  if (scope === 'passed') return list.filter(a => a.status === 'passed');
  if (scope === 'blown') return list.filter(a => a.status === 'blown');
  return list.filter(a => (a.status || 'active') === 'active');
}

export function parseAccountFilter(filter) {
  if (filter == null || filter === '' || filter === 'scope:active') return { scope: 'active', accountId: null };
  if (typeof filter === 'number') return { scope: 'active', accountId: filter };
  if (typeof filter === 'string' && filter.startsWith('scope:')) {
    return { scope: filter.slice(6), accountId: null };
  }
  const num = Number(filter);
  return Number.isFinite(num) && num > 0 ? { scope: 'active', accountId: num } : { scope: 'active', accountId: null };
}

export function tradeMatchesFilter(trade, filter, accounts) {
  const { scope, accountId } = parseAccountFilter(filter);
  const ids = tradeAccountIds(trade);
  if (accountId !== null) return ids.includes(accountId);
  if (scope === 'all') return true;
  if (scope === 'active') {
    if (!ids.length) return true;
    const activeIds = new Set(filterAccountsByScope(accounts, 'active').map(a => a.id));
    return ids.some(id => activeIds.has(id));
  }
  const targetIds = new Set(filterAccountsByScope(accounts, scope).map(a => a.id));
  return ids.some(id => targetIds.has(id));
}

export function scopedAccountResults(row, filter, accounts) {
  const results = row?.trade_results || [];
  const { scope, accountId } = parseAccountFilter(filter);
  if (accountId !== null) {
    return results
      .filter(result => tradeAccountIds(result).includes(accountId))
      .map(result => {
        const ids = tradeAccountIds(result);
        if (ids.length > 1 && result.net_pnl != null) {
          return { ...result, net_pnl: Math.round((result.net_pnl / ids.length) * 100) / 100, split: true };
        }
        return result;
      });
  }
  if (scope === 'all') return results;
  const includeUnassigned = scope === 'active';
  const targetIds = new Set(filterAccountsByScope(accounts, scope).map(a => a.id));
  const out = [];
  for (const result of results) {
    const ids = tradeAccountIds(result);
    if (!ids.length) {
      if (includeUnassigned) out.push(result);
      continue;
    }
    const matched = ids.filter(id => targetIds.has(id));
    if (!matched.length) continue;
    if (matched.length === ids.length || result.net_pnl == null) {
      out.push(result);
    } else {
      out.push({
        ...result,
        net_pnl: Math.round((result.net_pnl * (matched.length / ids.length)) * 100) / 100,
        split: true,
      });
    }
  }
  return out;
}

export function accountResults(row, account) {
  const results = row?.trade_results || [];
  if (account === null) return results;
  return results.filter(result => tradeAccountIds(result).includes(account))
    .map(result => tradeAccountIds(result).length > 1 ? { ...result, net_pnl: null } : result);
}

export function recordedTotal(results) {
  const recorded = results.filter(result => result.net_pnl != null);
  return recorded.length ? Math.round(recorded.reduce((total, trade) => total + Number(trade.net_pnl), 0) * 100) / 100 : null;
}

export function AccountSelector({ accounts, label, value, onChange, unassigned = false, disabled }) {
  if (unassigned) {
    return <label className="pj-field">{label}
      <select aria-label={label} value={value ?? ''} disabled={disabled}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Unassigned</option>
        {(accounts || []).map(account => (
          <option key={account.id} value={account.id}>
            {account.name} · {account.account_type}{account.status === 'blown' ? ' · Blown' : account.status === 'passed' ? ' · Passed' : ''}
          </option>
        ))}
      </select>
    </label>;
  }

  const active = filterAccountsByScope(accounts, 'active');
  const archived = (accounts || []).filter(a => (a.status || 'active') !== 'active');
  const selectValue = value == null ? '' : String(value);

  return <label className="pj-field">{label}
    <select aria-label={label} value={selectValue} disabled={disabled} onChange={e => {
      const raw = e.target.value;
      if (!raw) onChange(null);
      else if (raw.startsWith('scope:')) onChange(raw);
      else onChange(Number(raw));
    }}>
      <option value="">Active accounts ({active.length})</option>
      {active.length > 0 && <optgroup label="Active accounts">
        {active.map(account => (
          <option key={account.id} value={String(account.id)}>
            {account.name} · {account.account_type}
          </option>
        ))}
      </optgroup>}
      <optgroup label="Account scopes">
        <option value="scope:funded">Funded only (active)</option>
        <option value="scope:eval">Eval only (active)</option>
        <option value="scope:personal">Personal only (active)</option>
        <option value="scope:all">All accounts (incl. blown)</option>
        {archived.some(a => a.status === 'passed') && <option value="scope:passed">Passed evaluations</option>}
        {archived.some(a => a.status === 'blown') && <option value="scope:blown">Blown accounts</option>}
      </optgroup>
      {archived.length > 0 && <optgroup label="Blown &amp; Passed">
        {archived.map(account => (
          <option key={account.id} value={String(account.id)}>
            {account.name} · {account.account_type} · {account.status === 'passed' ? 'Passed' : 'Blown'}
          </option>
        ))}
      </optgroup>}
    </select>
  </label>;
}

const shift = (day, days) => {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const balanceMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const periods = { '1W': 7, '1M': 30, '3M': 90, All: null };
const MAX_ACCOUNT_CHIPS = 6;

function Chips({ label, choices, value, onChange }) {
  return <div className="segments" role="group" aria-label={label}>
    {choices.map(choice => <button key={String(choice.value ?? 'all')} type="button"
      className={value === choice.value ? 'selected' : ''} aria-pressed={value === choice.value}
      onClick={() => onChange(choice.value)}>{choice.label}</button>)}
  </div>;
}

export function computeDisciplineInsights(rows, filter, accounts) {
  const plan = {
    Yes: { days: 0, pnlDays: 0, wins: 0, net: 0 },
    Partly: { days: 0, pnlDays: 0, wins: 0, net: 0 },
    No: { days: 0, pnlDays: 0, wins: 0, net: 0 },
  };
  const mindset = {
    Focused: { days: 0, pnlDays: 0, wins: 0, net: 0 },
    Patient: { days: 0, pnlDays: 0, wins: 0, net: 0 },
    Distracted: { days: 0, pnlDays: 0, wins: 0, net: 0 },
    Frustrated: { days: 0, pnlDays: 0, wins: 0, net: 0 },
  };
  const weekdays = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 };
  const weekdayDays = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 };
  const wdNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const row of rows || []) {
    const res = scopedAccountResults(row, filter, accounts);
    const pnl = recordedTotal(res);
    if (pnl !== null) {
      const wd = wdNames[new Date(row.day + 'T12:00:00Z').getUTCDay()];
      if (Object.hasOwn(weekdays, wd)) {
        weekdays[wd] = Math.round((weekdays[wd] + pnl) * 100) / 100;
        weekdayDays[wd] += 1;
      }
    }
    if (row.plan_followed && Object.hasOwn(plan, row.plan_followed)) {
      plan[row.plan_followed].days += 1;
      if (pnl !== null) {
        plan[row.plan_followed].pnlDays += 1;
        if (pnl > 0) plan[row.plan_followed].wins += 1;
        plan[row.plan_followed].net = Math.round((plan[row.plan_followed].net + pnl) * 100) / 100;
      }
    }
    if (row.mindset && Object.hasOwn(mindset, row.mindset)) {
      mindset[row.mindset].days += 1;
      if (pnl !== null) {
        mindset[row.mindset].pnlDays += 1;
        if (pnl > 0) mindset[row.mindset].wins += 1;
        mindset[row.mindset].net = Math.round((mindset[row.mindset].net + pnl) * 100) / 100;
      }
    }
  }
  return { plan, mindset, weekdays, weekdayDays };
}

export function JournalEquity({ rows, accounts, palette, theme, onAskPrimax }) {
  const [scope, setScope] = useState('active');
  const [selection, setSelection] = useState(null);
  const [period, setPeriod] = useState('All');

  const allAccounts = accounts || [];
  const blownCount = allAccounts.filter(a => a.status === 'blown').length;
  const passedCount = allAccounts.filter(a => a.status === 'passed').length;
  const activeCount = allAccounts.filter(a => (a.status || 'active') === 'active').length;

  const scopedAccounts = useMemo(() => filterAccountsByScope(allAccounts, scope), [allAccounts, scope]);
  const account = allAccounts.some(item => item.id === selection) ? selection : null;
  const effectiveFilter = account !== null ? account : `scope:${scope}`;

  const starting = useMemo(() => {
    const target = account !== null ? allAccounts.filter(item => item.id === account) : scopedAccounts;
    return target.reduce((total, item) => total + Number(item.starting_balance || 0), 0);
  }, [allAccounts, scopedAccounts, account]);

  const { days, splitEstimated } = useMemo(() => {
    let anySplit = false;
    const list = (rows || [])
      .map(row => {
        const res = scopedAccountResults(row, effectiveFilter, allAccounts);
        if (res.some(r => r.split)) anySplit = true;
        return { day: row.day, pnl: recordedTotal(res) };
      })
      .filter(row => row.pnl !== null)
      .sort((a, b) => a.day.localeCompare(b.day));
    return { days: list, splitEstimated: anySplit };
  }, [rows, effectiveFilter, allAccounts]);

  let balance = starting;
  const series = days.map(row => ({ ...row, balance: (balance = Math.round((balance + row.pnl) * 100) / 100) }));
  const net = Math.round((balance - starting) * 100) / 100;
  const winDays = days.filter(d => d.pnl > 0).length;
  const winDayPct = days.length ? Math.round((winDays / days.length) * 100) : null;
  const last = series.at(-1)?.day;
  const first = last && (periods[period] ? shift(last, 1 - periods[period]) : shift(series[0].day, -1));
  const visible = series.filter(row => row.day >= first);
  const opening = series.findLast(row => row.day < first)?.balance ?? starting;
  if (first && visible[0]?.day !== first) visible.unshift({ day: first, balance: opening, pnl: null });

  const colors = palette[theme];
  const figure = {
    data: [{
      type: 'scatter',
      mode: 'lines+markers',
      x: visible.map(row => row.day),
      y: visible.map(row => row.balance),
      customdata: visible.map(row => row.pnl === null ? 'Opening balance' : 'Day P&L: ' + money(row.pnl)),
      marker: { size: 4 },
    }],
    layout: {
      margin: { l: 73, r: 15, t: 15, b: 36 },
      xaxis: { type: 'date', tickformat: '%d %b' },
      yaxis: { rangemode: 'normal' },
      shapes: [{
        type: 'line', xref: 'paper', x0: 0, x1: 1, y0: starting, y1: starting,
        line: { color: colors.muted, dash: 'dot', width: 1 },
      }],
    },
  };

  const scopeChoices = useMemo(() => {
    const base = [
      { value: 'active', label: `Active (${activeCount})` },
      { value: 'funded', label: 'Funded' },
      { value: 'eval', label: 'Eval' },
      { value: 'personal', label: 'Personal' },
    ];
    if (passedCount > 0) base.push({ value: 'passed', label: `Passed (${passedCount})` });
    if (blownCount > 0) base.push({ value: 'blown', label: `Blown (${blownCount})` });
    base.push({ value: 'all', label: 'All' });
    return base;
  }, [activeCount, passedCount, blownCount]);

  const chipAccounts = scopedAccounts.slice(0, MAX_ACCOUNT_CHIPS);
  const showDropdown = scopedAccounts.length > MAX_ACCOUNT_CHIPS || (scope === 'active' && (blownCount > 0 || passedCount > 0));
  const scopeTitle = ACCOUNT_SCOPES.find(s => s.value === scope)?.label || 'Active';

  const insights = useMemo(() => computeDisciplineInsights(rows, effectiveFilter, allAccounts), [rows, effectiveFilter, allAccounts]);
  const hasInsights = Object.values(insights.plan).some(v => v.days > 0) || Object.values(insights.mindset).some(v => v.days > 0);
  const maxWeekdayAbs = Math.max(1, ...Object.values(insights.weekdays).map(v => Math.abs(v)));

  function selectScope(nextScope) {
    setScope(nextScope);
    setSelection(null);
  }

  return <section className="card chart-card history-card pj-equity-card" aria-labelledby="pj-equity-title">
    <div className="section-title pj-equity-header">
      <div>
        <span className="lab-step">JOURNAL RESULTS</span>
        <h2 id="pj-equity-title">Journal equity curve</h2>
      </div>
      <Chips label="Equity range" choices={Object.keys(periods).map(value => ({ label: value, value }))} value={period} onChange={setPeriod}/>
    </div>

    <div className="pj-equity-controls">
      <Chips label="Equity scope" choices={scopeChoices} value={account === null ? scope : null} onChange={selectScope}/>
      <div className="pj-equity-account-row">
        <Chips
          label="Equity curve account"
          choices={[
            { label: scope === 'active' ? 'All active' : `All ${scopeTitle.toLowerCase()}`, value: null },
            ...chipAccounts.map(item => ({ label: item.name, value: item.id })),
          ]}
          value={account}
          onChange={setSelection}
        />
        {showDropdown && (
          <select
            className="pj-equity-picker"
            aria-label="Pick specific account"
            value={account ?? ''}
            onChange={e => setSelection(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Jump to any account…</option>
            {scopedAccounts.length > 0 && <optgroup label={`${scopeTitle} accounts`}>
              {scopedAccounts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.account_type}</option>)}
            </optgroup>}
            {allAccounts.some(a => !scopedAccounts.includes(a)) && <optgroup label="Other accounts">
              {allAccounts.filter(a => !scopedAccounts.includes(a)).map(item => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.account_type}{item.status && item.status !== 'active' ? ` · ${item.status}` : ''}
                </option>
              ))}
            </optgroup>}
          </select>
        )}
      </div>
    </div>

    <p className="pj-equity-note">
      {account !== null
        ? `Showing ${allAccounts.find(a => a.id === account)?.name || 'selected account'} only.`
        : scope === 'active'
          ? `Showing active accounts${blownCount > 0 ? ` (excluding ${blownCount} blown)` : ''}${passedCount > 0 ? ` and excluding ${passedCount} passed` : ''}, plus unassigned Journal trades.`
          : scope === 'all'
            ? 'All accounts combines starting balances across active, passed, and blown accounts, plus unassigned trades.'
            : `Showing ${scopeTitle.toLowerCase()} accounts only.`}
      {splitEstimated && ' Copy-traded cards partially overlapping this filter use an even per-account split.'}
    </p>

    {accounts && <div className="history-headline pj-equity-headline">
      <div><span>Current balance</span><strong>{balanceMoney.format(balance)}</strong></div>
      <div><span>Starting capital</span><strong>{balanceMoney.format(starting)}</strong></div>
      {days.length > 0 && <div><span>Green days</span><strong>{winDays}/{days.length} ({winDayPct}%)</strong></div>}
      <span className={net < 0 ? 'history-loss' : 'history-gain'}>
        Total P&amp;L {money(net)}{starting > 0 && ` · ${(net / starting * 100).toFixed(2)}%`}
      </span>
    </div>}

    {!accounts ? <p>Account balances are unavailable until accounts load.</p> : !days.length ?
      <p className="pj-equity-empty">No recorded Journal trade results for this selection yet.</p> :
      <LabHistory figure={figure} palette={colors} netResult={net} journal/>}

    {hasInsights && (
      <div className="pj-insights" aria-labelledby="pj-insights-title">
        <div className="pj-insights-header">
          <div>
            <span className="lab-step">PROCESS &amp; DISCIPLINE</span>
            <h3 id="pj-insights-title">Discipline &amp; mindset breakdown</h3>
          </div>
          {onAskPrimax && (
            <button
              type="button"
              className="pt-btn pj-primax-debrief-btn"
              onClick={() => onAskPrimax('Review my recent Journal entries and highlight my biggest pattern between plan adherence, mindset, and P&L. Give me 3 sharp adjustments for next session.')}
            >
              <Sparkles size={15} aria-hidden="true"/> Ask Primax for a pattern debrief
            </button>
          )}
        </div>
        <div className="pj-insights-grid">
          <div className="pj-insight-card">
            <h4>Plan followed vs. result</h4>
            <div className="pj-insight-rows">
              {['Yes', 'Partly', 'No'].map(key => {
                const stat = insights.plan[key];
                const wr = stat.pnlDays ? Math.round((stat.wins / stat.pnlDays) * 100) : null;
                return <div key={key} className="pj-insight-row">
                  <span className={`pj-tag tag-${key.toLowerCase()}`}>{key}</span>
                  <span className="pj-insight-days">{stat.days}d{wr !== null ? ` · ${wr}% green` : ''}</span>
                  <strong className={stat.net < 0 ? 'loss' : stat.net > 0 ? 'gain' : ''}>{stat.pnlDays ? money(stat.net) : '—'}</strong>
                </div>;
              })}
            </div>
          </div>

          <div className="pj-insight-card">
            <h4>Mindset vs. result</h4>
            <div className="pj-insight-rows">
              {['Focused', 'Patient', 'Distracted', 'Frustrated'].map(key => {
                const stat = insights.mindset[key];
                return <div key={key} className="pj-insight-row">
                  <span>{key}</span>
                  <span className="pj-insight-days">{stat.days}d</span>
                  <strong className={stat.net < 0 ? 'loss' : stat.net > 0 ? 'gain' : ''}>{stat.pnlDays ? money(stat.net) : '—'}</strong>
                </div>;
              })}
            </div>
          </div>

          <div className="pj-insight-card">
            <h4>Weekday performance</h4>
            <div className="pj-weekday-bars">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(wd => {
                const val = insights.weekdays[wd];
                const pct = Math.round((Math.abs(val) / maxWeekdayAbs) * 100);
                return <div key={wd} className="pj-weekday-row">
                  <span>{wd}</span>
                  <div className="pj-weekday-track">
                    {insights.weekdayDays[wd] > 0 && (
                      <div className={`pj-weekday-fill ${val < 0 ? 'loss' : 'gain'}`} style={{ width: `${Math.max(8, pct)}%` }}/>
                    )}
                  </div>
                  <strong className={val < 0 ? 'loss' : val > 0 ? 'gain' : ''}>{insights.weekdayDays[wd] ? money(val) : '—'}</strong>
                </div>;
              })}
            </div>
          </div>
        </div>
      </div>
    )}
  </section>;
}
