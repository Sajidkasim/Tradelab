import React,{useEffect,useRef,useState} from 'react';
import {replayProjector} from './replayViewport';
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);
export default function ReplayCanvasTools({chart,host,frame,session,price,qty,disabled,onAction,pause,onError}){
 const [geometry,setGeometry]=useState(null),[menu,setMenu]=useState(null),[drag,setDrag]=useState(null);
 const menuRef=useRef(null),ticket=frame.ticket;
 useEffect(()=>{
  let raf;const update=()=>{const proj=replayProjector(chart);const pane=proj?.paneRect('price');
   if(proj&&pane&&ticket){const g={top:pane.top,bottom:pane.top+pane.height,entry:proj.yOf(ticket.reference,'price'),stop:proj.yOf(ticket.stop_price,'price'),target:proj.yOf(ticket.target_price,'price')};setGeometry(old=>JSON.stringify(old)===JSON.stringify(g)?old:g)}
   raf=requestAnimationFrame(update)};update();return()=>cancelAnimationFrame(raf);
 },[chart,ticket]);
 useEffect(()=>{
  const el=host.current;if(!el)return;
  const context=e=>{const bounds=el.getBoundingClientRect(),proj=replayProjector(chart);if(!proj||proj.paneIdAtY(e.clientY-bounds.top)!=='price')return;e.preventDefault();e.stopImmediatePropagation();pause();const point=proj.pxToPoint(e.clientX-bounds.left,e.clientY-bounds.top,'price');setMenu({x:Math.max(8,Math.min(e.clientX-bounds.left,bounds.width-245)),y:Math.max(8,Math.min(e.clientY-bounds.top,bounds.height-235)),price:Math.round(point.price*4)/4})};
  el.addEventListener('contextmenu',context,true);return()=>el.removeEventListener('contextmenu',context,true);
 },[chart,host,pause]);
 useEffect(()=>{if(!menu)return;const close=e=>{if(e.key==='Escape'||(e.type==='pointerdown'&&!menuRef.current?.contains(e.target)))setMenu(null)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);menuRef.current?.focus();return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close)}},[menu]);
 async function send(kind,order){pause();try{await onAction(kind,order)}catch(e){onError(e.message)}}
 function amend(field,value){const a=frame.position||frame.order;if(!a)return;send('amend',{side:a.side,type:frame.order?.type||'market',qty:a.qty,price:frame.order?.price??null,stop:a.stop,target:a.target,[field]:value})}
 function atPointer(e){const r=host.current.getBoundingClientRect();return Math.max(.25,Math.round(replayProjector(chart).pxToPoint(e.clientX-r.left,e.clientY-r.top,'price').price*4)/4)}
 function place(side){const type=side==='buy'?(menu.price<=price?'limit':'stop'):(menu.price>=price?'limit':'stop');send('order',{side,type,qty:Number(qty),price:menu.price});setMenu(null)}
 return <>
 {ticket&&geometry&&<div className="bt-ticket-layer" aria-label={ticket.pending?'Pending order on chart':'Position on chart'}>{['entry','stop','target'].map(kind=>{
 const active=kind==='entry'||(kind==='stop'?ticket.stop_result:ticket.target_result)!=null;
 const level=drag?.kind===kind?drag.price:kind==='entry'?ticket.reference:ticket[kind+'_price'];
 const y=drag?.kind===kind?replayProjector(chart)?.yOf(level,'price'):geometry[kind];
 if(y==null||y<geometry.top+15||y>geometry.bottom-15)return null;
 const movable=kind!=='entry'||(ticket.pending&&frame.order?.type!=='market');
 const field=kind==='entry'?'price':kind;
 return <div key={kind} className={`bt-ticket-line ${kind} ${!active?'draft':''}`} style={{top:y}}>
 <div className="bt-price-ticket" role="group" aria-label={`${kind==='entry'?(ticket.pending?'Pending entry':'Entry'):kind==='stop'?'Stop loss':'Take profit'} price box`}>
 <button className="bt-ticket-drag" disabled={disabled||!movable||frame.position?.closing} title={movable?'Drag to set price':'Entry price'} aria-label={`Drag ${kind} price`} onPointerDown={e=>{if(!movable)return;pause();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setDrag({kind,price:level})}} onPointerMove={e=>{if(drag?.kind===kind)setDrag({kind,price:atPointer(e)})}} onPointerUp={e=>{if(drag?.kind!==kind)return;const value=atPointer(e);setDrag(null);amend(field,value)}} onPointerCancel={()=>setDrag(null)}>
 <b>{kind==='entry'?`${ticket.side==='buy'?'BUY':'SELL'} ${ticket.qty}`:kind==='stop'?'SL':'TP'}</b>
 <span>{level.toFixed(2)}</span><strong>{drag?.kind===kind?'…':kind==='entry'?(ticket.pending?'Pending':money(frame.unrealized)):active?money(ticket[kind+'_result']):'Drag to set'}</strong>
 </button><button disabled={disabled||frame.position?.closing} aria-label={kind==='entry'?(ticket.pending?'Cancel chart order':'Close chart position'):`Remove ${kind==='stop'?'stop loss':'take profit'}`} onClick={()=>kind==='entry'?send(ticket.pending?'cancel':'close'):amend(field,null)}>×</button>
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
