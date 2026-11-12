import React, {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,CalendarDays,Check,ListChecks,ChevronLeft,ChevronRight,Download,LockKeyhole,NotebookPen,Save,X,Link2,Trash2,Undo2} from 'lucide-react';
import {api,setCsrf} from './api';
import {WorkspaceEntrance} from './PrimusSignIn';
import {PrimusHeader,localSitePreview} from './SiteExperience';
import {Modal,Select} from './components';
import {JournalClock} from './JournalClock';
import TradeForm from './TradeForm';
import ReleaseNotes from './ReleaseNotes';
import useTradeDismissal from './useTradeDismissal';
import {money} from './format';
import FloatingAura from './FloatingAura';
import JournalTradeCards,{JournalScreenshots} from './JournalTradeCards';
import './journal-workspace.css';
import JournalReplayImports from './JournalReplay';

const ymd=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const dayDate=day=>new Date(day+'T12:00:00');
const niceDay=day=>dayDate(day).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
const blank=day=>({day,plan:'',notes:'',lesson:'',mindset:'Not set',plan_followed:null,traded_today:null,images:[],trades:[]});
const normalize=row=>({...blank(row.day),...row,trades:row.trades||[]});
const narrative=trade=>Object.fromEntries(['id','symbol','direction','strategy','time','source','notes','outcome','confirmations','level','timeframe','entry_timeframe','risk_amount','net_pnl','setup_grade','account_id','account_ids'].map(key=>[key,trade[key]]));
const sections=[
  {id:'plan',label:'Before the session',title:'What’s the plan?',hint:'Your market view, the levels you’re watching and the setups you want to take.',placeholder:'My plan for this session…'},
  {id:'notes',label:'During the session',title:'What happened?',hint:'Record what you noticed and the decisions you made. Add individual trades below.',placeholder:'What I saw and how I responded…'},
  {id:'lesson',label:'After the session',title:'How did the session go?',hint:'What worked, what didn’t, and what you want to change. Keep it in your own words.',placeholder:'Looking back at today’s session…'},
];

import JournalRules from './JournalRules';
import JournalAccounts from "./JournalAccounts";
import {AccountSelector, JournalEquity, accountResults, recordedTotal, tradeAccountIds} from "./JournalReview";

function JournalPrep({day}) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let controller;
    const load = () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      api(`/mindset/checklist/${day}`, {signal:request.signal})
        .then((value) => { if (!request.signal.aborted) setResult(value); })
        .catch(() => { if (!request.signal.aborted) setResult({day, failed:true}); });
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
  const status = result.failed ? 'Checklist unavailable' : complete ? 'Checklist complete'
    : items.length ? `${checked} of ${items.length} complete` : 'No checklist saved';
  return <aside className="pj-prep-summary" aria-label="Pre-session checklist">
    <ListChecks size={19} aria-hidden="true"/>
    <div>
      <strong>Pre-session checklist</strong>
      {items.length ? <details>
        <summary className={complete ? 'is-complete' : undefined}>{status}</summary>
        <ul>{items.map((item) => <li key={item.id}>{item.label} · {item.checked ? 'Done' : 'Open'}</li>)}</ul>
      </details> : <p>{status}</p>}
    </div>
    <a href="/mindset">Open Mindset <ArrowUpRight size={14} aria-hidden="true"/></a>
  </aside>;
}

