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

function formatCountdown(isoOrEpoch) {
  if (!isoOrEpoch) return '';
  const target = typeof isoOrEpoch === 'number' ? isoOrEpoch : Date.parse(isoOrEpoch);
  if (!Number.isFinite(target)) return '';
  const diffMin = Math.round((target - Date.now()) / 60000);
  if (diffMin < -30) return 'Released';
  if (diffMin <= 0) return 'LIVE';
  if (diffMin < 60) return `in ${diffMin}m`;
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return `in ${hrs}h ${mins}m`;
}

export function BullpenNewsPanel() {
  const [matrix, setMatrix] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const snap = await api('/matrix/snapshot');
        if (!active) return;
        setMatrix(snap);
        const fmp = Array.isArray(snap?.calendar) ? snap.calendar : [];
        if (fmp.length) {
          setCalendar(fmp.slice(0, 12));
        } else {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
          const econ = await api(`/backtesting/economic-calendar?day=${today}&scope=month`).catch(() => null);
          if (active && Array.isArray(econ?.events)) {
            setCalendar(econ.events.slice(0, 12));
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

  const swing = matrix?.desks?.swing || matrix?.swing;
  const intraday = matrix?.desks?.intraday || matrix?.intraday;

  return (
    <section className="bullpen-desk-panel" aria-label="Desk macro and calendar">
      <div className="bullpen-desk-block">
        <div className="bullpen-desk-heading"><Compass size={14} /> Matrix Macro Bias</div>
        {loading ? (
          <p className="bullpen-desk-muted">Loading Matrix snapshot…</p>
        ) : (swing || intraday) ? (
          <div className="bullpen-macro-grid">
            {swing && (
              <div className="bullpen-macro-card">
                <span>Swing Desk</span>
                <strong>{swing.bias || swing.verdict || swing.regime || '—'}</strong>
                {swing.score !== undefined && <small>Score {swing.score}</small>}
              </div>
            )}
            {intraday && (
              <div className="bullpen-macro-card">
                <span>Intraday Desk</span>
                <strong>{intraday.bias || intraday.verdict || intraday.regime || '—'}</strong>
                {intraday.score !== undefined && <small>Score {intraday.score}</small>}
              </div>
            )}
          </div>
        ) : (
          <p className="bullpen-desk-muted">Open The Matrix to view full macro readings.</p>
        )}
      </div>

      <div className="bullpen-desk-block">
        <div className="bullpen-desk-heading"><CalendarClock size={14} /> High-Impact US Calendar</div>
        {loading ? (
          <p className="bullpen-desk-muted">Loading schedule…</p>
        ) : calendar.length ? (
          <ul className="bullpen-cal-list">
            {calendar.map((ev, i) => {
              const when = ev.scheduled_at || ev.date || ev.time;
              const title = ev.title || ev.event || ev.name || 'US Release';
              const countdown = formatCountdown(when);
              return (
                <li key={ev.id || `${title}-${i}`}>
                  <div>
                    <strong>{title}</strong>
                    <small>{ev.impact ? `${ev.impact} · ` : ''}{when ? String(when).slice(0, 16).replace('T', ' ') : ''}</small>
                  </div>
                  {countdown && <span className={`bullpen-countdown${countdown === 'LIVE' ? ' is-live' : ''}`}>{countdown}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bullpen-desk-muted">No scheduled US high-impact events right now.</p>
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
