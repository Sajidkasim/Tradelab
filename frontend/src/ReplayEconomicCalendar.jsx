import React, {useEffect, useState} from 'react';
import {clockParts} from './replayClock';
import {api} from './api';
import {Button, Modal} from './components';

const monthLabel = new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});
const releaseTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

export function calendarToday() {
  return clockParts(Date.now(), 'America/New_York').day;
}

export default function ReplayEconomicCalendar({day, onClose}) {
  const [month, setMonth] = useState(() => day.slice(0, 7));
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api(`/backtesting/economic-calendar?day=${month}-01`)
      .then(data => { if (active) setResult(data); })
      .catch(() => { if (active) setResult({status: 'unavailable'}); });
    return () => { active = false; };
  }, [month, attempt]);

  function changeMonth(offset) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    setResult(null);
    setMonth(date.toISOString().slice(0, 7));
  }

  return <Modal title="USD economic calendar" className="bt-order-modal" onClose={onClose}>
    <div className="stack">
      <div className="bt-calendar-month">
        <Button aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</Button>
        <strong>{monthLabel.format(new Date(`${month}-01T00:00:00Z`))}</strong>
        <Button aria-label="Next month" onClick={() => changeMonth(1)}>›</Button>
      </div>
      <small>Selected US labor, inflation, GDP and Fed events · New York time</small>
      {!result ? <p role="status">Loading releases…</p> : result.status !== 'available' ?
        <div className="stack"><p role="status">The official schedule is unavailable for this month.</p>
          <Button onClick={() => {setResult(null);setAttempt(value => value + 1);}}>Retry</Button></div> :
        result.events.length ? <ul className="bt-calendar-events">
          {result.events.map(event => <li key={`${event.scheduled_at}:${event.name}`}>
            <strong>{event.name} <small>· {event.source}</small></strong><time dateTime={event.scheduled_at}>{releaseTime.format(new Date(event.scheduled_at))}</time>
          </li>)}
        </ul> : <p>No selected releases with published times this month.</p>}
      {result?.status === 'available' && result.sources.some(source => !source.available) &&
        <small>Coverage is incomplete this month.</small>}
      <div className="bt-close-presets">
        {(result?.sources || [
          {name: 'BLS', url: 'https://www.bls.gov/schedule/news_release/'},
          {name: 'BEA', url: 'https://www.bea.gov/news/schedule'},
          {name: 'Fed', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'},
        ]).map(source => <a key={source.name} href={source.url} target="_blank" rel="noreferrer">
          {source.name} schedule ↗
        </a>)}
      </div>
    </div>
  </Modal>;
}
