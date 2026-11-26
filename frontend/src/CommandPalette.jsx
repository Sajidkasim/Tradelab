import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Brain, Compass, FlaskConical, Home, Moon, NotebookPen, PlayCircle, Search, Sun,
} from 'lucide-react';
import { navigateTo } from './paths';
import SlidingSelection from './SlidingSelection';

const COMMANDS = [
  { id: 'journal', label: 'Daily Journal', sub: 'Log trades, prop accounts & session notes', href: '/journal', icon: NotebookPen, key: 'G J' },
  { id: 'matrix', label: 'The Matrix', sub: 'Pre-market sizing gate, bias & catalysts', href: '/matrix', icon: Compass, key: 'G M' },
  { id: 'lab', label: 'Strategy Lab', sub: 'Edge analytics, equity curves & trade review', href: '/lab', icon: FlaskConical, key: 'G L' },
  { id: 'mindset', label: 'Mindset & Compound Edge', sub: 'Warm-up drills, breathwork & 365-day streak', href: '/mindset', icon: Brain, key: 'G W' },
  { id: 'backtesting', label: 'Backtesting Replay', sub: 'Multi-chart deterministic historical replay', href: '/backtesting', icon: PlayCircle, key: 'G B' },
  { id: 'learn', label: 'Learn & Bullpen', sub: 'Foundations, resource library & live trading floor', href: '/learn', icon: BookOpen, key: 'G E' },
  { id: 'home', label: 'PrimusTrader Portal', sub: 'Desk overview, session clocks & market briefing', href: '/', icon: Home, key: 'G H' },
];

export default function CommandPalette({ open, onClose, theme, onToggleTheme }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);

  const items = useMemo(() => {
    const base = [
      ...COMMANDS,
      ...(onToggleTheme
        ? [{
            id: 'toggle-theme',
            label: theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode',
            sub: 'Applies Primus Signature across all pages',
            icon: theme === 'dark' ? Sun : Moon,
            key: 'T',
            action: onToggleTheme,
          }]
        : []),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => `${item.label} ${item.sub}`.toLowerCase().includes(q));
  }, [query, theme, onToggleTheme]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (selected >= items.length) setSelected(0);
  }, [items.length, selected]);

  if (!open) return null;

  function run(item) {
    if (!item) return;
    onClose();
    if (item.action) item.action();
    else if (item.href) navigateTo(item.href);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(items[selected]);
    }
  }

  return (
    <div
      className="primus-cmd-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="primus-cmd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quick navigation"
        onKeyDown={onKeyDown}
      >
        <div className="primus-cmd-head">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to Journal, Matrix, Lab, Mindset, or switch theme…"
            aria-label="Jump to workspace"
          />
          <button type="button" className="primus-cmd-esc" onClick={onClose}>Esc</button>
        </div>
        <SlidingSelection className="primus-cmd-list" role="listbox" aria-label="Workspace shortcuts"
          axis="vertical" value={items[selected]?.id}>
          {items.length ? items.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                data-slide-value={item.id}
                aria-selected={idx === selected}
                className="primus-cmd-item"
                onMouseEnter={() => setSelected(idx)}
                onClick={() => run(item)}
              >
                <span className="primus-cmd-item-main">
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{item.label}</strong>
                    <div className="primus-cmd-item-sub">{item.sub}</div>
                  </span>
                </span>
                <span className="primus-cmd-item-kbd">{item.key}</span>
              </button>
            );
          }) : (
            <div className="primus-cmd-empty">No matching page or command.</div>
          )}
        </SlidingSelection>
      </div>
    </div>
  );
}
