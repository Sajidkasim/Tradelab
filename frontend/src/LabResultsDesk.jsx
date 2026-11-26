import React from "react";
import { ArrowUpRight } from "lucide-react";
import LabEquityChart from "./LabEquityChart";
import LabMonteCarlo from "./LabMonteCarlo";
import ReturnDistributionChart from "./components/ReturnDistributionChart";
import { Button, Select } from "./components";
import { money, number, percent, rvalue } from "./format";
import { navigateTo } from "./paths";
import "./lab-results-desk.css";

const sourceName = (source) => source === "Backtesting" ? "Backtest" : "Live";
const sourceTone = (source) => source === "Backtesting" ? "backtest" : "live";
const drawdown = (value, format = rvalue) => format(value == null ? null : -Math.abs(value));

const headlineMetrics = [
  ["Net R", (sample) => rvalue(sample.r_equity?.net_r)],
  ["Average R", (sample) => rvalue(sample.stats.avg_r)],
  ["Max drawdown", (sample) => drawdown(sample.r_equity?.max_drawdown_r)],
  ["Trades analysed", (sample) => number(sample.stats.trades)],
];

function KeyMetrics({ sources }) {
  if (!sources.some(({ sample }) => sample?.stats.trades)) return null;
  return <dl className="card lab-key-metrics" aria-label="Key performance metrics">
    {headlineMetrics.map(([label, value]) => <div key={label}>
      <dt>{label}</dt>
      <dd>{sources.map(({ scope, sample }) => <div key={scope} className={`lab-metric-source lab-tone-${sourceTone(scope)}`}>
        {sources.length > 1 && <span>{sourceName(scope)}</span>}
        <strong>{sample ? value(sample) : "—"}</strong>
      </div>)}</dd>
    </div>)}
  </dl>;
}

