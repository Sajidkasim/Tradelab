import React, { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

// The popover enters the browser's top layer, so menus remain visible inside
// scrolling filters and modal dialogs. This component only selects labels.
export default function StyledSelect({ label, values, value, onChange, searchable = false, disabled, name, ...props }) {
  const id = useId(), root = useRef(), trigger = useRef(), panel = useRef(), search = useRef(), typeahead = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const [position, setPosition] = useState({});
  const options = values.map((v) => typeof v === "object" ? v : { value: v, label: v });
  const visible = options.filter((v) => String(v.label).toLowerCase().includes(query.toLowerCase()));
  const selected = options.find((v) => String(v.value) === String(value));
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  const choose = (item) => {
    if (!item || item.disabled) return;
    onChange?.({ target: { value: String(item.value), name } });
    close(true);
  };
  function start(last = false) {
    if (disabled) return;
    setQuery("");
    const current = options.findIndex((v) => String(v.value) === String(value));
    setActive(last ? options.length - 1 : Math.max(0, current));
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open) return;
    const menu = panel.current;
    menu.showPopover?.();
    const place = () => {
      const rect = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const height = viewport?.height || innerHeight;
      const width = viewport?.width || innerWidth;
      const bottomSpace = viewportTop + height - rect.bottom - 10;
      const topSpace = rect.top - viewportTop - 10;
      const above = bottomSpace < 210 && topSpace > bottomSpace;
      const maxHeight = Math.max(80, Math.min(330, above ? topSpace : bottomSpace));
      const menuWidth = Math.min(Math.max(rect.width, 180), width - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, width - menuWidth - 8)), top: above ? undefined : rect.bottom + 4,
        bottom: above ? innerHeight - rect.top + 4 : undefined, width: menuWidth, maxHeight });
    };
    place();
    const outside = (event) => { if (!root.current?.contains(event.target)) close(); };
    const scroll = (event) => { if (!menu.contains(event.target)) place(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    if (searchable) search.current?.focus();
    else menu.querySelector('[role="listbox"]')?.focus();
    return () => {
      menu.hidePopover?.();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, searchable]);
  useEffect(() => {
    if (open) panel.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, query]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function keys(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") {
      // Restore the trigger before the browser performs its normal tab action.
      trigger.current?.focus(); close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive((n) => event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, n + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" || (!searchable && event.key === " ")) {
      event.preventDefault(); choose(visible[active]);
    } else if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - typeahead.current.time < 700 ? typeahead.current.text : "") + event.key.toLowerCase();
      typeahead.current = { text, time: now };
      const found = visible.findIndex((v) => String(v.label).toLowerCase().startsWith(text));
      if (found >= 0) setActive(found);
    }
  }
  return (
    <div className="field search-select styled-select" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
      <span id={`${id}-label`}>{label}</span>
      <button {...props} type="button" ref={trigger} className="picker-trigger" disabled={disabled}
        role={searchable ? undefined : "combobox"}
        aria-labelledby={searchable ? `${id}-label ${id}-value` : `${id}-label`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        onClick={() => open ? close() : start()}
        onKeyDown={(event) => { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); if (!open) start(event.key === "ArrowUp"); } }}>
        <span id={`${id}-value`}>{selected?.label ?? value ?? "Choose…"}</span><ChevronDown size={16} aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={value ?? ""} disabled={disabled} />}
      {open && <div ref={panel} popover="manual" className={`picker-panel styled-select-panel ${searchable ? "with-search" : ""}`} style={position} tabIndex={-1} onKeyDown={keys}>
        {searchable && <div className="picker-search"><Search size={15} aria-hidden="true" /><input ref={search} aria-label={`Search ${label.toLowerCase()}`} placeholder="Type to find…" value={query} role="combobox" aria-autocomplete="list" aria-controls={`${id}-list`} aria-expanded="true" aria-activedescendant={visible[active] ? `${id}-option-${active}` : undefined} onChange={(event) => { setQuery(event.target.value); setActive(0); }} /></div>}
        <div role="listbox" aria-label={label} id={`${id}-list`} className="picker-options" tabIndex={searchable ? undefined : -1} aria-activedescendant={visible[active] ? `${id}-option-${active}` : undefined}>
          {visible.map((item, index) => <button type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} key={item.value} data-option-index={index}
            disabled={item.disabled} aria-selected={String(item.value) === String(value)} className={index === active ? "keyboard-option" : ""}
            onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
            <span>{item.label}</span>{String(item.value) === String(value) && <Check size={16} aria-hidden="true" />}
          </button>)}
          {!visible.length && <p className="picker-empty">No matching options.</p>}
        </div>
      </div>}
    </div>
  );
}
