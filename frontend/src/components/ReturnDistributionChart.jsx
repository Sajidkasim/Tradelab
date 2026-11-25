import React, { useMemo, useState } from "react";

export default function ReturnDistributionChart({ distribution, avgR, busy }) {
  const [hovered, setHovered] = useState(null);
  const buckets = distribution?.buckets || [
    { label: "≤−2R", count: 0 },
    { label: "−1.5R", count: 0 },
    { label: "−1R", count: 0 },
    { label: "−0.5R", count: 0 },
    { label: "0R", count: 0 },
    { label: "+0.5R", count: 0 },
    { label: "+1R", count: 0 },
    { label: "+2R", count: 0 },
    { label: "+3R+", count: 0 },
  ];
  const total = distribution?.total || 0;
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  const geometry = useMemo(() => {
    const W = 540;
    const H = 228;
    const padL = 32;
    const padR = 14;
    const padT = 18;
    const padB = 34;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const step = chartW / buckets.length;

    const bars = buckets.map((bucket, idx) => {
      const ratio = total > 0 ? bucket.count / maxCount : 0;
      const barH = total > 0 ? Math.max(bucket.count > 0 ? 6 : 0, ratio * chartH) : 0;
      const x = padL + idx * step + step * 0.17;
      const width = step * 0.66;
      const y = padT + chartH - barH;
      return {
        ...bucket,
        idx,
        x,
        y,
        width,
        barH,
        cx: x + width / 2,
        isPeak: total > 0 && bucket.count === maxCount && bucket.count > 0,
      };
    });

    let curvePath = "";
    if (total > 0 && bars.length > 1) {
      curvePath = `M ${bars[0].cx.toFixed(1)} ${bars[0].y.toFixed(1)}`;
      for (let i = 0; i < bars.length - 1; i += 1) {
        const cur = bars[i];
        const next = bars[i + 1];
        const midX = ((cur.cx + next.cx) / 2).toFixed(1);
        curvePath += ` C ${midX} ${cur.y.toFixed(1)}, ${midX} ${next.y.toFixed(1)}, ${next.cx.toFixed(1)} ${next.y.toFixed(1)}`;
      }
    }

    // Approximate mean marker x-position across R buckets [-2..+3]
    let meanX = null;
    const meanVal = distribution?.mean ?? avgR;
    if (total > 0 && meanVal != null && Number.isFinite(meanVal)) {
      const clamped = Math.max(-2, Math.min(3, meanVal));
      const t = (clamped + 2) / 5;
      meanX = padL + t * chartW;
    }

    const gridLines = [0, 1, 2, 3, 4].map((i) => ({
      y: padT + (chartH / 4) * i,
      label: total > 0 ? Math.round(maxCount * (1 - i / 4)) : 4 - i,
    }));

    return { W, H, padL, padR, padT, chartH, bars, curvePath, meanX, gridLines };
  }, [buckets, total, maxCount, distribution?.mean, avgR]);

  const meanDisplay =
    distribution?.unit === "relative"
      ? distribution?.mean != null
        ? `${distribution.mean >= 0 ? "+" : ""}${distribution.mean.toFixed(2)}×`
        : "—"
      : (distribution?.mean ?? avgR) != null
        ? `${(distribution?.mean ?? avgR) >= 0 ? "+" : ""}${(distribution?.mean ?? avgR).toFixed(2)}R`
        : "—";

  const meanPositive = (distribution?.mean ?? avgR ?? 0) >= 0;

  return (
    <div className={`card sl-dist-card${busy ? " updating" : ""}`}>
      <div className="sl-card-head">
        <div>
          <h3>
            {distribution?.unit === "relative"
              ? "Distribution of Trade Returns"
              : "Distribution of Trade Returns (R)"}
          </h3>
          <p>
            {total > 0
              ? "Frequency histogram with smoothed expectancy curve"
              : "Bucketed R-multiple outcomes appear once trades are logged"}
          </p>
        </div>
        <span className={`lab-val-chip ${total > 0 ? (meanPositive ? "is-pos" : "is-neg") : ""}`}>
          Mean {meanDisplay}
        </span>
      </div>

      <div className="sl-dist-stage">
        <svg
          className="sl-dist-svg"
          viewBox={`0 0 ${geometry.W} ${geometry.H}`}
          role="img"
          aria-label="Distribution of trade returns histogram"
        >
          {geometry.gridLines.map((line, i) => (
            <g key={i}>
              <line
                x1={geometry.padL}
                y1={line.y}
                x2={geometry.W - geometry.padR}
                y2={line.y}
                className="sl-dist-grid"
              />
              <text x={geometry.padL - 8} y={line.y + 4} textAnchor="end" className="sl-dist-axis">
                {line.label}
              </text>
            </g>
          ))}

          {geometry.bars.map((bar) => (
            <g key={bar.label}>
              {bar.barH > 0 && (
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.barH}
                  rx="4"
                  className={`sl-dist-bar${bar.isPeak ? " is-peak" : ""}${hovered?.idx === bar.idx ? " is-hover" : ""}`}
                  onMouseEnter={() => setHovered(bar)}
                  onMouseLeave={() => setHovered(null)}
                />
              )}
              <text x={bar.cx} y={geometry.H - 10} textAnchor="middle" className="sl-dist-axis">
                {bar.label}
              </text>
            </g>
          ))}

          {geometry.curvePath && (
            <path d={geometry.curvePath} fill="none" className="sl-dist-curve" />
          )}

          {geometry.meanX != null && (
            <line
              x1={geometry.meanX}
              y1={geometry.padT}
              x2={geometry.meanX}
              y2={geometry.padT + geometry.chartH}
              className="sl-dist-mean"
            />
          )}
        </svg>

        {hovered && total > 0 && (
          <div className="sl-dist-tooltip" role="status">
            <strong>{hovered.label}</strong> · {hovered.count} {hovered.count === 1 ? "trade" : "trades"} (
            {Math.round((hovered.count / total) * 100)}%)
          </div>
        )}

        {total === 0 && (
          <div className="sl-dist-empty-note">
            <span>Record risk on trades to map your R-multiple distribution</span>
          </div>
        )}
      </div>
    </div>
  );
}
