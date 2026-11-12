import React,{useEffect,useState} from 'react';
import {ChevronRight, ClipboardList} from 'lucide-react';
import {api} from './api';

export default function JournalRules({preferences,onSaved}){
 const saved=preferences?.trading_rules||'';
 const [draft,setDraft]=useState(saved),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{setDraft(saved)},[saved]);
 useEffect(()=>{if(draft===saved)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[draft,saved]);
 async function save(e){
  e.preventDefault();setBusy(true);setError('');setMessage('');
  try{const value=await api('/journal-preferences',{method:'PUT',body:{timezone:preferences?.timezone||'America/New_York',trading_rules:draft}});onSaved(value);setMessage('Rules saved.')}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <details className="pj-rules"><summary className="pj-sidebar-action"><ClipboardList size={17} aria-hidden="true"/> Rules <ChevronRight className="pj-rules-chevron" size={16} aria-hidden="true"/></summary><form onSubmit={save}>
  <label className="pj-field">Your personal trading rules<textarea rows={6} maxLength={12000} value={draft} disabled={busy} onChange={e=>{setDraft(e.target.value);setMessage('')}} placeholder="Write the rules you want to follow each session…"/></label>
  <button className="pt-btn" type="submit" disabled={busy||draft===saved}>{busy?'Saving…':'Save rules'}</button>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </form></details>;
}
