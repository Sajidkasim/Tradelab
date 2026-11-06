import {useEffect, useRef, useState} from 'react';
import {api} from '../api';

const time = new Intl.DateTimeFormat('en-GB', {
  timeZone:'America/New_York', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit',
});

export default function BullpenMacroFeed(){
  const [feed,setFeed]=useState(null);
  const [failed,setFailed]=useState(false);

  const [squawk,setSquawk]=useState(false);
  const knownHeadlines=useRef(new Set());
  const speech=typeof window.SpeechSynthesisUtterance==='function'?window.speechSynthesis:null;

  useEffect(()=>{
    if(!squawk||!feed||!speech)return;
    const incoming=feed.items.filter(item=>!knownHeadlines.current.has(item.url));
    for(const item of feed.items)knownHeadlines.current.add(item.url);
    for(const item of incoming.reverse()){
      const announcement=new window.SpeechSynthesisUtterance(item.title);
      announcement.lang='en-US';
      speech.speak(announcement);
    }
  },[feed,speech,squawk]);

  useEffect(()=>{
    if(squawk)return ()=>speech?.cancel();
  },[speech,squawk]);

  function toggleSquawk(){
    if(!squawk)knownHeadlines.current=new Set(feed.items.map(item=>item.url));
    setSquawk(!squawk);
  }

  useEffect(()=>{
    const controller=new AbortController();
    let timer;
    async function refresh(){
      try{
        const next=await api('/bullpen/macro-feed',{signal:controller.signal});
        if(!controller.signal.aborted){setFeed(next);setFailed(false)}
      }catch{
        if(!controller.signal.aborted)setFailed(true);
      }finally{
        if(!controller.signal.aborted)timer=setTimeout(refresh,120_000);
      }
    }
    void refresh();
    return ()=>{controller.abort();clearTimeout(timer)};
  },[]);

  return <section className="bullpen-feed bullpen-messages" aria-label="Macro trade feed">
    <h3>NQ macro headlines</h3>
    {speech?<button type="button" aria-pressed={squawk} disabled={!squawk&&(!feed||(!feed.items.length&&feed.stale))}
      onClick={toggleSquawk}>Audio squawk {squawk?'on':'off'}</button>:
      <p>Audio squawk is unavailable in this browser.</p>}
    {!feed&&!failed&&<p role="status">Loading headlines…</p>}
    {(failed||feed?.stale)&&<p role="status">Some headlines are unavailable. The feed will retry automatically.</p>}
    {feed&&!feed.stale&&!feed.items.length&&<p>No headlines match the NQ watchlist right now.</p>}
    {feed?.items.map(item=><article key={item.url}>
      <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
      <p>{item.source}{item.published!==null&&<> · <time dateTime={new Date(item.published*1000).toISOString()}>
        {time.format(item.published*1000)} ET</time></>}</p>
    </article>)}
  </section>;
}
