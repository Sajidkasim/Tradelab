import React, { useMemo } from "react";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Button, Chart } from "./components";
import LabHistory from "./LabHistory";

const BACKTEST = "Backtesting";
const LIVE = "Forward testing";
const sources = [BACKTEST, LIVE];
const sourceName = {
  [BACKTEST]: "Backtest",
  [LIVE]: "Live",
};
const styles = {
  [BACKTEST]: {
    dark: { color: "#74afff", dash: "dash" },
    light: { color: "#286cb7", dash: "dash" },
  },
  [LIVE]: {
    dark: { color: "#c9f36b", dash: "solid" },
    light: { color: "#44782a", dash: "solid" },
  },
};
const noSamples = [];

function sourceStyle(source, mode) {
  return styles[source][mode === "dark" ? "dark" : "light"];
}

function CompareCurve({ samples, mode, palette }) {
  const tradeCount = Math.max(0, ...samples.map(({ r_count }) => r_count ?? 0));
  const figure = useMemo(() => ({
    data: sources.flatMap((source) => {
      const values = samples.find(({ sample }) => sample === source)?.r_equity?.values;
      if (!values?.length) return [];
      return [{
        type: "scatter",
        mode: "lines",
        name: sourceName[source],
        x: values.map((_, index) => index),
        y: values,
        line: { ...sourceStyle(source, mode), width: 2.5 },
        hovertemplate: "%{y:.2f}R",
      }];
    }),
    layout: {
      showlegend: false,
      hovermode: "x unified",
      hoverlabel: {
        bgcolor: palette.surface,
        bordercolor: palette.axis,
        font: { color: palette.ink, size: 12 },
      },
      dragmode: false,
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      xaxis: {
        title: { text: "Trade number", font: { color: palette.ink2, size: 11 } },
        tickfont: { color: palette.ink2, size: 11 },
        tickformat: "d",
        hoverformat: "d",
        dtick: Math.max(1, Math.ceil(tradeCount / 8)),
        gridcolor: palette.grid,
        zeroline: false,
      },
      yaxis: {
        title: { text: "Cumulative R", standoff: 5, font: { color: palette.ink2, size: 11 } },
        tickfont: { color: palette.ink2, size: 11 },
        nticks: 6,
        gridcolor: palette.grid,
        zerolinecolor: palette.axis,
      },
    },
  }), [samples, mode, palette, tradeCount]);

  return <>
    <ul className="sl-equity-legend" aria-label="Chart series">
      {sources.map((source) => {
        const sample = samples.find((result) => result.sample === source);
        const total = sample?.stats?.trades ?? 0;
        const count = sample?.r_count ?? 0;
        const style = sourceStyle(source, mode);
        return <li key={source}>
          <span className="sl-equity-swatch" data-source={source} style={{ color: style.color }} aria-hidden="true" />
          <strong>{sourceName[source]}</strong>
          <span>{count === total ? count : `${count} of ${total}`} {total === 1 ? "trade" : "trades"}</span>
        </li>;
      })}
    </ul>
    <Chart figure={figure} height={340} ariaLabel="Cumulative R by trade number for Backtest and Live shown as separate series" />
  </>;
}

function EquityEmpty({ busy, scope, needsRisk, onTrades, onReplay, onImport }) {
  if (busy) return <div className="sl-equity-empty" role="status">Loading equity curve…</div>;
  if (needsRisk) return (
    <div className="sl-equity-empty">
      <h3>No trades with recorded risk</h3>
      <p>Add risk to closed trades to compare cumulative R.</p>
      <Button onClick={onTrades}>Review trades <ArrowDown size={14} aria-hidden="true" /></Button>
    </div>
  );
  const backtest = scope === BACKTEST;
  const action = backtest ? onReplay : scope === LIVE ? onImport : onTrades;
  const label = backtest && onReplay ? "Open replay" : scope === LIVE && onImport ? "Import live trades" : "Go to trades";
  return (
    <div className="sl-equity-empty">
      <h3>{scope === "All" ? "No closed trades yet" : `No closed ${backtest ? "backtest" : "live"} trades`}</h3>
      <Button variant="primary" onClick={action || onTrades}>{label} <ArrowUpRight size={14} aria-hidden="true" /></Button>
    </div>
  );
}

export default function LabEquityChart({
  samples = noSamples, scope, mode, palette, clockName, busy, onTrades, onReplay, onImport,
}) {
  const compare = scope === "All";
  const scopedSample = samples.find(({ sample }) => sample === scope);
  const hasPoints = compare
    ? samples.some(({ r_equity }) => r_equity?.values?.length)
    : Boolean(scopedSample?.chart);
  const needsRisk = compare && samples.some(({ stats }) => stats?.trades > 0);
  return (
    <section className="card sl-equity-card" aria-label="Equity curve">
      <header className="sl-equity-heading" data-tour="results">
        <h2>Equity curve</h2>
        <p>{compare ? "Trades with recorded risk, ordered by close." : `Cumulative P&L · ${clockName} time`}</p>
        {busy && hasPoints && <span className="sl-equity-update" role="status">Updating…</span>}
      </header>
      {!hasPoints ? (
        <EquityEmpty
          busy={busy}
          scope={scope}
          needsRisk={needsRisk}
          onTrades={onTrades}
          onReplay={onReplay}
          onImport={onImport}
        />
      ) : compare ? (
        <CompareCurve samples={samples} mode={mode} palette={palette} />
      ) : (
        <>
          <ul className="sl-equity-legend" aria-label="Chart series">
            <li>
              <span className="sl-equity-swatch" data-source={scope} style={{ color: sourceStyle(scope, mode).color }} aria-hidden="true" />
              <strong>{sourceName[scope]}</strong>
              <span>{scopedSample.stats.trades} {scopedSample.stats.trades === 1 ? "trade" : "trades"}</span>
            </li>
          </ul>
          <LabHistory
            figure={scopedSample.chart}
            latest={scopedSample.chart_latest}
            palette={palette}
            seriesStyle={sourceStyle(scope, mode)}
            netResult={scopedSample.stats.net_pnl}
          />
        </>
      )}
    </section>
  );
}
