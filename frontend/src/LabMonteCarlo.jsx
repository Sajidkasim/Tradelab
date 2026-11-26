import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Info, ShieldAlert } from "lucide-react";
import { api } from "./api";
import { percent, rvalue } from "./format";

const HORIZONS = [50, 100, 250, 500];
const DRAWDOWN_PRESETS = [5, 10, 20];
const SOURCES = [["Backtesting", "Backtest"], ["Forward testing", "Live"]];

export const VERDICTS = {
  strong: { tone: "good", title: "Strong edge", line: "Results this good would be very unlikely from a zero-edge strategy." },
  likely: { tone: "good", title: "Edge looks real", line: "Your average R is unlikely to be luck, but keep building the sample." },
  unproven: { tone: "warn", title: "Promising, not proven", line: "The edge is positive, but luck can still explain it." },
  luck: { tone: "warn", title: "Can't rule out luck", line: "A zero-edge strategy produces results like this fairly often." },
  none: { tone: "bad", title: "No edge yet", line: "The average trade is around or below 0R after costs." },
  negative: { tone: "bad", title: "Negative edge", line: "The average trade loses R after costs in this selection." },
  insufficient: { tone: "muted", title: "Need more trades", line: "Monte Carlo needs at least 20 closed trades with recorded risk." },
};

