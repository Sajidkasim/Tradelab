import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Shield, ShieldAlert, ShieldCheck, SlidersHorizontal, Wind,
} from 'lucide-react';
import { api } from '../api';

function fmtUsd(value) {
  const abs = Math.abs(Number(value) || 0);
  const digits = Number.isInteger(abs) ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  }).format(abs);
}

function parseLimit(raw, { integer = false, max = 1000000 } = {}) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0 || num > max) return undefined;
  if (num === 0) return null;
  return integer ? Math.round(num) : Math.round(num * 100) / 100;
}

export function evaluateRiskGuard({ dailyLossLimit, maxDailyTrades, dayPnl, tradeCount }) {
  const hasLossLimit = typeof dailyLossLimit === 'number' && dailyLossLimit > 0;
  const hasTradeLimit = typeof maxDailyTrades === 'number' && maxDailyTrades > 0;
  const configured = hasLossLimit || hasTradeLimit;

  const lossUsed = dayPnl != null && dayPnl < 0 ? Math.abs(dayPnl) : 0;
  const lossRatio = hasLossLimit ? lossUsed / dailyLossLimit : 0;
  const lossPct = hasLossLimit ? Math.min(100, Math.round(lossRatio * 100)) : 0;
  const lossRemaining = hasLossLimit ? Math.max(0, Math.round((dailyLossLimit - lossUsed) * 100) / 100) : null;

  const tradesRatio = hasTradeLimit ? tradeCount / maxDailyTrades : 0;
  const lossBreached = hasLossLimit && lossUsed >= dailyLossLimit;
  const lossWarning = hasLossLimit && !lossBreached && lossRatio >= 0.75;
  const tradesBreached = hasTradeLimit && tradeCount > maxDailyTrades;
  const tradesAtCap = hasTradeLimit && tradeCount === maxDailyTrades;
  const tradesWarning = hasTradeLimit && !tradesBreached && !tradesAtCap && maxDailyTrades >= 2 && tradesRatio >= 0.75;

  let tone = 'unset';
  if (configured) {
    if (lossBreached || tradesBreached) tone = 'lockout';
    else if (lossWarning || tradesAtCap || tradesWarning) tone = 'warning';
    else tone = 'safe';
  }

  let headline = 'Session Risk Guard';
  if (tone === 'lockout') {
    headline = lossBreached ? 'Daily loss limit reached — lock the desk' : 'Daily trade cap exceeded — step away';
  } else if (tone === 'warning') {
    headline = tradesAtCap
      ? `Trade cap reached (${tradeCount}/${maxDailyTrades}) — no new entries`
      : 'Approaching daily risk limit';
  } else if (tone === 'safe') {
    headline = dayPnl != null && dayPnl > 0 ? 'Risk Guard · In profit' : 'Risk Guard · Clear';
  }

  return {
    configured,
    hasLossLimit,
    hasTradeLimit,
    lossUsed,
    lossPct,
    lossRemaining,
    lossBreached,
    lossWarning,
    tradesBreached,
    tradesAtCap,
    tradesWarning,
    tone,
    headline,
  };
}

