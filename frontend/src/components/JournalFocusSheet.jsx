import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, PenLine, Save, X } from 'lucide-react';
import SlidingSelection from '../SlidingSelection';

function countWords(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function AutoGrowTextarea({ value, onChange, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 140)}px`;
  }, [value]);

  return <textarea ref={ref} value={value} onChange={onChange} {...rest} />;
}

/**
 * JournalFocusSheet — Full-height Primus editorial reader & distraction-free writer.
 * Keeps the main Journal page compact while letting traders read or write massive
 * multi-section entries clearly in a spacious, optical-framed popup.
 */
export default function JournalFocusSheet({
  open,
  initialMode = 'read',
  initialScope = 'all',
  dayLabel,
  dayOverline,
  dayPnlLabel,
  dayPnlOutcome,
  entry,
  sections,
  activeSection,
  onSelectSection,
  onEdit,
  onSave,
  onClose,
  busy,
  autoSaving,
  dirty,
  dictationNode,
}) {
  const [mode, setMode] = useState(initialMode);
  const [scope, setScope] = useState(initialScope);
  const sheetRef = useRef(null);
  const singleTextareaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setScope(initialScope);
  }, [open, initialMode, initialScope]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!busy && !autoSaving) onSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => {
      if (initialMode === 'write' && initialScope !== 'all' && singleTextareaRef.current) {
        singleTextareaRef.current.focus();
      } else {
        sheetRef.current?.focus();
      }
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy, autoSaving, onClose, onSave, initialMode, initialScope]);

  const stats = useMemo(() => {
    const visibleText = scope === 'all'
      ? sections.map((s) => entry[s.id] || '').join('\n')
      : (entry[scope] || '');
    const words = countWords(visibleText);
    const chars = visibleText.length;
    const mins = words ? Math.max(1, Math.round(words / 220)) : 0;
    return { words, chars, mins };
  }, [entry, sections, scope]);

  if (!open) return null;

  const focusedSection = sections.find((s) => s.id === scope) || sections[0];
  const hasMindset = entry.mindset && entry.mindset !== 'Not set';

  function switchScope(nextScope) {
    setScope(nextScope);
    if (nextScope !== 'all') onSelectSection?.(nextScope);
  }

  function jumpToEdit(sectionId) {
    setScope(sectionId);
    onSelectSection?.(sectionId);
    setMode('write');
    requestAnimationFrame(() => singleTextareaRef.current?.focus());
  }

  return createPortal(
    <div
      className="pj-focus-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="pj-focus-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Journal focus view — ${dayLabel}`}
        tabIndex={-1}
      >
        <header className="pj-focus-header">
          <div className="pj-focus-head-top">
            <div className="pj-focus-meta">
              <span className="pt-overline">{dayOverline} · SESSION JOURNAL</span>
              <div className="pj-focus-title-row">
                <h2>{dayLabel}</h2>
                {dayPnlLabel && (
                  <span className={`pj-focus-pill ${dayPnlOutcome ? `is-${dayPnlOutcome}` : ''}`}>
                    {dayPnlLabel}
                  </span>
                )}
                {entry.plan_followed && (
                  <span className="pj-focus-pill">Plan: {entry.plan_followed}</span>
                )}
                {hasMindset && (
                  <span className="pj-focus-pill">{entry.mindset}</span>
                )}
              </div>
            </div>

            <div className="pj-focus-controls">
              <SlidingSelection className="pj-focus-mode" value={mode} role="group" aria-label="View mode">
                <button
                  type="button"
                  data-slide-value="read"
                  aria-pressed={mode === 'read'}
                  onClick={() => setMode('read')}
                >
                  <BookOpen size={14} aria-hidden="true" /> Read
                </button>
                <button
                  type="button"
                  data-slide-value="write"
                  aria-pressed={mode === 'write'}
                  onClick={() => setMode('write')}
                >
                  <PenLine size={14} aria-hidden="true" /> Write
                </button>
              </SlidingSelection>
              <button
                type="button"
                className="pj-focus-close"
                onClick={onClose}
                aria-label="Close expanded journal"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <SlidingSelection className="pj-focus-tabs" value={scope} role="tablist" aria-label="Journal focus sections">
            <button
              type="button"
              role="tab"
              data-slide-value="all"
              aria-selected={scope === 'all'}
              onClick={() => switchScope('all')}
            >
              All sections
            </button>
            {sections.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                data-slide-value={item.id}
                aria-selected={scope === item.id}
                onClick={() => switchScope(item.id)}
              >
                <span>0{index + 1}</span>
                {item.label}
                {entry[item.id]?.trim() && <Check size={13} aria-hidden="true" />}
              </button>
            ))}
          </SlidingSelection>
        </header>

        <div className="pj-focus-body">
          {mode === 'read' ? (
            <div className="pj-focus-reader">
              {(scope === 'all' ? sections : [focusedSection]).map((item, idx) => {
                const sectionNumber = sections.findIndex((s) => s.id === item.id) + 1;
                const text = (entry[item.id] || '').trim();
                return (
                  <article key={item.id} className={`pj-focus-article ${idx > 0 ? 'has-divider' : ''}`}>
                    <div className="pj-focus-article-head">
                      <div>
                        <span className="pj-focus-step">0{sectionNumber} / {item.label.toUpperCase()}</span>
                        <h3>{item.title}</h3>
                      </div>
                      <button
                        type="button"
                        className="pj-focus-inline-edit"
                        onClick={() => jumpToEdit(item.id)}
                      >
                        <PenLine size={13} aria-hidden="true" /> Edit
                      </button>
                    </div>
                    {text ? (
                      <div className="pj-focus-prose">{entry[item.id]}</div>
                    ) : (
                      <div className="pj-focus-empty">
                        <p>Nothing written for {item.label.toLowerCase()} yet.</p>
                        <button
                          type="button"
                          className="pj-focus-inline-edit"
                          onClick={() => jumpToEdit(item.id)}
                        >
                          Write here
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : scope === 'all' ? (
            <div className="pj-focus-writer-all">
              {sections.map((item, index) => (
                <div key={item.id} className={`pj-focus-write-block ${index > 0 ? 'has-divider' : ''}`}>
                  <div className="pj-focus-article-head">
                    <div>
                      <span className="pj-focus-step">0{index + 1} / {item.label.toUpperCase()}</span>
                      <h3>{item.title}</h3>
                    </div>
                    <span className="pj-focus-char-hint">
                      {(entry[item.id] || '').length.toLocaleString()} chars
                    </span>
                  </div>
                  <AutoGrowTextarea
                    className="pj-focus-textarea is-stack"
                    aria-label={`${item.label} (expanded)`}
                    value={entry[item.id] || ''}
                    maxLength={item.id === 'notes' ? 20000 : 12000}
                    placeholder={item.placeholder}
                    disabled={busy}
                    onFocus={() => onSelectSection?.(item.id)}
                    onChange={(event) => onEdit(item.id, event.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="pj-focus-writer-single">
              <div className="pj-focus-article-head">
                <div>
                  <span className="pj-focus-step">
                    0{sections.findIndex((s) => s.id === focusedSection.id) + 1} / {focusedSection.label.toUpperCase()}
                  </span>
                  <h3>{focusedSection.title}</h3>
                  <p className="pj-focus-hint">{focusedSection.hint}</p>
                </div>
              </div>
              <textarea
                ref={singleTextareaRef}
                className="pj-focus-textarea is-full"
                aria-label={`${focusedSection.label} (expanded)`}
                value={entry[focusedSection.id] || ''}
                maxLength={focusedSection.id === 'notes' ? 20000 : 12000}
                placeholder={focusedSection.placeholder}
                disabled={busy}
                onChange={(event) => onEdit(focusedSection.id, event.target.value)}
              />
            </div>
          )}
        </div>

        <footer className="pj-focus-footer">
          <div className="pj-focus-stats">
            <span className="pt-save-state" role="status">
              {autoSaving
                ? 'Auto-saving…'
                : dirty
                  ? 'Unsaved changes'
                  : entry.updated_at
                    ? <><Check size={14} aria-hidden="true" /> Saved</>
                    : 'Fresh entry'}
            </span>
            <span className="pj-focus-dot" aria-hidden="true">·</span>
            <span>
              {stats.words.toLocaleString()} {stats.words === 1 ? 'word' : 'words'}
              {stats.mins > 0 ? ` · ${stats.mins} min read` : ''}
            </span>
            <span className="pj-focus-dot pj-focus-hide-sm" aria-hidden="true">·</span>
            <span className="pj-focus-hide-sm">{stats.chars.toLocaleString()} characters</span>
          </div>

          <div className="pj-focus-footer-actions">
            {mode === 'write' && scope !== 'all' && dictationNode}
            <button
              type="button"
              className="pt-btn pt-btn-dark"
              disabled={busy || autoSaving}
              onClick={onSave}
            >
              <Save size={15} aria-hidden="true" />
              {busy ? 'Saving…' : 'Save entry'}
            </button>
            <button type="button" className="pt-btn pj-focus-done" onClick={onClose}>
              Done <kbd>Esc</kbd>
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
