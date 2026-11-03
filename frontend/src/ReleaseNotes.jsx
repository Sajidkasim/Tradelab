import React, {useState} from 'react';
import {Modal, Button, Notice} from './components';
export default function ReleaseNotes({notes,onSeen,onClose}) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  async function dismiss(){
    setBusy(true);setError('');
    try {await onSeen();} catch(e){setError(e.message);} finally {setBusy(false);}
  }
  return <Modal title="What’s new in PrimusTrader" className="release-notes-modal" onClose={()=>!busy&&dismiss()}>
    <p className="muted">{notes.date} · Updates to your Lab, Journal and backtesting.</p>
    <div className="release-notes-list">{notes.items.map(item=><section key={item.title}><h3>{item.title}</h3><p>{item.text}</p></section>)}</div>
    {error&&<Notice error>{error}</Notice>}
    <div className="settings-actions"><Button variant="primary" busy={busy} onClick={dismiss}>Got it</Button>{error&&<Button onClick={onClose}>Close for now</Button>}</div>
    <small className="muted">Reopen these notes from My lab → What’s new.</small>
  </Modal>;
}
