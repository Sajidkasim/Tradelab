import React,{useEffect,useState} from 'react';
import {api} from './api';

export default function JournalRules({preferences,onSaved}){
 const saved=preferences?.trading_rules||'';
 const [draft,setDraft]=useState(saved),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{setDraft(saved)},[saved]);
 async function save(e){
  e.preventDefault();setBusy(true);setError('');setMessage('');
  try{const value=await api('/journal-preferences',{method:'PUT',body:{timezone:preferences?.timezone||'America/New_York',trading_rules:draft}});onSaved(value);setMessage('Rules saved.')}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <details className="pj-rules"><summary>Rules <span>Trading plan</span></summary><form onSubmit={save}>
  <label className="pj-field">Your personal trading rules<textarea rows={6} maxLength={12000} value={draft} disabled={busy} onChange={e=>{setDraft(e.target.value);setMessage('')}} placeholder="Write the rules you want to follow each session…"/></label>
  <button className="pt-btn" type="submit" disabled={busy||draft===saved}>{busy?'Saving…':'Save rules'}</button>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </form></details>;
}
