import React, {useEffect, useId, useRef, useState} from 'react';
import {ArrowUp, Info, Sparkles, X} from 'lucide-react';
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
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  async function review(submitted) {
    if (request.current || !submitted) return;
    const controller = new AbortController();
    request.current = controller;
    setError('');
    setLoading(true);
    const query = new URLSearchParams({day});
    if (account != null) query.set('account_id', account);
    try {
      const result = await api(`/journal/coach?${query}`, {method: 'POST', body: {question: submitted, history: turns.slice(-3).map(turn => ({question: turn.question.slice(0, 400), answer: turn.answer.slice(0, 650)}))}, cache: 'no-store', signal: controller.signal});
      if (!controller.signal.aborted) {
        const memories = Array.isArray(result.memories) ? result.memories : [];
        setTurns(previous => [...previous.slice(-19), {question: submitted, answer: result.markdown, memories}]);
        setQuestion(current => current.trim() === question.trim() ? '' : current);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (!controller.signal.aborted) {request.current = null; setLoading(false);}
    }
  }

  return <section className="pj-coach card" aria-labelledby={titleId}>
    <header>
      <div className="pj-aura-title">
        <h3 id={titleId}>Primax</h3>
        <div className="pj-aura-info" data-open={showPrivacy} onBlur={() => setShowPrivacy(false)}>
          <button type="button" aria-label="Journal privacy information" aria-describedby={titleId + '-privacy'}
            aria-expanded={showPrivacy} onClick={() => setShowPrivacy(value => !value)}><Info size={15} aria-hidden="true"/></button>
          <p id={titleId + '-privacy'} className="pj-aura-tooltip" role="tooltip">Cloudflare receives this day’s saved notes, relevant past saved entries, trade details and recent messages. Screenshots stay private. Account stats use the selected account, or the first account in All accounts.</p>
        </div>
      </div>
      <button type="button" className="pj-aura-close" onClick={onClose} aria-label="Close Primax" autoFocus><X size={20} aria-hidden="true"/></button>
    </header>
    {dirty && <p>Save your entry to include your latest notes.</p>}
    {turns.length > 0 && <div className="pj-coach-review" role="log" aria-label="Conversation with Primax">
      {turns.map((turn, index) => <article key={index}>
        <p className="pj-aura-question">{turn.question}</p>
        <div className="pj-aura-answer" aria-label="Primax"><CoachMarkdown text={turn.answer}/></div>
        {turn.memories?.length > 0 && (
          <div className="pj-aura-memories" aria-label="Recalled past Journal entries">
            <span>Recalled:</span>
            {turn.memories.map(item => (
              <a
                key={item.day}
                href={`/journal?day=${encodeURIComponent(item.day)}`}
                title={item.preview || item.day}
              >
                {item.day}{item.mindset ? ` · ${item.mindset}` : ''}
              </a>
            ))}
          </div>
        )}
      </article>)}
    </div>}
    {!turns.length && <div className="pj-aura-suggestions" role="group" aria-label="Suggested questions">
      {['Review my entries today', 'Am I breaking my rules?', 'What should I repeat next session?'].map(suggestion =>
        <button key={suggestion} type="button" disabled={loading || Boolean(question.trim())} onClick={() => review(suggestion)}>{suggestion}</button>)}
    </div>}
    <form className="pj-aura-compose" onSubmit={event => {event.preventDefault(); review(question.trim());}}>
      <textarea aria-label="Your question" value={question} maxLength={1000} rows={2}
        placeholder="What could I improve about my entry timing?"
        onChange={event => setQuestion(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            review(question.trim());
          }
        }}/>
      <button type="submit" className="pj-aura-send" aria-label="Send question" disabled={loading || !question.trim()}>
        <ArrowUp size={19} aria-hidden="true"/>
      </button>
    </form>
    {loading && <p role="status">Primax is thinking…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default function FloatingAura({day, account, dirty}) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const titleId = useId();
  const panelId = useId();

  function close() {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  }

  return <div className="pj-aura" data-primax-fab data-open={open} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }}>
    <button ref={button} type="button" className="aura-orb pj-aura-orb" hidden={open} aria-label="Primax - Trading Assistant"
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(value => !value)}>
      <Sparkles size={19} strokeWidth={1.65} aria-hidden="true"/>
      <span>Primax</span>
    </button>
    {open && <div id={panelId} className="pj-aura-panel">
      <AuraReview key={JSON.stringify([day, account])} day={day} account={account}
        dirty={dirty} titleId={titleId} onClose={close}/>
    </div>}
  </div>;
}
