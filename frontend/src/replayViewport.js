// Compatibility seam for the pinned Vela native renderer (0.9.3).
// Its public time range rounds/clamps to complete candles; restoring that range
// repeatedly changes candle spacing. Preserve the exact logical viewport instead.
export function holdReplayViewport(chart, appended) {
 const native=chart.renderer?.renderer;
 const viewport=native?.coords?.getViewport?.();
 if(!viewport||typeof native.applyViewport!=='function')return ()=>{};
 const saved={...viewport,rightOffset:viewport.rightOffset-appended};
 return ()=>native.applyViewport(saved);
}

// Same pinned compatibility seam as the logical viewport: shared native drawing
// projector respects manual scales, log mode, inversion and separate study panes.
export function replayProjector(chart){return chart?.renderer?.renderer?.drawingProjector?.()??null}

// Pinned Vela 0.9.3 compatibility: public API has no unbounded-navigation option
// or arbitrary two-sided history insertion. Keep these seams isolated and tested.
export function captureReplayView(chart){
 const n=chart.renderer?.renderer,c=n?.coords;if(!c?.barCount)return null;
 return {spacing:c.getViewport().barSpacing,tail:c.rightEdgeLogical>=c.barCount-1,offset:c.getViewport().rightOffset,from:c.logicalToTime(c.xToLogical(0)),to:c.logicalToTime(c.xToLogical(c.width)),price:n.scene.panes.get('price')?.manualScale?{...n.scene.panes.get('price').manualScale}:null};
}
export function restoreReplayView(chart,saved){
 if(!saved)return;const n=chart.renderer.renderer,c=n.coords,left=c.timeToLogical(saved.from),right=c.timeToLogical(saved.to);
 if(Number.isFinite(left)&&Number.isFinite(right)&&right>left)n.applyViewport({barSpacing:saved.spacing??c.width/((right-left)*c.spacingScale),rightOffset:saved.tail?saved.offset:right-(c.barCount-1)});
 const price=n.scene.panes.get('price');if(price)price.manualScale=saved.price;
}
export function replaceReplayHistory(chart,bars){
 const core=chart.orchestrator;if(!core?.setBarSeries)throw Error('This Vela version does not support paged history.');
 const saved=captureReplayView(chart);if(saved)saved.tail=false;core.setBarSeries(bars,{preserveView:true});restoreReplayView(chart,saved);core.notifySessionsBars('backfill');
}
export function installFreeReplayNavigation(chart,host){
 const n=chart.renderer?.renderer;if(!n?.clampViewport)return ()=>{};
 const clamp=n.clampViewport,begin=n.beginPricePan;
 n.clampViewport=(spacing,offset)=>({barSpacing:Number.isFinite(spacing)&&spacing>0?spacing:8,rightOffset:Number.isFinite(offset)?offset:0});
 n.beginPricePan=function(y){const pane=this.paneNodeAtY(y);if(pane&&!pane.manualScale)pane.manualScale={...pane.scale};return begin.call(this,y)};
 const wheel=e=>{
  if(e.target!==host&&e.target.tagName!=='CANVAS')return;
  const r=host.getBoundingClientRect(),x=e.clientX-r.left;if(x>n.coords.width)return;
  e.preventDefault();e.stopImmediatePropagation();const v=n.coords.getViewport(),unit=e.deltaMode===1?16:e.deltaMode===2?host.clientHeight:1;
  if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY))n.applyViewport({...v,rightOffset:v.rightOffset+(e.shiftKey?e.deltaY:e.deltaX)*unit*.85/n.coords.pxPerBar()});
  else n.zoomTo(v.barSpacing*Math.exp(-Math.max(-500,Math.min(500,e.deltaY*unit))*.0024),n.coords.xToLogical(x),x);
 };
 const touches=new Map();let pinch=null;
 const down=e=>{if(e.pointerType!=='touch')return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===2){const [a,b]=[...touches.values()];const x=(a.x+b.x)/2-host.getBoundingClientRect().left;pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),spacing:n.coords.getViewport().barSpacing,x,logical:n.coords.xToLogical(x)}}};
 const move=e=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size!==2||!pinch)return;e.preventDefault();e.stopImmediatePropagation();const [a,b]=[...touches.values()];n.zoomTo(pinch.spacing*Math.pow(Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),.85),pinch.logical,pinch.x)};
 const up=e=>{touches.delete(e.pointerId);pinch=null};
 host.addEventListener('wheel',wheel,{capture:true,passive:false});host.addEventListener('pointerdown',down,true);host.addEventListener('pointermove',move,{capture:true,passive:false});host.addEventListener('pointerup',up,true);host.addEventListener('pointercancel',up,true);
 return ()=>{n.clampViewport=clamp;n.beginPricePan=begin;host.removeEventListener('wheel',wheel,true);host.removeEventListener('pointerdown',down,true);host.removeEventListener('pointermove',move,true);host.removeEventListener('pointerup',up,true);host.removeEventListener('pointercancel',up,true)};
}
