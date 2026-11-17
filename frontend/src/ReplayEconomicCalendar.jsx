import React, {useEffect, useState} from 'react';
import {X} from 'lucide-react';
import {api} from './api';

const releaseTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const dateLabel = new Intl.DateTimeFormat('en-GB', {weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});

export default function ReplayEconomicCalendar({day, replayTime, onClose}) {
  const [response, setResponse] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const result = response?.day === day && response.attempt === attempt ? response.data : null;

  useEffect(() => {
    const controller = new AbortController();
    function accept(data) {
      if (!controller.signal.aborted) setResponse({day, attempt, data});
    }
    api(`/backtesting/economic-calendar?day=${day}&scope=day`, {signal: controller.signal})
      .then(accept)
      .catch(() => accept({status: 'unavailable'}));
    return () => controller.abort();
  }, [day, attempt]);

  const missing = result?.sources?.filter(source => !source.available) || [];
  return <aside id="bt-replay-news" className="bt-news-panel" aria-labelledby="bt-news-title"
    onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <header>
      <div><h2 id="bt-news-title">Economic news</h2><small>{dateLabel.format(new Date(day + 'T12:00:00Z'))} · USD</small></div>
      <button type="button" className="bt-icon" aria-label="Close economic news" onClick={onClose}><X size={18}/></button>
    </header>
    <div className="bt-news-body" aria-busy={!result}>
      {!result ? <p role="status">Loading releases…</p> : result.status === 'unavailable' ?
        <div><p role="status">Release coverage is unavailable for this date.</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div> :
        result.events.length ? <ul className="bt-calendar-events">
          {result.events.map(event => {
            const released = Date.parse(event.scheduled_at) <= replayTime;
            return <li key={`${event.scheduled_at}:${event.source}:${event.name}`}>
              <div><time dateTime={event.scheduled_at}>{releaseTime.format(new Date(event.scheduled_at))}</time>
                <small>{released ? 'Released' : 'Upcoming'}</small></div>
              <strong>{event.name}</strong>
              {event.url && released ? <a href={event.url} target="_blank" rel="noreferrer">{event.source} release ↗</a> : <small>{event.source}</small>}
            </li>;
          })}
        </ul> : <p>No releases found for this replay date.</p>}
    </div>
    {missing.length > 0 && <footer>Coverage unavailable from {missing.map(source => source.name).join(', ')}.</footer>}
  </aside>;
}
