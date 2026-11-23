import React, { useEffect, useState } from 'react';
import { CheckCircle2, Flame, Plus, RotateCcw, Wallet } from 'lucide-react';
import { api } from './api';
import { Button, Field, Modal, Notice } from './components';

const blank = {
  name: '',
  starting_balance: '',
  account_type: 'Eval',
  status: 'active',
  firm: '',
  fee_paid: '',
  payouts_total: '',
  closed_at: '',
};
const size = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function fmtSigned(value) {
  const num = Number(value || 0);
  const abs = size.format(Math.abs(num));
  return num > 0 ? `+${abs}` : num < 0 ? `-${abs}` : abs;
}

export default function JournalAccounts({ accounts, setAccounts }) {
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
    const {
      id,
      name,
      starting_balance,
      account_type,
      status = 'active',
      firm = '',
      fee_paid = '',
      payouts_total = '',
      closed_at = '',
    } = draft;
    const payload = {
      name: name.trim(),
      starting_balance: Number(starting_balance),
      account_type,
      status,
      firm: firm.trim(),
      fee_paid: fee_paid === '' ? 0 : Number(fee_paid),
      payouts_total: payouts_total === '' ? 0 : Number(payouts_total),
    };
    if (closed_at) payload.closed_at = closed_at;
    else if (status === 'active') payload.closed_at = null;
    try {
      const saved = await api(id ? `/journal-accounts/${id}` : '/journal-accounts', {
        method: id ? 'PUT' : 'POST',
        body: payload,
      });
      setAccounts(items => id ? items.map(item => item.id === id ? saved : item) : [...items, saved]);
      setStatusFilter(saved.status || status);
      setDraft(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function quickStatus(account, nextStatus) {
    setBusy(true);
    setError('');
    try {
      const saved = await api(`/journal-accounts/${account.id}`, {
        method: 'PUT',
        body: {
          name: account.name,
          starting_balance: Number(account.starting_balance),
          account_type: account.account_type,
          status: nextStatus,
          firm: account.firm || '',
          fee_paid: Number(account.fee_paid || 0),
          payouts_total: Number(account.payouts_total || 0),
        },
      });
      setAccounts(items => items.map(item => item.id === account.id ? saved : item));
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

  const all = accounts || [];
  const activeAccounts = all.filter(a => (a.status || 'active') === 'active');
  const passedAccounts = all.filter(a => a.status === 'passed');
  const blownAccounts = all.filter(a => a.status === 'blown');
  const visibleAccounts = all.filter(account => (account.status || 'active') === statusFilter);
  const totalFees = all.reduce((sum, a) => sum + Number(a.fee_paid || 0), 0);
  const totalPayouts = all.reduce((sum, a) => sum + Number(a.payouts_total || 0), 0);
  const netRoi = totalPayouts - totalFees;
  const hasLedger = totalFees > 0 || totalPayouts > 0 || blownAccounts.length > 0 || passedAccounts.length > 0;

  return <details className="pj-accounts">
    <summary>
      <span className="pj-accounts-summary-main">
        <Wallet size={16} aria-hidden="true"/>
        <strong>Accounts</strong>
        {accounts && <span className="pj-acct-pill active">{activeAccounts.length} active</span>}
        {passedAccounts.length > 0 && <span className="pj-acct-pill passed">{passedAccounts.length} passed</span>}
        {blownAccounts.length > 0 && <span className="pj-acct-pill blown">{blownAccounts.length} blown</span>}
      </span>
      {accounts && (totalFees > 0 || totalPayouts > 0) && (
        <span className={`pj-acct-roi ${netRoi < 0 ? 'loss' : 'gain'}`}>
          Prop ROI {fmtSigned(netRoi)}
        </span>
      )}
    </summary>
    <div className="pj-accounts-body">
      {accounts === null && (error
        ? <><Notice error>{error}</Notice><Button onClick={() => load()}>Retry</Button></>
        : <p role="status">Loading accounts…</p>)}
      {accounts && <>
        <div className="pj-accounts-toolbar">
          <div className="segments" role="group" aria-label="Account status">
            {[
              ['active', `Active (${activeAccounts.length})`],
              ['passed', `Passed (${passedAccounts.length})`],
              ['blown', `Blown (${blownAccounts.length})`],
            ].map(([value, label]) => (
              <button key={value} type="button" className={statusFilter === value ? 'selected' : ''}
                aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={() => setDraft({ ...blank })}><Plus size={15}/> Add account</Button>
        </div>

        {hasLedger && (
          <div className="pj-prop-ledger" aria-label="Prop firm ledger">
            <div><span>Active capital</span><strong>{size.format(activeAccounts.reduce((s, a) => s + Number(a.starting_balance || 0), 0))}</strong></div>
            <div><span>Eval &amp; activation fees</span><strong>{size.format(totalFees)}</strong></div>
            <div><span>Total payouts</span><strong>{size.format(totalPayouts)}</strong></div>
            <div><span>Net prop ROI</span><strong className={netRoi < 0 ? 'loss' : netRoi > 0 ? 'gain' : ''}>{fmtSigned(netRoi)}</strong></div>
          </div>
        )}

        {error && !draft && !deleting && <Notice error>{error}</Notice>}
        {!visibleAccounts.length && <p className="pj-accounts-empty">
          {statusFilter === 'active' ? 'No active accounts yet.' : statusFilter === 'passed' ? 'No passed evaluations yet.' : 'No blown accounts.'}
        </p>}
        <div className="pj-account-list">
          {visibleAccounts.map(account => {
            const st = account.status || 'active';
            return <div className={`pj-account-row is-${st}`} key={account.id}>
              <div className="pj-account-meta">
                <div className="pj-account-title">
                  <strong>{account.name}</strong>
                  {account.firm && <span className="pj-acct-firm">{account.firm}</span>}
                </div>
                <small>
                  {size.format(account.starting_balance)} · {account.account_type}
                  {Number(account.fee_paid || 0) > 0 && ` · Fee ${size.format(account.fee_paid)}`}
                  {Number(account.payouts_total || 0) > 0 && ` · Payouts ${size.format(account.payouts_total)}`}
                  {account.closed_at && ` · ${st === 'passed' ? 'Passed' : 'Blown'} ${account.closed_at}`}
                </small>
              </div>
              <div className="settings-actions">
                {st === 'active' && account.account_type === 'Eval' && (
                  <Button disabled={busy} onClick={() => quickStatus(account, 'passed')} aria-label={`Mark ${account.name} passed`}>
                    <CheckCircle2 size={14}/> Passed
                  </Button>
                )}
                {st === 'active' && (
                  <Button disabled={busy} onClick={() => quickStatus(account, 'blown')} aria-label={`Mark ${account.name} blown`}>
                    <Flame size={14}/> Blown
                  </Button>
                )}
                {st !== 'active' && (
                  <Button disabled={busy} onClick={() => quickStatus(account, 'active')} aria-label={`Reactivate ${account.name}`}>
                    <RotateCcw size={14}/> Reactivate
                  </Button>
                )}
                <Button disabled={busy} onClick={() => setDraft({
                  ...blank,
                  ...account,
                  firm: account.firm || '',
                  fee_paid: account.fee_paid ? String(account.fee_paid) : '',
                  payouts_total: account.payouts_total ? String(account.payouts_total) : '',
                  closed_at: account.closed_at || '',
                })} aria-label={`Edit ${account.name}`}>Edit</Button>
                <Button disabled={busy} onClick={() => setDeleting(account)} aria-label={`Delete ${account.name}`}>Delete</Button>
              </div>
            </div>;
          })}
        </div>
      </>}
    </div>

    {draft && <Modal title={draft.id ? 'Edit account' : 'Add account'} onClose={close} closable={!busy}>
      <form onSubmit={save}>
        <Field label="Account name"><input required maxLength={120} placeholder="e.g. Apex 50K #3" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></Field>
        <div className="pj-account-form-grid">
          <Field label="Account size ($)"><input required type="number" min="0.01" step="0.01" placeholder="50000" value={draft.starting_balance} onChange={e => setDraft({ ...draft, starting_balance: e.target.value })}/></Field>
          <Field label="Account type"><select value={draft.account_type} onChange={e => setDraft({ ...draft, account_type: e.target.value })}>
            {['Funded', 'Eval', 'Personal'].map(type => <option key={type}>{type}</option>)}
          </select></Field>
          <Field label="Prop firm / broker"><input maxLength={60} placeholder="Optional · e.g. Topstep, Apex" value={draft.firm || ''} onChange={e => setDraft({ ...draft, firm: e.target.value })}/></Field>
          <Field label="Status"><select value={draft.status || 'active'} onChange={e => setDraft({ ...draft, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="passed">Passed</option>
            <option value="blown">Blown</option>
          </select></Field>
          <Field label="Fee paid ($)"><input type="number" min="0" step="0.01" placeholder="Optional · e.g. 149" value={draft.fee_paid ?? ''} onChange={e => setDraft({ ...draft, fee_paid: e.target.value })}/></Field>
          <Field label="Payouts withdrawn ($)"><input type="number" min="0" step="0.01" placeholder="Optional · e.g. 2000" value={draft.payouts_total ?? ''} onChange={e => setDraft({ ...draft, payouts_total: e.target.value })}/></Field>
        </div>
        {(draft.status === 'blown' || draft.status === 'passed') && (
          <Field label={draft.status === 'passed' ? 'Date passed' : 'Date blown'}>
            <input type="date" value={draft.closed_at || ''} onChange={e => setDraft({ ...draft, closed_at: e.target.value })}/>
          </Field>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="settings-actions"><Button type="submit" variant="primary" busy={busy}>Save account</Button><Button type="button" disabled={busy} onClick={close}>Cancel</Button></div>
      </form>
    </Modal>}
    {deleting && <Modal title="Delete account?" onClose={close} closable={!busy}>
      <p>Delete {deleting.name}? For accounts with linked trades, mark it as Blown or Passed to keep its history without cluttering your active curve.</p>
      {error && <Notice error>{error}</Notice>}
      <div className="settings-actions"><Button busy={busy} onClick={remove}>Delete account</Button><Button type="button" disabled={busy} onClick={close}>Cancel</Button></div>
    </Modal>}
  </details>;
}
