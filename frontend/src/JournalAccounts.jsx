import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Button, Field, Modal, Notice } from './components';

const blank = { name: '', starting_balance: '', account_type: 'Personal', status: 'active' };
const size = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function JournalAccounts({accounts, setAccounts}) {
  const [statusFilter, setStatusFilter] = useState('active');
  const [draft, setDraft] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load(signal) {
    setError('');
    api('/journal-accounts', { signal }).then(setAccounts).catch(err => {
      if (err.name !== 'AbortError') setError(err.message);
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  function close() {
    if (busy) return;
    setDraft(null);
    setDeleting(null);
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { id, name, starting_balance, account_type, status = 'active' } = draft;
    try {
      const saved = await api(id ? `/journal-accounts/${id}` : '/journal-accounts', {
        method: id ? 'PUT' : 'POST',
        body: { name: name.trim(), starting_balance: Number(starting_balance), account_type, status },
      });
      setAccounts(items => id ? items.map(item => item.id === id ? saved : item) : [...items, saved]);
      setStatusFilter(status);
      setDraft(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api(`/journal-accounts/${deleting.id}`, { method: 'DELETE' });
      setAccounts(items => items.filter(item => item.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const visibleAccounts = (accounts || []).filter(account => (account.status || 'active') === statusFilter);

  return <details className="pj-accounts">
    <summary>Accounts {accounts && `(${accounts.length})`}</summary>
    {accounts === null && (error
      ? <><Notice error>{error}</Notice><Button onClick={() => load()}>Retry</Button></>
      : <p role="status">Loading accounts…</p>)}
    {accounts && <>
      <Field label="Account status"><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
        <option value="active">Active</option>
        <option value="blown">Blown</option>
      </select></Field>
      {!visibleAccounts.length && <p>{statusFilter === 'active' ? 'No active accounts.' : 'No blown accounts.'}</p>}
      {visibleAccounts.map(account => <div className="pj-account-row" key={account.id}>
        <div><strong>{account.name}</strong><br/>{size.format(account.starting_balance)} · {account.account_type}</div>
        <div className="settings-actions">
          <Button onClick={() => setDraft(account)} aria-label={`Edit ${account.name}`}>Edit</Button>
          <Button onClick={() => setDeleting(account)} aria-label={`Delete ${account.name}`}>Delete</Button>
        </div>
      </div>)}
      <Button onClick={() => setDraft({ ...blank })}>Add account</Button>
    </>}
    {draft && <Modal title={draft.id ? 'Edit account' : 'Add account'} onClose={close} closable={!busy}>
      <form onSubmit={save}>
        <Field label="Account name"><input required maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></Field>
        <Field label="Account size ($)"><input required type="number" min="0.01" step="0.01" value={draft.starting_balance} onChange={e => setDraft({ ...draft, starting_balance: e.target.value })}/></Field>
        <Field label="Account type"><select value={draft.account_type} onChange={e => setDraft({ ...draft, account_type: e.target.value })}>
          {['Funded', 'Eval', 'Personal'].map(type => <option key={type}>{type}</option>)}
        </select></Field>
        {draft.id && <Field label="Status"><select value={draft.status || 'active'} onChange={e => setDraft({ ...draft, status: e.target.value })}>
          <option value="active">Active</option>
          <option value="blown">Blown</option>
        </select></Field>}
        {error && <Notice error>{error}</Notice>}
        <div className="settings-actions"><Button type="submit" variant="primary" busy={busy}>Save account</Button><Button type="button" disabled={busy} onClick={close}>Cancel</Button></div>
      </form>
    </Modal>}
    {deleting && <Modal title="Delete account?" onClose={close} closable={!busy}>
      <p>Delete {deleting.name}? For accounts with linked trades, choose Blown under Edit to keep their history.</p>
      {error && <Notice error>{error}</Notice>}
      <div className="settings-actions"><Button busy={busy} onClick={remove}>Delete account</Button><Button type="button" disabled={busy} onClick={close}>Cancel</Button></div>
    </Modal>}
  </details>;
}
