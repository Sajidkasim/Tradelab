import React, {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,CalendarDays,Check,ChevronLeft,ChevronRight,Download,LockKeyhole,NotebookPen,Save,X,Link2} from 'lucide-react';
import {api,setCsrf} from './api';
import Unlock from './Unlock';
import {PrimusHeader,localSitePreview} from './SiteExperience';
import {Modal,Select} from './components';
import {JournalClock} from './JournalClock';
import TradeForm from './TradeForm';
import JournalTradeCards,{JournalScreenshots} from './JournalTradeCards';
import './journal-workspace.css';

const ymd=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const dayDate=day=>new Date(day+'T12:00:00');
const niceDay=day=>dayDate(day).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
const blank=day=>({day,plan:'',notes:'',lesson:'',mindset:'Not set',images:[],trades:[]});
const normalize=row=>({...blank(row.day),...row,trades:row.trades||[]});
const narrative=trade=>Object.fromEntries(['id','symbol','direction','strategy','time','source','notes','outcome','confirmations'].map(key=>[key,trade[key]]));
const sections=[
  {id:'plan',label:'Before the session',title:'What’s the plan?',hint:'Your market view, the levels you’re watching and the setups you want to take.',placeholder:'My plan for this session…'},
  {id:'notes',label:'During the session',title:'What happened?',hint:'Record what you noticed and the decisions you made. Add individual trades below.',placeholder:'What I saw and how I responded…'},
  {id:'lesson',label:'After the session',title:'How did the session go?',hint:'What worked, what didn’t, and what you want to change. Keep it in your own words.',placeholder:'Looking back at today’s session…'},
];

