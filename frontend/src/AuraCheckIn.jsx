import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUp, AudioLines, Sparkles, Square} from 'lucide-react';
import {Modal} from './components';
import {api} from './api';
import './mindset-warmup.css';

function AuraChat({onClose}) {
  const [draft, setDraft] = useState('');
  const [opening, setOpening] = useState(null);
  const [turns, setTurns] = useState([]);
  const [dictationState, setDictationState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const recognizer = useRef(null);
  const dictationTimer = useRef(null);
  const request = useRef(null);
  const timeline = useRef(null);
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const listening = dictationState === 'listening';

  useEffect(() => {
    const openingRequest = new AbortController();
    api('/mindset/check-in/opening', {signal: openingRequest.signal})
      .then((result) => { if (!openingRequest.signal.aborted) setOpening(result); })
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
    const prefix = draft;
    function reportDictationError(reason) {
      if (recognizer.current !== recognition) return;
      recognizer.current = null;
      setDictationState(['not-allowed', 'service-not-allowed'].includes(reason) ? 'blocked' : 'missed');
      dictationTimer.current = setTimeout(() => setDictationState('idle'), 3000);
    }
    recognition.onresult = (event) => {
      if (recognizer.current !== recognition) return;
      const words = Array.from(event.results, (result) => result[0]?.transcript || '').join(' ');
      setDraft(`${prefix} ${words}`.trim().slice(0, 400));
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

  useEffect(() => {
    const chat = timeline.current;
    chat.scrollTop = chat.scrollHeight;
  }, [turns, busy]);

  async function send(question, index = turns.length) {
    if (!question || listening || request.current) return;
    const controller = new AbortController();
    const history = turns.slice(0, index).filter((turn) => turn.answer).slice(-4)
      .map(({question, answer}) => ({question, answer}));
    request.current = controller;
    if (index === turns.length) setDraft('');
    setBusy(true);
    const updateTurn = (next) => setTurns((current) => [
      ...current.slice(0, index), next, ...current.slice(index + 1),
    ]);
    updateTurn({question});
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const result = await api('/mindset/check-in/reflect', {
        method: 'POST', body: {step: 'question', reflection: question, history}, signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      updateTurn({question, answer: result.text});
    } catch {
      if (request.current === controller) updateTurn({question, failed: true});
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  const voiceLabel = {
    idle: 'Dictate message', listening: 'Stop dictation', blocked: 'Microphone blocked', missed: 'Didn’t catch that',
  }[dictationState];
  return <Modal title="Primax" className="mw-modal mw-aura-modal" onClose={onClose}>
    <div className={`mw-aura-dialog ${turns.length ? '' : 'is-empty'}`}>
      <div className="mw-aura-thread" role="log" aria-label="Conversation" ref={timeline}>
        <header className="mw-aura-opening">
          <span className="mw-aura-avatar" aria-hidden="true"><Sparkles size={19}/></span>
          <h3>Prime your execution for the session.</h3>
          <p>{opening?.text || 'Set your intention, visualise your best setup, or define when you’ll step away.'}</p>
          {!turns.length && <div className="mw-aura-suggestions" role="group" aria-label="Quick replies">
            {(opening?.suggestions || ['Visualise my exact A+ setup', 'Pressure-test my bias', 'Set my hard walk-away limits']).map((message) =>
              <button key={message} type="button" disabled={busy || listening || Boolean(draft.trim())}
                onClick={() => send(message)}>{message}</button>)}
          </div>}
        </header>
        {turns.map(({question, answer, failed}, index) => <React.Fragment key={index}>
          <div className="mw-aura-message is-user"><p>{question}</p></div>
          <div className="mw-aura-message">
            <span className="mw-aura-avatar" aria-hidden="true"><Sparkles size={17}/></span>
            {answer ? <p>{answer}</p> : failed
              ? <p>Primax is resting. {index === turns.length - 1 && <button type="button" className="mw-aura-retry"
                disabled={busy || listening} onClick={() => send(question, index)}>Try again</button>}</p>
              : <p className="mw-aura-thinking">Thinking…</p>}
          </div>
        </React.Fragment>)}
      </div>
      <form className="mw-aura-compose" onSubmit={(event) => {event.preventDefault(); send(draft.trim());}}>
        <textarea aria-label="Message Primax" placeholder="What’s the plan today?" rows={2} maxLength={400}
          value={draft} readOnly={listening} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(draft.trim());
            }
          }}/>
        <div className="mw-aura-compose-tools">
          {dictationState !== 'idle' && <span role="status" className="mw-dictation-status">
            {listening ? 'Listening…' : voiceLabel}
          </span>}
          {Speech && <button type="button" className={`mw-aura-icon mw-dictation is-${dictationState}`}
            aria-label={voiceLabel} title={voiceLabel} aria-pressed={listening}
            disabled={['blocked', 'missed'].includes(dictationState)} onClick={dictate}>
            {listening ? <Square size={16} aria-hidden="true"/> : <AudioLines size={19} aria-hidden="true"/>}
          </button>}
          <button type="submit" className="mw-aura-icon mw-aura-send" aria-label="Send message" title="Send message"
            disabled={busy || listening || !draft.trim()}><ArrowUp size={20} aria-hidden="true"/></button>
        </div>
      </form>
    </div>
  </Modal>;
}

export default function AuraCheckIn() {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  return <div className="pj-aura primax-global" data-primax-fab>
    <button ref={trigger} type="button" className="aura-orb pj-aura-orb"
      hidden={open} onClick={() => setOpen(true)} aria-label="Ask Primax" aria-haspopup="dialog">
      <Sparkles size={19} strokeWidth={1.65} aria-hidden="true"/><span>Primax</span>
    </button>
    {open && createPortal(<AuraChat onClose={close}/>, document.body)}
  </div>;
}
