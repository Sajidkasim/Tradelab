import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Mic, Sparkles} from 'lucide-react';
import {Button, Modal, Notice, Segments} from './components';
import {api} from './api';

const FOCUS = {
  patience:'Patience',
  reset:'Reset after a loss',
  risk:'Risk discipline',
  focus:'Focus',
};

function suggestedFocus(text) {
  if (/loss|revenge|yesterday|make .*back/i.test(text)) return 'reset';
  if (/chase|fomo|rush|patien/i.test(text)) return 'patience';
  if (/risk|size|overtrad/i.test(text)) return 'risk';
  return 'focus';
}

function GuidedCheckIn({state, onSaved, onClose}) {
  const [reflection, setReflection] = useState('');
  const [focus, setFocus] = useState(state.aura_focus || 'focus');
  const [intention, setIntention] = useState('');
  const [opening, setOpening] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [resting, setResting] = useState(false);
  const [error, setError] = useState('');
  const [dictationState, setDictationState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('guided');
  const [reply, setReply] = useState('');
  const recognizer = useRef(null);
  const dictationTimer = useRef(null);
  const request = useRef(null);
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const listening = dictationState === 'listening';
  const chat = mode === 'chat';
  const canSubmit = reflection.trim().length >= (chat && !reviewing ? 1 : 10);

  useEffect(() => {
    const openingRequest = new AbortController();
    api('/mindset/check-in/opening', {signal: openingRequest.signal})
      .then((result) => { if (!openingRequest.signal.aborted) setOpening(result.text); })
      .catch(() => {});
    function onVisibilityChange() {
      if (document.hidden) recognizer.current?.stop();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      openingRequest.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(dictationTimer.current);
      const current = recognizer.current;
      recognizer.current = null;
      if (current) {
        current.onend = current.onerror = current.onresult = null;
        current.abort();
      }
      const active = request.current;
      request.current = null;
      active?.abort();
    };
  }, []);

  function dictate() {
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    clearTimeout(dictationTimer.current);
    const recognition = new Speech();
    recognition.lang = navigator.language || 'en-GB';
    recognition.interimResults = true;
    recognition.continuous = true;
    const prefix = reflection;
    function reportDictationError(reason) {
      if (recognizer.current !== recognition) return;
      recognizer.current = null;
      setDictationState(['not-allowed', 'service-not-allowed'].includes(reason) ? 'blocked' : 'missed');
      dictationTimer.current = setTimeout(() => setDictationState('idle'), 3000);
    }
    recognition.onresult = (event) => {
      if (recognizer.current !== recognition) return;
      const words = Array.from(event.results, (result) => result[0]?.transcript || '').join(' ');
      setReflection(`${prefix} ${words}`.trim().slice(0, 400));
    };
    recognition.onerror = (event) => reportDictationError(event.error);
    recognition.onend = () => {
      if (recognizer.current !== recognition) return;
      recognizer.current = null;
      setDictationState('idle');
    };
    recognizer.current = recognition;
    setDictationState('listening');
    try { recognition.start(); }
    catch (failure) { reportDictationError(failure.name === 'NotAllowedError' ? 'not-allowed' : ''); }
  }

  async function reflect(stage) {
    if (request.current || !canSubmit) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setResting(false);
    if (stage === 'question') setReply('');
    const timer = setTimeout(() => {
      if (request.current === controller) controller.abort();
    }, 5000);
    try {
      const result = await api('/mindset/check-in/reflect', {
        method: 'POST',
        body: {step: stage, reflection: reflection.trim(), question: stage === 'intention' ? intention : '', focus},
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (stage === 'question') setReply(result.text);
      else {
        setFocus(result.focus);
        setIntention(result.text.slice(0, 300));
        setReviewing(true);
      }
    } catch {
      if (request.current !== controller) return;
      setResting(true);
      if (!reviewing) setFocus(suggestedFocus(reflection));
      setReviewing(true);
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  async function save() {
    if (!intention.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await api('/mindset/check-in', {
        method: 'PUT', body: {day: state.day, focus, intention: intention.trim()}, signal: controller.signal,
      });
      if (!controller.signal.aborted) onSaved(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  const micLabel = {
    idle: 'Use browser dictation', listening: 'Listening…', blocked: 'Microphone blocked', missed: 'Didn’t catch that',
  }[dictationState];
  return <Modal title="Aura check-in" className="mw-modal mw-aura-modal" onClose={onClose}>
    <div className="mw-aura-dialog">
      <div className="mw-aura-prompt" key={reviewing ? 'rule' : mode}>
        <div className="mw-aura-avatar" aria-hidden="true"><Sparkles size={21}/></div>
        <div>
          <h3>{reviewing ? 'Take one rule to the desk.' : chat ? 'What’s on your mind?' : 'Leave the last session at the door.'}</h3>
          <p>{reviewing
            ? resting ? 'Write one rule you can follow today.' : 'Make this rule your own before you save it.'
            : chat ? 'Ask Aura about your trading process.'
              : opening || 'Before you look at a chart, take a moment. What could pull you away from your plan today?'}</p>
        </div>
      </div>
      {!reviewing && <>
        <div className="mw-mode-buttons">
          <Segments label="Aura mode" values={[{value:'guided', label:'Guided check-in'}, {value:'chat', label:'Ask Aura'}]}
            value={mode} disabled={listening || busy} onChange={setMode}/>
        </div>
        {!chat && <div className="mw-aura-starters" aria-label="Starting points" role="group">
          {['I feel focused', 'Yesterday is still on my mind', 'I’m tempted to rush'].map((text) =>
            <button type="button" key={text} onClick={() => setReflection(text)} disabled={listening || busy}>{text}</button>)}
        </div>}
        <div className="mw-aura-compose">
          <textarea aria-label="Your reflection" placeholder={chat ? 'Ask Aura a question…' : 'Start anywhere…'}
            readOnly={listening} rows={3} maxLength={400} disabled={busy} value={reflection} onChange={(e) => setReflection(e.target.value)}/>
          <div className="mw-aura-compose-tools">
            {Speech ? <Button type="button" disabled={busy || ['blocked', 'missed'].includes(dictationState)}
              className={`mw-dictation is-${dictationState}`} onClick={dictate} aria-pressed={listening}
              aria-label={listening ? 'Listening… Stop dictation' : micLabel}>
              <Mic size={16} aria-hidden="true"/>{micLabel}
            </Button> : <small>Use the microphone on your keyboard to dictate.</small>}
            {Speech && <small>Your browser may send audio to its speech service.</small>}
            {dictationState !== 'idle' && <span className="mw-dictation-status" role="status">{micLabel}</span>}
          </div>
        </div>
        {reply && chat && <p role="status">{reply}</p>}
        <Button variant="primary" busy={busy} disabled={!canSubmit || listening}
          onClick={() => reflect(chat ? 'question' : 'intention')}>{chat ? 'Send question' : 'Continue'}</Button>
      </>}
      {reviewing && <>
        <div className="mw-aura-compose">
          <textarea aria-label="Daily intention" placeholder="I will…" maxLength={300} rows={3}
            value={intention} disabled={busy} onChange={(e) => setIntention(e.target.value)}/>
        </div>
        <div className="mw-step-actions">
          <Button disabled={busy} onClick={() => {setReviewing(false); setResting(false); setError('');}}>Edit reflection</Button>
          <Button disabled={busy || !canSubmit} onClick={() => reflect('intention')}>Regenerate</Button>
          <Button variant="primary" busy={busy} disabled={!intention.trim()} onClick={save}>Approve and save</Button>
        </div>
      </>}
      {resting && <div className="toast mw-aura-toast" role="status">Aura is resting. You can write and save your rule here.</div>}
      {error && <Notice error>{error}</Notice>}
    </div>
  </Modal>;
}

export default function AuraCheckIn({state,onSaved}) {
  const [open,setOpen]=useState(false);
  const [history,setHistory]=useState(null);
  const reader=useRef(null);
  useEffect(()=>()=>reader.current?.abort(),[]);
  async function historyToggle(event) {
    reader.current?.abort();
    if(!event.currentTarget.open)return;
    const controller=new AbortController();
    reader.current=controller;
    setHistory(null);
    try {
      const rows=await api('/mindset/check-ins',{signal:controller.signal});
      if(!controller.signal.aborted)setHistory(rows);
    } catch {
      if(!controller.signal.aborted)setHistory(false);
    }
  }
  return <section className="wp-panel mw-card mw-aura-card" aria-labelledby="morning-check-in">
    <h2 id="morning-check-in">Aura Check-In</h2>
    <button type="button" className="mw-aura-orb" onClick={()=>setOpen(true)} aria-label="Open Aura check-in">
      <Sparkles size={27} aria-hidden="true"/><span>Aura</span>
    </button>
    {state.intention ? <div className="mw-aura-intention"><small>Today’s intention{state.aura_focus ? ` · ${FOCUS[state.aura_focus] || 'Focus'}` : ''}</small><p>{state.intention}</p></div>
      : <p>Pick one thing to focus on before the bell.</p>}
    <details className="mw-aura-history" onToggle={historyToggle}>
      <summary>Recent check-ins</summary>
      {history===null ? <p role="status">Loading check-ins…</p> : history===false ? <p>Check-ins are unavailable. Reopen to retry.</p>
        : !history.length ? <p>Your saved check-ins will appear here.</p> : <ul>{history.map(row=><li key={row.day}><strong>{FOCUS[row.focus] || 'Focus'}</strong><time dateTime={row.day}>{row.day}</time><p>{row.intention}</p></li>)}</ul>}
    </details>
    {open&&createPortal(<GuidedCheckIn state={state} onClose={()=>setOpen(false)} onSaved={value=>{
      onSaved(value);
      setHistory(current=>Array.isArray(current)?[{day:value.day,focus:value.aura_focus,intention:value.intention},...current.filter(row=>row.day!==value.day)].slice(0,7):current);
      setOpen(false);
    }}/>,document.body)}
  </section>;
}
