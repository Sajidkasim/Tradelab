import React, {useEffect, useState} from 'react';
import {api} from './api';
import {Button, Notice} from './components';

export default function SetupGallery({name}){
  const [items,setItems]=useState(null);
  const [tag,setTag]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    api('/learn/setup-gallery',{signal:controller.signal}).then(setItems).catch(()=>{
      if(!controller.signal.aborted)setError('Could not open the private setup gallery.');
    });
    return ()=>controller.abort();
  },[]);

  async function upload(event){
    event.preventDefault();
    const form=event.currentTarget;
    const body=new FormData(form);
    setBusy(true);
    setError('');
    try{
      const entry=await api('/learn/setup-gallery',{method:'POST',body});
      setItems(rows=>[entry,...rows]);
      setTag('');
      form.reset();
    }catch(failure){setError(failure.message)}
    finally{setBusy(false)}
  }

  async function remove(item){
    if(!window.confirm(`Remove “${item.title}” from the team gallery?`))return;
    setBusy(true);
    setError('');
    try{
      await api(`/learn/setup-gallery/${item.id}`,{method:'DELETE'});
      setItems(rows=>rows.filter(row=>row.id!==item.id));
      setTag('');
    }catch(failure){setError(failure.message)}
    finally{setBusy(false)}
  }

  const tags=[...new Set(items?.flatMap(item=>item.tags))].sort();
  const visible=items?.filter(item=>!tag||item.tags.includes(tag));
  return <section className="wp-panel">
    <span className="pt-overline">TEAM PLAYBOOK</span>
    <h2>Lux Algo Setup Gallery</h2>
    <p>Share marked-up A+ setups with verified Primus teammates.</p>
    {error&&<Notice error>{error}</Notice>}
    {!items&&!error&&<p role="status">Loading setups…</p>}
    {items&&<>
      <form className="learn-risk-fields" onSubmit={upload}>
        <label>Setup name<input name="title" required maxLength={120}/></label>
        <label>Tags (comma-separated)<input name="tags" maxLength={300}/></label>
        <label>Screenshot<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required/></label>
        <Button type="submit" busy={busy} disabled={busy}>Share setup</Button>
      </form>
      <label>Filter by tag <select value={tag} onChange={event=>setTag(event.target.value)}>
        <option value="">All tags</option>
        {tags.map(value=><option key={value}>{value}</option>)}
      </select></label>
      {!visible.length&&<p>No setups to show.</p>}
      <div className="learn-gallery">
        {visible.map(item=><figure key={item.id}>
          <img src={`/api/learn/setup-gallery/${item.id}/image`} alt={item.title} loading="lazy"/>
          <figcaption><strong>{item.title}</strong> · {item.author}
            {item.tags.length>0&&<p>{item.tags.join(' · ')}</p>}
            {item.author===name&&<Button disabled={busy} onClick={()=>remove(item)}>Remove setup</Button>}</figcaption>
        </figure>)}
      </div>
    </>}
  </section>;
}
