import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, Circle, X } from "lucide-react";
import TradingRings, { ringPillars, type PillarScores } from "./TradingRings";
import { api } from "./api";
import "./compound-edge.css";

type TaskKey = "checklist" | "mindset" | "journal" | "plan" | "replay" | "lab";
type Day = { date: string; pillars: PillarScores; score: number; off: boolean };
type HabitSummary = {
  today: string;
  days: Day[];
  pillars: PillarScores;
  score: number;
  tasks: Record<TaskKey, boolean>;
  current_streak: number;
  longest_streak: number;
  days_kept: number;
  rest_days?: number[];
  habits?: { completed: number; total: number };
};
const actions: readonly (readonly [TaskKey, string, string, string][])[] = [
  [["checklist", "Pre-session checklist", "Open checklist", "#prep-checklist"],
   ["mindset", "Mindset exercise", "Open warm-up", "#warm-up-title"]],
  [["journal", "Save a pre-trade plan", "Open Journal", "/journal#journal-entry"],
   ["plan", "Confirm you followed your plan", "Open plan check", "/journal#journal-plan-followed"]],
  [["replay", "20 active replay minutes", "Open Backtesting", "/backtesting"],
   ["lab", "Save a Lab note or review five trades", "Open Trades", "/lab#trades"]],
];
const emptyScores: PillarScores = [0, 0, 0];