const pct = (value) => (value == null ? "—" : value < 0.001 && value > 0 ? "<0.1%" : percent(value));
const signedR = (value, digits = 1) => {
  if (value == null) return "—";
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}R`;
};
const formatR = (value) => {
  if (value == null) return "—";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

export function mcRequestBody(filters, source, horizon, drawdownR, method) {
  return { filters: { ...filters, scope: source, sample: source }, horizon, drawdown_r: drawdownR, method };
}

export function niceTicks(min, max, target = 5) {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min];
  const raw = span / Math.max(1, target - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const candidates = [0.5, 1, 2, 2.5, 5, 10].map((m) => m * mag);
  let best = [];
  for (const step of candidates) {
    const start = Math.ceil((min - step * 1e-6) / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 1e-6; v += step) {
      ticks.push(Math.abs(v) < step * 1e-6 ? 0 : Math.round(v * 1e6) / 1e6);
    }
    if (!best.length || Math.abs(ticks.length - target) < Math.abs(best.length - target)) {
      best = ticks;
    }
  }
  return best.length >= 2 ? best : [min, max];
}

function useWidth(ref) {
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function FanChart({ projection, horizon, animKey }) {
  const wrap = useRef(null);
  const width = useWidth(wrap);
  const [hover, setHover] = useState(null);
  const height = width < 480 ? 230 : 290;
  const pad = { top: 16, right: 14, bottom: 30, left: 48 };
  const { steps, bands, paths } = projection;
  const geometry = useMemo(() => {
    const all = [...bands["5"], ...bands["95"], ...paths.flat(), 0];
    let min = Math.min(...all), max = Math.max(...all);
    const span = max - min || 1;
    min -= span * 0.06; max += span * 0.06;
    const x = (step) => pad.left + (step / Math.max(1, horizon)) * (width - pad.left - pad.right);
    const y = (value) => pad.top + (1 - (value - min) / (max - min)) * (height - pad.top - pad.bottom);
    const line = (values) => values.map((value, i) => `${i ? "L" : "M"}${x(steps[i]).toFixed(1)},${y(value).toFixed(1)}`).join("");
    const area = (upper, lower) => `${line(upper)}${lower.map((value, i) => i).reverse()
      .map((i) => `L${x(steps[i]).toFixed(1)},${y(lower[i]).toFixed(1)}`).join("")}Z`;
    const ticks = niceTicks(min, max, 5);
    const digits = ticks.some((t) => Math.abs(t % 1) > 1e-4) ? 1 : 0;
    return { x, y, line, area, ticks, digits };
  }, [bands, paths, steps, width, height, horizon, pad.left, pad.right, pad.top, pad.bottom]);
  const { x, y, line, area, ticks, digits } = geometry;
  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - pad.left) / Math.max(1, box.width - pad.left - pad.right);
    const target = Math.max(0, Math.min(1, ratio)) * horizon;
    let best = 0;
    steps.forEach((step, i) => { if (Math.abs(step - target) < Math.abs(steps[best] - target)) best = i; });
    setHover(best);
  };
  const tip = hover == null ? null : {
    step: steps[hover], hi: bands["95"][hover], mid: bands["50"][hover], lo: bands["5"][hover],
  };
  const tipLeft = tip == null ? 0 : (
    x(tip.step) > width * 0.62
      ? Math.max(pad.left, x(tip.step) - 160)
      : Math.min(width - 154, Math.max(pad.left, x(tip.step) + 12))
  );
  return <div className="mc-fan" ref={wrap}>
    <svg width={width} height={height} role="img" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
      aria-label={`Projected cumulative R over the next ${horizon} trades. Median ${signedR(bands["50"].at(-1))}, 90% of futures between ${signedR(bands["5"].at(-1))} and ${signedR(bands["95"].at(-1))}.`}>
      {ticks.map((tick) => <g key={tick} className="mc-grid">
        <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)}/>
        <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{signedR(tick, digits)}</text>
      </g>)}
      <line className="mc-zero" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)}/>
      <path className="mc-band mc-band-outer" d={area(bands["95"], bands["5"])}/>
      <path className="mc-band mc-band-inner" d={area(bands["75"], bands["25"])}/>
      <g key={animKey} className="mc-paths">{paths.map((values, i) => <path key={i} d={line(values)} pathLength="1"
        style={{ animationDelay: `${(i % 16) * 45}ms` }} data-side={values.at(-1) >= 0 ? "up" : "down"}/>)}</g>
      <path key={`med-${animKey}`} className="mc-median" d={line(bands["50"])} pathLength="1"/>
      {[0, Math.round(horizon / 2), horizon].map((step) => <text key={step} className="mc-axis" x={x(step)} y={height - 8}
        textAnchor={step === 0 ? "start" : step === horizon ? "end" : "middle"}>{step === 0 ? "Now" : `${step} trades`}</text>)}
      {tip && <g className="mc-cursor">
        <line x1={x(tip.step)} x2={x(tip.step)} y1={pad.top} y2={height - pad.bottom}/>
        <circle className="mc-cursor-edge" cx={x(tip.step)} cy={y(tip.hi)} r="3"/>
        <circle cx={x(tip.step)} cy={y(tip.mid)} r="4.5"/>
        <circle className="mc-cursor-lo" cx={x(tip.step)} cy={y(tip.lo)} r="3"/>
      </g>}
    </svg>
    {tip && <div className="mc-tip" style={{ left: tipLeft }} role="status">
      <strong>Trade {tip.step}</strong>
      <span><i data-k="hi"/>Best 5%: {signedR(tip.hi)}</span>
      <span><i data-k="mid"/>Median: {signedR(tip.mid)}</span>
      <span><i data-k="lo"/>Worst 5%: {signedR(tip.lo)}</span>
    </div>}
  </div>;
}

function EdgeMeter({ edge, sample }) {
  const [lo, hi] = edge.ci95 || [0, 0];
  const reach = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(sample.mean_r), 0.1) * 1.25;
  const pos = (value) => `${50 + (value / reach) * 50}%`;
  return <div className="mc-meter" aria-label={`95% range for average R per trade: ${rvalue(lo)} to ${rvalue(hi)}`}>
    <div className="mc-meter-track">
      <span className="mc-meter-zero" style={{ left: "50%" }}/>
      <span className="mc-meter-range" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }}/>
      <span className="mc-meter-dot" style={{ left: pos(sample.mean_r) }}/>
    </div>
    <div className="mc-meter-labels"><span>{rvalue(-reach)}</span><span>0R</span><span>{rvalue(reach)}</span></div>
  </div>;
}

function Verdict({ data, onTrades }) {
  const { edge, sample } = data;
  const verdict = VERDICTS[edge.verdict] || VERDICTS.insufficient;
  const resamples = edge.resamples ?? data.n_sims;
  const detail = edge.verdict === "insufficient"
    ? `${sample.trades || 0} of ${data.min_trades} trades with recorded risk.`
    : sample.constant_r
      ? `All ${sample.trades} trades finished at ${rvalue(sample.mean_r)} — there is no spread to simulate yet.`
      : edge.verdict === "negative" || edge.verdict === "none"
        ? `Average ${rvalue(sample.mean_r)} per trade over ${sample.trades} trades.`
        : `In ${resamples.toLocaleString()} resamples, ${pct(edge.prob_positive)} kept a positive average R. Chance a zero-edge strategy does this well: ${pct(edge.p_value)}.`;
  const progress = Math.min(100, Math.round(((sample.trades || 0) / Math.max(1, data.min_trades)) * 100));
  return <div className={`mc-verdict mc-tone-${verdict.tone}`}>
    <div className="mc-verdict-copy">
      <span className="mc-eyebrow">Is the edge real?</span>
      <h3>{verdict.title}</h3>
      <p>{verdict.line}</p>
      <p className="mc-verdict-detail">{detail}</p>
      {edge.verdict === "insufficient" && <div className="mc-progress">
        <span className="mc-progress-bar" aria-hidden="true"><span style={{ width: `${progress}%` }}/></span>
        {data.missing_risk > 0 && onTrades && <button type="button" className="inline-action" onClick={onTrades}>
          Review {data.missing_risk} {data.missing_risk === 1 ? "trade" : "trades"} missing risk
        </button>}
      </div>}
      {(edge.verdict === "unproven" || edge.verdict === "luck") && edge.more_trades_needed > 0 &&
        <p className="mc-verdict-next">About <strong>{edge.more_trades_needed} more trades</strong> at this average would make it statistically clear.</p>}
    </div>
    {edge.ci95 && <div className="mc-verdict-meter">
      <span className="mc-eyebrow">Average R per trade · 95% range</span>
      <strong>{rvalue(edge.ci95[0])} to {rvalue(edge.ci95[1])}</strong>
      <EdgeMeter edge={edge} sample={sample}/>
    </div>}
  </div>;
}

function DrawdownLadder({ drawdown }) {
  return <section className="mc-ladder" aria-labelledby="mc-ladder-title">
    <h4 id="mc-ladder-title"><ShieldAlert size={15} aria-hidden="true"/> Chance of a drawdown of at least…</h4>
    <ul>{drawdown.ladder.map(({ r, prob }) => {
      const target = Math.abs(r - drawdown.target.r) < 1e-6;
      return <li key={r} data-target={target || undefined} data-level={prob >= 0.5 ? "high" : prob >= 0.2 ? "mid" : "low"}>
        <span>−{formatR(r)}R</span>
        <span className="mc-ladder-bar"><span style={{ width: `${Math.max(prob * 100, prob > 0 ? 1.5 : 0)}%` }}/></span>
        <strong>{pct(prob)}</strong>
      </li>;
    })}</ul>
    <p className="mc-footnote">Peak-to-trough, measured from your highest point. Your limit is ±{(drawdown.target.standard_error * 196).toFixed(1)} pts accurate.</p>
  </section>;
}

function preferredSource(scope, samples) {
  if (scope !== "All") return scope;
  const bt = samples?.find((s) => s?.sample === "Backtesting")?.r_count ?? 0;
  const live = samples?.find((s) => s?.sample === "Forward testing")?.r_count ?? 0;
  return live > 0 && bt === 0 ? "Forward testing" : "Backtesting";
}

export default function LabMonteCarlo({ scope, samples, filters, revision, onTrades }) {
  const [source, setSource] = useState(() => preferredSource(scope, samples));
  const [horizon, setHorizon] = useState(100);
  const [drawdownR, setDrawdownR] = useState(10);
  const [draft, setDraft] = useState("10");
  const [method, setMethod] = useState("block");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const ref = useRef(null);

  useEffect(() => {
    if (scope !== "All") setSource(scope);
    else {
      const bt = samples?.find((s) => s?.sample === "Backtesting")?.r_count ?? 0;
      const live = samples?.find((s) => s?.sample === "Forward testing")?.r_count ?? 0;
      if (source === "Backtesting" && bt === 0 && live > 0) setSource("Forward testing");
      else if (source === "Forward testing" && live === 0 && bt > 0) setSource("Backtesting");
    }
  }, [scope, samples, source]);

  useEffect(() => {
    if (visible || !ref.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  const draftValue = Number(draft);
  const draftInvalid = draft.trim() !== "" && (!Number.isFinite(draftValue) || draftValue < 0.5 || draftValue > 200);
  useEffect(() => {
    if (!Number.isFinite(draftValue) || draftValue < 0.5 || draftValue > 200) return undefined;
    const rounded = Math.round(draftValue * 100) / 100;
    const timer = setTimeout(() => setDrawdownR(rounded), 350);
    return () => clearTimeout(timer);
  }, [draftValue]);

  useEffect(() => {
    if (!visible) return undefined;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      api("/lab/monte-carlo", { method: "POST", body: mcRequestBody(filters, source, horizon, drawdownR, method), signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setData(result); })
        .catch((e) => { if (e.name !== "AbortError" && !controller.signal.aborted) setError(e.message); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [visible, filters, source, horizon, drawdownR, method, revision]);

  const ready = data?.projection && data.edge?.verdict !== "insufficient";
  const tone = source === "Backtesting" ? "backtest" : "live";
  const animKey = `${source}-${horizon}-${method}`;
  return <section ref={ref} className={`card mc-card lab-tone-${tone}`} aria-labelledby="mc-title" aria-busy={busy}>
    <header className="mc-head">
      <div>
        <span className="mc-eyebrow"><Activity size={13} aria-hidden="true"/> Monte Carlo · {data?.n_sims ? data.n_sims.toLocaleString() : "5,000"} alternate futures</span>
        <h2 id="mc-title">Edge stress test</h2>
        <p>Reshuffles your real R results to show what the next trades could look like — and whether the edge is real or luck.</p>
      </div>
      {scope === "All" && <div className="mc-seg" role="group" aria-label="Sample">
        {SOURCES.map(([value, label]) => <button key={value} type="button" aria-pressed={source === value} onClick={() => setSource(value)}>{label}</button>)}
      </div>}
    </header>

    <div className="mc-controls">
      <div className="mc-control">
        <span id="mc-horizon">Project next</span>
        <div className="mc-seg" role="group" aria-labelledby="mc-horizon">
          {HORIZONS.map((value) => <button key={value} type="button" aria-pressed={horizon === value} onClick={() => setHorizon(value)}>{value}</button>)}
        </div>
      </div>
      <div className="mc-control">
        <label htmlFor="mc-dd">Drawdown limit</label>
        <div className="mc-dd" data-invalid={draftInvalid || undefined}>
          <span aria-hidden="true">−</span>
          <input id="mc-dd" type="number" inputMode="decimal" min="0.5" max="200" step="0.5" value={draft}
            aria-invalid={draftInvalid || undefined}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (!Number.isFinite(draftValue) || draftValue < 0.5 || draftValue > 200) setDraft(String(drawdownR)); }}
            aria-describedby="mc-dd-help"/>
          <span aria-hidden="true">R</span>
        </div>
        <div className="mc-chips">{DRAWDOWN_PRESETS.map((value) => <button key={value} type="button" aria-pressed={drawdownR === value}
          onClick={() => { setDraft(String(value)); setDrawdownR(value); }}>{value}R</button>)}</div>
      </div>
      <div className="mc-control">
        <span id="mc-method">Sequencing</span>
        <div className="mc-seg" role="group" aria-labelledby="mc-method">
          <button type="button" aria-pressed={method === "block"} onClick={() => setMethod("block")}>Streak-aware</button>
          <button type="button" aria-pressed={method === "iid"} onClick={() => setMethod("iid")}>Independent</button>
        </div>
      </div>
    </div>
    <p id="mc-dd-help" className={`mc-hint${draftInvalid ? " is-error" : ""}`}>
      {draftInvalid
        ? "Enter a drawdown limit between 0.5R and 200R."
        : "Tip: drawdown limit in R = your max loss ÷ risk per trade (e.g. $2,000 ÷ $200 = 10R)."}
    </p>

    {error && <p className="mc-error" role="alert">{error}</p>}
    {!data && !error && <div className="mc-skeleton" role="status">Running 5,000 simulations…</div>}
    {data && <div className={`mc-body${busy ? " is-updating" : ""}`}>
      <Verdict data={data} onTrades={onTrades}/>
      {ready && <>
        <div className="mc-chart-card">
          <div className="mc-chart-head">
            <h4>Next {data.horizon} trades</h4>
            <ul className="mc-legend" aria-hidden="true">
              <li><i data-k="outer"/>90% of futures</li><li><i data-k="inner"/>Middle 50%</li><li><i data-k="median"/>Median</li>
            </ul>
          </div>
          <FanChart projection={data.projection} horizon={data.horizon} animKey={animKey}/>
        </div>
        <dl className="mc-tiles">
          <div data-hero><dt>Chance of hitting −{formatR(data.drawdown.target.r)}R</dt><dd>{pct(data.drawdown.target.prob)}</dd><small>within {data.horizon} trades</small></div>
          <div><dt>Median result</dt><dd>{signedR(data.projection.final["50"])}</dd><small>after {data.horizon} trades</small></div>
          <div><dt>Bad case · 1 in 20</dt><dd>{signedR(data.projection.final["5"])}</dd><small>5th percentile</small></div>
          <div><dt>Chance of profit</dt><dd>{pct(data.projection.prob_profit)}</dd><small>finish above 0R</small></div>
          <div><dt>Losing streak to expect</dt><dd>{data.drawdown.losing_streak.median} in a row</dd><small>1 in 20 runs: {data.drawdown.losing_streak.p95}+</small></div>
          <div><dt>Typical worst drawdown</dt><dd>−{data.drawdown.max_dd["50"].toFixed(1)}R</dd><small>1 in 20: −{data.drawdown.max_dd["95"].toFixed(1)}R</small></div>
        </dl>
        <div className="mc-split">
          <DrawdownLadder drawdown={data.drawdown}/>
          {data.history && <section className="mc-history" aria-labelledby="mc-history-title">
            <h4 id="mc-history-title">Has your order of trades been lucky?</h4>
            <p className="mc-history-figure"><strong>−{data.history.actual_max_dd.toFixed(1)}R</strong> your real worst drawdown</p>
            <p>{data.history.worse_share >= 0.6
              ? <>Shuffling the exact same {data.sample.trades} trades into random orders produced a <strong>deeper</strong> drawdown {pct(data.history.worse_share)} of the time (typical −{data.history.typical_max_dd.toFixed(1)}R). Expect worse than you've seen.</>
              : data.history.worse_share <= 0.25
                ? <>Only {pct(data.history.worse_share)} of random orders of these same trades were worse — you've already lived through a rough sequence.</>
                : <>Your drawdown is typical for these trades in any order (median shuffled drawdown −{data.history.typical_max_dd.toFixed(1)}R).</>}</p>
          </section>}
        </div>
      </>}
      <footer className="mc-assumptions">
        <Info size={14} aria-hidden="true"/>
        <p>
          Based on {data.sample.trades} {data.scope === "Backtesting" ? "backtest" : "live"} trades with recorded risk
          {data.missing_risk > 0 && <> ({data.missing_risk} without risk left out)</>}.
          Assumes future trades look like these, at the same risk per trade. {method === "block"
            ? `Streak-aware keeps runs of ~${data.sample.block_length} trades together so hot and cold spells stay realistic.`
            : "Independent treats every trade as unrelated to the last."} Filtering down to the best-looking slice makes any edge look stronger than it is.
        </p>
      </footer>
    </div>}
  </section>;
}
