import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Download, ImagePlus, LockKeyhole, NotebookPen, Save, Trash2, X } from 'lucide-react';
import { api, setCsrf } from './api';
import Unlock from './Unlock';
import { PrimusHeader, localSitePreview } from './SiteExperience';

const ymd=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const dayDate=day=>new Date(day+'T12:00:00');
const niceDay=day=>dayDate(day).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
const blank=day=>({day,plan:'',notes:'',lesson:'',mindset:'Not set',images:[]});
const sections=[{id:'plan',label:'Before the session',title:'Give the day a direction.',hint:'Your bias, important levels and what you’re waiting for. What would make you stay out?'},{id:'notes',label:'During the session',title:'Keep the story behind the trade.',hint:'What did you see? Why did you enter? What changed? You can write about several trades here.'},{id:'lesson',label:'After the session',title:'Take one lesson forward.',hint:'What went well? What would you change? Leave one clear thing to work on next time.'}];

export default function JournalPage(){
  const today=ymd(new Date());
  const [identity,setIdentity]=useState(null),[rows,setRows]=useState([]),[day,setDay]=useState(today);
  const [entry,setEntry]=useState(blank(today)),[section,setSection]=useState('plan');
  const [month,setMonth]=useState(new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [viewing,setViewing]=useState(null);
  const fileInput=useRef(), viewer=useRef();
  async function boot(){
    try{const session=await api('/session');setCsrf(session.csrf);setIdentity(session);if(session.authenticated){const list=await api('/journal');setRows(list);setEntry(list.find(row=>row.day===day)||blank(day));}}
    catch(e){setError(e.message)}
  }
  useEffect(()=>{document.title='Your Journal — PrimusTrader';boot();const loggedOut=()=>{setRows([]);setEntry(blank(day));setIdentity({authenticated:false,auth_mode:'google'});setDirty(false)};window.addEventListener('primus:logout',loggedOut);return()=>window.removeEventListener('primus:logout',loggedOut)},[]);
  useEffect(()=>{if(!dirty)return;const leave=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave)},[dirty]);
  useEffect(()=>{if(viewing)viewer.current?.showModal()},[viewing]);
  const current=sections.find(item=>item.id===section);
  function upsert(value){setRows(old=>[...old.filter(row=>row.day!==value.day),value].sort((a,b)=>b.day.localeCompare(a.day)));setEntry(value);setDirty(false)}
  function selectDay(value){if(busy)return;if(dirty&&!window.confirm('Leave this day without saving your changes?'))return;setDay(value);setEntry(rows.find(row=>row.day===value)||blank(value));setDirty(false);setNotice('');setError('');setMonth(new Date(dayDate(value).getFullYear(),dayDate(value).getMonth(),1))}
  const body=()=>({plan:entry.plan,notes:entry.notes,lesson:entry.lesson,mindset:entry.mindset});
  async function save(){setBusy(true);setError('');try{const saved=await api(`/journal/${day}`,{method:'PUT',body:body()});upsert(saved);setNotice(localSitePreview()?'Entry saved for this local preview.':'Entry saved.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function upload(file){
    if(!file||busy)return;
    if(file.size>8*1024*1024){setError('Choose a screenshot smaller than 8 MB.');return}
    setBusy(true);setError('');
    try{const saved=await api(`/journal/${day}`,{method:'PUT',body:body()});upsert(saved);const form=new FormData();form.append('file',file);upsert(await api(`/journal/${day}/images`,{method:'POST',body:form}));setNotice('Screenshot added. Your notes are saved too.')}
    catch(e){setError(e.message)}finally{setBusy(false);if(fileInput.current)fileInput.current.value=''}
  }
  async function removeImage(id){if(!window.confirm('Remove this screenshot from this entry?'))return;setBusy(true);setError('');try{const updated=await api(`/journal/${day}/images/${id}`,{method:'DELETE'});setEntry(old=>({...old,images:updated.images}));setRows(old=>old.map(row=>row.day===day?{...row,images:updated.images}:row));setNotice('Screenshot removed.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  function edit(field,value){setEntry(old=>({...old,[field]:value}));setDirty(true);setNotice('')}
  const startOffset=(new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7;
  const monthDays=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  if(!identity)return <div className="pt-journal"><PrimusHeader active="journal"/><main className="pt-journal-loading">{error?<><p role="alert">{error}</p><button className="pt-btn" onClick={boot}>Try again</button></>:'Opening your private Journal…'}</main></div>;
  if(!identity.authenticated)return <><PrimusHeader active="journal"/><Unlock ready={Boolean(identity.csrf)} authMode={identity.auth_mode} appearance="modern" onAppearanceChange={()=>{}} onUnlocked={boot}/></>;
  return <div className="pt-journal">
    <PrimusHeader active="journal"/>
    <main className="pt-wrap pt-journal-main">
      <div className="pt-journal-heading"><div><span className="pt-overline">THE DAILY PRACTICE</span><h1>Pause. Put it <em>on paper.</em></h1><p>Your space to plan, capture and reflect. Every session has something to teach you.</p></div><div className="pt-private-badge"><LockKeyhole size={14}/> Only you can see your entries</div></div>
      <div className="pt-journal-layout">
        <aside className="pt-journal-sidebar">
          <button className="pt-btn pt-btn-dark" onClick={()=>selectDay(today)} disabled={busy}><NotebookPen size={17}/> Today’s entry <ArrowUpRight size={16}/></button>
          <label className="pt-mobile-date">Choose a day<input type="date" aria-label="Journal date" value={day} disabled={busy} onChange={e=>{if(e.target.value)selectDay(e.target.value)}}/></label>
          <div className="pt-calendar"><div className="pt-calendar-heading"><strong>{month.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</strong><div><button aria-label="Previous month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={16}/></button><button aria-label="Next month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={16}/></button></div></div>
          <div className="pt-calendar-grid">{['M','T','W','T','F','S','S'].map((d,i)=><span key={'head'+i}>{d}</span>)}{Array.from({length:startOffset},(_,i)=><span key={'blank'+i}/>)}{Array.from({length:monthDays},(_,i)=>{const value=ymd(new Date(month.getFullYear(),month.getMonth(),i+1));return <button key={value} className={`${day===value?'selected':''} ${rows.some(row=>row.day===value)?'has-entry':''}`} aria-label={niceDay(value)} aria-pressed={day===value} disabled={busy} onClick={()=>selectDay(value)}>{i+1}</button>})}</div><p><i/> A day you’ve written about</p></div>
          <div className="pt-recent-heading"><span className="pt-overline">RECENT ENTRIES</span><span>{rows.length}</span></div>
          <div className="pt-recent-entries">{rows.slice(0,8).map(row=><button key={row.day} aria-pressed={row.day===day} disabled={busy} onClick={()=>selectDay(row.day)}><CalendarDays size={17}/><span><strong>{niceDay(row.day)}</strong><small>{row.lesson||row.notes||row.plan||'Your session notes'}</small></span><ArrowUpRight size={14}/></button>)}{!rows.length&&<p>Your first entry starts here. Choose a day and write a few lines.</p>}</div>
          <a className="pt-download-notes" href="/api/journal/export"><Download size={15}/> Download your notes</a>
          <div className="pt-journal-note"><span>{localSitePreview()?"LOCAL PREVIEW":"YOUR PRIVATE NOTES"}</span><p>{localSitePreview()?"Example entries and edits stay in this disposable preview. Screenshots are stored on this Mac. Cloud storage is not connected yet.":"Notes are saved privately in the cloud. Download a copy whenever you need it. Screenshot uploads are coming once private image storage is connected."}</p></div>
        </aside>
        <section className="pt-day-editor" aria-label="Daily journal editor">
          <div className="pt-day-heading"><div><span className="pt-overline">{day===today?'TODAY':dayDate(day).toLocaleDateString('en-GB',{weekday:'long'}).toUpperCase()}</span><h2>{niceDay(day)}</h2></div><div><span className="pt-save-state" role="status">{dirty?'Unsaved changes':entry.updated_at?<><Check size={14}/> Saved</>:'A fresh page'}</span><button className="pt-btn pt-btn-dark" disabled={busy} onClick={save}><Save size={15}/>{busy?'Saving…':'Save entry'}</button></div></div>
          {error&&<div className="pt-journal-error" role="alert">{error}</div>}{notice&&<div className="pt-journal-success" role="status">{notice}</div>}
          <div className="pt-entry-tabs" role="tablist" aria-label="Session writing sections">{sections.map((item,i)=><button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={section===item.id} onClick={()=>setSection(item.id)}><span>0{i+1}</span>{item.label}{entry[item.id]?.trim()&&<Check size={13}/>}</button>)}</div>
          <div className="pt-writing-area" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`}><span className="pt-overline">{section==='plan'?'THE INTENTION':section==='notes'?'THE OBSERVATION':'THE TAKEAWAY'}</span><h3>{current.title}</h3><p>{current.hint}</p><textarea aria-label={current.label} value={entry[section]} maxLength={section==='notes'?20000:12000} placeholder={section==='plan'?'Today, I’m looking for…':section==='notes'?'The setup I saw was…':'One thing I’ll take into the next session…'} onChange={e=>edit(section,e.target.value)} disabled={busy}/><div className="pt-writing-footer"><span>Write for yourself. A few honest lines are enough.</span><span>{entry[section].length.toLocaleString()} characters</span></div></div>
          {localSitePreview()&&<div className="pt-image-section"><div className="pt-image-heading"><div><span className="pt-overline">THE VISUAL RECORD</span><h3>A chart says what words can’t.</h3></div><span>{entry.images.length} / 6 images</span></div>
            <div className="pt-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();upload(e.dataTransfer.files[0])}} onPaste={e=>{const file=Array.from(e.clipboardData.files)[0];if(file){e.preventDefault();upload(file)}}} tabIndex={0} aria-label="Screenshot drop area" onKeyDown={e=>{if(e.key==='Enter')fileInput.current?.click()}}>
              <ImagePlus size={25} strokeWidth={1.3}/><div><strong>Drop a screenshot, or <button disabled={busy||entry.images.length>=6} onClick={()=>fileInput.current?.click()}>choose an image</button></strong><small>PNG, JPEG or WebP · up to 8 MB · paste a screenshot here too</small></div><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload screenshot" onChange={e=>upload(e.target.files[0])} disabled={busy||entry.images.length>=6} hidden/>
            </div>
            {!!entry.images.length&&<div className="pt-image-grid">{entry.images.map((item,i)=>{const url=`/api/journal/${day}/images/${item.id}`;return <figure key={item.id}><button className="pt-image-open" onClick={()=>setViewing(url)} aria-label={`Open screenshot ${i+1}`}><img src={url} alt={`Trading screenshot ${i+1} for ${niceDay(day)}`} loading="lazy"/></button><figcaption><span>Screenshot {i+1}</span><a href={url} download="primus-screenshot.webp" aria-label={`Download screenshot ${i+1}`}><Download size={15}/></a><button disabled={busy} onClick={()=>removeImage(item.id)} aria-label={`Remove screenshot ${i+1}`}><Trash2 size={15}/></button></figcaption></figure>})}</div>}
          </div>
          }
          <div className="pt-mindset"><div><span className="pt-overline">A QUICK CHECK-IN</span><h3>How did you show up?</h3></div><div role="group" aria-label="Session mindset">{['Focused','Patient','Distracted','Frustrated'].map(value=><button disabled={busy} key={value} aria-pressed={entry.mindset===value} onClick={()=>edit('mindset',entry.mindset===value?'Not set':value)}>{value}</button>)}</div></div>
          <div className="pt-day-bottom"><a href="/lab">Take an idea to the Lab <ArrowUpRight size={16}/></a><button className="pt-btn pt-btn-dark" onClick={save} disabled={busy}>{busy?'Saving…':'Save entry'} <Check size={16}/></button></div>
        </section>
      </div>
    </main>
    {viewing&&<dialog ref={viewer} className="pt-image-dialog" onCancel={()=>setViewing(null)}><button className="pt-image-close" onClick={()=>setViewing(null)} aria-label="Close screenshot"><X/></button><img src={viewing} alt="Expanded trading screenshot"/></dialog>}
  </div>;
}
