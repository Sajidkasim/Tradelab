import React, { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, Compass, Radio, Share2 } from 'lucide-react';
import { api } from '../api';
import { useBullpen } from '../hooks/usePresence';

const SYMBOLS = ['NQ', 'ES', 'GC', 'EURUSD', 'QQQ'];

const LEVEL_STATUS_CYCLE = ['watching', 'taken', 'hit', 'invalidated'];
const LEVEL_STATUS_LABEL = {
  watching: 'Watching',
  taken: 'Taken',
  hit: 'Hit',
  invalidated: 'Invalidated',
};

export const MARKET_MOVER = /\b(?:CPI|PPI|FOMC|NFP|Payroll|Jobs|JOLTS|GDP|PCE|Retail Sales|Unemployment|Initial Claims|Jobless|Fed|Powell|ISM|PMI|Consumer Confidence|Consumer Sentiment|Durable Goods|Personal Income|Rate Decision|Minutes)\b/i;

const MACRO_FIELDS = [
  { key: 'dgs10', label: '10Y Yield', source: 'tickers' },
  { key: 'cot', label: 'NQ COT Net', source: 'swing' },
  { key: 'cpi', label: 'Core CPI YoY', source: 'swing' },
  { key: 'curve', label: '10Y-2Y Curve', source: 'intraday' },
  { key: 'breakeven', label: '10Y Breakeven', source: 'addons' },
  { key: 'fed', label: 'Fed Liquidity', source: 'swing' },
];

export function parseEventMs(ev) {
  const raw = ev?.scheduled_at || ev?.date || ev?.time;
  if (!raw) return NaN;
  const normalized = typeof raw === 'string' && raw.length === 16 && raw.includes(' ')
    ? raw.replace(' ', 'T') + ':00Z'
    : raw;
  return Date.parse(normalized);
}

