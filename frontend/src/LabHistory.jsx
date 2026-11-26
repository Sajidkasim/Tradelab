import React, { useMemo, useState } from "react";
import { Chart } from "./components";

// Chart presentation only. Every plotted value comes from the core-generated
// figure or its existing final point; no financial series is calculated here.
function rgb(hex) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}
function alpha(hex, opacity) {
  return `rgba(${rgb(hex).join(",")},${opacity})`;
}
function blend(first, second, weight) {
  const a = rgb(first),
    b = rgb(second);
  return `rgb(${a.map((v, i) => Math.round(v * weight + b[i] * (1 - weight))).join(",")})`;
}

export default function LabHistory({ figure, latest, palette, netResult, journal = false, seriesStyle }) {
  const [drawdown, setDrawdown] = useState(false);
  const display = useMemo(() => {
    const equity = figure.data[0];
    const tone = seriesStyle?.color ?? (netResult < 0 ? palette.critical : palette.series[2]);
    const line = seriesStyle?.color ?? (netResult < 0 ? tone : blend(tone, palette.ink2, 0.65));
    const traces = [
      {
        ...equity,
        name: "Cumulative result",
        line: { ...equity.line, ...seriesStyle, color: line, width: 3, shape: "linear" },
        fill: journal ? "tonexty" : "tozeroy",
        fillcolor: alpha(tone, 0.11),
        fillgradient: {
          type: "vertical",
          colorscale: [
            [0, alpha(tone, 0.01)],
            [1, alpha(tone, 0.19)],
          ],
        },
        hovertemplate: journal
          ? "<b>%{x|%d %b %Y}</b><br>Balance: $%{y:,.2f}<br>%{customdata}<extra></extra>"
          : "<b>%{x|%d %b %Y · %H:%M}</b><br>Cumulative result: $%{y:,.2f}<extra></extra>",
      },
    ];
    if (journal) {
      const floor = equity.y.reduce((minimum, value) => Math.min(minimum, value), Infinity);
      traces.unshift({type: "scatter", x: equity.x, y: equity.x.map(() => floor), mode: "lines", line: {width: 0}, hoverinfo: "skip"});
    }
    if (drawdown) traces.push(...figure.data.slice(1));
    if (latest)
      traces.push({
        type: "scatter",
        x: [latest.time],
        y: [latest.equity],
        mode: "markers",
        marker: {
          color: line,
          size: 9,
          line: { color: palette.surface, width: 2 },
        },
        name: "Latest closed trade",
        showlegend: false,
        hoverinfo: "skip",
        xaxis: "x",
        yaxis: "y",
      });
    const xAxis = {
      ...figure.layout.xaxis,
      showgrid: false,
      showticklabels: !drawdown,
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
      spikecolor: palette.muted,
      spikethickness: 1,
      spikedash: "dot",
      tickfont: { color: palette.muted, size: 10 },
      nticks: 5,
      matches: drawdown ? "x2" : undefined,
    };
    const yAxis = {
      ...figure.layout.yaxis,
      domain: drawdown ? figure.layout.yaxis.domain : [0, 1],
      title: { text: "" },
      gridcolor: alpha(palette.ink2, 0.08),
      zeroline: true,
      zerolinecolor: alpha(palette.ink2, 0.2),
      zerolinewidth: 1,
      tickprefix: "$",
      tickformat: ",.0f",
      nticks: 5,
      tickfont: { color: palette.muted, size: 10 },
    };
    const layout = {
      ...figure.layout,
      xaxis: xAxis,
      yaxis: yAxis,
      showlegend: false,
      hovermode: "x unified",
      dragmode: false,
      hoverlabel: {
        bgcolor: palette.surface,
        bordercolor: palette.grid,
        font: { color: palette.ink, size: 12 },
      },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
    };
    if (!drawdown) {
      delete layout.xaxis2;
      delete layout.yaxis2;
    } else
      layout.xaxis2 = {
        ...layout.xaxis2,
        showgrid: false,
        nticks: 5,
        tickfont: { color: palette.muted, size: 10 },
      };
    return { data: traces, layout };
  }, [figure, latest, palette, netResult, drawdown, journal, seriesStyle]);
  return (
    <div className={`lab-history ${netResult < 0 ? "is-loss" : ""}`}>
      <Chart figure={display} height={drawdown ? 380 : 340} />
      {!journal && <div className="history-footer">
        <span>
          <i className="history-point" style={seriesStyle && { backgroundColor: seriesStyle.color }} />
          Latest closed trade
        </span>
        <label className="history-drawdown">
          <input
            type="checkbox"
            checked={drawdown}
            onChange={(e) => setDrawdown(e.target.checked)}
          />{" "}
          Show drawdown
        </label>
      </div>}
      <p className="history-hint">
        Hover or tap along the line to inspect your results.
      </p>
    </div>
  );
}
