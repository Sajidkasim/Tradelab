import React,{useRef,useState,useEffect} from 'react';
export const toolNames={trendline:'Line',hline:'Horizontal line',hray:'Horizontal ray',box:'Rectangle',fibretracement:'Fibonacci',text:'Text',position:'Long / short position'};
const toolIcons = {
  hline: <path d="M3 12h18"/>,
  hray: <><circle cx="5" cy="12" r="2"/><path d="M7 12h14"/></>,
  trendline: <><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="m6.5 17.5 11-11"/></>,
  box: <rect x="4" y="5" width="16" height="14" rx="1"/>,
  fibretracement: <><path d="M4 5h16M4 10h16M4 15h16M4 20h16"/><path d="m5 20 14-15" strokeDasharray="2 3"/></>,
  text: <path d="M5 6V4h14v2M12 4v16m-3 0h6"/>,
  position: <path d="M4 12h16M8 8l4-4 4 4M8 16l4 4 4-4"/>,
};

export function clampBar(point,width,height){return {x:Math.max(0,Math.min(point.x,Math.max(0,width-160))),y:Math.max(0,Math.min(point.y,Math.max(0,height-44)))}}
export default function DrawingFavoritesBar({chart,position,onPosition}){
 const [tools,setTools]=useState(()=>chart.drawings.favorites()),[point,setPoint]=useState(position||{x:70,y:70});const ref=useRef(),drag=useRef();
 useEffect(()=>chart.on('drawing:favorites',()=>setTools(chart.drawings.favorites())),[chart]);
 useEffect(()=>{const fit=()=>setPoint(p=>clampBar(p,ref.current?.parentElement.clientWidth||800,ref.current?.parentElement.clientHeight||600));window.addEventListener('resize',fit);fit();return()=>window.removeEventListener('resize',fit)},[]);
 if(!tools.length)return null;
 return <div ref={ref} className="bt-floating-favorites" role="toolbar" aria-label="Favorite drawing tools" style={{left:point.x,top:point.y}}><button aria-label="Move favorites bar" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX-point.x,y:e.clientY-point.y}}} onPointerMove={e=>{if(drag.current){const parent=ref.current.parentElement;setPoint(clampBar({x:e.clientX-drag.current.x,y:e.clientY-drag.current.y},parent.clientWidth,parent.clientHeight))}}} onPointerUp={()=>{drag.current=null;onPosition(point)}} onPointerCancel={()=>{drag.current=null}} onKeyDown={e=>{const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];if(delta){e.preventDefault();const p=clampBar({x:point.x+delta[0],y:point.y+delta[1]},ref.current.parentElement.clientWidth,ref.current.parentElement.clientHeight);setPoint(p);onPosition(p)}}}>⠿</button>{tools.filter(t=>toolNames[t]).map(t=><button key={t} className="bt-favorite-icon" title={toolNames[t]} aria-label={toolNames[t]} onClick={()=>chart.drawings.setTool(t)}><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{toolIcons[t]}</svg></button>)}</div>;
}
