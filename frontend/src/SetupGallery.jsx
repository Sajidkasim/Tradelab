import React, { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Layers, Trash2, X } from 'lucide-react';
import { api } from './api';
import { Button, Modal, Notice } from './components';

export default function SetupGallery({ identity }) {
  const [items, setItems] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeTag, setActiveTag] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!identity?.authenticated) {
      setUnavailable(true);
      return;
    }
    let alive = true;
    api('/learn/setup-gallery')
      .then((rows) => {
        if (alive) {
          setItems(Array.isArray(rows) ? rows : []);
          setUnavailable(false);
        }
      })
      .catch(() => {
        if (alive) setUnavailable(true);
      });
    return () => { alive = false; };
  }, [identity?.authenticated]);

  const allTags = useMemo(() => {
    if (!items) return [];
    const set = new Set();
    items.forEach((item) => (item.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [items]);

  const visible = useMemo(() => {
    if (!items) return [];
    if (!activeTag) return items;
    return items.filter((item) => (item.tags || []).includes(activeTag));
  }, [items, activeTag]);

  if (unavailable || items === null) return null;

  async function onSubmit(event) {
    event.preventDefault();
    if (!file || !title.trim()) {
      setError('Add a title and choose a setup screenshot.');
      return;
    }
    setUploading(true);
    setError('');
    setStatus('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title.trim());
      form.append('tags', tags);
      const payload = await api('/learn/setup-gallery', { method: 'POST', body: form });
      setItems((prev) => [payload, ...(prev || [])]);
      setTitle('');
      setTags('');
      setFile(null);
      setShowUpload(false);
      setStatus('Setup added to the team vault.');
    } catch (e) {
      setError(e.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function removeItem(entry) {
    if (!window.confirm(`Remove "${entry.title}" from the Setup Vault?`)) return;
    setError('');
    setStatus('');
    try {
      await api(`/learn/setup-gallery/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      setItems((prev) => (prev || []).filter((row) => row.id !== entry.id));
      if (expanded?.id === entry.id) setExpanded(null);
      setStatus('Setup removed.');
    } catch (e) {
      setError(e.message || 'Could not remove setup.');
    }
  }

  return (
    <section id="setup-vault" data-learn-tour="vault" className="wp-panel learn-vault" aria-label="Team Setup Vault">
      <div className="wp-section-heading learn-vault-head">
        <div>
          <span className="pt-overline">TEAM SETUP VAULT</span>
          <h2>Annotated A+ Setups</h2>
          <p>Private desk screenshots shared across the Primus team — filter by setup tag and study clean execution.</p>
        </div>
        <Button variant="primary" onClick={() => { setError(''); setShowUpload(true); }}>
          <ImagePlus size={15} aria-hidden="true" /> Share setup
        </Button>
      </div>

      {status && <p className="wp-footnote" role="status">{status}</p>}
      {error && <Notice error>{error}</Notice>}

      {allTags.length > 0 && (
        <div className="learn-vault-tags" role="group" aria-label="Filter setups by tag">
          <button
            type="button"
            className={`learn-tag-chip ${!activeTag ? 'is-active' : ''}`}
            onClick={() => setActiveTag('')}
          >
            All ({items.length})
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`learn-tag-chip ${activeTag === tag ? 'is-active' : ''}`}
              onClick={() => setActiveTag((cur) => (cur === tag ? '' : tag))}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {visible.length > 0 ? (
        <div className="learn-gallery">
          {visible.map((entry) => (
            <figure key={entry.id} className="learn-vault-card">
              <button
                type="button"
                className="learn-vault-thumb"
                onClick={() => setExpanded(entry)}
                aria-label={`Inspect ${entry.title}`}
              >
                <img
                  src={`/api/learn/setup-gallery/${encodeURIComponent(entry.id)}/image`}
                  alt={entry.title}
                  loading="lazy"
                />
              </button>
              <figcaption className="learn-vault-meta">
                <div>
                  <strong>{entry.title}</strong>
                  <span className="learn-vault-author">{entry.author}</span>
                </div>
                <button
                  type="button"
                  className="learn-vault-del"
                  onClick={() => removeItem(entry)}
                  aria-label={`Remove ${entry.title}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </figcaption>
              {entry.tags?.length > 0 && (
                <div className="wp-tags learn-vault-card-tags">
                  {entry.tags.map((t) => <span key={t}>#{t}</span>)}
                </div>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <div className="wp-empty learn-vault-empty">
          <Layers size={24} aria-hidden="true" />
          <p>{activeTag ? `No setups tagged #${activeTag} yet.` : 'No team setup screenshots yet. Share your cleanest A+ chart for the desk to study.'}</p>
        </div>
      )}

      {showUpload && (
        <Modal title="Share a setup to the Vault" onClose={() => setShowUpload(false)}>
          <form className="learn-vault-form" onSubmit={onSubmit}>
            <label className="field">
              <span>Setup title</span>
              <input
                type="text"
                required
                maxLength={120}
                placeholder="e.g. NQ NY Open Sweep + 1m MSS"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Tags (comma separated)</span>
              <input
                type="text"
                maxLength={300}
                placeholder="nq, sweep, mss, ny-open"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Chart screenshot (PNG / JPG / WebP, max 8 MB)</span>
              <input
                type="file"
                accept="image/*"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            {error && <Notice error>{error}</Notice>}
            <div className="settings-actions">
              <Button type="button" onClick={() => setShowUpload(false)}>Cancel</Button>
              <Button type="submit" variant="primary" busy={uploading}>Upload to Vault</Button>
            </div>
          </form>
        </Modal>
      )}

      {expanded && (
        <div className="learn-lightbox" role="dialog" aria-modal="true" aria-label={expanded.title} onClick={(e) => { if (e.target === e.currentTarget) setExpanded(null); }}>
          <div className="learn-lightbox-inner">
            <header>
              <div>
                <strong>{expanded.title}</strong>
                <span>Shared by {expanded.author}</span>
              </div>
              <button type="button" className="button" onClick={() => setExpanded(null)} aria-label="Close setup">
                <X size={15} aria-hidden="true" /> Close
              </button>
            </header>
            <img src={`/api/learn/setup-gallery/${encodeURIComponent(expanded.id)}/image`} alt={expanded.title} />
          </div>
        </div>
      )}
    </section>
  );
}
