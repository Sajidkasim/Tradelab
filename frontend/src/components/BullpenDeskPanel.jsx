import React, { useEffect, useState } from 'react';
import { CalendarClock, TrendingUp, TrendingDown, Minus, Plus, Trash2, Compass } from 'lucide-react';
import { api } from '../api';
import { useBullpen } from '../hooks/usePresence';

const BIAS_OPTIONS = [
  { id: 'bullish', label: 'Bullish', icon: TrendingUp },
  { id: 'neutral', label: 'Neutral', icon: Minus },
  { id: 'bearish', label: 'Bearish', icon: TrendingDown },
];

const SYMBOLS = ['NQ', 'ES', 'GC', 'EURUSD', 'QQQ'];

const MARKET_MOVER = /\b(?:CPI|PPI|FOMC|NFP|Payroll|Jobs|JOLTS|GDP|PCE|Retail Sales|Unemployment|Initial Claims|Jobless|Fed|Powell|ISM|PMI|Consumer Confidence|Consumer Sentiment|Durable Goods|Personal Income|Rate Decision|Minutes)\b/i;

const MACRO_FIELDS = [
  { key: 'dgs10', label: '10Y Yield', source: 'tickers' },
  { key: 'cot', label: 'NQ COT Net', source: 'swing' },
  { key: 'cpi', label: 'Core CPI YoY', source: 'swing' },
  { key: 'curve', label: '10Y-2Y Curve', source: 'intraday' },
  { key: 'breakeven', label: '10Y Breakeven', source: 'addons' },
  { key: 'fed', label: 'Fed Liquidity', source: 'swing' },
];

function parseEventMs(ev) {
  const raw = ev?.scheduled_at || ev?.date || ev?.time;
  if (!raw) return NaN;
  const normalized = typeof raw === 'string' && raw.length === 16 && raw.includes(' ')
    ? raw.replace(' ', 'T') + ':00Z'
    : raw;
  return Date.parse(normalized);
}

function formatEventTime(ms, fallback) {
  if (!Number.isFinite(ms)) return fallback ? String(fallback).slice(0, 16).replace('T', ' ') : '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms)) + ' ET';
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms)) return '';
  const diffMin = Math.round((ms - Date.now()) / 60000);
  if (diffMin < -30) return 'Released';
  if (diffMin <= 0) return 'LIVE';
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffMin < 1440) {
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return mins ? `in ${hrs}h ${mins}m` : `in ${hrs}h`;
  }
  const days = Math.ceil(diffMin / 1440);
  return `in ${days}d`;
}

