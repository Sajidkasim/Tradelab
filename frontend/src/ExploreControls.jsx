import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

// Native selects remain available for forms; this searchable picker is for Explore.
export function SearchSelect({ label, values, value, onChange }) {
  const id = useId(),
    root = useRef(),
    trigger = useRef(),
    search = useRef();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const options = values.map((v) =>
    typeof v === "object" ? v : { value: v, label: v },
  );
  const visible = options.filter((v) =>
    v.label.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = options.find((v) => String(v.value) === String(value));
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const choose = (item) => {
    onChange({ target: { value: String(item.value) } });
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="field search-select"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        ref={trigger}
        className="picker-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => {
          setQuery("");
          setActive(0);
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>{selected?.label || value}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          className="picker-panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <div className="picker-search">
            <Search size={15} />
            <input
              ref={search}
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Type to find…"
              value={query}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={`${id}-list`}
              aria-expanded="true"
              aria-activedescendant={
                visible[active] ? `${id}-option-${active}` : undefined
              }
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                  e.preventDefault();
                  setActive((n) =>
                    Math.max(
                      0,
                      Math.min(
                        visible.length - 1,
                        n + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
                }
                if (e.key === "Enter" && visible[active]) {
                  e.preventDefault();
                  choose(visible[active]);
                }
              }}
            />
          </div>
          <div
            role="listbox"
            aria-label={label}
            id={`${id}-list`}
            className="picker-options"
          >
            {visible.map((item, i) => (
              <button
                type="button"
                role="option"
                id={`${id}-option-${i}`}
                key={item.value}
                aria-selected={String(item.value) === String(value)}
                className={i === active ? "keyboard-option" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span>{item.label}</span>
                {String(item.value) === String(value) && <Check size={16} />}
              </button>
            ))}
            {!visible.length && (
              <p className="picker-empty">No matching options.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