export default function JournalPage({theme = "light"}){
  const today=ymd(new Date());
  const requested=new URLSearchParams(location.search).get('day');
  const initialDay=requested&&/^\d{4}-\d{2}-\d{2}$/.test(requested)&&!Number.isNaN(dayDate(requested).getTime())&&ymd(dayDate(requested))===requested?requested:today;
  const [identity,setIdentity]=useState(null),[meta,setMeta]=useState(null),[rows,setRows]=useState([]),[day,setDay]=useState(initialDay);
  const [entry,setEntry]=useState(blank(initialDay)),[section,setSection]=useState('plan'),[month,setMonth]=useState(initialDay.slice(0,7));
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [accounts,setAccounts]=useState(null),[selection,setSelection]=useState(null);
  const account=accounts?.some(item=>item.id===selection)?selection:null;
  const [freshTradeId,setFreshTradeId]=useState(null);
  const [expanded,setExpanded]=useState(new URLSearchParams(location.search).get('card')),[viewing,setViewing]=useState(null),[labDraft,setLabDraft]=useState(null);
  const [linking,setLinking]=useState(null),[labTrades,setLabTrades]=useState([]),[selectedLink,setSelectedLink]=useState('');
  const [deleting,setDeleting]=useState(false),[trash,setTrash]=useState(null),[undoId,setUndoId]=useState(null);
  const labDismissal=useTradeDismissal(()=>setLabDraft(null));
  const viewer=useRef();
  async function boot(){
    try{const session=await api('/session');setCsrf(session.csrf);setIdentity(session);
      if(session.authenticated){const [list,metadata]=await Promise.all([api('/journal'),api('/metadata')]);const normalized=list.map(normalize);setRows(normalized);setMeta(metadata);setEntry(normalized.find(row=>row.day===day)||blank(day));}}
    catch(e){setError(e.message)}
  }
  useEffect(()=>{document.title='Your Journal — PrimusTrader';boot();const loggedOut=()=>{setRows([]);setAccounts(null);setSelection(null);setEntry(blank(day));setIdentity({authenticated:false,auth_mode:'google'});setDirty(false)};window.addEventListener('primus:logout',loggedOut);return()=>window.removeEventListener('primus:logout',loggedOut)},[]);
  useEffect(()=>{if(!dirty)return;const leave=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave)},[dirty]);
  useEffect(()=>{if(viewing)viewer.current?.showModal()},[viewing]);
  useEffect(()=>{
    if(!freshTradeId)return;
    const frame=requestAnimationFrame(()=>document.querySelector('.pj-trade-card.is-new')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
    return()=>cancelAnimationFrame(frame);
  },[freshTradeId]);
  const current=sections.find(item=>item.id===section);
  const timezone=meta?.journal_preferences?.timezone||'America/New_York';
  function upsert(value){const row=normalize(value);setRows(old=>[...old.filter(item=>item.day!==row.day),row].sort((a,b)=>b.day.localeCompare(a.day)));setEntry(row);setDirty(false)}
  function selectDay(value){if(busy||!value)return;if(dirty&&!window.confirm('Leave this day without saving your changes?'))return;setDay(value);setEntry(rows.find(row=>row.day===value)||blank(value));setDirty(false);setNotice('');setError('');setMonth(value.slice(0,7));setExpanded(null)}
  const body=()=>({plan:entry.plan,notes:entry.notes,lesson:entry.lesson,mindset:entry.mindset,plan_followed:entry.plan_followed,traded_today:entry.traded_today,trades:entry.trades.map(narrative)});
  async function persist(){const saved=await api(`/journal/${day}`,{method:'PUT',body:body()});upsert(saved);return saved}
  async function save(){setBusy(true);setError('');try{await persist();setNotice(localSitePreview()?'Entry saved for this local preview.':'Entry saved.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function upload(file,tradeId=''){
    if(!file||busy)return;if(file.size>8*1024*1024){setError('Choose a screenshot smaller than 8 MB.');return}
    setBusy(true);setError('');try{await persist();const form=new FormData();form.append('file',file);upsert(await api(`/journal/${day}/images${tradeId?`?trade_id=${tradeId}`:''}`,{method:'POST',body:form}));setNotice('Screenshot added. Your entry is saved too.')}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function removeImage(id){if(!window.confirm('Remove this screenshot from this entry?'))return;setBusy(true);setError('');try{const updated=await api(`/journal/${day}/images/${id}`,{method:'DELETE'});setEntry(old=>({...old,images:updated.images}));setRows(old=>old.map(row=>row.day===day?{...row,images:updated.images}:row));setNotice('Screenshot removed.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  function edit(field,value){setEntry(old=>({...old,[field]:value}));setDirty(true);setNotice('')}
  function addTrade(){setSelection(null);const trade={id:crypto.randomUUID().replaceAll('-',''),symbol:'',direction:'',strategy:'',time:'',source:'manual',notes:'',outcome:'not_recorded',confirmations:[],lab_trade_id:null};edit('trades',[...entry.trades,trade]);setExpanded(trade.id);setFreshTradeId(trade.id)}
  function editTrade(id,field,value){edit('trades',entry.trades.map(trade=>trade.id===id?{...trade,[field]:value,...(field==='account_ids'?{account_id:value.length===1?value[0]:null}:field==='account_id'?{account_ids:value==null?[]:[value]}:{})}:trade))}
  function removeTrade(id){if(!window.confirm('Remove this card from the Journal? Its Lab trade stays saved. Screenshots will remain with the day.'))return;edit('trades',entry.trades.filter(trade=>trade.id!==id));edit('images',entry.images.map(image=>image.trade_id===id?{...image,trade_id:null}:image));setExpanded(null)}
  async function prepareLab(trade){setBusy(true);setError('');try{await persist();setLabDraft(trade)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function prepareLink(trade){setBusy(true);setError('');try{await persist();const list=await api('/trades');setLabTrades(list);setSelectedLink(trade.lab_trade_id?String(trade.lab_trade_id):'');setLinking(trade)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function linkTrade(){setBusy(true);setError('');try{upsert(await api(`/journal/${day}/trades/${linking.id}/link`,{method:'PUT',body:{trade_id:selectedLink?Number(selectedLink):null}}));setLinking(null);setNotice(selectedLink?'Trade linked. No duplicate was added to the Lab.':'Lab link removed. The original Lab trade stays saved.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function deleteDay(){setBusy(true);setError('');try{if(dirty)await persist();const result=await api(`/journal/${day}`,{method:'DELETE'});setUndoId(result.archive_id);setRows(old=>old.filter(row=>row.day!==day));setEntry(blank(day));setDirty(false);setExpanded(null);setDeleting(false);setNotice('Entry moved to deleted entries. Your Lab trades are unchanged.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function openTrash(){setError('');try{setTrash(await api('/journal/trash'))}catch(e){setError(e.message)}}
  async function restoreDay(id){setBusy(true);setError('');try{const restored=await api(`/journal/trash/${id}/restore`,{method:'POST'});upsert(restored);setDay(restored.day);setMonth(restored.day.slice(0,7));setTrash(null);setUndoId(null);setNotice('Journal entry restored.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  function shiftMonth(amount){const date=new Date(month+'-15T12:00:00');date.setMonth(date.getMonth()+amount);setMonth(ymd(date).slice(0,7))}
  const monthDate=new Date(month+'-01T12:00:00'),startOffset=(monthDate.getDay()+6)%7,monthDays=new Date(monthDate.getFullYear(),monthDate.getMonth()+1,0).getDate();
  function dailyResult(row) {
    if (account === null) return row?.day_result;
    const results = accountResults(row, account);
    const total = results.length && results.every(trade => trade.net_pnl != null) ? recordedTotal(results) : null;
    return {net_pnl:total, outcome:total === null ? 'not_recorded' : total > 0 ? 'win' : total < 0 ? 'loss' : 'breakeven'};
  }
  const dayResult=dailyResult(entry);
  const hasDayTrades=entry.trades.some(trade=>account===null||tradeAccountIds(trade).includes(account));
  const monthRows=rows.filter(row=>row.day.startsWith(month));
  const knownDays=new Set(rows.map(row=>row.day));
  const dayLabTrades=labTrades.filter(trade=>trade.entry_time&&new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(trade.entry_time))===day);
  const linkChoices=[...dayLabTrades,...labTrades.filter(trade=>!dayLabTrades.some(other=>other.id===trade.id))];
  if(!identity||(identity.authenticated&&!meta))return <div className="pt-journal"><PrimusHeader active="journal"/><main className="pt-journal-loading">{error?<><p role="alert">{error}</p><button className="pt-btn" onClick={boot}>Try again</button></>:'Opening your private Journal…'}</main></div>;
  const entrancePreview=localSitePreview()&&new URLSearchParams(location.search).get('preview')==='signin';
  if(!identity.authenticated||entrancePreview)return <WorkspaceEntrance workspace="journal" session={entrancePreview?{...identity,auth_mode:'google'}:identity} ready={!entrancePreview&&Boolean(identity.csrf)} onUnlocked={boot}/>;
  return <div className="pt-journal pj-workspace">
    <FloatingAura day={day} account={account} dirty={dirty}/>
    {meta.release_notes&&!meta.release_notes.seen&&<ReleaseNotes notes={meta.release_notes} onClose={()=>setMeta(m=>({...m,release_notes:{...m.release_notes,seen:true}}))} onSeen={async()=>{await api('/release-notes/seen',{method:'POST'});setMeta(m=>({...m,release_notes:{...m.release_notes,seen:true}}))}}/>}
    <PrimusHeader active="journal"/>
    <main className="pt-wrap pt-journal-main">
      <div className="pt-journal-heading"><div><span className="pt-overline">THE DAILY PRACTICE</span><h1>Pause. Put it <em>on paper.</em></h1><p>Your session, your trades and the story behind them. All in one place.</p></div><div className="pt-private-badge"><LockKeyhole size={15}/> Your private workspace</div></div>
      <JournalAccounts accounts={accounts} setAccounts={setAccounts}/>
      <div className="pt-journal-layout">
        <aside className="pt-journal-sidebar" aria-label="Journal calendar and history">
          <button className="pt-btn pt-btn-dark" onClick={()=>selectDay(today)} disabled={busy}><NotebookPen size={17}/> Today’s entry <ArrowUpRight size={16}/></button>
          <label className="pt-mobile-date">Go to date<input type="date" aria-label="Journal date" value={day} disabled={busy} onChange={e=>selectDay(e.target.value)}/></label>
          <JournalRules preferences={meta.journal_preferences} onSaved={value=>setMeta(old=>({...old,journal_preferences:value}))}/>
          <AccountSelector accounts={accounts} value={account} onChange={setSelection} label="Calendar account" disabled={!accounts}/>
          <div className="pt-calendar"><div className="pt-calendar-heading"><button aria-label="Previous month" disabled={busy} onClick={()=>shiftMonth(-1)}><ChevronLeft size={18}/></button><label className="pj-month"><span>{monthDate.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</span><input type="month" aria-label="Browse month" value={month} disabled={busy} onChange={e=>{if(e.target.value)setMonth(e.target.value)}}/></label><button aria-label="Next month" disabled={busy} onClick={()=>shiftMonth(1)}><ChevronRight size={18}/></button></div>
            <div className="pt-calendar-grid">{['M','T','W','T','F','S','S'].map((value,index)=><span key={'head'+index}>{value}</span>)}{Array.from({length:startOffset},(_,index)=><span key={'blank'+index}/>)}{Array.from({length:monthDays},(_,index)=>{const value=`${month}-${String(index+1).padStart(2,'0')}`,saved=knownDays.has(value),row=monthRows.find(row=>row.day===value),result=dailyResult(row),followed=row?.plan_followed,traded=row?.traded_today,colour=result?.outcome,label=colour&&colour!=='not_recorded'?`${colour==='win'?'Profit':colour==='loss'?'Loss':'Break-even'}: ${money(result.net_pnl)}`:saved?'Saved entry · P&L incomplete or no trades':'Start an entry';const markers=[followed&&`Plan followed: ${followed}`,traded&&`Traded: ${traded}`].filter(Boolean).join(' · ');return <button key={value} className={`${day===value?'selected':''} ${saved?'has-entry':''}`} aria-label={niceDay(value)} title={markers?`${label} · ${markers}`:label} aria-description={markers||undefined} aria-pressed={day===value} disabled={busy} onClick={()=>selectDay(value)}>{index+1}{['win','loss','breakeven'].includes(colour)&&<i className={`pj-day-dot ${colour}`} role="img" aria-label={label}/>}
                {traded&&<span className="pj-traded-marker" aria-hidden="true">{traded==='Yes'?'✓':'–'}</span>}{followed&&<span className="pj-plan-marker" aria-hidden="true">{followed[0]}</span>}</button>})}</div><p className="pj-calendar-legend"><span><i className="pj-day-dot win"/>Profit</span><span><i className="pj-day-dot loss"/>Loss</span><span><i className="pj-day-dot breakeven"/>Break-even</span></p><p>Dots use the saved total of the day’s trades. Enter P&amp;L for every trade in the selected account to see a dot. Y / P / N marks whether you followed the plan. ✓ traded · – did not trade.</p>
          </div>
          <details className="pj-history" open><summary>Entries this month <span>{monthRows.length}</span></summary><div className="pt-recent-entries">{monthRows.map(row=><button key={row.day} aria-label={`Open entry ${niceDay(row.day)}`} aria-pressed={row.day===day} disabled={busy} onClick={()=>selectDay(row.day)}><CalendarDays size={18}/><span><strong>{dayDate(row.day).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</strong><small>{row.trades.length?`${row.trades.length} trade${row.trades.length===1?'':'s'} · `:''}{row.lesson||row.notes||row.plan||'Session saved'}</small></span><ArrowUpRight size={14}/></button>)}{!monthRows.length&&<p>No saved entries this month. Pick a day to start, or browse another month.</p>}</div></details>
          <a className="pt-download-notes" href="/api/journal/export"><Download size={16}/> Download your Journal</a>
          <button className="pj-trash-link" onClick={openTrash} disabled={busy}><Trash2 size={15}/> Deleted entries</button><p className="pj-storage-note">{localSitePreview()?'Local design preview · example entries and screenshots stay in this temporary workspace.':'Your entries are saved privately in the cloud.'}</p>
        </aside>
        <section className="pt-day-editor" aria-label="Daily journal editor">
          <div className="pt-day-heading"><div><span className="pt-overline">{day===today?'TODAY':dayDate(day).toLocaleDateString('en-GB',{weekday:'long'}).toUpperCase()}</span><h2>{niceDay(day)}</h2><p aria-label="Day profit and loss">{dirty?'Save entry to update the day’s P&L':dayResult?.net_pnl!=null?`Day P&L: ${money(dayResult.net_pnl)}`:hasDayTrades?'Day P&L incomplete · enter a result for every trade':account===null?'No trades recorded':'No trades recorded for this selection'}{entry.plan_followed&&<span> · Plan followed: {entry.plan_followed}</span>}</p></div><div><span className="pt-save-state" role="status">{dirty?'Unsaved changes':entry.updated_at?<><Check size={15}/> Saved</>:'A fresh page'}</span><button className="pt-btn pt-btn-dark" disabled={busy} onClick={save}><Save size={16}/>{busy?'Saving…':'Save entry'}</button><button className="pj-delete-entry" onClick={()=>setDeleting(true)} disabled={busy||(!entry.updated_at&&!dirty)} aria-label="Delete journal entry"><Trash2 size={17}/></button></div></div>
          <JournalPrep day={day} key={day}/>
          {(error||notice)&&<div className="pj-day-feedback">{error&&<div className="pt-journal-error" role="alert">{error}</div>}{notice&&<div className="pt-journal-success" role="status">{notice}{undoId&&<button className="pj-undo" onClick={()=>restoreDay(undoId)} disabled={busy}><Undo2 size={15}/> Undo</button>}</div>}</div>}
          <div className="pt-entry-tabs" role="tablist" aria-label="Session writing sections">{sections.map((item,index)=><button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={section===item.id} onClick={()=>setSection(item.id)}><span>0{index+1}</span>{item.label}{entry[item.id]?.trim()&&<Check size={14}/>}</button>)}</div>
          <div className="pt-writing-area" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`}><span className="pt-overline">SESSION NOTES</span><h3>{current.title}</h3><p>{current.hint}</p><textarea aria-label={current.label} value={entry[section]} maxLength={section==='notes'?20000:12000} placeholder={current.placeholder} onChange={e=>edit(section,e.target.value)} disabled={busy}/><div className="pt-writing-footer"><span>{section==='lesson'?'Your review of the whole session. Trade-by-trade details go below.':'A few lines are enough. You can come back to this later.'}</span><span>{entry[section].length.toLocaleString()} characters</span></div></div>
          <div className="pt-mindset pj-plan-field">
            <h3>Plan followed?</h3>
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
          </div>
          <JournalReplayImports/>
          <JournalTradeCards palette={meta.palette[theme]} accountFilter={account} accounts={accounts} entry={entry} meta={meta} busy={busy} expanded={expanded} setExpanded={setExpanded} onChange={editTrade} onAdd={addTrade} onRemove={removeTrade} onUpload={upload} onRemoveImage={removeImage} onView={setViewing} onAddToLab={prepareLab} onLink={prepareLink} canUpload={Boolean(identity.images_enabled??localSitePreview())} freshTradeId={freshTradeId}/>
          {(identity.images_enabled??localSitePreview())&&<details className="pj-session-images" open={entry.images.some(image=>!image.trade_id)||undefined}><summary>Session screenshots <span>Optional · charts for the whole day</span></summary><JournalScreenshots images={entry.images.filter(image=>!image.trade_id)} allImages={entry.images} day={day} busy={busy} onUpload={file=>upload(file)} onRemove={removeImage} onView={setViewing}/></details>}
          <div className="pt-mindset"><div><span className="pt-overline">A QUICK CHECK-IN</span><h3>How did you show up?</h3></div><div role="group" aria-label="Session mindset">{['Focused','Patient','Distracted','Frustrated'].map(value=><button disabled={busy} key={value} aria-pressed={entry.mindset===value} onClick={()=>edit('mindset',entry.mindset===value?'Not set':value)}>{value}</button>)}</div></div>
          <div className="pt-day-bottom"><span><LockKeyhole size={14}/> Save your notes here. Only trades you add to the Lab affect Lab results.</span><button className="pt-btn pt-btn-dark" onClick={save} disabled={busy}>{busy?'Saving…':'Save entry'} <Check size={16}/></button></div>
        </section>
      </div>
      <JournalEquity rows={rows} accounts={accounts} palette={meta.palette} theme={theme}/>
    </main>
    {deleting&&<Modal title="Delete journal entry?" onClose={()=>setDeleting(false)} className="pj-link-modal"><p className="pj-modal-hint">Move the entry for {niceDay(day)}, its trade cards and screenshots to Deleted entries? You can restore it later. Linked Strategy Lab trades stay saved.</p>{error&&<p role="alert">{error}</p>}<div className="pj-modal-actions"><button className="pt-btn" onClick={()=>setDeleting(false)} disabled={busy}>Keep entry</button><button className="pt-btn pj-danger" onClick={deleteDay} disabled={busy}>Delete entry</button></div></Modal>}
    {trash&&<Modal title="Deleted entries" onClose={()=>setTrash(null)} className="pj-link-modal"><p className="pj-modal-hint">Restore an entry with its notes, cards and screenshots. Your Lab trades are unaffected.</p>{!trash.length&&<p>No deleted entries.</p>}{trash.map(item=><div className="pj-trash-row" key={item.id}><span>{niceDay(item.day)}</span><button className="pt-btn" disabled={busy} onClick={()=>restoreDay(item.id)}><Undo2 size={15}/> Restore</button></div>)}{error&&<p role="alert">{error}</p>}</Modal>}
    {viewing&&<dialog ref={viewer} className="pt-image-dialog" onCancel={()=>setViewing(null)}><button className="pt-image-close" onClick={()=>setViewing(null)} aria-label="Close screenshot"><X/></button><img src={viewing} alt="Expanded trading screenshot"/></dialog>}
    {labDraft&&<JournalClock.Provider value={timezone}><Modal title="Add Journal trade to Strategy Lab" onClose={labDismissal.requestClose} className="pj-lab-modal"><p className="pj-modal-hint">Your notes are saved. Record the actual result and original risk below. This adds one linked trade to your Lab.</p><TradeForm onDraftStateChange={labDismissal.onDraftStateChange} meta={meta} previous={{account_id:labDraft.account_id,strategy:labDraft.strategy,symbol:labDraft.symbol,direction:labDraft.direction,source:labDraft.source,notes:labDraft.notes,net_pnl:labDraft.net_pnl,risk_amount:labDraft.risk_amount,labels:{level:labDraft.level||'Not recorded',timeframe:labDraft.timeframe||'Not recorded',entry_timeframe:labDraft.entry_timeframe||'Not recorded',condition:'Not recorded',news:'Not recorded',confirmations:labDraft.confirmations||[]}}} initialEntryTime={`${day}T${labDraft.time||'09:30'}`} journalOrigin={{day,id:labDraft.id}} onPrevious={()=>{}} onClose={labDismissal.requestClose} onSaved={async(_,__,result)=>{if(result?.journal_entry)upsert(result.journal_entry);setLabDraft(null);setNotice('Trade saved in Strategy Lab and linked to this entry.')}}/></Modal></JournalClock.Provider>}
    {linking&&<Modal title="Link an existing Lab trade" onClose={()=>setLinking(null)} className="pj-link-modal"><p className="pj-modal-hint">Choose a trade you’ve already added or imported. This creates a link without adding another trade. Times use your Lab timezone.</p><Select label="Lab trade" value={selectedLink} onChange={e=>setSelectedLink(e.target.value)} values={[{value:'',label:linking.lab_trade_id?'Remove the current link':'Choose a trade'},...linkChoices.map(trade=>({value:String(trade.id),label:`${trade.symbol} · ${trade.direction==='long'?'Buy':'Sell'} · ${new Date(trade.entry_time).toLocaleString('en-GB',{timeZone:timezone,dateStyle:'short',timeStyle:'short'})} · ${trade.setup_name||'Unclassified'}`}))]}/>{error&&<p role="alert">{error}</p>}<div className="pj-modal-actions"><button className="pt-btn" onClick={()=>setLinking(null)}>Cancel</button><button className="pt-btn pt-btn-dark" disabled={busy||(!selectedLink&&!linking.lab_trade_id)} onClick={linkTrade}><Link2 size={16}/> Save link</button></div></Modal>}
  </div>;
}
