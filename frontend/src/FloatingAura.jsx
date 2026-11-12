import React, {useEffect, useId, useRef, useState} from 'react';
import {Sparkles} from 'lucide-react';
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

export default function FloatingAura({day, account, dirty}) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const titleId = useId();
  const panelId = useId();

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  return <div className="pj-aura" onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }}>
    <button ref={button} type="button" className="pj-aura-orb" aria-label="Aura - Trading Assistant"
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(value => !value)}>
      <Sparkles size={19} strokeWidth={1.65} aria-hidden="true"/>
      <span>Aura</span>
    </button>
    {open && <div id={panelId} className="pj-aura-panel">
      <AuraReview key={JSON.stringify([day, account])} day={day} account={account}
        dirty={dirty} titleId={titleId} onClose={close}/>
    </div>}
  </div>;
}
