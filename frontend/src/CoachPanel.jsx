import React, {useState} from 'react';
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

export default function CoachPanel({day, account, dirty}) {
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function review() {
    setError('');
    setMarkdown('');
    setLoading(true);
    const query = new URLSearchParams({day});
    if (account != null) query.set('account_id', account);
    try {
      const result = await api(`/journal/coach?${query}`, {cache: 'no-store'});
      setMarkdown(result.markdown);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  return <section className="pj-coach card" aria-labelledby="pj-coach-title">
    <h3 id="pj-coach-title">Aura - Trading Assistant</h3>
    <p>Requesting a review sends this day’s saved session notes and a summary of the selected account’s recent live trades to Google Gemini. If you’re viewing all accounts, Aura uses the first account.</p>
    {dirty && <p>Save your entry to include your latest notes.</p>}
    <button type="button" className="pt-btn pt-btn-dark" onClick={review} disabled={loading}>
      {loading ? 'Preparing review…' : 'Ask Aura'}
    </button>
    {loading && <p role="status">Aura is reviewing your session.</p>}
    {error && <p role="alert">{error}</p>}
    {markdown && <div className="pj-coach-review" aria-live="polite"><CoachMarkdown text={markdown}/></div>}
  </section>;
}
