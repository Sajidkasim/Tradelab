import React, { useState } from "react";
const scenes = {
  chart: {
    title: "Inside one candle",
    labels: ["Open", "High", "Low", "Close"],
    copy: [
      "The first traded price in the interval.",
      "The highest traded price reached.",
      "The lowest traded price reached.",
      "The last traded price in the interval.",
    ],
  },
  risk: {
    title: "Map the trade before entry",
    labels: ["Entry", "Stop", "Target"],
    copy: [
      "The planned starting price for this illustrative long trade.",
      "The planned exit if the trade moves against the idea. Actual fills can differ.",
      "The planned objective. It is separate from the realised result.",
    ],
  },
  test: {
    title: "Keep the sequence honest",
    labels: ["Observe", "Decide", "Execute"],
    copy: [
      "Use only the information available at this point.",
      "Apply the rules you defined before the test.",
      "Simulate the next eligible fill, with costs and execution assumptions.",
    ],
  },
  review: {
    title: "Give the result its context",
    labels: ["Trades", "Sample", "Review"],
    copy: [
      "Look at individual entries and exits.",
      "Read the trade count and tested period together.",
      "Check the rules, costs and missing information before drawing conclusions.",
    ],
  },
};
export default function GuideVisual({ guide }) {
  const [active, setActive] = useState(0),
    scene = scenes[guide];
  return (
    <div className="guide-visual">
      <span className="guide-visual-title">{scene.title}</span>
      <svg
        viewBox="0 0 320 160"
        role="img"
        aria-label={`${scene.title} — educational illustration`}
      >
        {[35, 80, 125].map((y) => (
          <path key={y} d={`M12 ${y}H308`} stroke="currentColor" opacity=".1" />
        ))}
        {guide === "chart" ? (
          <g>
            <path d="M160 20V140" stroke="currentColor" strokeWidth="2" />
            <rect
              x="138"
              y="55"
              width="44"
              height="55"
              fill="var(--pt-focus)"
            />
            <path
              d={`M${active === 0 ? 110 : active === 3 ? 182 : 160} ${[110, 20, 140, 55][active]}h65`}
              stroke="var(--pt-ink)"
              strokeDasharray="3 4"
            />
            <circle
              cx={160}
              cy={[110, 20, 140, 55][active]}
              r="5"
              fill="var(--pt-ink)"
            />
          </g>
        ) : guide === "risk" ? (
          <g>
            <rect
              x="48"
              y="25"
              width="220"
              height="59"
              fill="var(--pt-focus)"
              opacity=".12"
            />
            <rect
              x="48"
              y="84"
              width="220"
              height="45"
              fill="#b06454"
              opacity=".12"
            />
            {[84, 129, 25].map((y, i) => (
              <g key={y}>
                <path
                  d={`M38 ${y}H282`}
                  stroke={active === i ? "var(--pt-ink)" : "var(--pt-muted)"}
                  strokeWidth={active === i ? 2 : 1}
                  strokeDasharray={i ? "4 4" : undefined}
                />
                <circle
                  cx="265"
                  cy={y}
                  r={active === i ? 5 : 3}
                  fill="var(--pt-focus)"
                />
              </g>
            ))}
          </g>
        ) : (
          <g>
            <path d="M50 80H270" stroke="var(--pt-muted)" opacity=".5" />
            {scene.labels.map((label, i) => (
              <g key={label}>
                <circle
                  cx={55 + i * 105}
                  cy="80"
                  r={active === i ? 24 : 16}
                  fill={active === i ? "var(--pt-focus)" : "var(--pt-white)"}
                  stroke="var(--pt-focus)"
                />
                <text
                  x={55 + i * 105}
                  y="85"
                  textAnchor="middle"
                  fill={active === i ? "#fff" : "var(--pt-ink)"}
                  fontSize="13"
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <div
        className="guide-visual-controls"
        role="group"
        aria-label={scene.title}
      >
        {scene.labels.map((label, i) => (
          <button
            key={label}
            aria-pressed={active === i}
            onClick={() => setActive(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <p aria-live="polite">{scene.copy[active]}</p>
      <small>Illustration · tap a label to explore</small>
    </div>
  );
}
