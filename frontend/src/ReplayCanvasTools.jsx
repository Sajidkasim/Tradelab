import React,{useEffect,useRef,useState} from 'react';
import {ticketLabelOffset} from './replayTicketLayout';
import {recordTiming} from './replayTiming';
import {replayProjector} from './replayViewport';
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);
export default function ReplayCanvasTools({chart,host,frame,session,price,qty,disabled,onAction,onOpenClose,pause,onError,cursor,version}){
 const [geometry,setGeometry]=useState(null),[menu,setMenu]=useState(null),[drag,setDrag]=useState(null);
 const menuRef=useRef(null),ticket=frame.ticket;
 const [pendingLevel,setPendingLevel]=useState(null);
 const latest=useRef({frame,cursor});latest.current={frame,cursor};
 const latestDrag=useRef(null),dragRaf=useRef(null);
 const tick=session.tick_size||.25,multiplier=session.multiplier||({'NQ':20,'MNQ':2,'ES':50,'MES':5}[session.instrument]);
 useEffect(()=>{if(!drag)return;const cancel=e=>{if(e.key==='Escape'){cancelAnimationFrame(dragRaf.current);dragRaf.current=null;latestDrag.current=null;setDrag(null)}};window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel)},[Boolean(drag)]);
 useEffect(()=>()=>cancelAnimationFrame(dragRaf.current),[]);
 useEffect(()=>{if(!ticket){cancelAnimationFrame(dragRaf.current);dragRaf.current=null;latestDrag.current=null;setDrag(null);setPendingLevel(null)}},[Boolean(ticket)]);

 useEffect(()=>{
  if(!ticket){setGeometry(null);return}let raf;const update=()=>{const proj=replayProjector(chart);const pane=proj?.paneRect('price');
   if(proj&&pane&&ticket){const g={axis:Math.max(0,host.current.clientWidth-proj.width),top:pane.top,bottom:pane.top+pane.height,entry:proj.yOf(ticket.reference,'price'),stop:proj.yOf(ticket.stop_price,'price'),target:proj.yOf(ticket.target_price,'price'),partial:frame.position?.partial_target ? proj.yOf(frame.position.partial_target.price,'price') : null};setGeometry(old=>JSON.stringify(old)===JSON.stringify(g)?old:g)}
   raf=requestAnimationFrame(update)};update();return()=>cancelAnimationFrame(raf);
 },[chart,ticket,frame.position?.partial_target]);
 useEffect(()=>{
  const el=host.current;if(!el)return;
  const context=e=>{const bounds=el.getBoundingClientRect(),proj=replayProjector(chart);const pointOnChart=chart.renderer.renderer.input.local(e);if(!proj||pointOnChart.x<0||pointOnChart.x>=proj.width||proj.paneIdAtY(pointOnChart.y)!=='price')return;e.preventDefault();e.stopImmediatePropagation();pause();const point=proj.pxToPoint(pointOnChart.x,pointOnChart.y,'price');setMenu({x:Math.max(8,Math.min(e.clientX-bounds.left,bounds.width-245)),y:Math.max(8,Math.min(e.clientY-bounds.top,bounds.height-235)),price:Math.round(point.price*4)/4})};
  el.addEventListener('contextmenu',context,true);return()=>el.removeEventListener('contextmenu',context,true);
 },[chart,host,pause]);
 useEffect(()=>{if(!menu)return;const close=e=>{if(e.key==='Escape'||(e.type==='pointerdown'&&!menuRef.current?.contains(e.target)))setMenu(null)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);menuRef.current?.focus();return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close)}},[menu]);
 async function send(kind,order){try{await onAction(kind,order)}catch(e){onError(e.message)}}
 function amend(field,value){const a=latest.current.frame.position||latest.current.frame.order;if(!a)return;return send('amend',{side:a.side,type:latest.current.frame.order?.type||'market',qty:a.qty,[field]:value})}
 function atPointer(e){const started=performance.now();const r=host.current.getBoundingClientRect();const value=Math.max(tick,Math.round(replayProjector(chart).pxToPoint(e.clientX-r.left,e.clientY-r.top-(latestDrag.current?.offset||0),'price').price/tick)*tick);recordTiming('pointer handler',started);return value}
 function place(side){const type=side==='buy'?(menu.price<=price?'limit':'stop'):(menu.price>=price?'limit':'stop');send('order',{side,type,qty:Number(qty),price:menu.price});setMenu(null)}
 return <>
 {ticket&&geometry&&<div className="bt-ticket-layer" style={{'--bt-price-gutter': geometry.axis+'px'}} aria-label={ticket.pending?'Pending order on chart':'Position on chart'}>{['stop','target'].map(kind=>{const value=drag?.kind===kind?drag.price:pendingLevel?.kind===kind?pendingLevel.price:ticket[kind+'_price'];const y=replayProjector(chart)?.yOf(value,'price');return y==null?null:<div key={kind+'zone'} className={`bt-risk-zone ${kind}`} style={{top:Math.min(y,geometry.entry),height:Math.abs(y-geometry.entry)}}/>})}{geometry.partial!=null&&geometry.partial>=geometry.top&&geometry.partial<=geometry.bottom&&
 <div className="bt-partial-line" style={{top:geometry.partial}}><button type="button" onClick={()=>{pause();onOpenClose()}} disabled={disabled}>Partial · {frame.position?.partial_target?.qty}</button></div>}
 {frame.position&&<button className="bt-break-even" onClick={()=>amend('stop',frame.position.entry)}>SL to break-even</button>}{['entry','stop','target'].map(kind=>{
 const active=kind==='entry'||(kind==='stop'?ticket.stop_result:ticket.target_result)!=null;
 const level=drag?.kind===kind?drag.price:pendingLevel?.kind===kind?pendingLevel.price:kind==='entry'?ticket.reference:ticket[kind+'_price'];
 const amount=(level-ticket.reference)*(ticket.side==='buy'?1:-1)*multiplier*ticket.qty;
 const points=Math.abs(level-ticket.reference),risk=Math.abs((drag?.kind==='stop'?drag.price:ticket.stop_price)-ticket.reference);
 const rr=risk>0?Math.abs((drag?.kind==='target'?drag.price:ticket.target_price)-ticket.reference)/risk:null;
 let y=(drag?.kind===kind||pendingLevel?.kind===kind)?replayProjector(chart)?.yOf(level,'price'):geometry[kind];
 if(y==null)return null;
 if(drag?.kind===kind)y=Math.max(geometry.top+15,Math.min(y,geometry.bottom-15));
 else if(y<geometry.top+15||y>geometry.bottom-15)return null;
 const movable=kind!=='entry'||(ticket.pending&&frame.order?.type!=='market');
 const field=kind==='entry'?'price':kind;
 return <div key={kind} className={`bt-ticket-line ${kind} ${!active?'draft':''} ${drag?.kind===kind?'dragging':pendingLevel?.kind===kind?'dropping':''}`} style={{top:y}}>
 <div className="bt-price-ticket" style={{top:drag?.kind===kind?drag.labelOffset:ticketLabelOffset(kind,ticket.side,geometry.entry,y)}} role="group" aria-label={`${kind==='entry'?(ticket.pending?'Pending entry':'Entry'):kind==='stop'?'Stop loss':'Take profit'} price box`}>
 <button className="bt-ticket-drag" disabled={disabled||!movable||frame.position?.closing} title={movable?'Drag to set price':'Entry price'} aria-label={`Drag ${kind} price`} onPointerDown={e=>{if(!movable)return;e.stopPropagation();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);latestDrag.current={kind,price:level,offset:e.clientY-host.current.getBoundingClientRect().top-y,labelOffset:ticketLabelOffset(kind,ticket.side,geometry.entry,y)};setDrag(latestDrag.current)}} onPointerMove={e=>{
 const started=performance.now();try{
 if(latestDrag.current?.kind!==kind)return;
 let value=atPointer(e);const sign=ticket.side==='buy'?1:-1;
 if(ticket.pending&&kind==='stop'){const edge=ticket.reference-(ticket.pending?sign*tick:0);value=sign===1?Math.min(value,edge):Math.max(value,edge)}
 if(ticket.pending&&kind==='target')value=sign===1?Math.max(value,ticket.reference+tick):Math.min(value,ticket.reference-tick);
 latestDrag.current={...latestDrag.current,kind,price:value};
 if(dragRaf.current==null)dragRaf.current=requestAnimationFrame(()=>{dragRaf.current=null;setDrag(latestDrag.current)});
 }finally{recordTiming('drag move handler',started)}
 }} onPointerUp={e=>{e.stopPropagation();if(latestDrag.current?.kind!==kind)return;cancelAnimationFrame(dragRaf.current);dragRaf.current=null;const value=latestDrag.current.price;latestDrag.current=null;const pending={kind,price:value};setPendingLevel(pending);setDrag(null);Promise.resolve(amend(field,value)).finally(()=>setPendingLevel(current=>current===pending?null:current))}} onPointerCancel={()=>{cancelAnimationFrame(dragRaf.current);dragRaf.current=null;latestDrag.current=null;setDrag(null)}}>
 <span aria-hidden="true">↕</span><b>{kind==='entry'?`${ticket.side==='buy'?'BUY':'SELL'} ${ticket.qty}`:kind==='stop'?'SL':'TP'}</b>
 <span>{level.toFixed(2)}</span><strong>{drag?.kind===kind?`${money(amount)} · ${points.toFixed(2)} pt${rr==null?'':` · ${rr.toFixed(2)}R`}`:kind==='entry'?(ticket.pending?'Pending':money(frame.unrealized)):active?money(ticket[kind+'_result']):'Drag to set'}</strong>
 </button><button disabled={disabled||frame.position?.closing} aria-label={kind==='entry'?(ticket.pending?'Cancel chart order':'Close chart position'):`Remove ${kind==='stop'?'stop loss':'take profit'}`} onClick={()=>kind==='entry'?(ticket.pending?send('cancel'):(pause(),onOpenClose())):amend(field,null)}>×</button>
 </div></div>})}<small className="bt-ticket-note">{ticket.pending?'Pending entry · market fill price may differ. ':''}SL/TP amounts are gross, before fees.</small></div>}
 {menu&&<div className="bt-chart-menu" role="menu" aria-label="Chart options" tabIndex={-1} ref={menuRef} style={{left:menu.x,top:menu.y}}>
 <button role="menuitem" disabled={disabled||Boolean(ticket)} onClick={()=>place('buy')}>↗ Buy {qty} {session.instrument} @ {menu.price.toFixed(2)} {menu.price<=price?'limit':'stop'}</button>
 <button role="menuitem" disabled={disabled||Boolean(ticket)} onClick={()=>place('sell')}>↘ Sell {qty} {session.instrument} @ {menu.price.toFixed(2)} {menu.price>=price?'limit':'stop'}</button>
 <hr/><button role="menuitem" onClick={()=>{chart.setVisibleRangePreset('ALL');setMenu(null)}}>Reset chart view</button>
 <button role="menuitem" onClick={()=>{chart.panBy(10000);setMenu(null)}}>Move to last candle</button>
 <hr/><button role="menuitem" onClick={()=>{chart.renderer.openSettings();setMenu(null)}}>Chart settings…</button>
 </div>}
 </>;
}
