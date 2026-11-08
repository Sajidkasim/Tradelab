import {MAX_VISIBLE_REPLAY_BARS} from './ReplayHistoryFeed';

export const MIN_REPLAY_BAR_SPACING=2.5;
const VIEW_EPSILON=1e-6;
function applyStableViewport(native,value){
 if(!Number.isFinite(value.barSpacing)||value.barSpacing<=0||!Number.isFinite(value.rightOffset))return;
 const current=native.coords.getViewport();
 if(!Number.isFinite(current.barSpacing)||!Number.isFinite(current.rightOffset)||Math.abs(current.barSpacing-value.barSpacing)>VIEW_EPSILON||Math.abs(current.rightOffset-value.rightOffset)>VIEW_EPSILON)native.applyViewport(value);
}

// Compatibility seam for the pinned Vela native renderer (0.9.3).
// Its public time range rounds/clamps to complete candles; restoring that range
// repeatedly changes candle spacing. Preserve the exact logical viewport instead.
export function holdReplayViewport(chart, appended) {
 const native=chart.renderer?.renderer;
 const viewport=native?.coords?.getViewport?.();
 if(!viewport||typeof native.applyViewport!=='function')return ()=>{};
 const saved={...viewport,rightOffset:viewport.rightOffset-appended};
 return ()=>applyStableViewport(native,saved);
}

// Same pinned compatibility seam as the logical viewport: shared native drawing
// projector respects manual scales, log mode, inversion and separate study panes.
export function replayProjector(chart){return chart?.renderer?.renderer?.drawingProjector?.()??null}

// Pinned Vela 0.9.3 compatibility: public API has no horizontal-pan-only option
// or arbitrary two-sided history insertion. Keep these seams isolated and tested.
export function captureReplayView(chart){
 const n=chart.renderer?.renderer,c=n?.coords;if(!c?.barCount)return null;
 const viewport=c.getViewport(),logicalFrom=c.xToLogical(0),logicalTo=c.xToLogical(c.width);
 if(![viewport.barSpacing,viewport.rightOffset,logicalFrom,logicalTo].every(Number.isFinite))return null;
 // Anchor to a real candle plus a fractional logical delta. Converting an
 // extrapolated timestamp back after a prepend can change its cadence/rounding.
 const index=Math.max(0,Math.min(c.barCount-1,Math.floor(logicalTo)));
 return {spacing:viewport.barSpacing,tail:logicalTo>=c.barCount-1-VIEW_EPSILON,offset:viewport.rightOffset,
  logicalFrom,logicalTo,anchorTime:c.logicalToTime(index),anchorDelta:logicalTo-index,
  from:c.logicalToTime(logicalFrom),to:c.logicalToTime(logicalTo),price:n.scene.panes.get('price')?.manualScale?{...n.scene.panes.get('price').manualScale}:null};
}
export function restoreReplayView(chart,saved){
 if(!saved)return;const n=chart.renderer.renderer,c=n.coords;
 const right=Number.isFinite(saved.anchorTime)&&Number.isFinite(saved.anchorDelta)?c.timeToLogical(saved.anchorTime)+saved.anchorDelta:c.timeToLogical(saved.to);
 const spacing=saved.spacing??c.width/((right-c.timeToLogical(saved.from))*c.spacingScale);
 const offset=saved.tail?saved.offset:right-(c.barCount-1);
 if(Number.isFinite(spacing)&&spacing>0&&Number.isFinite(offset))applyStableViewport(n,{barSpacing:spacing,rightOffset:offset});
 const price=n.scene.panes.get('price');if(price)price.manualScale=saved.price;
}
export function replaceReplayHistory(chart,bars){
 const core=chart.orchestrator;if(!core?.setBarSeries)throw Error('This Vela version does not support paged history.');
 const saved=captureReplayView(chart);if(saved)saved.tail=false;core.setBarSeries(bars,{preserveView:true});restoreReplayView(chart,saved);core.notifySessionsBars('backfill');
}
export function installFreeReplayNavigation(chart,host,onNavigate=()=>{}){
 const n=chart.renderer?.renderer;if(!n?.clampViewport)return ()=>{};
 const clamp=n.clampViewport,begin=n.beginPricePan;
 // Fixed floor + paging headroom: loading/evicting a page must not change zoom.
 // Retain Vela's upper bound, but not its bar-count-dependent lower bound.
 n.clampViewport=(spacing,offset)=>{
  const safeSpacing=Number.isFinite(spacing)&&spacing>0?spacing:8;
  const scale=n.coords.spacingScale||1;
  const floor=Math.max(MIN_REPLAY_BAR_SPACING/Math.min(1,scale),n.coords.width/(MAX_VISIBLE_REPLAY_BARS*scale));
  const maximum=clamp.call(n,Number.MAX_VALUE,0).barSpacing;
  return {barSpacing:Math.min(maximum,Math.max(safeSpacing,floor)),rightOffset:Number.isFinite(offset)?offset:0};
 };
 const zoom=(spacing,logical,x)=>{
  const current=n.coords.getViewport(),target=n.clampViewport(spacing,current.rightOffset).barSpacing;
  if(Math.abs(target-current.barSpacing)>VIEW_EPSILON)n.zoomTo(target,logical,x);
 };
 n.beginPricePan=function(y){const pane=this.paneNodeAtY(y);if(pane&&!pane.manualScale)pane.manualScale={...pane.scale};return begin.call(this,y)};
 const wheel=e=>{
  if(e.target!==host&&e.target.tagName!=='CANVAS')return;
  const r=host.getBoundingClientRect(),x=e.clientX-r.left;if(x>n.coords.width)return;
  onNavigate();e.preventDefault();e.stopImmediatePropagation();const v=n.coords.getViewport(),unit=e.deltaMode===1?16:e.deltaMode===2?host.clientHeight:1;
  if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY))n.applyViewport({...v,rightOffset:v.rightOffset+(e.shiftKey?e.deltaY:e.deltaX)*unit*.85/n.coords.pxPerBar()});
  else zoom(v.barSpacing*Math.exp(-Math.max(-120,Math.min(120,e.deltaY*unit))*.0012),n.coords.xToLogical(x),x);
 };
 const touches=new Map();let pinch=null;
 const down=e=>{if(e.pointerType!=='touch')return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===2){const [a,b]=[...touches.values()];const x=(a.x+b.x)/2-host.getBoundingClientRect().left;pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),spacing:n.coords.getViewport().barSpacing,x,logical:n.coords.xToLogical(x)}}};
 const move=e=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size!==2||!pinch)return;onNavigate();e.preventDefault();e.stopImmediatePropagation();const [a,b]=[...touches.values()];zoom(pinch.spacing*Math.pow(Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),.65),pinch.logical,pinch.x)};
 const up=e=>{touches.delete(e.pointerId);pinch=null};
 host.addEventListener('wheel',wheel,{capture:true,passive:false});host.addEventListener('pointerdown',down,true);host.addEventListener('pointermove',move,{capture:true,passive:false});host.addEventListener('pointerup',up,true);host.addEventListener('pointercancel',up,true);
 return ()=>{n.clampViewport=clamp;n.beginPricePan=begin;host.removeEventListener('wheel',wheel,true);host.removeEventListener('pointerdown',down,true);host.removeEventListener('pointermove',move,true);host.removeEventListener('pointerup',up,true);host.removeEventListener('pointercancel',up,true)};
}
