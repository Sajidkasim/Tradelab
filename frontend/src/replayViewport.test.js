import {test,expect,vi} from 'vitest';
import {installFreeReplayNavigation,holdReplayViewport,replayProjector} from './replayViewport';
function setup({width=1200,scale=1,min=2,max=40}={}){
 const listeners=new Map(),host={addEventListener:vi.fn((name,cb)=>listeners.set(name,cb)),removeEventListener:vi.fn(),getBoundingClientRect:()=>({left:0}),clientHeight:600};
 const price={manualScale:{min:100,max:120}},viewport={barSpacing:8,rightOffset:-200};
 const projector={xOf:vi.fn(),yOf:vi.fn()};
 const native={coords:{width,spacingScale:scale,getViewport:()=>({...viewport}),pxPerBar:()=>viewport.barSpacing*scale,xToLogical:x=>x/(viewport.barSpacing*scale)},
  clampViewport:vi.fn((spacing,offset)=>({barSpacing:Math.max(min,Math.min(max,spacing)),rightOffset:Math.max(-10,Math.min(10,offset))})),
  beginPricePan:vi.fn(),paneNodeAtY:()=>price,drawingProjector:()=>projector,
  applyViewport:vi.fn(value=>Object.assign(viewport,native.clampViewport(value.barSpacing,value.rightOffset))),
  zoomTo:vi.fn(spacing=>native.applyViewport({...viewport,barSpacing:spacing})),
 };
 const chart={renderer:{renderer:native}},original=native.clampViewport,release=installFreeReplayNavigation(chart,host);
 return {native,chart,viewport,price,projector,original,release,host,listeners};
}
test('retains native zoom clamps while horizontal pan offsets remain free',()=>{
 const h=setup();
 expect(h.native.clampViewport(.00001,-100000)).toEqual({barSpacing:2,rightOffset:-100000});
 expect(h.native.clampViewport(100000,100000)).toEqual({barSpacing:40,rightOffset:100000});
 expect(h.native.clampViewport(NaN,NaN)).toEqual({barSpacing:8,rightOffset:0});
 expect(h.original).toHaveBeenCalledWith(.4,0);
 h.release();expect(h.native.clampViewport).toBe(h.original);
 expect(h.host.removeEventListener).toHaveBeenCalledTimes(5);
});
test('the projector never spans more than 3000 candle slots, including spacing multipliers',()=>{
 const h=setup({width:3000,scale:.5,min:.5});
 const spacing=h.native.clampViewport(.00001,-100000).barSpacing;
 expect(h.native.coords.width/(spacing*h.native.coords.spacingScale)).toBeLessThanOrEqual(3000);
 expect(replayProjector(h.chart)).toBe(h.projector); // Keep native candle geometry.
 h.release();
});
test('locked streaming retains exact spacing, pan and vertical scale as bars append',()=>{
 const h=setup(),before={...h.price.manualScale};
 const restore=holdReplayViewport(h.chart,3);
 h.viewport.rightOffset=6;h.viewport.barSpacing=20;restore();
 expect(h.viewport).toEqual({barSpacing:8,rightOffset:-203});
 expect(h.price.manualScale).toEqual(before);
 h.release();
});
test('wheel zoom and touch pinch obey the same limits; horizontal wheel only pans',()=>{
 const h=setup(),event={target:{tagName:'CANVAS'},clientX:600,deltaMode:0,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()};
 for(let i=0;i<20;i++)h.listeners.get('wheel')({...event,deltaY:10000,deltaX:0});
 expect(h.viewport.barSpacing).toBe(2);
 for(let i=0;i<20;i++)h.listeners.get('wheel')({...event,deltaY:-10000,deltaX:0});
 expect(h.viewport.barSpacing).toBe(40);
 const price={...h.price.manualScale},spacing=h.viewport.barSpacing;
 h.listeners.get('wheel')({...event,deltaX:100000,deltaY:0});
 expect(h.viewport.barSpacing).toBe(spacing);expect(h.price.manualScale).toEqual(price);
 h.listeners.get('pointerdown')({pointerType:'touch',pointerId:1,clientX:0,clientY:0});
 h.listeners.get('pointerdown')({pointerType:'touch',pointerId:2,clientX:100,clientY:0});
 h.listeners.get('pointermove')({...event,pointerId:2,clientX:.001,clientY:0});
 expect(h.viewport.barSpacing).toBe(2);
 h.listeners.get('pointermove')({...event,pointerId:2,clientX:100000,clientY:0});
 expect(h.viewport.barSpacing).toBe(40);expect(h.price.manualScale).toEqual(price);
 h.release();
});