function Strategies({ sources, setups, setup, onSetupChange }) {
  const label = sources.length > 1 ? " (Backtest / Live)" : "";
  const bySource = sources.map(({ sample }) =>
    new Map((sample?.strategy_summary || []).map((row) => [row.setup_name, row])),
  );
  const cells = [
    (row) => number(row?.trades ?? 0),
    (row) => rvalue(row?.avg_r),
    (row) => drawdown(row?.max_drawdown_r),
  ];
  return <section className="card lab-strategies" aria-labelledby="lab-strategies-title">
    <header className="lab-results-heading"><h2 id="lab-strategies-title">Strategies</h2></header>
    {setups.length === 0 ? <p className="muted">Strategies appear when you add a setup or tag a trade.</p> : (
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Strategy comparison table">
        <table>
          <thead><tr>
            <th scope="col">Setup</th>
            <th scope="col">Trades{label}</th>
            <th scope="col">Average R{label}</th>
            <th scope="col">Max drawdown{label}</th>
          </tr></thead>
          <tbody>{setups.map((name) => <tr key={name} data-selected={name === setup || undefined}>
            <th scope="row">
              <button type="button" aria-pressed={name === setup} onClick={() => {
                onSetupChange(name === setup ? "All strategies" : name);
                document.querySelector(".sl-equity-card")?.scrollIntoView({block: "nearest"});
              }}>
                {name} <ArrowUpRight size={14} aria-hidden="true"/>
              </button>
            </th>
            {cells.map((value, index) => <td key={index}>
              {sources.map(({ scope, sample }, sourceIndex) => <React.Fragment key={scope}>
                {sourceIndex > 0 && <span className="lab-source-separator"> / </span>}
                <span className={`lab-tone-${sourceTone(scope)}`}>
                  {sample ? value(bySource[sourceIndex].get(name)) : "—"}
                </span>
              </React.Fragment>)}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
    )}
  </section>;
}

function DetailedSample({ sample, busy, onTrades }) {
  const { stats, fixed_rr: fixed } = sample;
  const useFixed = fixed?.complete && sample.r_count === 0;
  const hasDistribution = sample.distribution?.total > 0;
  const values = [
    ["Net P&L", money(stats.net_pnl)], ["Win rate", percent(stats.win_rate)],
    ["95% win-rate interval", stats.win_rate_ci.map(percent).join("–")],
    ["Profit factor", number(stats.profit_factor)], ["Payoff ratio", number(stats.payoff_ratio)],
    ["Expectancy / trade", money(stats.expectancy)], ["Max drawdown ($)", drawdown(stats.max_drawdown, money)],
    ["Sharpe ratio", number(stats.sharpe)], ["Sortino ratio", number(stats.sortino)],
    ...(useFixed ? [["Fixed average R", rvalue(fixed.avg_r)]] : []),
  ];
  return <section className={`lab-detail-source${hasDistribution ? " has-distribution" : ""}`} aria-label={`${sourceName(sample.sample)} breakdown`}>
    <article className="card lab-detail-metrics">
      <header className="lab-results-heading">
        <h3>{sourceName(sample.sample)}</h3>
        {stats.trades > 0 && <small>{stats.trades} closed {stats.trades === 1 ? "trade" : "trades"}</small>}
      </header>
      {stats.trades === 0 ? <p className="muted">No closed trades match this selection.</p> : <>
        <dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="muted">{stats.wins} wins · {stats.losses} losses · {stats.scratches} break-even</p>
        {useFixed && <p className="muted">Fixed average R uses tagged full-target and full-stop outcomes before costs.</p>}
        {sample.r_count < stats.trades && <button type="button" className="inline-action" onClick={onTrades}>Review missing risk</button>}
      </>}
    </article>
    {hasDistribution && <ReturnDistributionChart distribution={sample.distribution} avgR={stats.avg_r} busy={busy}/>}
  </section>;
}

function GroupedResults({ samples, comparison, dimensions, onComparisonChange, busy }) {
  const populated = samples.filter(({stats}) => stats.trades > 0);
  if (!populated.length) return null;

  return <section className="card lab-grouped-results" aria-labelledby="lab-grouped-results-title">
    <header className="lab-results-heading">
      <h3 id="lab-grouped-results-title">Grouped trades</h3>
      <Select label="Group by" values={dimensions} value={comparison}
        onChange={(event) => onComparisonChange(event.target.value)}/>
    </header>
    {busy ? <p className="muted lab-grouped-loading" role="status">Updating groups…</p> : populated.map((sample) => {
      const label = sourceName(sample.sample);
      return <div key={sample.sample} className="lab-grouped-source">
        {samples.length > 1 && <h4>{label}</h4>}
        {sample.breakdown?.length > 0 ? <div className="table-wrap" tabIndex={0} role="region" aria-label={`${label} grouped trades`}>
          <table>
            <thead><tr><th scope="col">Group</th><th scope="col">Trades</th><th scope="col">Win rate</th><th scope="col">Average R</th></tr></thead>
            <tbody>{sample.breakdown.map((row) => <tr key={row[comparison]}>
              <th scope="row">{row[comparison]}{row.small_sample && <small className="table-caption">Small sample</small>}</th>
              <td>{row.trades}</td><td>{percent(row.win_rate)}</td><td>{rvalue(row.avg_r)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="muted">No groups for this selection.</p>}
      </div>;
    })}
  </section>;
}

export default function LabResultsDesk({
  scope, sampleScopes, samples, setups, setup, onSetupChange, busy, detail,
  onToggleDetail, comparison, dimensions, onComparisonChange, onTrades, onImport,
  palette, mode, clockName, filters, revision,
}) {
  const sources = sampleScopes.map((scope, index) => ({ scope, sample: samples[index] }));
  const available = samples.filter(Boolean);
  return <section className="lab-results-desk" aria-label={scope === "All" ? "Compare results" : `${sourceName(scope)} results`}>
    <LabEquityChart
      scope={scope} samples={available} palette={palette} mode={mode} busy={busy}
      clockName={clockName} onTrades={onTrades} onImport={onImport}
      onReplay={() => navigateTo("/backtesting")}
    />
    <KeyMetrics sources={sources}/>
    <div className="lab-results-actions">
      <details className="r-explainer reveal-disclosure">
        <summary>What does R mean?</summary>
        <p>R measures a result against the original trade risk. +1R is a gain equal to the amount risked. R metrics use closed trades with recorded risk.</p>
      </details>
      <Button className="lab-advanced-toggle" onClick={onToggleDetail} aria-expanded={detail}
        aria-controls={detail ? "lab-breakdown" : undefined}>
        {detail ? "Hide advanced metrics" : "Advanced metrics"} <ArrowUpRight size={14} aria-hidden="true"/>
      </Button>
    </div>
    {filters && available.some((sample) => sample.stats?.trades > 0) &&
      <LabMonteCarlo scope={scope} samples={available} filters={filters} revision={revision} onTrades={onTrades}/>}
    {detail && <section id="lab-breakdown" className="lab-breakdown-desk" aria-labelledby="lab-breakdown-title">
      <header className="lab-results-heading">
        <h2 id="lab-breakdown-title">Performance breakdown</h2>
      </header>
      {available.map((sample) => <DetailedSample key={sample.sample}
        sample={sample} busy={busy} onTrades={onTrades}/>)}
      <GroupedResults samples={available} comparison={comparison} dimensions={dimensions} onComparisonChange={onComparisonChange} busy={busy}/>
    </section>}
    <Strategies sources={sources} setups={setups} setup={setup} onSetupChange={onSetupChange}/>
  </section>;
}