export function formatEventTime(ms, fallback) {
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

function formatTimeAgo(unixSec) {
  if (!Number.isFinite(unixSec)) return '';
  const diffMin = Math.max(0, Math.round((Date.now() / 1000 - unixSec) / 60));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const hrs = Math.floor(diffMin / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function BullpenNewsPanel({ snapshot, calendar = [], loading = false, onDropHeadline, isDisabled = false }) {
  const [showPast, setShowPast] = useState(false);
  const [squawk, setSquawk] = useState([]);
  const [squawkLoading, setSquawkLoading] = useState(true);
  const [droppedUrl, setDroppedUrl] = useState('');

  useEffect(() => {
    let active = true;
    async function loadSquawk() {
      try {
        const res = await api('/bullpen/macro-feed');
        if (active && Array.isArray(res?.items)) {
          setSquawk(res.items.slice(0, 12));
        }
      } catch {
        // Leave empty gracefully
      } finally {
        if (active) setSquawkLoading(false);
      }
    }
    void loadSquawk();
    const timer = setInterval(loadSquawk, 90_000);
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

  async function handleDrop(item) {
    if (!onDropHeadline || isDisabled) return;
    const ok = await onDropHeadline(item);
    if (ok) {
      setDroppedUrl(item.url);
      setTimeout(() => setDroppedUrl((prev) => (prev === item.url ? '' : prev)), 2500);
    }
  }

  return (
    <section className="bullpen-desk-panel" aria-label="Desk macro, calendar, and live squawk">
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

      <div className="bullpen-desk-block">
        <div className="bullpen-desk-row">
          <div className="bullpen-desk-heading"><Radio size={14} /> Live Market Squawk</div>
        </div>
        {squawkLoading ? (
          <p className="bullpen-desk-muted">Loading squawk wire…</p>
        ) : squawk.length ? (
          <ul className="bullpen-squawk-list">
            {squawk.map((item) => (
              <li key={item.url}>
                <div className="bullpen-squawk-body">
                  <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
                  <small>{item.source}{item.published ? ` · ${formatTimeAgo(item.published)}` : ''}</small>
                </div>
                {onDropHeadline && (
                  <button
                    type="button"
                    className="bullpen-squawk-drop"
                    disabled={isDisabled}
                    onClick={() => handleDrop(item)}
                    title="Drop headline in Floor chat"
                  >
                    <Share2 size={12} />
                    <span>{droppedUrl === item.url ? 'Sent' : 'Chat'}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="bullpen-desk-muted">No fresh macro squawk headlines right now.</p>
        )}
      </div>
    </section>
  );
}

export function BullpenLevelsPanel({ desk, onDeskUpdate, isDisabled = false }) {
  const { send } = useBullpen();
  const [symbol, setSymbol] = useState('NQ');
  const [price, setPrice] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function addLevel(event) {
    event.preventDefault();
    if (!price.trim() || !label.trim() || busy || isDisabled) return;
    setBusy(true);
    try {
      const updated = await api('/bullpen/desk', {
        method: 'PUT',
        body: { add_level: { symbol, price: price.trim(), label: label.trim() } },
      });
      onDeskUpdate?.(updated);
      setPrice('');
      setLabel('');
      void send('desk', { action: 'level' });
    } finally {
      setBusy(false);
    }
  }

  async function cycleLevelStatus(lvl) {
    if (busy || isDisabled) return;
    const current = LEVEL_STATUS_CYCLE.includes(lvl.status) ? lvl.status : 'watching';
    const next = LEVEL_STATUS_CYCLE[(LEVEL_STATUS_CYCLE.indexOf(current) + 1) % LEVEL_STATUS_CYCLE.length];
    setBusy(true);
    try {
      const updated = await api('/bullpen/desk', {
        method: 'PUT',
        body: { update_level_status: { id: lvl.id, status: next } },
      });
      onDeskUpdate?.(updated);
      void send('desk', { action: 'level_status' });
    } finally {
      setBusy(false);
    }
  }

  async function removeLevel(id) {
    if (busy || isDisabled) return;
    setBusy(true);
    try {
      const updated = await api('/bullpen/desk', {
        method: 'PUT',
        body: { remove_level_id: id },
      });
      onDeskUpdate?.(updated);
      void send('desk', { action: 'level' });
    } finally {
      setBusy(false);
    }
  }

  const levels = desk?.levels || [];

  return (
    <section className="bullpen-desk-panel" aria-label="Shared key levels">
      <div className="bullpen-desk-block">
        <div className="bullpen-desk-row">
          <div className="bullpen-desk-heading">Shared Key Levels ({desk?.day || 'Today'})</div>
          <span className="bullpen-desk-muted">{levels.length}/25</span>
        </div>
        <form className="bullpen-level-form" onSubmit={addLevel}>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol" disabled={isDisabled}>
            {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (e.g. 21480)" maxLength={24} disabled={isDisabled} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Level (e.g. PDH, 4H FVG)" maxLength={80} disabled={isDisabled} />
          <button type="submit" disabled={busy || isDisabled || !price.trim() || !label.trim()} aria-label="Add key level">
            <Plus size={15} />
          </button>
        </form>
        {levels.length ? (
          <ul className="bullpen-level-list">
            {levels.map((lvl) => {
              const statusKey = LEVEL_STATUS_CYCLE.includes(lvl.status) ? lvl.status : 'watching';
              return (
                <li key={lvl.id} className={`is-lvl-${statusKey}`}>
                  <div className="bullpen-lvl-main">
                    <span className="bullpen-lvl-sym">{lvl.symbol}</span>
                    <strong>{lvl.price}</strong>
                    <span>{lvl.label}</span>
                    <small>by {lvl.author}</small>
                  </div>
                  <div className="bullpen-lvl-actions">
                    <button
                      type="button"
                      className={`bullpen-lvl-status is-${statusKey}`}
                      onClick={() => cycleLevelStatus(lvl)}
                      disabled={busy || isDisabled}
                      title="Click to cycle status: Watching → Taken → Hit → Invalidated"
                    >
                      {LEVEL_STATUS_LABEL[statusKey]}
                    </button>
                    <button type="button" onClick={() => removeLevel(lvl.id)} disabled={busy || isDisabled} aria-label={`Remove ${lvl.label}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bullpen-desk-muted">No levels pinned yet. Add PDH, PDL, or key FVGs — tap any status badge to mark Watching, Taken, Hit, or Invalidated.</p>
        )}
      </div>
    </section>
  );
}
