import React from 'react';
import {
  BookOpen,
  Brain,
  CandlestickChart,
  Compass,
  FlaskConical,
  Moon,
  NotebookPen,
  Search,
  Sun,
} from 'lucide-react';

export default function WorkspaceRail({
  active,
  replayEnabled = false,
  bullpenCount = 0,
  theme = 'light',
  onToggleTheme,
  onOpenCommand,
}) {
  const items = [
    { id: 'journal', label: 'Daily Journal', href: '/journal', icon: NotebookPen },
    { id: 'lab', label: 'Strategy Lab', href: '/lab', icon: FlaskConical },
    { id: 'mindset', label: 'Mindset Desk', href: '/mindset', icon: Brain },
    ...(replayEnabled
      ? [{ id: 'backtesting', label: 'Backtesting Studio', href: '/backtesting', icon: CandlestickChart }]
      : []),
    {
      id: 'learn',
      label: bullpenCount > 0 ? `Learn & Bullpen (${bullpenCount} live)` : 'Learn & Bullpen',
      href: '/learn',
      icon: BookOpen,
      live: bullpenCount > 0,
    },
    { id: 'matrix', label: 'The Matrix', href: '/matrix', icon: Compass },
  ];

  return (
    <aside className="primus-rail" aria-label="Workspace quick rail">
      <div className="primus-rail-group" role="list">
        {items.map(({ id, label, href, icon: Icon, live }) => (
          <a
            key={id}
            href={href}
            role="listitem"
            className={`primus-rail-item${active === id ? ' is-active' : ''}`}
            aria-current={active === id ? 'page' : undefined}
            aria-label={label}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            {live && <span className="primus-rail-live-dot" aria-hidden="true" />}
            <span className="primus-rail-tip" aria-hidden="true">{label}</span>
          </a>
        ))}
      </div>

      <div className="primus-rail-footer">
        {onOpenCommand && (
          <button
            type="button"
            className="primus-rail-item"
            onClick={onOpenCommand}
            aria-label="Command palette"
          >
            <Search size={17} strokeWidth={1.75} aria-hidden="true" />
            <span className="primus-rail-tip" aria-hidden="true">Jump · ⌘K</span>
          </button>
        )}
        {onToggleTheme && (
          <button
            type="button"
            className="primus-rail-item"
            onClick={onToggleTheme}
            aria-label="Toggle workspace theme"
          >
            {theme === 'dark' ? <Sun size={17} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={17} strokeWidth={1.75} aria-hidden="true" />}
            <span className="primus-rail-tip" aria-hidden="true">
              {theme === 'dark' ? 'Paper Light' : 'Obsidian Dark'}
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