export function BullpenNewsPanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [showPast, setShowPast] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await api('/matrix/snapshot');
        if (!active) return;
        const snap = res?.snapshot || (res?.tickers || res?.swing ? res : null);
        setSnapshot(snap);
        const fmp = Array.isArray(snap?.calendar) ? snap.calendar : [];
        if (fmp.length) {
          setCalendar(fmp);
        } else {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
          const econ = await api(`/backtesting/economic-calendar?day=${today}&scope=month`).catch(() => null);
          if (active && Array.isArray(econ?.events)) {
            setCalendar(econ.events);
          }
        }
      } catch {
        // Leave empty gracefully
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 180_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const readings = [];
  if (snapshot) {
    const pools = {
      tickers: Array.isArray(snapshot.tickers) ? snapshot.tickers : [],
      swing: Array.isArray(snapshot.swing?.metrics) ? snapshot.swing.metrics : [],
      intraday: Array.isArray(snapshot.intraday?.metrics) ? snapshot.intraday.metrics : [],
      addons: Array.isArray(snapshot.addons) ? snapshot.addons : [],
    };
    for (const field of MACRO_FIELDS) {
      const hit = pools[field.source]?.find((item) => item?.id === field.key);
      if (hit?.value) readings.push({ ...field, value: hit.value, change: hit.change, direction: hit.direction });
    }
  }

  const nowMs = Date.now();
  const normalizedEvents = calendar
    .map((ev, idx) => {
      const title = ev.title || ev.event || ev.name || 'US Release';
      const ms = parseEventMs(ev);
      return { id: ev.id || `${title}-${idx}`, title, ms, raw: ev.scheduled_at || ev.date || ev.time, actual: ev.actual, estimate: ev.estimate };
    })
    .filter((ev) => MARKET_MOVER.test(ev.title))
    .sort((a, b) => (a.ms || 0) - (b.ms || 0));

  const upcoming = normalizedEvents.filter((ev) => !Number.isFinite(ev.ms) || ev.ms >= nowMs - 30 * 60000);
  const past = normalizedEvents.filter((ev) => Number.isFinite(ev.ms) && ev.ms < nowMs - 30 * 60000).reverse();
  const visibleEvents = showPast ? [...upcoming, ...past].slice(0, 12) : upcoming.slice(0, 8);
  const nextEvent = upcoming[0] || null;

  return (
    <section className="bullpen-desk-panel" aria-label="Desk macro and calendar">
      <div className="bullpen-desk-block">
        <div className="bullpen-desk-row">
          <div className="bullpen-desk-heading"><Compass size={14} /> Matrix Macro Pulse</div>
          <a className="bullpen-desk-link" href="/matrix">Full Matrix ↗</a>
        </div>
        {loading ? (
          <p className="bullpen-desk-muted">Loading Matrix readings…</p>
        ) : readings.length ? (
          <div className="bullpen-macro-grid">
            {readings.map((r) => (
              <div key={r.key} className="bullpen-macro-card">
                <span>{r.label}</span>
                <div className="bullpen-macro-val">
                  <strong>{r.value}</strong>
                  {r.change && <small className={r.direction === 'up' ? 'is-up' : r.direction === 'down' ? 'is-down' : ''}>{r.change}</small>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="bullpen-desk-muted">No cached Matrix readings yet. Open The Matrix to refresh.</p>
        )}
      </div>

      <div className="bullpen-desk-block">
        <div className="bullpen-desk-row">
          <div className="bullpen-desk-heading"><CalendarClock size={14} /> Upcoming US Catalysts</div>
          {past.length > 0 && (
            <button type="button" className="bullpen-desk-toggle" onClick={() => setShowPast((v) => !v)}>
              {showPast ? 'Hide past' : `Past (${past.length})`}
            </button>
          )}
        </div>
        {nextEvent && (
          <div className="bullpen-next-event">
            <div>
              <span className="bullpen-next-label">NEXT RED-FOLDER</span>
              <strong>{nextEvent.title}</strong>
              <small>{formatEventTime(nextEvent.ms, nextEvent.raw)}</small>
            </div>
            <span className={`bullpen-countdown${formatCountdown(nextEvent.ms) === 'LIVE' ? ' is-live' : ' is-next'}`}>
              {formatCountdown(nextEvent.ms)}
            </span>
          </div>
        )}
        {loading ? (
          <p className="bullpen-desk-muted">Loading schedule…</p>
        ) : visibleEvents.length ? (
          <ul className="bullpen-cal-list">
            {visibleEvents.map((ev) => {
              const countdown = formatCountdown(ev.ms);
              return (
                <li key={ev.id}>
                  <div>
                    <strong>{ev.title}</strong>
                    <small>
                      {formatEventTime(ev.ms, ev.raw)}
                      {ev.estimate != null ? ` · Est ${ev.estimate}` : ''}
                      {ev.actual != null ? ` · Act ${ev.actual}` : ''}
                    </small>
                  </div>
                  {countdown && <span className={`bullpen-countdown${countdown === 'LIVE' ? ' is-live' : ''}`}>{countdown}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bullpen-desk-muted">No remaining major US catalysts this month.</p>
        )}
      </div>
    </section>
  );
}

export function BullpenLevelsPanel() {
  const { access, deskVersion, send } = useBullpen();
  const [desk, setDesk] = useState({ day: '', biases: {}, levels: [] });
  const [symbol, setSymbol] = useState('NQ');
  const [price, setPrice] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api('/bullpen/desk').then((data) => {
      if (active && data) setDesk(data);
    }).catch(() => {});
    return () => { active = false; };
  }, [deskVersion]);

  async function setBias(next) {
    setBusy(true);
    try {
      const current = desk.biases?.[access?.name];
      const updated = await api('/bullpen/desk', {
        method: 'PUT',
        body: { bias: current === next ? null : next },
      });
      setDesk(updated);
      void send('desk', { action: 'bias' });
    } finally {
      setBusy(false);
    }
  }

  async function addLevel(event) {
    event.preventDefault();
    if (!price.trim() || !label.trim() || busy) return;
    setBusy(true);
    try {
      const updated = await api('/bullpen/desk', {
        method: 'PUT',
        body: { add_level: { symbol, price: price.trim(), label: label.trim() } },
      });
      setDesk(updated);
      setPrice('');
      setLabel('');
      void send('desk', { action: 'level' });
    } finally {
      setBusy(false);
    }
  }

  async function removeLevel(id) {
    setBusy(true);
    try {
      const updated = await api('/bullpen/desk', {
        method: 'PUT',
        body: { remove_level_id: id },
      });
      setDesk(updated);
      void send('desk', { action: 'level' });
    } finally {
      setBusy(false);
    }
  }

  const myBias = desk.biases?.[access?.name] || null;
  const biasEntries = Object.entries(desk.biases || {});

  return (
    <section className="bullpen-desk-panel" aria-label="Shared key levels and team bias">
      <div className="bullpen-desk-block">
        <div className="bullpen-desk-heading">Your Daily Bias ({desk.day || 'Today'})</div>
        <div className="bullpen-bias-picker" role="group" aria-label="Select daily bias">
          {BIAS_OPTIONS.map(({ id, label: lbl, icon: Icon }) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              className={`bullpen-bias-btn is-${id}${myBias === id ? ' is-selected' : ''}`}
              onClick={() => setBias(id)}
            >
              <Icon size={14} /> {lbl}
            </button>
          ))}
        </div>
        {biasEntries.length > 0 && (
          <div className="bullpen-bias-roster">
            {biasEntries.map(([trader, bias]) => (
              <span key={trader} className={`bullpen-bias-chip is-${bias}`}>
                {trader}: {bias}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bullpen-desk-block">
        <div className="bullpen-desk-heading">Shared Key Levels</div>
        <form className="bullpen-level-form" onSubmit={addLevel}>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (e.g. 21480)" maxLength={24} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Level (e.g. PDH, 4H FVG)" maxLength={80} />
          <button type="submit" disabled={busy || !price.trim() || !label.trim()} aria-label="Add key level">
            <Plus size={15} />
          </button>
        </form>
        {desk.levels.length ? (
          <ul className="bullpen-level-list">
            {desk.levels.map((lvl) => (
              <li key={lvl.id}>
                <div>
                  <span className="bullpen-lvl-sym">{lvl.symbol}</span>
                  <strong>{lvl.price}</strong>
                  <span>{lvl.label}</span>
                  <small>by {lvl.author}</small>
                </div>
                <button type="button" onClick={() => removeLevel(lvl.id)} aria-label={`Remove ${lvl.label}`}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="bullpen-desk-muted">No levels pinned yet. Add PDH, PDL, or key FVGs for the team.</p>
        )}
      </div>
    </section>
  );
}
