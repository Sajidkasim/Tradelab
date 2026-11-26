import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, ClipboardList, Maximize2, PenLine, Save, X } from 'lucide-react';
import { api } from './api';
import SlidingSelection from './SlidingSelection';

function countWords(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function parseRuleLines(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function JournalRules({ preferences, onSaved }) {
  const saved = preferences?.trading_rules || '';
  const [draft, setDraft] = useState(saved);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('write');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const triggerRef = useRef(null);
  const sheetRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  useEffect(() => {
    if (draft === saved) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, saved]);

  const dirty = draft !== saved;
  const savedRuleCount = useMemo(() => parseRuleLines(saved).length, [saved]);
  const draftRuleLines = useMemo(() => parseRuleLines(draft), [draft]);
  const words = useMemo(() => countWords(draft), [draft]);

  const closeSheet = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const saveRules = useCallback(async () => {
    if (busy || draft === saved) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const value = await api('/journal-preferences', {
        method: 'PUT',
        body: {
          timezone: preferences?.timezone || 'America/New_York',
          trading_rules: draft,
        },
      });
      onSaved(value);
      setMessage('Rules saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [busy, draft, saved, preferences?.timezone, onSaved]);

  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveRules();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(() => {
      if (mode === 'write' && textareaRef.current) {
        textareaRef.current.focus();
      } else {
        sheetRef.current?.focus();
      }
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, mode, closeSheet, saveRules]);

  function openSheet() {
    setMessage('');
    setError('');
    setMode('write');
    setOpen(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    saveRules();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pj-sidebar-action pj-rules-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSheet}
      >
        <ClipboardList size={17} aria-hidden="true" />
        <span>Rules</span>
        {savedRuleCount > 0 && (
          <span className="pj-rules-count" aria-label={`${savedRuleCount} saved ${savedRuleCount === 1 ? 'rule' : 'rules'}`}>
            {savedRuleCount}
          </span>
        )}
        <Maximize2 className="pj-rules-chevron" size={14} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          className="pj-focus-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSheet();
          }}
        >
          <form
            ref={sheetRef}
            className="pj-focus-sheet pj-rules-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Personal trading rules"
            tabIndex={-1}
            onSubmit={handleSubmit}
          >
            <header className="pj-focus-header pj-rules-header">
              <div className="pj-focus-head-top">
                <div className="pj-focus-meta">
                  <span className="pt-overline">PERSONAL PLAYBOOK · NON-NEGOTIABLES</span>
                  <div className="pj-focus-title-row">
                    <h2>Trading Rules</h2>
                    {draftRuleLines.length > 0 && (
                      <span className="pj-focus-pill">
                        {draftRuleLines.length} {draftRuleLines.length === 1 ? 'rule' : 'rules'}
                      </span>
                    )}
                    {dirty && <span className="pj-focus-pill">Unsaved changes</span>}
                  </div>
                </div>

                <div className="pj-focus-controls">
                  <SlidingSelection className="pj-focus-mode" role="group" aria-label="Rules view mode" value={mode}>
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
                      onClick={() => {
                        setMode('write');
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                    >
                      <PenLine size={14} aria-hidden="true" /> Write
                    </button>
                  </SlidingSelection>
                  <button
                    type="button"
                    className="pj-focus-close"
                    onClick={closeSheet}
                    aria-label="Close trading rules"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </header>

            <div className="pj-focus-body">
              {mode === 'read' ? (
                <div className="pj-focus-reader">
                  <article className="pj-focus-article">
                    <div className="pj-focus-article-head">
                      <div>
                        <span className="pj-focus-step">SESSION STANDARDS · DISCIPLINE</span>
                        <h3>Your personal trading rules</h3>
                      </div>
                      <button
                        type="button"
                        className="pj-focus-inline-edit"
                        onClick={() => {
                          setMode('write');
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                      >
                        <PenLine size={13} aria-hidden="true" /> Edit
                      </button>
                    </div>

                    {draftRuleLines.length > 0 ? (
                      <ol className="pj-rules-read-list">
                        {draftRuleLines.map((line, index) => (
                          <li key={`${index}-${line.slice(0, 24)}`}>
                            <span className="pj-rules-read-index">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="pj-rules-read-text">{line}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="pj-focus-empty">
                        <p>No trading rules written yet. Add your non-negotiables before the next session.</p>
                        <button
                          type="button"
                          className="pj-focus-inline-edit"
                          onClick={() => {
                            setMode('write');
                            requestAnimationFrame(() => textareaRef.current?.focus());
                          }}
                        >
                          Write rules
                        </button>
                      </div>
                    )}
                  </article>
                </div>
              ) : (
                <div className="pj-focus-writer-single">
                  <div className="pj-focus-article-head">
                    <div>
                      <span className="pj-focus-step">SESSION STANDARDS · DISCIPLINE</span>
                      <h3>Your personal trading rules</h3>
                      <p className="pj-focus-hint">
                        Write one rule per line or outline your session boundaries. Switch to Read anytime for a clean pre-market checklist.
                      </p>
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    className="pj-focus-textarea is-full"
                    aria-label="Your personal trading rules"
                    maxLength={12000}
                    value={draft}
                    disabled={busy}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setMessage('');
                    }}
                    placeholder="Write the rules you want to follow each session…"
                  />
                </div>
              )}
            </div>

            <footer className="pj-focus-footer">
              <div className="pj-focus-stats">
                {error ? (
                  <span className="pj-rules-error" role="alert">{error}</span>
                ) : (
                  <span className="pt-save-state" role="status">
                    {message ? (
                      <><Check size={14} aria-hidden="true" /> {message}</>
                    ) : dirty ? (
                      'Unsaved changes'
                    ) : saved ? (
                      <><Check size={14} aria-hidden="true" /> Saved</>
                    ) : (
                      'No rules saved yet'
                    )}
                  </span>
                )}
                <span className="pj-focus-dot" aria-hidden="true">·</span>
                <span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
                <span className="pj-focus-dot pj-focus-hide-sm" aria-hidden="true">·</span>
                <span className="pj-focus-hide-sm">{draft.length.toLocaleString()} / 12,000 characters</span>
              </div>

              <div className="pj-focus-footer-actions">
                <button
                  className="pt-btn pt-btn-dark"
                  type="submit"
                  disabled={busy || !dirty}
                >
                  <Save size={15} aria-hidden="true" />
                  {busy ? 'Saving…' : 'Save rules'}
                </button>
                <button
                  type="button"
                  className="pt-btn pj-focus-done"
                  onClick={closeSheet}
                >
                  Done <kbd>Esc</kbd>
                </button>
              </div>
            </footer>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
