import React from "react";
import { X } from "lucide-react";
import StyledSelect from "./StyledSelect";

export function SearchSelect(props) {
  return <StyledSelect {...props} searchable />;
}

export function FilterChips({ filters, defaults, onRemove, onClear }) {
  const labels = {
    strategy: "Strategy",
    direction: "Side",
    level: "Level",
    timeframe: "Level TF",
    entry_timeframe: "Entry TF",
    target_rr: "RR",
    weekday: "Day",
    news: "News",
    condition: "Market condition",
    window: "Session",
    symbol: "Market",
    account_id: "Account",
    start: "From",
    end: "To",
  };
  const active = Object.entries(labels).filter(
    ([key]) => filters[key] !== defaults[key],
  );
  const count = active.length + filters.confirmations.length;
  if (!count) return null;
  return (
    <div className="active-filters" aria-label="Active setup filters">
      <span className="active-filter-label">Your selection</span>
      {active.map(([key, label]) => (
        <button
          type="button"
          key={key}
          onClick={() => onRemove(key)}
          aria-label={`Remove ${label.toLowerCase()} filter`}
        >
          {label}:{" "}
          {key === "direction"
            ? { long: "Buy", short: "Sell" }[filters[key]] || filters[key]
            : filters[key]}
          <X size={12} />
        </button>
      ))}
      {filters.confirmations.map((v) => (
        <button
          type="button"
          key={v}
          onClick={() => onRemove("confirmations", v)}
          aria-label={`Remove ${v} confirmation`}
        >
          {v}
          <X size={12} />
        </button>
      ))}
      <button type="button" className="clear-filters" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}
