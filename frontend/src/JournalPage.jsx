import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowUpRight, BarChart3, BookOpen, CalendarDays, Check, Circle, ChevronLeft, ChevronRight,
  Download, ListChecks, Maximize2, Mic, MicOff, NotebookPen, Save, Search, Trash2, Undo2, X, Link2,
} from 'lucide-react';
import {api, setCsrf} from './api';
import {WorkspaceEntrance} from './PrimusSignIn';
import {PrimusHeader, localSitePreview} from './SiteExperience';
import {PrimusSunbeams} from './components/PrimusAtmosphere';
import JournalFocusSheet from './components/JournalFocusSheet';
import {Modal, Select} from './components';
import {JournalClock} from './JournalClock';
import TradeForm from './TradeForm';
import ReleaseNotes from './ReleaseNotes';
import useTradeDismissal from './useTradeDismissal';
import {money} from './format';
import FloatingAura from './FloatingAura';
import JournalTradeCards, {JournalScreenshots} from './JournalTradeCards';
import './journal-workspace.css';
import JournalReplayImports from './JournalReplay';
import JournalReset from './JournalReset';
import JournalRules from './JournalRules';
import JournalAccounts from './JournalAccounts';
import {
  AccountSelector, JournalEquity, filterAccountsByScope, parseAccountFilter,
  recordedTotal, scopedAccountResults, tradeAccountIds, tradeMatchesFilter,
} from './JournalReview';

const ymd = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dayDate = day => new Date(day + 'T12:00:00');
const niceDay = day => dayDate(day).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
const blank = day => ({day, plan: '', notes: '', lesson: '', mindset: 'Not set', plan_followed: null, traded_today: null, images: [], trades: []});
const normalize = row => ({...blank(row.day), ...row, trades: row.trades || []});
const narrative = trade => Object.fromEntries(['id', 'symbol', 'direction', 'strategy', 'time', 'source', 'notes', 'outcome', 'confirmations', 'level', 'timeframe', 'entry_timeframe', 'planned_rr', 'risk_amount', 'net_pnl', 'setup_grade', 'account_id', 'account_ids', 'replay_id'].map(key => [key, trade[key]]));
const visionFields = {asset: 'symbol', direction: 'direction', entry_timeframe: 'entry_timeframe', key_level: 'level', level_timeframe: 'timeframe'};
const currencyFmt = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
const sections = [
  {id: 'plan', label: 'Before the session', title: 'What’s the plan?', placeholder: 'My plan for this session…'},
  {id: 'notes', label: 'During the session', title: 'What happened?', placeholder: 'What I saw and how I responded…'},
  {id: 'lesson', label: 'After the session', title: 'How did the session go?', placeholder: 'Looking back at today’s session…'},
];

function JournalPrep({day}) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let controller;
    const load = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      api(`/mindset/checklist/${day}`, {signal: request.signal})
        .then((value) => { if (!request.signal.aborted) setResult(value); })
        .catch(() => { if (!request.signal.aborted) setResult({day, failed: true}); });
    };
    const refresh = () => { if (!document.hidden) load(); };
    load();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller?.abort();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [day]);
  if (result?.day !== day) return null;
  const items = result.items ?? [];
  const checked = items.filter((item) => item.checked).length;
  const complete = items.length > 0 && checked === items.length;
  const status = result.failed ? 'Checklist unavailable' : 'No checklist saved';
  const heading = <>
    <strong>Pre-session checklist</strong>
    {result.warmup_completed && <span className="pj-prep-complete"><Check size={14} aria-hidden="true"/> Warm-up complete</span>}
  </>;
  return <aside className="pj-prep-summary" aria-label="Pre-session checklist">
    <ListChecks size={19} aria-hidden="true"/>
    <div>
      {items.length ? <details>
        <summary className="pj-prep-heading">
          <ChevronRight size={15} aria-hidden="true"/> {heading}
          {(!complete || !result.warmup_completed) &&
            <span className="pj-prep-count">{complete ? 'Checklist complete' : `${checked}/${items.length} checked`}</span>}
        </summary>
        <ul>{items.map((item) => <li key={item.id} data-checked={item.checked}>
          {item.checked ? <Check size={15} aria-hidden="true"/> : <Circle size={15} aria-hidden="true"/>}
          <span>{item.label} · {item.checked ? 'Done' : 'Open'}</span>
        </li>)}</ul>
      </details> : <><div className="pj-prep-heading">{heading}</div><p>{status}</p></>}
    </div>
    <a href="/mindset#warm-up-title">Open Mindset <ArrowUpRight size={14} aria-hidden="true"/></a>
  </aside>;
}

function VoiceDictationButton({cloudEnabled, disabled, onTranscript, onError}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const speechRef = useRef(null);

  const SpeechCtor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const canRecordCloud = cloudEnabled && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
  const supported = canRecordCloud || Boolean(SpeechCtor);

  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch {}
    try { speechRef.current?.stop(); } catch {}
  }, []);

  if (!supported) return null;

  async function toggle() {
    if (transcribing) return;
    if (recording) {
      setRecording(false);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (speechRef.current) {
        try { speechRef.current.stop(); } catch {}
        speechRef.current = null;
      }
      return;
    }

    if (canRecordCloud) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({audio: true});
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunksRef.current, {type: recorder.mimeType || 'audio/webm'});
          chunksRef.current = [];
          if (!blob.size) return;
          setTranscribing(true);
          try {
            const form = new FormData();
            form.append('file', blob, 'voice-note.webm');
            const res = await api('/journal/transcribe', {method: 'POST', body: form});
            if (res?.text) onTranscript(res.text);
          } catch (err) {
            onError?.(err.message);
          } finally {
            setTranscribing(false);
          }
        };
        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
      } catch {
        onError?.('Microphone permission was denied.');
      }
      return;
    }

    if (SpeechCtor) {
      try {
        const recognition = new SpeechCtor();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.continuous = true;
        recognition.onresult = event => {
          const added = Array.from(event.results)
            .slice(event.resultIndex)
            .filter(r => r.isFinal)
            .map(r => r[0]?.transcript?.trim())
            .filter(Boolean)
            .join(' ');
          if (added) onTranscript(added);
        };
        recognition.onerror = () => setRecording(false);
        recognition.onend = () => setRecording(false);
        speechRef.current = recognition;
        recognition.start();
        setRecording(true);
      } catch {
        onError?.('Voice dictation could not start in this browser.');
      }
    }
  }

  return <button
    type="button"
    className={`pj-voice-btn ${recording ? 'is-recording' : ''}`}
    disabled={disabled || transcribing}
    aria-pressed={recording}
    onClick={toggle}
    title={canRecordCloud ? 'Dictate with Cloudflare Whisper' : 'Dictate with browser speech-to-text'}
  >
    {recording ? <MicOff size={14}/> : <Mic size={14}/>}
    <span>{transcribing ? 'Transcribing…' : recording ? 'Stop dictating' : 'Dictate'}</span>
  </button>;
}