export function useHabitSummary() {
  const [data, setData] = useState<HabitSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const summary = await api("/compound-edge", { signal: controller.signal });
        if (!controller.signal.aborted) { setData(summary); setError(""); }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Couldn’t refresh your routine.");
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("primus:habits-saved", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("primus:habits-saved", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return { data, setData, error, loading: !data && !error };
}

function PillarCards({ data, onJump }: { data: HabitSummary; onJump: (href: string) => void }) {
  return <div className="ce-action-grid grid gap-3">
    {ringPillars.map(({ name, cap, color }, i) => <section className="ce-panel ce-action" key={name}>
      <div className="ce-action-heading"><h3 className={`ce-tone-${color}`}>{name}</h3><span>{data.pillars[i]} / {cap}</span></div>
      <ul>{actions[i].map(([key, title, link, href]) => <li key={key}>
        {data.tasks[key] ? <Check className={`ce-tone-${color}`} size={16} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
        <span><span className="ce-sr">{data.tasks[key] ? "Complete: " : "To do: "}</span>{title}</span>
        <a href={href} onClick={(event) => {
          if (!href.startsWith("#")) return;
          event.preventDefault();
          onJump(href);
        }}>{link}<ArrowUpRight size={12} aria-hidden="true" /></a>
      </li>)}</ul>
    </section>)}
  </div>;
}

export function ConsistencyCurve({ days }: { days: Day[] }) {
  let earned = 0;
  let available = 0;
  const series = [{ ideal: 1, actual: 1 }, ...days.map((day) => {
    if (!day.off) { available += 1; earned += day.score; }
    return { ideal: 1.01 ** available, actual: 1.01 ** (earned / 100) };
  })];
  const range = Math.max(0.01, series.at(-1).ideal - 1);
  const points = (key: "ideal" | "actual") => series.map((value, i) =>
    `${(i * 320 / (series.length - 1)).toFixed(2)},${(53 - (value[key] - 1) * 49 / range).toFixed(2)}`).join(" ");
  return <figure className="ce-panel ce-curve">
    <figcaption><strong>Consistency Index</strong><small>A measure of showing up, not trading performance or returns.</small></figcaption>
    {available >= 2 ? <><svg viewBox="0 0 320 56" preserveAspectRatio="none" role="img" aria-label="Actual routine consistency and ideal qualifying-day consistency">
      <polyline className="ce-ideal" points={points("ideal")} />
      <polyline points={points("actual")} />
    </svg>
    <small>Solid · Your routine　 Dashed · Every qualifying day</small></> : <svg className="ce-preview-curve" viewBox="0 0 320 56" preserveAspectRatio="none"
      role="img" aria-label="Illustrative consistency target before enough qualifying days are recorded">
      <polyline points={Array.from({ length: 41 }, (_, i) =>
        `${i * 8},${52 - 47 * (1.01 ** (365 * i / 40) - 1) / (1.01 ** 365 - 1)}`).join(" ")} />
    </svg>}
  </figure>;
}

function description(day: Day) {
  const detail = ringPillars.map(({ name, cap }, i) => `${name} ${day.pillars[i]}/${cap}`).join(", ");
  return `${day.date} · ${day.off ? "Rest day or market closure · " : ""}${day.score}/100 · ${detail}`;
}

export function YearlyCompoundGrid({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focused = Math.min(cursor ?? days.length - 1, days.length - 1);
  const offset = days.length ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  return <section className="ce-panel" aria-label="Routine history">
    <h3>Your routine history</h3>
    {days.length < 2 ? <div className="ce-grid-scroll">
      <div className="ce-grid ce-ghost-grid" role="img" aria-label="Preview of the 365-day routine grid">
        {Array.from({ length: 365 }, (_, i) => <span className="ce-square" key={i} aria-hidden="true" />)}
      </div>
    </div> : <>
      <div className="ce-grid-scroll">
        <div className="ce-grid" aria-label="Daily routine history">
          {Array.from({ length: offset }, (_, i) => <span aria-hidden="true" key={`space-${i}`} />)}
          {days.map((day, i) => {
            const tier = day.off ? "rest" : day.score === 100 ? "full" : day.score >= 50 ? "kept" : day.score > 0 ? "partial" : "empty";
            return <button key={day.date} ref={node => { buttons.current[i] = node; }} type="button"
              className={`ce-square ce-${tier}`} aria-label={description(day)} tabIndex={focused === i ? 0 : -1}
              onFocus={() => { setCursor(i); setActive(i); }} onBlur={() => setActive(null)}
              onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}
              onClick={() => setActive(i)} onKeyDown={event => {
                const delta: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
                if (!(event.key in delta)) return;
                event.preventDefault();
                buttons.current[Math.max(0, Math.min(days.length - 1, i + delta[event.key]))]?.focus();
              }} />;
          })}
          {Array.from({ length: (7 - (offset + days.length) % 7) % 7 }, (_, i) =>
            <span className="ce-square ce-future" key={`future-${i}`} aria-hidden="true" />)}
        </div>
      </div>
      <div className="ce-history-key">{[["empty", "No points"], ["partial", "Started"], ["kept", "Kept"], ["full", "Complete"], ["rest", "Rest"]].map(([tier, label]) =>
        <span key={tier}><i className={`ce-square ce-${tier}`} aria-hidden="true" />{label}</span>)}</div>
      {active !== null && days[active] && <div className="ce-day-tooltip" role="tooltip">{description(days[active])}</div>}
    </>}
  </section>;
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function RestDaySettings({ days, onSaved }: { days: number[]; onSaved: (data: HabitSummary) => void }) {
  const [selected, setSelected] = useState(days);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      onSaved(await api("/compound-edge/rest-days", { method: "PUT", body: { days: selected } }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t refresh your routine.");
    } finally {
      setSaving(false);
    }
  }
  return <details>
    <summary>Rest days</summary>
    <fieldset className="ce-rest-settings" disabled={saving}>
      <legend>Skip these weekdays when counting streaks</legend>
      {weekdays.map((day, i) => <label key={day}>
        <input type="checkbox" checked={selected.includes(i + 1)} onChange={(event) =>
          setSelected(event.target.checked ? [...selected, i + 1] : selected.filter((value) => value !== i + 1))} /> {day}
      </label>)}
      <button className="button" type="button" onClick={save}>Save rest days</button>
    </fieldset>
    {error && <small role="alert">{error}</small>}
  </details>;
}

function EdgeDrawer({ data, onSaved, onClose, onJump }: {
  data: HabitSummary | null;
  onSaved: (value: HabitSummary) => void;
  onClose: () => void;
  onJump: (href: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const node = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return <dialog ref={dialog} className="ce-drawer" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], summary, input:not(:disabled)'
      )].filter(node => node.tabIndex >= 0 && node.getClientRects().length);
      const boundary = event.shiftKey ? controls.at(0) : controls.at(-1);
      if (document.activeElement !== boundary) return;
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls.at(0))?.focus();
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <div className="ce-drawer-content grid gap-4">
      <header className="ce-drawer-header"><h2 id={title}>Aura</h2>
        <button type="button" aria-label="Close" onClick={onClose}><X size={21} aria-hidden="true" /></button>
      </header>
      <div className={`ce-drawer-rings ${data?.score === 100 ? "ce-celebrate" : ""}`}>
        <TradingRings scores={data?.pillars ?? emptyScores} />
        {data?.score === 100 && <p>You showed up today.</p>}
      </div>
      {data ? <>
        <dl className="ce-stats">
          <div><dt>Current streak</dt><dd>{data.current_streak}</dd></div>
          <div><dt>Longest streak</dt><dd>{data.longest_streak}</dd></div>
          <div><dt>Days kept this year</dt><dd>{data.days_kept}</dd></div>
        </dl>
        <PillarCards data={data} onJump={onJump} />
        <section className="ce-panel ce-action" aria-label="Daily habits">
          <div>
            <h3>Daily habits</h3>
            <p>{data.habits?.total ? `${data.habits.completed} of ${data.habits.total} complete today` : 'Add habits to start tracking.'}</p>
            <button className="pt-btn" type="button" onClick={()=>onJump('#daily-habits')}>Open habit tracker</button>
          </div>
        </section>
        <YearlyCompoundGrid days={data.days} />
        <ConsistencyCurve days={data.days} />
        {data.rest_days && <RestDaySettings key={data.rest_days.join(",")} days={data.rest_days} onSaved={onSaved} />}
      </> : <p>Your routine is currently unavailable.</p>}
    </div>
  </dialog>;
}

export default function CompoundEdge() {
  const { data, setData, error, loading } = useHabitSummary();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const ringDescription = ringPillars.map(({ name, cap }, i) =>
    `${name} ${Math.round(100 * (data?.pillars[i] ?? 0) / cap)}% complete`).join(", ");
  const complete = ringPillars.filter(({ cap }, i) => data?.pillars[i] === cap).length;
  const message = loading ? "Loading your routine…" : error && !data ? "Routine unavailable" :
    complete === 3 ? "You showed up today" : !data?.score ? "" :
      complete === 0 ? "Your routine is underway" : `${complete} of 3 pillars done today`;
  function close(href?: string) {
    setOpen(false);
    requestAnimationFrame(() => {
      const target = href && document.getElementById(href.slice(1));
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.focus();
        target.scrollIntoView({ block: "center" });
      } else {
        trigger.current?.focus();
      }
    });
  }
  const pillars = data?.pillars ?? emptyScores;
  return <section aria-label="Aura" className="ce-widget">
    <header className="ce-widget-heading">
      <div>
        <h2>YOUR AURA</h2>
        <p>TRACK YOUR 1% DAILY EDGE.</p>
      </div>
      {data && (
        <span className="ce-streak-badge" aria-label={`Current streak ${data.current_streak} days`}>
          <strong>{data.current_streak}d</strong> streak
        </span>
      )}
    </header>
    <button ref={trigger} type="button" className={`ce-trigger ${complete === 3 ? "ce-celebrate" : ""}`}
      aria-label={message ? `Open Aura. ${message}` : "Open Aura"} aria-description={ringDescription} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}>
      <div className="ce-trigger-body">
        <TradingRings scores={pillars} />
        <div className="ce-mini-pillars" aria-hidden="true">
          {ringPillars.map(({ name, cap, color }, i) => {
            const val = pillars[i] ?? 0;
            const pct = Math.min(100, Math.round((val / cap) * 100));
            return <div key={name} className="ce-mini-pillar">
              <div className="ce-mini-pillar-row">
                <span className={`ce-tone-${color}`}>{name}</span>
                <span>{val}/{cap}</span>
              </div>
              <div className="ce-mini-track">
                <span className={`ce-mini-fill ce-fill-${color}`} style={{ width: `${pct}%` }} />
              </div>
            </div>;
          })}
        </div>
      </div>
      <div className="ce-trigger-footer">
        <span className="ce-widget-status">{message || (data ? `${data.days_kept} days kept this year` : "")}</span>
        <span className="ce-open-hint">365-day grid <ArrowUpRight size={13} aria-hidden="true" /></span>
      </div>
    </button>
    {open && <EdgeDrawer data={data} onSaved={setData} onClose={() => close()} onJump={close} />}
  </section>;
}
