import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Mic, Sparkles} from 'lucide-react';
import {Button, Modal, Notice} from './components';
import {api} from './api';

const FOCUS = {
  patience:['Patience','What will you wait to see before entering?','I will wait for my confirmation before I enter.'],
  reset:['Reset after a loss','What will you do if you feel the urge to win a loss back?','After a loss, I will pause and review my rules before the next trade.'],
  risk:['Risk discipline','Which risk rule will you check before placing a trade?','I will check my risk before entering.'],
  focus:['Focus','What is one action that would help you stick to your plan today?','I will check my plan before making a decision.'],
};

function suggestedFocus(text) {
  if (/loss|revenge|yesterday|make .*back/i.test(text)) return 'reset';
  if (/chase|fomo|rush|patien/i.test(text)) return 'patience';
  if (/risk|size|overtrad/i.test(text)) return 'risk';
  return 'focus';
}

function GuidedCheckIn({state,onSaved,onClose}) {
  const [step,setStep]=useState(0);
  const [reflection,setReflection]=useState('');
  const [focus,setFocus]=useState(state.aura_focus || 'focus');
  const [answer,setAnswer]=useState('');
  const [intention,setIntention]=useState('');
  const [followUp,setFollowUp]=useState('');
  const [guided,setGuided]=useState(false);
  const [error,setError]=useState('');
  const [listening,setListening]=useState(false);
  const [busy,setBusy]=useState(false);
  const [useBrowser,setUseBrowser]=useState(false);
  const [chat,setChat]=useState(false);
  const [reply,setReply]=useState('');
  const recognizer=useRef(null);
  const request=useRef(null);
  const Speech=window.SpeechRecognition || window.webkitSpeechRecognition;
  const deviceDictation=Boolean(Speech && 'processLocally' in Speech.prototype && !useBrowser);

  useEffect(()=>()=>{
    const current=recognizer.current;
    recognizer.current=null;
    if(current) {current.onend=null;current.onerror=null;current.onresult=null;current.abort();}
    request.current?.abort();
  },[]);

  function dictate() {
    if(listening){recognizer.current?.stop();return;}
    setError('');
    const recognition=new Speech();
    if ('processLocally' in recognition) recognition.processLocally=deviceDictation;
    recognition.lang=navigator.language || 'en-GB';
    recognition.interimResults=true;
    recognition.continuous=true;
    const prefix=step===0?reflection:answer;
    recognition.onresult=event=>{
      const words=Array.from(event.results,result=>result[0]?.transcript || '').join(' ');
      (step===0?setReflection:setAnswer)(`${prefix} ${words}`.trim().slice(0,400));
    };
    recognition.onerror=event=>{
      if(deviceDictation && ['language-not-supported','service-not-allowed'].includes(event.error)) {
        setUseBrowser(true);
        setError('On-device dictation is unavailable. You can type or choose browser dictation.');
      } else setError('Dictation couldn’t hear you. Try again, check microphone access, or type your reply.');
    };
    recognition.onend=()=>{recognizer.current=null;setListening(false);};
    try {recognition.start();recognizer.current=recognition;setListening(true);}
    catch {setError('Device dictation could not start. You can type your reply.');}
  }

  async function reflect(stage) {
    if(busy)return;
    const controller=new AbortController();
    request.current=controller;
    setBusy(true);setError('');
    try {
      const result=await api('/mindset/check-in/reflect', {method:'POST',
        body:{step:stage,reflection:reflection.trim(),reply:answer.trim(),question:followUp,focus},signal:controller.signal});
      if(controller.signal.aborted)return;
      if(stage==='follow_up') {setGuided(false);setFocus(result.focus);setFollowUp(result.text);setStep(1);}
      else if(stage==='question') setReply(result.text);
      else {setIntention(result.text);setStep(2);}
    } catch (failure) {
      if(controller.signal.aborted)return;
      setGuided(stage!=='question');
      setError(failure.message);
    } finally {
      if(!controller.signal.aborted)setBusy(false);
    }
  }

  async function save() {
    if(!intention.trim()||busy)return;
    const controller=new AbortController();
    request.current=controller;
    setBusy(true);setError('');
    try {
      const result=await api('/mindset/check-in',{method:'PUT',body:{day:state.day,focus,intention:intention.trim()},signal:controller.signal});
      if(!controller.signal.aborted) onSaved(result);
    } catch(e) {
      if(!controller.signal.aborted){setError(e.message);setBusy(false);}
    }
  }

  const titles = ['Leave the last session at the door.', 'Choose how you’ll respond.', 'Take one rule to the desk.'];
  const dictation = step<2&&<div className="mw-aura-compose-tools">
    {Speech?<Button type="button" disabled={busy} onClick={dictate} aria-pressed={listening}>
      <Mic size={16} aria-hidden="true"/>{listening?'Stop dictation':deviceDictation?'Speak your reply':'Use browser dictation'}
    </Button>:<small>Use the microphone on your keyboard to dictate.</small>}
    {Speech&&!deviceDictation&&<small>Your browser may send audio to its speech service.</small>}
    {listening&&<span className="mw-aura-listening" role="status">Listening…</span>}
  </div>;
  return <Modal title="Aura check-in" className="mw-modal mw-aura-modal" onClose={onClose}>
    <div className="mw-aura-dialog">
      <div className="mw-aura-prompt" key={step}>
        <div className="mw-aura-avatar" aria-hidden="true"><Sparkles size={21}/></div>
        <div><h3>{titles[step]}</h3><p>{[
          'Before you look at a chart, take a moment. What could pull you away from your plan today?',
          followUp || FOCUS[focus][1],
          'Put it in your own words so you’ll remember it when price moves.',
        ][step]}</p></div>
      </div>
      {step===0&&<>
        <div className="mw-mode-buttons" role="group" aria-label="Aura mode">
          <Button disabled={listening||busy} aria-pressed={!chat} onClick={()=>{setChat(false);setError('');setGuided(false);}}>Guided check-in</Button>
          <Button disabled={listening||busy} aria-pressed={chat} onClick={()=>{setChat(true);setError('');setGuided(false);}}>Ask Aura</Button>
        </div>
        {!chat&&<div className="mw-aura-starters" aria-label="Starting points" role="group">
          {['I feel focused', 'Yesterday is still on my mind', 'I’m tempted to rush'].map(text=>
            <button type="button" key={text} onClick={()=>setReflection(text)} disabled={listening||busy}>{text}</button>)}
        </div>}
        <div className="mw-aura-compose">
          <textarea aria-label="Your reflection" placeholder={chat?"Ask Aura a question…":"Start anywhere…"} readOnly={listening} rows={3} maxLength={400} disabled={busy} value={reflection} onChange={e=>setReflection(e.target.value)}/>
          {dictation}
        </div>
        {reply&&chat&&<p role="status">{reply}</p>}
        <Button variant="primary" busy={busy} disabled={!reflection.trim()||listening} onClick={()=>reflect(chat?'question':'follow_up')}>{chat?'Send question':'Continue'}</Button>
      </>}
      {step===1&&<>
        <label>Today’s focus<select value={focus} disabled={busy} onChange={e=>{setFocus(e.target.value);setFollowUp('');}}>
          {Object.entries(FOCUS).map(([id,[label]])=><option value={id} key={id}>{label}</option>)}
        </select></label>
        <div className="mw-aura-compose">
          <textarea aria-label="How will you respond?" placeholder="When that happens, I’ll…" readOnly={listening} rows={3} maxLength={400} disabled={busy} value={answer} onChange={e=>setAnswer(e.target.value)}/>
          {dictation}
        </div>
        <Button variant="primary" busy={busy} disabled={listening} onClick={()=>{
          if(guided){setIntention((answer.trim()||FOCUS[focus][2]).slice(0,300));setError('');setStep(2);}
          else reflect('intention');
        }}>Review intention</Button>
      </>}
      {step===2&&<>
        <div className="mw-aura-compose"><textarea aria-label="Daily intention" maxLength={300} rows={3} value={intention} disabled={busy} onChange={e=>setIntention(e.target.value)}/></div>
        <Button variant="primary" busy={busy} disabled={!intention.trim()} onClick={save}>Approve and save</Button>
      </>}
      {error&&<Notice error>{error}</Notice>}
      {error&&guided&&<Button onClick={()=>{
        setError('');
        if(step===0){setFocus(suggestedFocus(reflection));setStep(1);}
        else {setIntention((answer.trim()||FOCUS[focus][2]).slice(0,300));setStep(2);}
      }}>Continue without AI</Button>}
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
    {state.intention ? <div className="mw-aura-intention"><small>Today’s intention{state.aura_focus ? ` · ${FOCUS[state.aura_focus]?.[0] || 'Focus'}` : ''}</small><p>{state.intention}</p></div>
      : <p>Pick one thing to focus on before the bell.</p>}
    <details className="mw-aura-history" onToggle={historyToggle}>
      <summary>Recent check-ins</summary>
      {history===null ? <p role="status">Loading check-ins…</p> : history===false ? <p>Check-ins are unavailable. Reopen to retry.</p>
        : !history.length ? <p>Your saved check-ins will appear here.</p> : <ul>{history.map(row=><li key={row.day}><strong>{FOCUS[row.focus]?.[0] || 'Focus'}</strong><time dateTime={row.day}>{row.day}</time><p>{row.intention}</p></li>)}</ul>}
    </details>
    {open&&createPortal(<GuidedCheckIn state={state} onClose={()=>setOpen(false)} onSaved={value=>{
      onSaved(value);
      setHistory(current=>Array.isArray(current)?[{day:value.day,focus:value.aura_focus,intention:value.intention},...current.filter(row=>row.day!==value.day)].slice(0,7):current);
      setOpen(false);
    }}/>,document.body)}
  </section>;
}
