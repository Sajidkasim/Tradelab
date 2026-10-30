import React, { useState } from 'react';
import { api } from './api';
import { Modal, Field, Select, Button, Notice } from './components';

const lines = (text) => [...new Set(text.split('\n').map((value) => value.trim()).filter(Boolean))];
export default function Welcome({ refresh }) {
  const [timezone, setTimezone] = useState('America/New_York');
  const [strategies, setStrategies] = useState(''), [levels, setLevels] = useState(''), [confirmations, setConfirmations] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/welcome', { method: 'PUT', body: { timezone, strategies: lines(strategies), levels: lines(levels), confirmations: lines(confirmations) } });
      await refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal closable={false} title="Welcome to your lab" className="lab-settings-modal" onClose={() => {}}>
    <form className="stack" onSubmit={save}>
      <p>Your strategy tester is private and starts empty. Set up your own labels below, or leave them blank and add them later in My lab → Lab settings.</p>
      <p className="muted">After setup, an optional five-step guide will show you around.</p>
      <Select label="Tester clock" value={timezone} onChange={(e) => setTimezone(e.target.value)} values={[{value:'America/New_York',label:'New York · EST / EDT'},{value:'Europe/London',label:'UK · GMT / BST'}]} />
      <div className="form-grid two">
        <Field label="Your strategies" hint="Optional · one name per line"><textarea rows={4} value={strategies} onChange={(e) => setStrategies(e.target.value)} /></Field>
        <Field label="Your key levels / PDA" hint="Optional · one name per line"><textarea rows={4} value={levels} onChange={(e) => setLevels(e.target.value)} /></Field>
      </div>
      <Field label="Your confirmations" hint="Optional · one name per line"><textarea rows={3} value={confirmations} onChange={(e) => setConfirmations(e.target.value)} /></Field>
      <small className="muted">The tester clock controls trade entry, dates and the graph. Session windows and CSV export time zones have their own settings.</small>
      {error && <Notice error>{error}</Notice>}
      <Button type="submit" variant="primary" busy={busy}>Open my lab</Button>
    </form>
  </Modal>;
}
