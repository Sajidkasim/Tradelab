import React, {useEffect, useState} from 'react';
import {Download} from 'lucide-react';
import {api} from './api';
import {Modal} from './components';

export default function JournalReset({onClose, onReset}) {
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api('/journal/reset/preview', {signal: controller.signal}).then(setPreview).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, []);

  async function sendCode() {
    setBusy(true);
    setError('');
    setCode('');
    setConfirmation('');
    setSent(false);
    try {
      const scope = await api('/journal/reset/send-code', {method: 'POST'});
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
      await api('/journal/reset/confirm', {method: 'POST', body: {code, confirmation}});
      onReset();
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

  return <Modal title="Master Journal reset" onClose={() => !busy && onClose()} closable={!busy} className="pj-link-modal pj-journal-reset-modal">
    {preview ? <>
      <p>Permanently clear Journal data for every date and account, including today and Deleted entries.</p>
      <ul>
        <li>Journal entries and screenshots ({preview.entries} active, {preview.trash} in trash)</li>
        <li>Replay imports ({preview.imports}) and account presets ({preview.presets})</li>
        <li>Trading accounts to remove ({preview.accounts})</li>
      </ul>
      {preview.shared_accounts > 0
        ? <p>Accounts kept for Strategy Lab trades or risk history ({preview.shared_accounts}).</p>
        : <p>A fresh default account will be created.</p>}
      <a className="pt-btn" href="/api/journal/reset/backup" download><Download size={16}/> Download full Journal backup</a>
      {!preview.available && <p>Email verification requires Google sign-in and a configured mail sender.</p>}
    </> : !error && <p role="status">Checking your Journal…</p>}
    {sent && <p role="status">Code sent to {preview.email_hint}. It expires in 10 minutes.</p>}
    {error && <p role="alert">{error}</p>}
    <form onSubmit={deleteEntries}>
      {sent && <>
      <label className="pj-field">
        Verification code
        <input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} disabled={busy}
          onChange={event => setCode(event.target.value.replace(/\D/g, ''))}/>
      </label>
      <label className="pj-field">
        Type DELETE JOURNAL
        <input autoComplete="off" spellCheck={false} value={confirmation} disabled={busy}
          onChange={event => setConfirmation(event.target.value)}/>
      </label>
      </>}
      <div className="pj-modal-actions">
        <button type="button" className="pt-btn" onClick={onClose} disabled={busy}>Cancel</button>
        {preview?.available && [preview.entries, preview.trash, preview.imports, preview.presets, preview.accounts].some(Boolean) && <button type="button" className="pt-btn" disabled={busy} onClick={sendCode}>
          {sent ? 'Send a new code' : 'Email me a code'}
        </button>}
        {sent && <button className="pt-btn pj-danger" type="submit" disabled={busy || code.length !== 6 || confirmation !== 'DELETE JOURNAL'}>Permanently reset Journal</button>}
      </div>
    </form>
  </Modal>;
}
