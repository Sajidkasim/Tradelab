import React, {useEffect, useState} from 'react';
import {Download} from 'lucide-react';
import {api} from './api';
import {Modal} from './components';

export default function JournalHistoryDelete({onClose, onDeleted}) {
  const [preview, setPreview] = useState(null);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api('/journal/history/preview', {signal: controller.signal}).then(setPreview).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, []);

  async function sendCode() {
    setBusy(true);
    setError('');
    setCode('');
    setSent(false);
    try {
      const scope = await api('/journal/history/send-code', {method: 'POST'});
      setPreview(current => ({...current, ...scope}));
      setSent(true);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntries(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const {days} = await api('/journal/history/delete', {method: 'POST', body: {code}});
      onDeleted(days);
    } catch (error) {
      setError(error.message);
      if (error.status === 403 || error.status === 409) {
        setSent(false);
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Delete past Journal entries?" onClose={() => !busy && onClose()} closable={!busy} className="pj-link-modal pj-history-delete-modal">
    {preview ? <>
      <p>{preview.count ? `${preview.count} entries dated before ${preview.before} across all trade accounts will move to Deleted entries.` : 'No past entries to delete.'}</p>
      <a className="pt-btn" href="/api/journal/export"><Download size={16}/> Download Journal backup</a>
      <p className="pj-modal-hint">The backup includes notes, trade cards and screenshot references. Restore entries from Deleted entries to access their screenshots.</p>
      {preview.count > 0 && !preview.available && <p>Email verification requires Google sign-in and a configured mail sender.</p>}
    </> : !error && <p role="status">Checking past entries…</p>}
    {sent && <p role="status">Code sent to {preview.email_hint}. It expires in 10 minutes.</p>}
    {error && <p role="alert">{error}</p>}
    <form onSubmit={deleteEntries}>
      {sent && <label className="pj-field">
        Verification code
        <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} disabled={busy}
          onChange={event => setCode(event.target.value.replace(/\D/g, ''))}/>
      </label>}
      <div className="pj-modal-actions">
        <button type="button" className="pt-btn" onClick={onClose} disabled={busy}>Cancel</button>
        {preview?.available && preview.count > 0 && <button type="button" className="pt-btn" disabled={busy} onClick={sendCode}>
          {sent ? 'Send a new code' : 'Email me a code'}
        </button>}
        {sent && <button className="pt-btn pj-danger" type="submit" disabled={busy || code.length !== 6}>Move past entries to trash</button>}
      </div>
    </form>
  </Modal>;
}