export default function SessionRiskGuard({ preferences, dayPnl, tradeCount = 0, onSaved }) {
  const dailyLossLimit = preferences?.daily_loss_limit ?? null;
  const maxDailyTrades = preferences?.max_daily_trades ?? null;

  const [editing, setEditing] = useState(false);
  const [lossDraft, setLossDraft] = useState(dailyLossLimit != null ? String(dailyLossLimit) : '');
  const [tradesDraft, setTradesDraft] = useState(maxDailyTrades != null ? String(maxDailyTrades) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLossDraft(dailyLossLimit != null ? String(dailyLossLimit) : '');
    setTradesDraft(maxDailyTrades != null ? String(maxDailyTrades) : '');
  }, [dailyLossLimit, maxDailyTrades]);

  const status = evaluateRiskGuard({ dailyLossLimit, maxDailyTrades, dayPnl, tradeCount });

  async function saveLimits(nextLoss, nextTrades) {
    setBusy(true);
    setError('');
    try {
      const updated = await api('/journal-preferences', {
        method: 'PUT',
        body: {
          timezone: preferences?.timezone || 'America/New_York',
          daily_loss_limit: nextLoss ?? 0,
          max_daily_trades: nextTrades ?? 0,
        },
      });
      onSaved?.(updated);
      setEditing(false);
    } catch (e) {
      setError(e.message || 'Could not save risk limits.');
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const parsedLoss = parseLimit(lossDraft, { integer: false, max: 1000000 });
    const parsedTrades = parseLimit(tradesDraft, { integer: true, max: 50 });
    if (parsedLoss === undefined) {
      setError('Enter a daily loss limit between $0 and $1,000,000.');
      return;
    }
    if (parsedTrades === undefined) {
      setError('Enter a max daily trade cap between 0 and 50.');
      return;
    }
    saveLimits(parsedLoss, parsedTrades);
  }

  const Icon = status.tone === 'lockout'
    ? ShieldAlert
    : status.tone === 'warning'
      ? AlertTriangle
      : status.tone === 'safe'
        ? ShieldCheck
        : Shield;

  return (
    <section
      className={`pj-risk-guard is-${status.tone}`}
      aria-label="Session risk guard"
    >
      <div className="pj-risk-head">
        <div className="pj-risk-title">
          <Icon size={16} aria-hidden="true" />
          <strong>{status.headline}</strong>
          {!status.configured && !editing && (
            <span className="pj-risk-sub">Set a daily loss cap and max trade count to guard against tilt.</span>
          )}
        </div>
        <div className="pj-risk-actions">
          {(status.tone === 'lockout' || status.tone === 'warning') && (
            <a className="pj-risk-reset-link" href="/mindset?reset=1">
              <Wind size={13} aria-hidden="true" />
              <span>60s Tilt Reset</span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            className="pj-risk-edit-btn"
            aria-expanded={editing}
            disabled={busy}
            onClick={() => {
              setError('');
              setEditing((open) => !open);
            }}
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            <span>{editing ? 'Close' : status.configured ? 'Edit limits' : 'Set limits'}</span>
          </button>
        </div>
      </div>

      {status.configured && (
        <div className={`pj-risk-meters${status.hasLossLimit && status.hasTradeLimit ? ' is-dual' : ''}`}>
          {status.hasLossLimit && (
            <div className="pj-risk-meter">
              <div className="pj-risk-meter-head">
                <span>Daily loss buffer</span>
                <strong>
                  {status.lossBreached
                    ? `-${fmtUsd(status.lossUsed)} / -${fmtUsd(dailyLossLimit)} (${status.lossPct}%)`
                    : status.lossUsed > 0
                      ? `-${fmtUsd(status.lossUsed)} / -${fmtUsd(dailyLossLimit)} · ${fmtUsd(status.lossRemaining)} left`
                      : `${fmtUsd(dailyLossLimit)} buffer intact`}
                </strong>
              </div>
              <div
                className="pj-risk-bar"
                role="progressbar"
                aria-label="Daily loss limit used"
                aria-valuemin={0}
                aria-valuemax={dailyLossLimit}
                aria-valuenow={Math.min(status.lossUsed, dailyLossLimit)}
                aria-valuetext={`${status.lossPct}% of daily loss limit used`}
              >
                <span
                  className={`pj-risk-bar-fill${status.lossBreached ? ' is-lockout' : status.lossWarning ? ' is-warning' : ''}`}
                  style={{ width: `${status.lossPct}%` }}
                />
              </div>
            </div>
          )}

          {status.hasTradeLimit && (
            <div className="pj-risk-meter">
              <div className="pj-risk-meter-head">
                <span>Trade cap</span>
                <strong>
                  {tradeCount} / {maxDailyTrades} {maxDailyTrades === 1 ? 'trade' : 'trades'}
                </strong>
              </div>
              {maxDailyTrades <= 10 ? (
                <div className="pj-risk-pips" aria-hidden="true">
                  {Array.from({ length: maxDailyTrades }, (_, idx) => (
                    <span
                      key={idx}
                      className={`pj-risk-pip${idx < tradeCount ? ' is-used' : ''}${status.tradesBreached ? ' is-lockout' : status.tradesAtCap || status.tradesWarning ? ' is-warning' : ''}`}
                    />
                  ))}
                  {tradeCount > maxDailyTrades && (
                    <span className="pj-risk-over">+{tradeCount - maxDailyTrades}</span>
                  )}
                </div>
              ) : (
                <div className="pj-risk-bar" aria-hidden="true">
                  <span
                    className={`pj-risk-bar-fill${status.tradesBreached ? ' is-lockout' : status.tradesAtCap || status.tradesWarning ? ' is-warning' : ''}`}
                    style={{ width: `${Math.min(100, Math.round((tradeCount / maxDailyTrades) * 100))}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {editing && (
        <form className="pj-risk-form" onSubmit={handleSubmit}>
          <label>
            <span>Daily max loss ($)</span>
            <input
              type="number"
              min="0"
              max="1000000"
              step="10"
              placeholder="e.g. 500"
              value={lossDraft}
              disabled={busy}
              onChange={(e) => setLossDraft(e.target.value)}
            />
          </label>
          <label>
            <span>Max trades / day</span>
            <input
              type="number"
              min="0"
              max="50"
              step="1"
              placeholder="e.g. 3"
              value={tradesDraft}
              disabled={busy}
              onChange={(e) => setTradesDraft(e.target.value)}
            />
          </label>
          <div className="pj-risk-form-actions">
            <button type="submit" className="pt-btn pt-btn-dark" disabled={busy}>
              {busy ? 'Saving…' : 'Save limits'}
            </button>
            {status.configured && (
              <button
                type="button"
                className="pt-btn"
                disabled={busy}
                onClick={() => saveLimits(null, null)}
              >
                Clear limits
              </button>
            )}
          </div>
          {error && <p className="pj-risk-error" role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
