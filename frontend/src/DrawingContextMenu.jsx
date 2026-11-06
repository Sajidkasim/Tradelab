import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronRight, Clock, Copy, EyeOff, Layers, LayoutGrid, Lock, Settings2, Trash2} from 'lucide-react';
import {api} from './api';

export default function DrawingContextMenu({chart, point, onClose, openSettings}) {
  const ref = useRef(null);
  const [section,setSection] = useState('');
  const [templates,setTemplates] = useState(null);
  const [error,setError] = useState('');
  const drawing = chart.drawings.all().find(item=>item.id===point.id);

  useLayoutEffect(()=>{
    const menu=ref.current;
    if(!menu)return;
    menu.style.left=Math.max(8,Math.min(point.x,innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=Math.max(8,Math.min(point.y,innerHeight-menu.offsetHeight-8))+'px';
    menu.querySelector('button')?.focus();
  },[point,section,templates,error]);

  useEffect(()=>{
    const dismiss=event=>{if(!ref.current?.contains(event.target))onClose()};
    const escape=event=>{
      if(event.key!=='Escape')return;
      event.preventDefault();
      event.stopPropagation();
      if(section)setSection('');
      else onClose();
    };
    document.addEventListener('pointerdown',dismiss,true);
    document.addEventListener('keydown',escape,true);
    window.addEventListener('resize',onClose);
    return ()=>{
      document.removeEventListener('pointerdown',dismiss,true);
      document.removeEventListener('keydown',escape,true);
      window.removeEventListener('resize',onClose);
    };
  },[onClose,section]);

  useEffect(()=>{
    if(section!=='Templates')return;
    const controller=new AbortController();
    api('/backtesting/drawing-templates',{signal:controller.signal}).then(setTemplates).catch(failure=>{
      if(!controller.signal.aborted)setError(failure.message);
    });
    return ()=>controller.abort();
  },[section]);

  if(!drawing)return null;
  const {id,type}=drawing;
  const run=action=>()=>{action();onClose()};
  const settings=(tab,template)=>run(()=>openSettings(id,tab,template));
  const update=patch=>run(()=>chart.drawings.update(id,patch));
  const appearance=value=>update({style:{...drawing.style,...value.style},text:value.text});
  const row=(label,Icon,action,hint)=>(
    <button type="button" role="menuitem" key={label} onClick={action}>
      <span className="bt-drawing-menu-icon">{Icon&&<Icon size={17}/>}</span><span>{label}</span>{hint}
    </button>
  );
  const sub=(label,Icon)=>row(label,Icon,()=>{setError('');setSection(label)},<ChevronRight size={15}/>);
  const shortcut=key=><kbd>{key}</kbd>;
  const defaults=chart.drawings.toolDefaults()[type];
  return createPortal(<div className="bt-object-menu" role="menu" aria-label={section||'Drawing actions'} ref={ref}
    onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
      const rows=[...ref.current.querySelectorAll('button')];
      const index=rows.indexOf(document.activeElement);
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();
        rows[(index+rows.length+(event.key==='ArrowDown'?1:-1))%rows.length]?.focus();
      }else if(event.key==='ArrowLeft'&&section){
        event.preventDefault();setSection('');
      }
    }}>
    {section&&row('Back',null,()=>setSection(''))}
    {!section&&<>
      {row('Settings',Settings2,settings('Style'))}
      {sub('Templates',LayoutGrid)}
      {row('Copy',Copy,run(()=>chart.drawings.copyToClipboard([id])),shortcut('⌘C'))}
      {row('Clone',null,run(()=>chart.drawings.duplicate([id])),shortcut('⌘D'))}
      {sub('Visual order',Layers)}
      {sub('Visibility on intervals',Clock)}
      <hr role="separator"/>
      {row('Delete',Trash2,run(()=>chart.drawings.removeMany([id])),shortcut('Delete'))}
      {row('Hide',EyeOff,update({visible:false}))}
      {row(drawing.locked?'Unlock':'Lock',Lock,update({locked:!drawing.locked}))}
    </>}
    {section==='Templates'&&<>
      {row('Save as…',null,settings('Style','save'))}
      {defaults&&row('Apply tool default',null,appearance(defaults))}
      {templates?.filter(item=>item.type===type).map(item=>row(item.name,null,appearance(item)))}
      {!templates&&!error&&<p role="status">Loading templates…</p>}
      {error&&<p role="alert">{error}</p>}
    </>}
    {section==='Visual order'&&<>
      {row('Bring to front',null,run(()=>chart.drawings.bringToFront(id)))}
      {row('Send to back',null,run(()=>chart.drawings.sendToBack(id)))}
    </>}
    {section==='Visibility on intervals'&&<>
      {row('Show on all intervals',null,update({showOn:undefined}))}
      {row('Choose intervals…',null,settings('Visibility'))}
    </>}
  </div>,document.body);
}
