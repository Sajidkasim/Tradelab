import { ClipboardList, Crosshair, Search } from "lucide-react";
import React, { type CSSProperties } from "react";

export type PillarScores = readonly [number, number, number];
export const ringPillars = [
  { name: "Prepare", cap: 30, radius: 48, color: "prep" },
  { name: "Execute", cap: 40, radius: 35, color: "execute" },
  { name: "Study", cap: 30, radius: 22, color: "study" },
] as const;

const ringIcons = [ClipboardList, Crosshair, Search] as const;

export default function TradingRings({ scores }: { scores: PillarScores }) {
  const total = ringPillars.reduce((sum, { cap }, i) => sum + Math.max(0, Math.min(cap, scores[i])), 0);
  const metric = `+${(total / 100).toFixed(1)}%`;
  return <svg className="ce-rings" viewBox="0 0 116 116" role="group" aria-label="Daily activity rings">
    {ringPillars.map(({ name, cap, radius, color }, index) => {
      const fraction = Math.max(0, Math.min(1, scores[index] / cap));
      const circumference = 2 * Math.PI * radius;
      const Icon = ringIcons[index];
      return <g key={name} role="img" aria-label={`${name}: ${Math.round(fraction * 100)}% complete`}
        className={`ce-tone-${color}`} fill="none" stroke="currentColor" strokeWidth="9">
        <circle cx="58" cy="58" r={radius} className="ce-ring-track" />
        {fraction > 0 && <circle cx="58" cy="58" r={radius} transform="rotate(-90 58 58)"
          className="ce-ring-progress" strokeLinecap="round" strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{ "--ce-length": circumference, "--ce-delay": `${index * 140}ms` } as CSSProperties} />}
        <g aria-hidden="true" transform={`translate(58 ${58 - radius})`}>
          <circle r="5.4" fill="currentColor" stroke="none" />
          <Icon x="-3.6" y="-3.6" size="7.2" color="#101613" strokeWidth={2.8} />
        </g>
      </g>;
    })}
    <text x="58" y="58" textAnchor="middle" dominantBaseline="central"
      className={`ce-ring-metric ${total === 100 ? "ce-ring-metric-full" : ""}`}>{metric}</text>
  </svg>;
}
