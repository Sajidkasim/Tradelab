import React, {useEffect, useId, useRef, useState} from 'react';
import {api} from './api';

function inlineMarkdown(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  );
}

function CoachMarkdown({text}) {
  return text.trim().split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n');
    return <div key={index}>{lines.map((line, lineIndex) => {
      if (/^#{1,6}\s/.test(line)) return <h4 key={lineIndex}>{inlineMarkdown(line.replace(/^#+\s+/, ''))}</h4>;
      if (/^>\s?/.test(line)) return <blockquote key={lineIndex}>{inlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>;
      return <p key={lineIndex}>{inlineMarkdown(line.replace(/^[-*]\s+/, '• '))}</p>;
    })}</div>;
  });
}

function AuraReview({day, account, dirty, titleId, onClose}) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  async function review(event) {
    event.preventDefault();
    if (loading) return;
    const controller = new AbortController();
    request.current = controller;
    setError('');
    const submitted = question.trim() || 'What stands out from my journal today?';
    setLoading(true);
    const query = new URLSearchParams({day});
    if (account != null) query.set('account_id', account);
    try {
      const result = await api(`/journal/coach?${query}`, {method: 'POST', body: {question: submitted, history: turns.slice(-3).map(turn => ({question: turn.question.slice(0, 400), answer: turn.answer.slice(0, 650)}))}, cache: 'no-store', signal: controller.signal});
      if (!controller.signal.aborted) {
        setTurns(previous => [...previous.slice(-19), {question: submitted, answer: result.markdown}]);
        setQuestion(current => current.trim() === question.trim() ? '' : current);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return <section className="pj-coach card" aria-labelledby={titleId}>
    <header>
      <h3 id={titleId}>Aura</h3>
      <button type="button" className="pt-btn" onClick={onClose} aria-label="Close Aura">×</button>
    </header>
    <details className="pj-aura-context">
      <summary>Journal context</summary>
      <p>Cloudflare receives this day’s saved notes, trade details and recent messages. Screenshots stay private. Account stats use the selected account, or the first account in All accounts.</p>
    </details>
    {dirty && <p>Save your entry to include your latest notes.</p>}
    {turns.length > 0 && <div className="pj-coach-review" role="log" aria-label="Conversation with Aura">
      {turns.map((turn, index) => <article key={index}>
        <p className="pj-aura-question">{turn.question}</p>
        <div className="pj-aura-answer" aria-label="Aura"><CoachMarkdown text={turn.answer}/></div>
      </article>)}
    </div>}
    <form onSubmit={review} className="pj-field">
      <label htmlFor={titleId + '-question'}>Your question</label>
      <textarea id={titleId + '-question'} value={question} maxLength={1000} rows={2}
        placeholder="What could I improve about my entry timing?"
        onChange={event => setQuestion(event.target.value)}/>
      <button type="submit" className="pt-btn pt-btn-dark" disabled={loading}>
        {loading ? 'Thinking…' : question.trim() ? 'Send question' : 'Ask Aura'}
      </button>
    </form>
    {loading && <p role="status">Aura is thinking…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

const ORB = 58;
const EDGE = 12;
const GAP = 10;
const initialPosition = () => ({x: window.innerWidth - ORB - 20, y: window.innerHeight - ORB - 20});
const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value));
const keepOnScreen = ({x, y}) => ({
  x: clamp(x, EDGE, window.innerWidth - ORB - EDGE),
  y: clamp(y, EDGE, window.innerHeight - ORB - EDGE),
});

export default function FloatingAura({day, account, dirty}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(() => keepOnScreen(initialPosition()));
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const button = useRef(null);
  const titleId = useId();
  const panelId = useId();

  useEffect(() => {
    const resize = () => setPosition(keepOnScreen);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  function startDrag(event) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY, origin: position};
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event) {
    const start = drag.current;
    if (start?.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!suppressClick.current && Math.hypot(dx, dy) < 5) return;
    suppressClick.current = true;
    setDragging(true);
    setPosition(keepOnScreen({x: start.origin.x + dx, y: start.origin.y + dy}));
  }

  function endDrag(event) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  const roomAbove = position.y - GAP - EDGE;
  const roomBelow = window.innerHeight - position.y - ORB - GAP - EDGE;
  const above = roomAbove >= roomBelow;
  const width = Math.min(380, window.innerWidth - EDGE * 2);
  const panelStyle = {
    width, maxHeight: Math.max(roomAbove, roomBelow),
    left: clamp(position.x + ORB - width, EDGE, window.innerWidth - width - EDGE) - position.x,
    [above ? 'bottom' : 'top']: ORB + GAP,
  };

  return <div className="pj-aura" style={{left: position.x, top: position.y}}
    onKeyDown={event => {
      if (open && event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }}>
    <button ref={button} type="button" className="pj-aura-orb" aria-label="Aura - Trading Assistant"
      aria-expanded={open} aria-controls={open ? panelId : undefined} data-dragging={dragging}
      onPointerDown={startDrag} onPointerMove={move} onPointerUp={endDrag}
      onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onClick={event => {
        if (event.detail === 0 || !suppressClick.current) setOpen(value => !value);
        suppressClick.current = false;
      }}>Aura</button>
    {open && <div id={panelId} className="pj-aura-panel" style={panelStyle}>
      <AuraReview key={JSON.stringify([day, account])} day={day} account={account}
        dirty={dirty} titleId={titleId} onClose={close}/>
    </div>}
  </div>;
}