export default function JournalPage({theme = 'light'}) {
  const today = ymd(new Date());
  const requested = new URLSearchParams(location.search).get('day');
  const initialDay = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(dayDate(requested).getTime()) && ymd(dayDate(requested)) === requested ? requested : today;
  const [identity, setIdentity] = useState(null), [meta, setMeta] = useState(null), [rows, setRows] = useState([]), [day, setDay] = useState(initialDay);
  const [entry, setEntry] = useState(blank(initialDay)), [section, setSection] = useState('plan'), [month, setMonth] = useState(initialDay.slice(0, 7));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState(null), [selection, setSelection] = useState(null);
  const [presets, setPresets] = useState([]);
  const [searchQuery, setSearchQuery] = useState(''), [entryFilter, setEntryFilter] = useState('all');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try { return localStorage.getItem('primus_journal_autosave') !== 'false'; } catch { return true; }
  });
  const [freshTradeId, setFreshTradeId] = useState(null);
  const [expanded, setExpanded] = useState(new URLSearchParams(location.search).get('card')), [viewing, setViewing] = useState(null), [labDraft, setLabDraft] = useState(null);
  const [linking, setLinking] = useState(null), [labTrades, setLabTrades] = useState([]), [selectedLink, setSelectedLink] = useState('');
  const [deleting, setDeleting] = useState(false), [trash, setTrash] = useState(null), [undoId, setUndoId] = useState(null);
  const [resettingJournal, setResettingJournal] = useState(false);
  const [journalRevision, setJournalRevision] = useState(0);
  const [focusSheet, setFocusSheet] = useState(null);
  const [journalView, setJournalView] = useState(() =>
    new URLSearchParams(location.search).get('view') === 'performance' ? 'performance' : 'log'
  );

  function switchJournalView(nextView) {
    setJournalView(nextView);
    try {
      const url = new URL(location.href);
      if (nextView === 'performance') url.searchParams.set('view', 'performance');
      else url.searchParams.delete('view');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  const parsedFilter = parseAccountFilter(selection);
  const account = parsedFilter.accountId != null
    ? (accounts?.some(item => item.id === parsedFilter.accountId) ? parsedFilter.accountId : null)
    : (typeof selection === 'string' && selection.startsWith('scope:') ? selection : null);
  const selectedAccountId = typeof account === 'number' ? account : null;

  const labDismissal = useTradeDismissal(() => setLabDraft(null));
  const viewer = useRef();
  const entryHeading = useRef(null);
  const focusTrigger = useRef(null);
  const visionEdits = useRef(new Map());
  const autoSaveTimer = useRef(null);

  async function boot() {
    try {
      const session = await api('/session');
      setCsrf(session.csrf);
      setIdentity(session);
      if (session.authenticated) {
        const [list, metadata] = await Promise.all([api('/journal'), api('/metadata')]);
        const normalized = list.map(normalize);
        setRows(normalized);
        setMeta(metadata);
        setEntry(normalized.find(row => row.day === day) || blank(day));
        api('/journal-accounts/presets')
          .then(res => setPresets(Array.isArray(res?.presets) ? res.presets : []))
          .catch(() => {});
      }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    document.title = 'Your Journal — PrimusTrader';
    boot();
    const loggedOut = () => {
      setRows([]); setAccounts(null); setSelection(null); setPresets([]);
      setEntry(blank(day)); setIdentity({authenticated: false, auth_mode: 'google'}); setDirty(false);
    };
    window.addEventListener('primus:logout', loggedOut);
    return () => window.removeEventListener('primus:logout', loggedOut);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const leave = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  useEffect(() => { if (viewing) viewer.current?.showModal(); }, [viewing]);

  useEffect(() => {
    if (!freshTradeId) return;
    const frame = requestAnimationFrame(() => document.querySelector('.pj-trade-card.is-new')?.scrollIntoView({block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}));
    return () => cancelAnimationFrame(frame);
  }, [freshTradeId]);

  function toggleAutoSave(checked) {
    setAutoSaveEnabled(checked);
    try { localStorage.setItem('primus_journal_autosave', checked ? 'true' : 'false'); } catch {}
  }

  const current = sections.find(item => item.id === section);
  const timezone = meta?.journal_preferences?.timezone || 'America/New_York';

  function upsert(value) {
    const row = normalize(value);
    setRows(old => [...old.filter(item => item.day !== row.day), row].sort((a, b) => b.day.localeCompare(a.day)));
    setEntry(row);
    setDirty(false);
  }

  function showDay(value) {
    const url = new URL(window.location.href);
    url.searchParams.set('day', value);
    window.history.replaceState(window.history.state, '', url);
    setDay(value);
    setMonth(value.slice(0, 7));
  }

  function selectDay(value) {
    if (busy || !value) return false;
    if (value === day) return true;
    if (dirty && !window.confirm('Leave this day without saving your changes?')) return false;
    clearTimeout(autoSaveTimer.current);
    showDay(value);
    setEntry(rows.find(row => row.day === value) || blank(value));
    setDirty(false); setNotice(''); setError(''); setExpanded(null);
    return true;
  }

  function editSavedEntry(value) {
    if (!selectDay(value)) return;
    requestAnimationFrame(() => entryHeading.current?.focus());
  }

  const buildBody = (target = entry) => ({
    plan: target.plan,
    notes: target.notes,
    lesson: target.lesson,
    mindset: target.mindset,
    plan_followed: target.plan_followed,
    no_trade_plan: target.traded_today === 'No' && Boolean(target.no_trade_plan),
    traded_today: target.traded_today,
    trades: target.trades.map(trade => ({
      ...narrative(trade),
      custom_fields: Object.fromEntries((meta?.custom_trade_fields || [])
        .filter(({id}) => Object.hasOwn(trade.custom_fields || {}, id))
        .map(({id}) => [id, trade.custom_fields[id]])),
    })),
  });

  async function persist(target = entry) {
    clearTimeout(autoSaveTimer.current);
    const saved = await api(`/journal/${target.day}`, {method: 'PUT', body: buildBody(target)});
    upsert(saved);
    return saved;
  }

  async function save() {
    if (busy || autoSaving) return;
    clearTimeout(autoSaveTimer.current);
    setBusy(true); setError('');
    try {
      await persist();
      setNotice(localSitePreview() ? 'Entry saved for this local preview.' : 'Entry saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Quiet 4-second idle autosave so rapid clicks and E2E flows never race.
  useEffect(() => {
    clearTimeout(autoSaveTimer.current);
    if (!autoSaveEnabled || !dirty || busy || !identity?.authenticated || !meta) return;
    const hasContent = Boolean(
      entry.updated_at || entry.plan.trim() || entry.notes.trim() || entry.lesson.trim() ||
      entry.trades.length || entry.plan_followed || entry.traded_today || entry.mindset !== 'Not set'
    );
    if (!hasContent) return;
    const snapshot = entry;
    let currentSnapshot = true;
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaving(true);
      try {
        const saved = await api(`/journal/${snapshot.day}`, {method: 'PUT', body: buildBody(snapshot)});
        setRows(old => [...old.filter(item => item.day !== saved.day), normalize(saved)].sort((a, b) => b.day.localeCompare(a.day)));
        setEntry(curr => curr === snapshot ? normalize(saved) : curr);
        if (currentSnapshot) setDirty(false);
      } catch {
        // Keep dirty state intact so user can manually retry Save.
      } finally {
        setAutoSaving(false);
      }
    }, 4000);
    return () => {
      currentSnapshot = false;
      clearTimeout(autoSaveTimer.current);
    };
  }, [entry, dirty, busy, autoSaveEnabled, identity?.authenticated, meta]);

  async function upload(file, tradeId = '') {
    if (!file || busy) return;
    if (file.size > 8 * 1024 * 1024) { setError('Choose a screenshot smaller than 8 MB.'); return; }
    setBusy(true); setError('');
    try {
      await persist();
      const form = new FormData();
      form.append('file', file);
      upsert(await api(`/journal/${day}/images${tradeId ? `?trade_id=${tradeId}` : ''}`, {method: 'POST', body: form}));
      setNotice('Screenshot added. Your entry is saved too.');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(id) {
    if (!window.confirm('Remove this screenshot from this entry?')) return;
    setBusy(true); setError('');
    try {
      const updated = await api(`/journal/${day}/images/${id}`, {method: 'DELETE'});
      setEntry(old => ({...old, images: updated.images}));
      setRows(old => old.map(row => row.day === day ? {...row, images: updated.images} : row));
      setNotice('Screenshot removed.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function edit(field, value) { setEntry(old => ({...old, [field]: value})); setDirty(true); setNotice(''); }

  function addTrade() {
    setSelection(null);
    const trade = {id: crypto.randomUUID().replaceAll('-', ''), symbol: '', direction: '', strategy: '', time: '', source: 'manual', notes: '', outcome: 'not_recorded', confirmations: [], lab_trade_id: null};
    edit('trades', [...entry.trades, trade]);
    setExpanded(trade.id);
    setFreshTradeId(trade.id);
  }

  function duplicateTrade(sourceTrade) {
    if (entry.trades.length >= 30) return;
    const copy = {
      ...narrative(sourceTrade),
      id: crypto.randomUUID().replaceAll('-', ''),
      time: '',
      net_pnl: null,
      outcome: 'not_recorded',
      notes: '',
      replay_id: null,
      lab_trade_id: null,
      custom_fields: sourceTrade.custom_fields ? {...sourceTrade.custom_fields} : {},
    };
    edit('trades', [...entry.trades, copy]);
    setExpanded(copy.id);
    setFreshTradeId(copy.id);
  }

  function editTrade(id, field, value) {
    const edits = visionEdits.current.get(id) || {fields: new Set(), confirmations: new Map()};
    if (field === 'confirmations') {
      const previous = entry.trades.find(trade => trade.id === id)?.confirmations || [];
      const selected = new Set(value.map(tag => tag.toLowerCase()));
      for (const tag of previous) if (!selected.has(tag.toLowerCase())) edits.confirmations.set(tag.toLowerCase(), false);
      for (const tag of selected) edits.confirmations.set(tag, true);
    } else if (Object.values(visionFields).includes(field) || field === 'outcome' || field === 'planned_rr') {
      edits.fields.add(field);
    }
    visionEdits.current.set(id, edits);
    setEntry(old => ({...old, trades: old.trades.map(trade => trade.id === id ? {
      ...trade, [field]: value, ...(field === 'account_ids' ? {account_id: value.length === 1 ? value[0] : null} :
        field === 'account_id' ? {account_ids: value == null ? [] : [value]} : {}),
    } : trade)}));
    setDirty(true); setNotice('');
  }

  function applyVision(tradeId, findings, explicit = false) {
    const edits = visionEdits.current.get(tradeId);
    const allowed = findings.filter(({kind, value}) => kind === 'confirmation'
      ? explicit || edits?.confirmations.get(value.toLowerCase()) !== false
      : Object.hasOwn(visionFields, kind) && !edits?.fields.has(visionFields[kind]));
    if (!allowed.length) return;
    if (explicit && edits) {
      for (const {kind, value} of allowed) if (kind === 'confirmation') edits.confirmations.set(value.toLowerCase(), true);
    }
    setEntry(old => ({...old, trades: old.trades.map(trade => {
      if (trade.id !== tradeId || trade.lab_trade_id) return trade;
      const next = {...trade};
      let confirmations = next.confirmations || [];
      const primary = allowed.find(({kind}) => kind === 'key_level');
      for (const {kind, value} of allowed) {
        if (kind === 'confirmation') {
          if (confirmations.length < 30 && !confirmations.some(tag => tag.toLowerCase() === value.toLowerCase())) confirmations = [...confirmations, value];
        } else {
          const field = visionFields[kind];
          if (kind === 'level_timeframe' && (!primary || Boolean(trade.level && trade.level !== 'Not recorded' && trade.level !== primary.value))) continue;
          if (!next[field] || next[field] === 'Not recorded') next[field] = value;
        }
      }
      return {...next, confirmations};
    })}));
    setDirty(true); setNotice('');
  }

  function applyProjection(tradeId, value, automatic = false) {
    const edited = visionEdits.current.get(tradeId)?.fields;
    setEntry(old => ({...old, trades: old.trades.map(trade => {
      if (trade.id !== tradeId || trade.lab_trade_id || (trade.direction && trade.direction !== value.direction)) return trade;
      const addOutcome = value.outcome && trade.net_pnl == null &&
        (!automatic || (!edited?.has('outcome') && (!trade.outcome || trade.outcome === 'not_recorded')));
      const addRatio = !automatic || (!edited?.has('planned_rr') && trade.planned_rr == null);
      const addDirection = !trade.direction && !edited?.has('direction');
      if (!addOutcome && !addRatio && !addDirection) return trade;
      return {...trade, ...(addDirection ? {direction: value.direction} : {}),
        ...(addRatio ? {planned_rr: value.plannedRR} : {}), ...(addOutcome ? {outcome: value.outcome} : {})};
    })}));
    setDirty(true); setNotice('');
  }

  function removeTrade(id) {
    if (!window.confirm('Remove this card from the Journal? Its Lab trade stays saved. Screenshots will remain with the day.')) return;
    visionEdits.current.delete(id);
    edit('trades', entry.trades.filter(trade => trade.id !== id));
    edit('images', entry.images.map(image => image.trade_id === id ? {...image, trade_id: null} : image));
    setExpanded(null);
  }

  async function savePreset(name, accountIds) {
    const next = [...presets, {id: crypto.randomUUID().replaceAll('-', ''), name, account_ids: accountIds}].slice(-12);
    try {
      const res = await api('/journal-accounts/presets', {method: 'PUT', body: {presets: next}});
      setPresets(res?.presets || next);
      setNotice(`Preset "${name}" saved.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deletePreset(id) {
    const next = presets.filter(item => item.id !== id);
    try {
      const res = await api('/journal-accounts/presets', {method: 'PUT', body: {presets: next}});
      setPresets(res?.presets || next);
    } catch (err) {
      setError(err.message);
    }
  }

  async function prepareLab(trade) { setBusy(true); setError(''); try { await persist(); setLabDraft(trade); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function prepareLink(trade) { setBusy(true); setError(''); try { await persist(); const list = await api('/trades'); setLabTrades(list); setSelectedLink(trade.lab_trade_id ? String(trade.lab_trade_id) : ''); setLinking(trade); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function linkTrade() { setBusy(true); setError(''); try { upsert(await api(`/journal/${day}/trades/${linking.id}/link`, {method: 'PUT', body: {trade_id: selectedLink ? Number(selectedLink) : null}})); setLinking(null); setNotice(selectedLink ? 'Trade linked. No duplicate was added to the Lab.' : 'Lab link removed. The original Lab trade stays saved.'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function deleteDay() { setBusy(true); setError(''); try { if (dirty) await persist(); const result = await api(`/journal/${day}`, {method: 'DELETE'}); setUndoId(result.archive_id); setRows(old => old.filter(row => row.day !== day)); setEntry(blank(day)); setDirty(false); setExpanded(null); setDeleting(false); setNotice('Entry moved to deleted entries. Your Lab trades are unchanged.'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function openTrash() { setError(''); try { setTrash(await api('/journal/trash')); } catch (e) { setError(e.message); } }

  function journalReset() {
    setRows([]);
    setEntry(blank(day));
    setExpanded(null);
    setAccounts(null);
    setSelection(null);
    setPresets([]);
    setResettingJournal(false);
    setUndoId(null);
    setNotice('Journal reset complete.');
    setJournalRevision(value => value + 1);
    boot();
  }
  async function restoreDay(id) { setBusy(true); setError(''); try { const restored = await api(`/journal/trash/${id}/restore`, {method: 'POST'}); upsert(restored); showDay(restored.day); setTrash(null); setUndoId(null); setNotice('Journal entry restored.'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  function shiftMonth(amount) { const date = new Date(month + '-15T12:00:00'); date.setMonth(date.getMonth() + amount); setMonth(ymd(date).slice(0, 7)); }

  const monthDate = new Date(month + '-01T12:00:00'), startOffset = (monthDate.getDay() + 6) % 7, monthDays = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

  function dailyResult(row) {
    if (!row) return null;
    if (account === null && !accounts?.some(a => (a.status || 'active') !== 'active')) {
      return row.day_result;
    }
    const results = scopedAccountResults(row, account, accounts);
    const total = results.length && results.every(trade => trade.net_pnl != null) ? recordedTotal(results) : null;
    return {net_pnl: total, outcome: total === null ? 'not_recorded' : total > 0 ? 'win' : total < 0 ? 'loss' : 'breakeven'};
  }

  // Live day P&L calculated directly from entry.trades while editing so numbers update instantly.
  const liveEntryRow = useMemo(() => {
    if (!dirty) return entry;
    const trade_results = entry.trades.map(t => ({
      account_id: t.account_id ?? null,
      ...(tradeAccountIds(t).length > 1 ? {account_ids: tradeAccountIds(t)} : {}),
      net_pnl: t.net_pnl ?? null,
    }));
    const allRecorded = trade_results.length > 0 && trade_results.every(r => r.net_pnl != null);
    const sum = allRecorded ? recordedTotal(trade_results) : null;
    return {
      ...entry,
      trade_results,
      day_result: {net_pnl: sum, outcome: sum === null ? 'not_recorded' : sum > 0 ? 'win' : sum < 0 ? 'loss' : 'breakeven'},
    };
  }, [entry, dirty]);

  const dayResult = dailyResult(liveEntryRow);
  const hasDayTrades = entry.trades.some(trade => tradeMatchesFilter(trade, account, accounts));
  const monthRows = rows.filter(row => row.day.startsWith(month));
  const knownDays = new Set(rows.map(row => row.day));

  // Active Cockpit KPI strip stats
  const cockpitStats = useMemo(() => {
    const activeAccts = filterAccountsByScope(accounts, 'active');
    const blownAccts = (accounts || []).filter(a => a.status === 'blown');
    const activeStart = activeAccts.reduce((s, a) => s + Number(a.starting_balance || 0), 0);
    const activeAllPnl = rows.reduce((s, row) => {
      const val = recordedTotal(scopedAccountResults(row, null, accounts));
      return val != null ? s + val : s;
    }, 0);
    const monthPnl = monthRows.reduce((s, row) => {
      const val = recordedTotal(scopedAccountResults(row, account, accounts));
      return val != null ? s + val : s;
    }, 0);
    const hasMonthPnl = monthRows.some(row => recordedTotal(scopedAccountResults(row, account, accounts)) != null);
    const taggedPlan = rows.filter(r => r.plan_followed);
    const planYes = taggedPlan.filter(r => r.plan_followed === 'Yes').length;
    const planPct = taggedPlan.length ? Math.round((planYes / taggedPlan.length) * 100) : null;
    return {
      activeCount: activeAccts.length,
      blownCount: blownAccts.length,
      activeBalance: Math.round((activeStart + activeAllPnl) * 100) / 100,
      monthPnl: Math.round(monthPnl * 100) / 100,
      hasMonthPnl,
      planPct,
      taggedPlanCount: taggedPlan.length,
    };
  }, [accounts, rows, monthRows, account]);

  // Sidebar search & filter across all saved entries when active
  const isFilteringEntries = Boolean(searchQuery.trim()) || entryFilter !== 'all';
  const displayedEntries = useMemo(() => {
    const pool = isFilteringEntries ? rows : monthRows;
    const q = searchQuery.trim().toLowerCase();
    return pool.filter(row => {
      const res = dailyResult(row);
      if (entryFilter === 'win' && res?.outcome !== 'win') return false;
      if (entryFilter === 'loss' && res?.outcome !== 'loss') return false;
      if (entryFilter === 'plan_no' && row.plan_followed !== 'No' && row.plan_followed !== 'Partly') return false;
      if (entryFilter === 'trades' && !(row.trades && row.trades.length)) return false;
      if (!q) return true;
      const hay = [
        row.day, row.plan, row.notes, row.lesson, row.mindset,
        ...(row.trades || []).flatMap(t => [t.symbol, t.strategy, t.notes, t.level]),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, monthRows, isFilteringEntries, searchQuery, entryFilter, account, accounts]);

  const dayLabTrades = labTrades.filter(trade => trade.entry_time && new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(trade.entry_time)) === day);
  const linkChoices = [...dayLabTrades, ...labTrades.filter(trade => !dayLabTrades.some(other => other.id === trade.id))];

  function triggerPrimaxDebrief(question) {
    window.dispatchEvent(new CustomEvent('primus:ask-primax', {detail: {question}}));
  }

  function appendTranscript(text) {
    if (!text) return;
    setEntry(old => {
      const prev = old[section] || '';
      const sep = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
      return {...old, [section]: (prev + sep + text).slice(0, section === 'notes' ? 20000 : 12000)};
    });
    setDirty(true);
    setNotice('Voice note added.');
  }

  if (!identity || (identity.authenticated && !meta)) return <div className="pt-journal"><PrimusHeader active="journal"/><main className="pt-journal-loading">{error ? <><p role="alert">{error}</p><button className="pt-btn" onClick={boot}>Try again</button></> : 'Opening your private Journal…'}</main></div>;
  const entrancePreview = localSitePreview() && new URLSearchParams(location.search).get('preview') === 'signin';
  if (!identity.authenticated || entrancePreview) return <WorkspaceEntrance workspace="journal" session={entrancePreview ? {...identity, auth_mode: 'google'} : identity} ready={!entrancePreview && Boolean(identity.csrf)} onUnlocked={boot}/>;

  return <div className="pt-journal pj-workspace">
    <FloatingAura day={day} account={selectedAccountId} dirty={dirty}/>
    {meta.release_notes && !meta.release_notes.seen && <ReleaseNotes notes={meta.release_notes} onClose={() => setMeta(m => ({...m, release_notes: {...m.release_notes, seen: true}}))} onSeen={async () => {await api('/release-notes/seen', {method: 'POST'}); setMeta(m => ({...m, release_notes: {...m.release_notes, seen: true}}));}}/>}
    <PrimusHeader active="journal"/>
    <div className="pj-atmosphere-wash" aria-hidden="true"><PrimusSunbeams/></div>
    <main className="pt-wrap pt-journal-main">
      <div className="pt-journal-heading">
        <div>
          <h1>Pause. Put it <em>on paper.</em></h1>
          <p>Your session, your trades and the story behind them. All in one place.</p>
        </div>
        <div className="pj-heading-actions">
          <div className="pj-view-switch" role="tablist" aria-label="Journal views">
            <button
              type="button"
              role="tab"
              id="journal-tab-log"
              aria-controls="journal-panel-log"
              aria-selected={journalView === 'log'}
              onClick={() => switchJournalView('log')}
            >
              <NotebookPen size={14} aria-hidden="true"/> Daily Log
            </button>
            <button
              type="button"
              role="tab"
              id="journal-tab-performance"
              aria-controls="journal-panel-performance"
              aria-selected={journalView === 'performance'}
              onClick={() => switchJournalView('performance')}
            >
              <BarChart3 size={14} aria-hidden="true"/> Performance
            </button>
          </div>
        </div>
      </div>

      <JournalAccounts key={journalRevision} accounts={accounts} setAccounts={setAccounts}/>

      {journalView === 'log' && (
      <div className="pt-journal-layout" role="tabpanel" id="journal-panel-log" aria-labelledby="journal-tab-log">
        <aside className="pt-journal-sidebar" aria-label="Journal calendar and history">
          <div className="pj-sidebar-actions">
            <button type="button" className="pj-sidebar-action" aria-current={day === today ? 'date' : undefined}
              onClick={() => selectDay(today)} disabled={busy}>
              <NotebookPen size={17} aria-hidden="true"/> Today’s entry
            </button>
            <JournalRules preferences={meta.journal_preferences} onSaved={value => setMeta(old => ({...old, journal_preferences: value}))}/>
          </div>
          <label className="pt-mobile-date">Go to date<input type="date" aria-label="Journal date" value={day} disabled={busy} onChange={e => selectDay(e.target.value)}/></label>
          <AccountSelector accounts={accounts} value={account} onChange={setSelection} label="Calendar account" disabled={!accounts}/>
          <div className="pt-calendar">
            <div className="pt-calendar-heading">
              <button aria-label="Previous month" disabled={busy} onClick={() => shiftMonth(-1)}><ChevronLeft size={18}/></button>
              <label className="pj-month"><span>{monthDate.toLocaleDateString('en-GB', {month: 'long', year: 'numeric'})}</span><input type="month" aria-label="Browse month" value={month} disabled={busy} onChange={e => {if (e.target.value) setMonth(e.target.value);}}/></label>
              <button aria-label="Next month" disabled={busy} onClick={() => shiftMonth(1)}><ChevronRight size={18}/></button>
            </div>
            <div className="pt-calendar-grid">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((value, index) => <span key={'head' + index}>{value}</span>)}
              {Array.from({length: startOffset}, (_, index) => <span key={'blank' + index}/>)}
              {Array.from({length: monthDays}, (_, index) => {
                const value = `${month}-${String(index + 1).padStart(2, '0')}`;
                const saved = knownDays.has(value);
                const row = monthRows.find(r => r.day === value);
                const result = dailyResult(row);
                const followed = row?.plan_followed;
                const traded = row?.traded_today;
                const colour = result?.outcome;
                const label = colour && colour !== 'not_recorded' ? `${colour === 'win' ? 'Profit' : colour === 'loss' ? 'Loss' : 'Break-even'}: ${money(result.net_pnl)}` : saved ? 'Saved entry · P&L incomplete or no trades' : 'Start an entry';
                const markers = [followed && `Plan followed: ${followed}`, traded && `Traded: ${traded}`].filter(Boolean).join(' · ');
                return <button key={value} className={`${day === value ? 'selected' : ''} ${saved ? 'has-entry' : ''}`} aria-label={niceDay(value)} title={markers ? `${label} · ${markers}` : label} aria-description={markers || undefined} aria-pressed={day === value} disabled={busy} onClick={() => selectDay(value)}>
                  {index + 1}
                  {['win', 'loss', 'breakeven'].includes(colour) && <i className={`pj-day-dot ${colour}`} role="img" aria-label={label}/>}
                  {traded && <span className="pj-traded-marker" aria-hidden="true">{traded === 'Yes' ? '✓' : '–'}</span>}
                  {followed && <span className="pj-plan-marker" aria-hidden="true">{followed[0]}</span>}
                </button>;
              })}
            </div>
            <p className="pj-calendar-legend"><span><i className="pj-day-dot win"/>Profit</span><span><i className="pj-day-dot loss"/>Loss</span><span><i className="pj-day-dot breakeven"/>Break-even</span></p>
          </div>

          <details className="pj-history" open>
            <summary>{isFilteringEntries ? 'Matching entries' : 'Entries this month'} <span>{displayedEntries.length}</span></summary>
            <div className="pj-search-box">
              <Search size={14} aria-hidden="true"/>
              <input
                type="search"
                aria-label="Search journal entries"
                placeholder="Search notes, symbols, lessons…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {isFilteringEntries && (
                <button type="button" className="pj-search-clear" aria-label="Clear search and filters"
                  onClick={() => {setSearchQuery(''); setEntryFilter('all');}}>
                  <X size={13}/>
                </button>
              )}
            </div>
            <div className="pj-filter-pills" role="group" aria-label="Filter journal entries">
              {[
                ['all', 'All'],
                ['win', 'Wins'],
                ['loss', 'Losses'],
                ['plan_no', 'Off-plan'],
                ['trades', 'Trades'],
              ].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={entryFilter === value}
                  onClick={() => setEntryFilter(value)}>{label}</button>
              ))}
            </div>
            <div className="pt-recent-entries">
              {displayedEntries.map(row => {
                const r = dailyResult(row);
                return <button key={row.day} aria-label={`Edit entry ${niceDay(row.day)}`} aria-pressed={row.day === day} disabled={busy} onClick={() => editSavedEntry(row.day)}>
                  <CalendarDays size={18}/>
                  <span>
                    <strong>
                      {dayDate(row.day).toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'})}
                      {r?.net_pnl != null && <em className={`pj-entry-pnl ${r.outcome}`}>{money(r.net_pnl)}</em>}
                    </strong>
                    <small>{row.trades.length ? `${row.trades.length} trade${row.trades.length === 1 ? '' : 's'} · ` : ''}{row.lesson || row.notes || row.plan || 'Session saved'}</small>
                  </span>
                  <NotebookPen size={14} aria-hidden="true"/>
                </button>;
              })}
              {!displayedEntries.length && <p>{isFilteringEntries ? 'No entries match your search or filter.' : 'No saved entries this month. Pick a day to start, or browse another month.'}</p>}
            </div>
          </details>
          <a className="pt-download-notes" href="/api/journal/export"><Download size={16}/> Download your Journal</a>
          <button className="pj-trash-link" onClick={openTrash} disabled={busy}><Trash2 size={15}/> Deleted entries</button>
          <button className="pj-trash-link" disabled={busy || autoSaving || dirty} onClick={() => setResettingJournal(true)}>
            <Trash2 size={15}/> Master Journal reset
          </button>
        </aside>

        <section className="pt-day-editor" aria-label="Daily journal editor">
          <div className="pt-day-heading" id="journal-entry">
            <div>
              <span className="pt-overline">{day === today ? 'TODAY' : dayDate(day).toLocaleDateString('en-GB', {weekday: 'long'}).toUpperCase()}</span>
              <h2 ref={entryHeading} tabIndex={-1}>{niceDay(day)}</h2>
              <p aria-label="Day profit and loss">
                {dayResult?.net_pnl != null
                  ? `Day P&L: ${money(dayResult.net_pnl)}${dirty ? ' (unsaved)' : ''}`
                  : hasDayTrades
                    ? 'Day P&L incomplete · enter a result for every trade'
                    : account === null
                      ? 'No trades recorded'
                      : 'No trades recorded for this selection'}
                {entry.plan_followed && <span> · Plan followed: {entry.plan_followed}</span>}
              </p>
            </div>
            <div>
              <span className="pt-save-state" role="status">
                {autoSaving ? 'Auto-saving…' : dirty ? 'Unsaved changes' : entry.updated_at ? <><Check size={15}/> Saved</> : 'A fresh page'}
              </span>
              <button className="pt-btn pt-btn-dark" disabled={busy || autoSaving} onClick={save}><Save size={16}/>{busy ? 'Saving…' : 'Save entry'}</button>
              <button className="pj-delete-entry" onClick={() => setDeleting(true)} disabled={busy || (!entry.updated_at && !dirty)} aria-label="Delete journal entry"><Trash2 size={17}/></button>
            </div>
          </div>

          <JournalPrep day={day} key={day}/>

          {(error || notice) && <div className="pj-day-feedback">
            {error && <div className="pt-journal-error" role="alert">{error}</div>}
            {notice && <div className="pt-journal-success" role="status">{notice}{undoId && <button className="pj-undo" onClick={() => restoreDay(undoId)} disabled={busy}><Undo2 size={15}/> Undo</button>}</div>}
          </div>}

          <div className="pt-entry-tabs" role="tablist" aria-label="Session writing sections">
            {sections.map((item, index) => (
              <button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={section === item.id} onClick={() => setSection(item.id)}>
                <span>0{index + 1}</span>{item.label}{entry[item.id]?.trim() && <Check size={14}/>}
              </button>
            ))}
          </div>

          <div className="pt-writing-area" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`}>
            <div className="pj-writing-head">
              <span className="pt-overline">SESSION NOTES</span>
              <div className="pj-writing-expand-group">
                <button
                  type="button"
                  className="pj-focus-trigger"
                  onClick={(e) => { focusTrigger.current = e.currentTarget; setFocusSheet({mode: 'read', scope: 'all'}); }}
                  title="Read all three session sections in full-screen view"
                >
                  <BookOpen size={13} aria-hidden="true"/> Read all
                </button>
                <button
                  type="button"
                  className="pj-focus-trigger"
                  onClick={(e) => { focusTrigger.current = e.currentTarget; setFocusSheet({mode: 'write', scope: section}); }}
                  title="Expand writing view"
                >
                  <Maximize2 size={13} aria-hidden="true"/> Expand
                </button>
              </div>
            </div>
            <h3>{current.title}</h3>
            <textarea aria-label={current.label} value={entry[section]} maxLength={section === 'notes' ? 20000 : 12000} placeholder={current.placeholder} onChange={e => edit(section, e.target.value)} disabled={busy}/>
            <div className="pt-writing-footer">
              <div className="pj-writing-tools">
                <VoiceDictationButton
                  cloudEnabled={Boolean(identity?.voice_journal_enabled)}
                  disabled={busy}
                  onTranscript={appendTranscript}
                  onError={msg => setError(msg)}
                />
                <span>{entry[section].length.toLocaleString()} characters</span>
              </div>
            </div>
          </div>

          <JournalFocusSheet
            open={Boolean(focusSheet)}
            initialMode={focusSheet?.mode || 'read'}
            initialScope={focusSheet?.scope || 'all'}
            dayLabel={niceDay(day)}
            dayOverline={day === today ? 'TODAY' : dayDate(day).toLocaleDateString('en-GB', {weekday: 'long'}).toUpperCase()}
            dayPnlLabel={dayResult?.net_pnl != null ? `Day P&L ${money(dayResult.net_pnl)}` : ''}
            dayPnlOutcome={dayResult?.outcome || ''}
            entry={entry}
            sections={sections}
            activeSection={section}
            onSelectSection={setSection}
            onEdit={edit}
            onSave={save}
            onClose={() => {
              setFocusSheet(null);
              requestAnimationFrame(() => focusTrigger.current?.focus());
            }}
            busy={busy}
            autoSaving={autoSaving}
            dirty={dirty}
            dictationNode={
              <VoiceDictationButton
                cloudEnabled={Boolean(identity?.voice_journal_enabled)}
                disabled={busy}
                onTranscript={appendTranscript}
                onError={msg => setError(msg)}
              />
            }
          />

          <div className="pj-session-checks pj-session-checks-3">
            <div className="pt-mindset pj-plan-field">
              <h3 id="journal-plan-followed">Plan followed?</h3>
              <div role="group" aria-label="Plan followed?">
                {['Yes', 'Partly', 'No'].map(option => <button key={option} type="button" disabled={busy}
                  aria-pressed={entry.plan_followed === option} onClick={() => edit('plan_followed', entry.plan_followed === option ? null : option)}>
                  {option}
                </button>)}
              </div>
            </div>
            <div className="pt-mindset pj-plan-field">
              <h3>Did you trade today?</h3>
              <div role="group" aria-label="Did you trade today?">
                {['Yes', 'No'].map(option => <button key={option} type="button" disabled={busy}
                  aria-pressed={entry.traded_today === option} onClick={() => edit('traded_today', entry.traded_today === option ? null : option)}>
                  {option}
                </button>)}
              </div>
              {entry.traded_today === 'No' && !entry.trades.length && <label className="pj-no-trade-check">
                <input type="checkbox" checked={Boolean(entry.no_trade_plan)} disabled={busy}
                  onChange={event => edit('no_trade_plan', event.target.checked)}/>
                I stayed with my plan by not trading
              </label>}
            </div>
            <div className="pt-mindset pj-plan-field">
              <h3>How did you show up?</h3>
              <div role="group" aria-label="Session mindset">
                {['Focused', 'Patient', 'Distracted', 'Frustrated'].map(value => (
                  <button type="button" disabled={busy} key={value} aria-pressed={entry.mindset === value}
                    onClick={() => edit('mindset', entry.mindset === value ? 'Not set' : value)}>{value}</button>
                ))}
              </div>
            </div>
          </div>

          <JournalReplayImports key={journalRevision} onDelete={references => {
            const deleted = new Set(references);
            const unlink = row => ({...row, trades: row.trades.map(trade => deleted.has(trade.replay_id) ? {...trade, replay_id: null} : trade)});
            setEntry(unlink);
            setRows(currentRows => currentRows.map(unlink));
          }}/>

          <JournalTradeCards
            palette={meta.palette[theme]}
            accountFilter={account}
            accounts={accounts}
            entry={entry}
            meta={meta}
            busy={busy}
            expanded={expanded}
            setExpanded={setExpanded}
            onChange={editTrade}
            onSave={save}
            saving={busy || autoSaving}
            savedTrades={rows.find(row => row.day === entry.day)?.trades || []}
            dirty={dirty}
            onAdd={addTrade}
            onDuplicate={duplicateTrade}
            onRemove={removeTrade}
            onUpload={upload}
            onRemoveImage={removeImage}
            onView={setViewing}
            onAddToLab={prepareLab}
            onLink={prepareLink}
            canUpload={Boolean(identity.images_enabled ?? localSitePreview())}
            freshTradeId={freshTradeId}
            visionCloudEnabled={identity.chart_vision_cloud_enabled}
            onVision={applyVision}
            onProjection={applyProjection}
            presets={presets}
            onSavePreset={savePreset}
            onDeletePreset={deletePreset}
          />

          {(identity.images_enabled ?? localSitePreview()) && (
            <details className="pj-session-images" open={entry.images.some(image => !image.trade_id) || undefined}>
              <summary>Session screenshots <span>Optional · charts for the whole day</span></summary>
              <JournalScreenshots images={entry.images.filter(image => !image.trade_id)} allImages={entry.images} day={day} busy={busy} onUpload={file => upload(file)} onRemove={removeImage} onView={setViewing}/>
            </details>
          )}

          <div className="pt-day-bottom">
            <div className="pj-day-bottom-actions">
              <label className="pj-autosave-toggle">
                <input type="checkbox" checked={autoSaveEnabled} onChange={e => toggleAutoSave(e.target.checked)}/>
                <span>Auto-save</span>
              </label>
              <button className="pt-btn pt-btn-dark" onClick={save} disabled={busy || autoSaving}>{busy ? 'Saving…' : 'Save entry'} <Check size={16}/></button>
            </div>
          </div>
        </section>
      </div>
      )}

      {journalView === 'performance' && (
        <div className="pj-performance-pane" role="tabpanel" id="journal-panel-performance" aria-labelledby="journal-tab-performance">
          {accounts && (
            <section className="pj-kpi-strip" aria-label="Active journal overview">
              <div className="pj-kpi-card">
                <span className="pj-kpi-label">Active balance</span>
                <strong>{currencyFmt.format(cockpitStats.activeBalance)}</strong>
                <small>{cockpitStats.activeCount} active{cockpitStats.blownCount > 0 ? ` · ${cockpitStats.blownCount} blown excluded` : ''}</small>
              </div>
              <div className="pj-kpi-card">
                <span className="pj-kpi-label">{monthDate.toLocaleDateString('en-GB', {month: 'short', year: 'numeric'})} P&amp;L</span>
                <strong className={cockpitStats.hasMonthPnl ? (cockpitStats.monthPnl < 0 ? 'loss' : cockpitStats.monthPnl > 0 ? 'gain' : '') : ''}>
                  {cockpitStats.hasMonthPnl ? money(cockpitStats.monthPnl) : '—'}
                </strong>
                <small>{monthRows.length} saved {monthRows.length === 1 ? 'day' : 'days'} this month</small>
              </div>
              <div className="pj-kpi-card">
                <span className="pj-kpi-label">Plan followed</span>
                <strong>{cockpitStats.planPct !== null ? `${cockpitStats.planPct}%` : '—'}</strong>
                <small>{cockpitStats.taggedPlanCount ? `Across ${cockpitStats.taggedPlanCount} tagged sessions` : 'Tag sessions to track'}</small>
              </div>
              <div className="pj-kpi-card">
                <span className="pj-kpi-label">Journal archive</span>
                <strong>{rows.length} {rows.length === 1 ? 'day' : 'days'}</strong>
                <small>{entry.trades.length} {entry.trades.length === 1 ? 'trade' : 'trades'} on {dayDate(day).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'})}</small>
              </div>
            </section>
          )}
          <JournalEquity rows={rows} accounts={accounts} palette={meta.palette} theme={theme} onAskPrimax={triggerPrimaxDebrief}/>
        </div>
      )}
    </main>

    {resettingJournal && <JournalReset onClose={() => setResettingJournal(false)} onReset={journalReset}/>}
    {deleting && <Modal title="Delete journal entry?" onClose={() => setDeleting(false)} className="pj-link-modal"><p className="pj-modal-hint">Move the entry for {niceDay(day)}, its trade cards and screenshots to Deleted entries? You can restore it later. Linked Strategy Lab trades stay saved.</p>{error && <p role="alert">{error}</p>}<div className="pj-modal-actions"><button className="pt-btn" onClick={() => setDeleting(false)} disabled={busy}>Keep entry</button><button className="pt-btn pj-danger" onClick={deleteDay} disabled={busy}>Delete entry</button></div></Modal>}
    {trash && <Modal title="Deleted entries" onClose={() => setTrash(null)} className="pj-link-modal"><p className="pj-modal-hint">Restore an entry with its notes, cards and screenshots. Your Lab trades are unaffected.</p>{!trash.length && <p>No deleted entries.</p>}{trash.map(item => <div className="pj-trash-row" key={item.id}><span>{niceDay(item.day)}</span><button className="pt-btn" disabled={busy} onClick={() => restoreDay(item.id)}><Undo2 size={15}/> Restore</button></div>)}{error && <p role="alert">{error}</p>}</Modal>}
    {viewing && <dialog ref={viewer} className="pt-image-dialog" onCancel={() => setViewing(null)}><button className="pt-image-close" onClick={() => setViewing(null)} aria-label="Close screenshot"><X/></button><img src={viewing} alt="Expanded trading screenshot"/></dialog>}
    {labDraft && <JournalClock.Provider value={timezone}><Modal title="Add Journal trade to Strategy Lab" onClose={labDismissal.requestClose} className="pj-lab-modal"><p className="pj-modal-hint">Your notes are saved. Record the actual result and original risk below. This adds one linked trade to your Lab.</p><TradeForm onDraftStateChange={labDismissal.onDraftStateChange} meta={meta} previous={{account_id: labDraft.account_id, strategy: labDraft.strategy, symbol: labDraft.symbol, direction: labDraft.direction, source: labDraft.source, notes: labDraft.notes, net_pnl: labDraft.net_pnl, risk_amount: labDraft.risk_amount, custom_fields: labDraft.custom_fields, labels: {level: labDraft.level || 'Not recorded', timeframe: labDraft.timeframe || 'Not recorded', entry_timeframe: labDraft.entry_timeframe || 'Not recorded', condition: 'Not recorded', news: 'Not recorded', confirmations: labDraft.confirmations || []}}} initialEntryTime={`${day}T${labDraft.time || '09:30'}`} journalOrigin={{day, id: labDraft.id}} onPrevious={() => {}} onClose={labDismissal.requestClose} onSaved={async (_, __, result) => {if (result?.journal_entry) upsert(result.journal_entry); setLabDraft(null); setNotice('Trade saved in Strategy Lab and linked to this entry.');}}/></Modal></JournalClock.Provider>}
    {linking && <Modal title="Link an existing Lab trade" onClose={() => setLinking(null)} className="pj-link-modal"><p className="pj-modal-hint">Choose a trade you’ve already added or imported. This creates a link without adding another trade. Times use your Lab timezone.</p><Select label="Lab trade" value={selectedLink} onChange={e => setSelectedLink(e.target.value)} values={[{value: '', label: linking.lab_trade_id ? 'Remove the current link' : 'Choose a trade'}, ...linkChoices.map(trade => ({value: String(trade.id), label: `${trade.symbol} · ${trade.direction === 'long' ? 'Buy' : 'Sell'} · ${new Date(trade.entry_time).toLocaleString('en-GB', {timeZone: timezone, dateStyle: 'short', timeStyle: 'short'})} · ${trade.setup_name || 'Unclassified'}`}))]}/>{error && <p role="alert">{error}</p>}<div className="pj-modal-actions"><button className="pt-btn" onClick={() => setLinking(null)}>Cancel</button><button className="pt-btn pt-btn-dark" disabled={busy || (!selectedLink && !linking.lab_trade_id)} onClick={linkTrade}><Link2 size={16}/> Save link</button></div></Modal>}
  </div>;
}