export default function JournalPage(){
  const today=ymd(new Date());
  const requested=new URLSearchParams(location.search).get('day');
  const initialDay=requested&&/^\d{4}-\d{2}-\d{2}$/.test(requested)&&!Number.isNaN(dayDate(requested).getTime())&&ymd(dayDate(requested))===requested?requested:today;
  const [identity,setIdentity]=useState(null),[meta,setMeta]=useState(null),[rows,setRows]=useState([]),[day,setDay]=useState(initialDay);
  const [entry,setEntry]=useState(blank(initialDay)),[section,setSection]=useState('plan'),[month,setMonth]=useState(initialDay.slice(0,7));
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [expanded,setExpanded]=useState(new URLSearchParams(location.search).get('card')),[viewing,setViewing]=useState(null),[labDraft,setLabDraft]=useState(null);
  const [linking,setLinking]=useState(null),[labTrades,setLabTrades]=useState([]),[selectedLink,setSelectedLink]=useState('');
  const viewer=useRef();
  async function boot(){
    try{const session=await api('/session');setCsrf(session.csrf);setIdentity(session);
      if(session.authenticated){const [list,metadata]=await Promise.all([api('/journal'),api('/metadata')]);const normalized=list.map(normalize);setRows(normalized);setMeta(metadata);setEntry(normalized.find(row=>row.day===day)||blank(day));}}
    catch(e){setError(e.message)}
  }
  useEffect(()=>{document.title='Your Journal — PrimusTrader';boot();const loggedOut=()=>{setRows([]);setEntry(blank(day));setIdentity({authenticated:false,auth_mode:'google'});setDirty(false)};window.addEventListener('primus:logout',loggedOut);return()=>window.removeEventListener('primus:logout',loggedOut)},[]);
  useEffect(()=>{if(!dirty)return;const leave=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave)},[dirty]);
  useEffect(()=>{if(viewing)viewer.current?.showModal()},[viewing]);
  const current=sections.find(item=>item.id===section);
  const timezone=meta?.journal_preferences?.timezone||'America/New_York';
  function upsert(value){const row=normalize(value);setRows(old=>[...old.filter(item=>item.day!==row.day),row].sort((a,b)=>b.day.localeCompare(a.day)));setEntry(row);setDirty(false)}
  function selectDay(value){if(busy||!value)return;if(dirty&&!window.confirm('Leave this day without saving your changes?'))return;setDay(value);setEntry(rows.find(row=>row.day===value)||blank(value));setDirty(false);setNotice('');setError('');setMonth(value.slice(0,7));setExpanded(null)}
  const body=()=>({plan:entry.plan,notes:entry.notes,lesson:entry.lesson,mindset:entry.mindset,trades:entry.trades.map(narrative)});
  async function persist(){const saved=await api(`/journal/${day}`,{method:'PUT',body:body()});upsert(saved);return saved}
  async function save(){setBusy(true);setError('');try{await persist();setNotice(localSitePreview()?'Entry saved for this local preview.':'Entry saved.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function upload(file,tradeId=''){
    if(!file||busy)return;if(file.size>8*1024*1024){setError('Choose a screenshot smaller than 8 MB.');return}
    setBusy(true);setError('');try{await persist();const form=new FormData();form.append('file',file);upsert(await api(`/journal/${day}/images${tradeId?`?trade_id=${tradeId}`:''}`,{method:'POST',body:form}));setNotice('Screenshot added. Your entry is saved too.')}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function removeImage(id){if(!window.confirm('Remove this screenshot from this entry?'))return;setBusy(true);setError('');try{const updated=await api(`/journal/${day}/images/${id}`,{method:'DELETE'});setEntry(old=>({...old,images:updated.images}));setRows(old=>old.map(row=>row.day===day?{...row,images:updated.images}:row));setNotice('Screenshot removed.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  function edit(field,value){setEntry(old=>({...old,[field]:value}));setDirty(true);setNotice('')}
  function addTrade(){const trade={id:crypto.randomUUID().replaceAll('-',''),symbol:'',direction:'',strategy:'',time:'',source:'manual',notes:'',outcome:'not_recorded',confirmations:[],lab_trade_id:null};edit('trades',[...entry.trades,trade]);setExpanded(trade.id)}
  function editTrade(id,field,value){edit('trades',entry.trades.map(trade=>trade.id===id?{...trade,[field]:value}:trade))}
  function removeTrade(id){if(!window.confirm('Remove this card from the Journal? Its Lab trade stays saved. Screenshots will remain with the day.'))return;edit('trades',entry.trades.filter(trade=>trade.id!==id));edit('images',entry.images.map(image=>image.trade_id===id?{...image,trade_id:null}:image));setExpanded(null)}
  async function prepareLab(trade){setBusy(true);setError('');try{await persist();setLabDraft(trade)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function prepareLink(trade){setBusy(true);setError('');try{await persist();const list=await api('/trades');setLabTrades(list);setSelectedLink(trade.lab_trade_id?String(trade.lab_trade_id):'');setLinking(trade)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function linkTrade(){setBusy(true);setError('');try{upsert(await api(`/journal/${day}/trades/${linking.id}/link`,{method:'PUT',body:{trade_id:selectedLink?Number(selectedLink):null}}));setLinking(null);setNotice(selectedLink?'Trade linked. No duplicate was added to the Lab.':'Lab link removed. The original Lab trade stays saved.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  function shiftMonth(amount){const date=new Date(month+'-15T12:00:00');date.setMonth(date.getMonth()+amount);setMonth(ymd(date).slice(0,7))}
  const monthDate=new Date(month+'-01T12:00:00'),startOffset=(monthDate.getDay()+6)%7,monthDays=new Date(monthDate.getFullYear(),monthDate.getMonth()+1,0).getDate();
  const monthRows=rows.filter(row=>row.day.startsWith(month));
  const knownDays=new Set(rows.map(row=>row.day));
  const dayLabTrades=labTrades.filter(trade=>trade.entry_time&&new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(trade.entry_time))===day);
  const linkChoices=[...dayLabTrades,...labTrades.filter(trade=>!dayLabTrades.some(other=>other.id===trade.id))];
  if(!identity||(identity.authenticated&&!meta))return <div className="pt-journal"><PrimusHeader active="journal"/><main className="pt-journal-loading">{error?<><p role="alert">{error}</p><button className="pt-btn" onClick={boot}>Try again</button></>:'Opening your private Journal…'}</main></div>;
  const entrancePreview=localSitePreview()&&new URLSearchParams(location.search).get('preview')==='signin';
  if(!identity.authenticated||entrancePreview)return <><PrimusHeader active="journal"/><Unlock workspace="journal" ready={!entrancePreview&&Boolean(identity.csrf)} authMode={entrancePreview?'google':identity.auth_mode} appearance="modern" onAppearanceChange={()=>{}} onUnlocked={boot}/></>;
  return <div className="pt-journal pj-workspace">
    <PrimusHeader active="journal"/>
    <main className="pt-wrap pt-journal-main">
      <div className="pt-journal-heading"><div><span className="pt-overline">THE DAILY PRACTICE</span><h1>Pause. Put it <em>on paper.</em></h1><p>Your session, your trades and the story behind them. All in one place.</p></div><div className="pt-private-badge"><LockKeyhole size={15}/> Your private workspace</div></div>
      <div className="pt-journal-layout">
        <aside className="pt-journal-sidebar" aria-label="Journal calendar and history">
          <button className="pt-btn pt-btn-dark" onClick={()=>selectDay(today)} disabled={busy}><NotebookPen size={17}/> Today’s entry <ArrowUpRight size={16}/></button>
          <label className="pt-mobile-date">Go to date<input type="date" aria-label="Journal date" value={day} disabled={busy} onChange={e=>selectDay(e.target.value)}/></label>
          <div className="pt-calendar"><div className="pt-calendar-heading"><button aria-label="Previous month" disabled={busy} onClick={()=>shiftMonth(-1)}><ChevronLeft size={18}/></button><label className="pj-month"><span>{monthDate.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</span><input type="month" aria-label="Browse month" value={month} disabled={busy} onChange={e=>{if(e.target.value)setMonth(e.target.value)}}/></label><button aria-label="Next month" disabled={busy} onClick={()=>shiftMonth(1)}><ChevronRight size={18}/></button></div>
            <div className="pt-calendar-grid">{['M','T','W','T','F','S','S'].map((value,index)=><span key={'head'+index}>{value}</span>)}{Array.from({length:startOffset},(_,index)=><span key={'blank'+index}/>)}{Array.from({length:monthDays},(_,index)=>{const value=`${month}-${String(index+1).padStart(2,'0')}`,saved=knownDays.has(value);return <button key={value} className={`${day===value?'selected':''} ${saved?'has-entry':''}`} aria-label={niceDay(value)} title={saved?'Saved journal entry':'Start an entry'} aria-pressed={day===value} disabled={busy} onClick={()=>selectDay(value)}>{index+1}</button>})}</div><p><i/> Green days have a saved entry</p>
          </div>
          <details className="pj-history" open><summary>Entries this month <span>{monthRows.length}</span></summary><div className="pt-recent-entries">{monthRows.map(row=><button key={row.day} aria-label={`Open entry ${niceDay(row.day)}`} aria-pressed={row.day===day} disabled={busy} onClick={()=>selectDay(row.day)}><CalendarDays size={18}/><span><strong>{dayDate(row.day).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</strong><small>{row.trades.length?`${row.trades.length} trade${row.trades.length===1?'':'s'} · `:''}{row.lesson||row.notes||row.plan||'Session saved'}</small></span><ArrowUpRight size={14}/></button>)}{!monthRows.length&&<p>No saved entries this month. Pick a day to start, or browse another month.</p>}</div></details>
          <a className="pt-download-notes" href="/api/journal/export"><Download size={16}/> Download your Journal</a>
          <p className="pj-storage-note">{localSitePreview()?'Local design preview · example entries and screenshots stay in this temporary workspace.':'Your entries are saved privately in the cloud.'}</p>
        </aside>
        <section className="pt-day-editor" aria-label="Daily journal editor">
          <div className="pt-day-heading"><div><span className="pt-overline">{day===today?'TODAY':dayDate(day).toLocaleDateString('en-GB',{weekday:'long'}).toUpperCase()}</span><h2>{niceDay(day)}</h2></div><div><span className="pt-save-state" role="status">{dirty?'Unsaved changes':entry.updated_at?<><Check size={15}/> Saved</>:'A fresh page'}</span><button className="pt-btn pt-btn-dark" disabled={busy} onClick={save}><Save size={16}/>{busy?'Saving…':'Save entry'}</button></div></div>
          {(error||notice)&&<div className="pj-day-feedback">{error&&<div className="pt-journal-error" role="alert">{error}</div>}{notice&&<div className="pt-journal-success" role="status">{notice}</div>}</div>}
          <div className="pt-entry-tabs" role="tablist" aria-label="Session writing sections">{sections.map((item,index)=><button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={section===item.id} onClick={()=>setSection(item.id)}><span>0{index+1}</span>{item.label}{entry[item.id]?.trim()&&<Check size={14}/>}</button>)}</div>
          <div className="pt-writing-area" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`}><span className="pt-overline">SESSION NOTES</span><h3>{current.title}</h3><p>{current.hint}</p><textarea aria-label={current.label} value={entry[section]} maxLength={section==='notes'?20000:12000} placeholder={current.placeholder} onChange={e=>edit(section,e.target.value)} disabled={busy}/><div className="pt-writing-footer"><span>{section==='lesson'?'Your review of the whole session. Trade-by-trade details go below.':'A few lines are enough. You can come back to this later.'}</span><span>{entry[section].length.toLocaleString()} characters</span></div></div>
          <JournalTradeCards entry={entry} meta={meta} busy={busy} expanded={expanded} setExpanded={setExpanded} onChange={editTrade} onAdd={addTrade} onRemove={removeTrade} onUpload={upload} onRemoveImage={removeImage} onView={setViewing} onAddToLab={prepareLab} onLink={prepareLink} canUpload={localSitePreview()}/>
          {localSitePreview()&&<details className="pj-session-images" open={entry.images.some(image=>!image.trade_id)||undefined}><summary>Session screenshots <span>Optional · charts for the whole day</span></summary><JournalScreenshots images={entry.images.filter(image=>!image.trade_id)} allImages={entry.images} day={day} busy={busy} onUpload={file=>upload(file)} onRemove={removeImage} onView={setViewing}/></details>}
          <div className="pt-mindset"><div><span className="pt-overline">A QUICK CHECK-IN</span><h3>How did you show up?</h3></div><div role="group" aria-label="Session mindset">{['Focused','Patient','Distracted','Frustrated'].map(value=><button disabled={busy} key={value} aria-pressed={entry.mindset===value} onClick={()=>edit('mindset',entry.mindset===value?'Not set':value)}>{value}</button>)}</div></div>
          <div className="pt-day-bottom"><span><LockKeyhole size={14}/> Notes stay in your Journal. Only trades you add to the Lab affect results.</span><button className="pt-btn pt-btn-dark" onClick={save} disabled={busy}>{busy?'Saving…':'Save entry'} <Check size={16}/></button></div>
        </section>
      </div>
    </main>
    {viewing&&<dialog ref={viewer} className="pt-image-dialog" onCancel={()=>setViewing(null)}><button className="pt-image-close" onClick={()=>setViewing(null)} aria-label="Close screenshot"><X/></button><img src={viewing} alt="Expanded trading screenshot"/></dialog>}
    {labDraft&&<JournalClock.Provider value={timezone}><Modal title="Add Journal trade to Strategy Lab" onClose={()=>setLabDraft(null)} className="pj-lab-modal"><p className="pj-modal-hint">Your notes are saved. Record the actual result and original risk below. This adds one linked trade to your Lab.</p><TradeForm meta={meta} previous={{strategy:labDraft.strategy,symbol:labDraft.symbol,direction:labDraft.direction,source:labDraft.source,notes:labDraft.notes,labels:{level:'Not recorded',timeframe:'Not recorded',entry_timeframe:'Not recorded',condition:'Not recorded',news:'Not recorded',confirmations:labDraft.confirmations||[]}}} initialEntryTime={`${day}T${labDraft.time||'09:30'}`} journalOrigin={{day,id:labDraft.id}} onPrevious={()=>{}} onClose={()=>setLabDraft(null)} onSaved={async(_,__,result)=>{if(result?.journal_entry)upsert(result.journal_entry);setLabDraft(null);setNotice('Trade saved in Strategy Lab and linked to this entry.')}}/></Modal></JournalClock.Provider>}
    {linking&&<Modal title="Link an existing Lab trade" onClose={()=>setLinking(null)} className="pj-link-modal"><p className="pj-modal-hint">Choose a trade you’ve already added or imported. This creates a link without adding another trade. Times use your Lab timezone.</p><Select label="Lab trade" value={selectedLink} onChange={e=>setSelectedLink(e.target.value)} values={[{value:'',label:linking.lab_trade_id?'Remove the current link':'Choose a trade'},...linkChoices.map(trade=>({value:String(trade.id),label:`${trade.symbol} · ${trade.direction==='long'?'Buy':'Sell'} · ${new Date(trade.entry_time).toLocaleString('en-GB',{timeZone:timezone,dateStyle:'short',timeStyle:'short'})} · ${trade.setup_name||'Unclassified'}`}))]}/>{error&&<p role="alert">{error}</p>}<div className="pj-modal-actions"><button className="pt-btn" onClick={()=>setLinking(null)}>Cancel</button><button className="pt-btn pt-btn-dark" disabled={busy||(!selectedLink&&!linking.lab_trade_id)} onClick={linkTrade}><Link2 size={16}/> Save link</button></div></Modal>}
  </div>;
}
