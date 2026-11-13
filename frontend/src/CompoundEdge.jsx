import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { api } from "./api";
import "./compound-edge.css";

const pillars = [
  { name: "Prepare", cap: 30, tasks: [["checklist", "Pre-session checklist"], ["mindset", "Mindset exercise"]] },
  { name: "Execute", cap: 40, tasks: [["journal", "Save a pre-trade plan in Journal"], ["plan", "Confirm you followed your plan"]] },
  { name: "Study", cap: 30, tasks: [["replay", "20 active replay minutes"], ["lab", "Save a Lab note or review five trades"]] },
];

export function useHabitSummary() {
  const [data, setData] = useState(null);
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
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return { data, setData, error, loading: !data && !error };
}

export function DailyCompoundBar({ data, variant }) {
  const complete = pillars.filter(({ cap }, i) => data.pillars[i] === cap).length;
  const [selected, setSelected] = useState(null);
  const active = selected == null ? null : pillars[selected];
  return <div>
    {variant === "compact" && <div className="ce-ring" role="img"
      aria-label={`${complete} of 3 pillars done`} style={{ "--ce-progress": `${data.score}%` }}>
      <strong>{complete}/3</strong>
    </div>}
    <div className="ce-bar grid gap-1" style={{ gridTemplateColumns: "3fr 4fr 3fr" }}>
      {pillars.map(({ name, cap }, i) => {
        const finished = data.pillars[i] === cap;
        return <button key={name} type="button" className={finished ? "ce-segment ce-complete" : "ce-segment"}
          aria-expanded={selected === i} aria-label={`${name}, ${data.pillars[i]} of ${cap}`}
          onFocus={() => setSelected(i)} onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
          <span className="ce-fill" style={{ width: `${100 * data.pillars[i] / cap}%` }} />
          <span className="ce-segment-label">{name}{finished && <Check size={13} aria-hidden="true" />}</span>
        </button>;
      })}
    </div>
    <p className="ce-message">{complete === 3 ? "You showed up as the trader you’re becoming." : `${complete} of 3 pillars done today`}</p>
    {active && <ul className="ce-tasks" aria-label={active.name}>{active.tasks.map(([key, title]) =>
      <li key={key}>{data.tasks[key] ? "✓ " : "○ "}{title}</li>)}</ul>}
  </div>;
}

export function ConsistencyCurve({ days }) {
  let earned = 0;
  let available = 0;
  const series = [{ ideal: 1, actual: 1 }, ...days.map((day) => {
    if (!day.off) { available += 1; earned += day.score; }
    return { ideal: 1.01 ** available, actual: 1.01 ** (earned / 100) };
  })];
  const range = Math.max(0.01, series.at(-1).ideal - 1);
  const points = (key) => series.map((value, i) =>
    `${(i * 320 / (series.length - 1)).toFixed(2)},${(53 - (value[key] - 1) * 49 / range).toFixed(2)}`).join(" ");
  return <figure className="ce-curve">
    <figcaption><strong>Consistency Index</strong><small>A measure of showing up, not trading performance or returns.</small></figcaption>
    <svg viewBox="0 0 320 56" preserveAspectRatio="none" role="img" aria-label="Actual routine consistency and ideal qualifying-day consistency">
      <polyline className="ce-ideal" points={points("ideal")} />
      <polyline points={points("actual")} />
    </svg>
    <small>Solid · Your routine　 Dashed · Every qualifying day</small>
  </figure>;
}

function description(day) {
  const detail = pillars.map(({ name, cap }, i) => `${name} ${day.pillars[i]}/${cap}`).join(", ");
  return `${day.date} · ${day.off ? "Rest day or market closure" : `${day.score}/100`} · ${detail}`;
}

export function YearlyCompoundGrid({ data }) {
  const [inspected, setInspected] = useState(null);
  const { days } = data;
  const offset = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return <div className="grid gap-3">
    <ConsistencyCurve days={days} />
    <div className="ce-grid-scroll">
      <div className="ce-grid" aria-label="Daily routine history">
        {Array.from({ length: offset }, (_, i) => <span aria-hidden="true" key={`space-${i}`} />)}
        {days.map((day) => {
          const tier = day.off ? "rest" : day.score === 100 ? "full" : day.score >= 50 ? "kept" : day.score > 0 ? "partial" : "empty";
          return <button key={day.date} type="button" className={`ce-square ce-${tier}`}
            title={description(day)} aria-label={description(day)}
            onClick={() => setInspected(day.date)} />;
        })}
        {Array.from({ length: (7 - (offset + days.length) % 7) % 7 }, (_, i) =>
          <span className="ce-square ce-future" key={`future-${i}`} aria-hidden="true" />)}
      </div>
    </div>
    {inspected && days.some(({ date }) => date === inspected) &&
      <small role="status">{description(days.find(({ date }) => date === inspected))}</small>}
    <div className="ce-stats flex flex-wrap gap-3">
      <span><strong>{data.current_streak}</strong> current streak</span>
      <span><strong>{data.longest_streak}</strong> longest streak</span>
      <span><strong>{data.days_kept}</strong> days kept this year</span>
    </div>
  </div>;
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function RestDaySettings({ days, onSaved }) {
  const [selected, setSelected] = useState(days);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      onSaved(await api("/compound-edge/rest-days", { method: "PUT", body: { days: selected } }));
    } catch (failure) {
      setError(failure.message);
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

export default function CompoundEdge({ variant = "compact" }) {
  const { data, setData, error, loading } = useHabitSummary();
  return <section className={`ce-card grid gap-4 ce-${variant}`} aria-label="Compound Edge">
    <h2>Compound Edge</h2>
    {loading && <p role="status">Loading your routine…</p>}
    {error && <p role="status">Couldn’t refresh your routine. We’ll try again shortly.</p>}
    {data && <>
      <DailyCompoundBar data={data} variant={variant} />
      <YearlyCompoundGrid data={data} />
      {data.rest_days && <RestDaySettings key={data.rest_days.join(",")} days={data.rest_days} onSaved={setData} />}
    </>}
  </section>;
}
