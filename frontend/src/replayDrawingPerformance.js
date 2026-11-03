import {recordTiming} from './replayTiming';

// Compatibility adapter for pinned Vela 0.9.3. Do not mutate node_modules.
// Vela already commits a drawing once on release; leave that model/undo path intact.
export function installDrawingPerformance(chart, schedule=requestAnimationFrame, cancel=cancelAnimationFrame) {
 const layer=chart.renderer?.renderer?.userDrawings;
 if(!layer?.render||!layer.pointerMove||!layer.pointerUp)return ()=>{};
 const originals={},releases=[];let paint=null,move=null,pending=null,disposed=false;
 const wrap=(name,fn)=>{originals[name]=layer[name];layer[name]=fn};
 const measured=(name,fn,args)=>{const start=performance.now();try{return fn.apply(layer,args)}finally{recordTiming(name,start)}};
 const paintNow=()=>{paint=null;if(!disposed)measured('drawings:paint',originals.render,[])};
 const flushMove=()=>{if(move!==null){cancel(move);move=null}if(pending){const args=pending;pending=null;measured('drawings:pointer',originals.pointerMove,args)}};
 wrap('render',()=>{if(paint===null&&!disposed)paint=schedule(paintNow)});
 wrap('pointerMove',(...args)=>{pending=args;if(move===null)move=schedule(()=>{move=null;flushMove()})});
 for(const name of ['pointerDown','pointerUp'])if(typeof layer[name]==='function')wrap(name,(...args)=>{flushMove();return measured('drawings:'+name,originals[name],args)});
 // A canceled gesture must never receive a queued move afterwards.
 if(layer.handleKey)wrap('handleKey',event=>{if(event.key==='Escape'){pending=null;if(move!==null)cancel(move);move=null}return originals.handleKey.call(layer,event)});
 // Avoid filtering/allocating the same drawing array several times per pointer event.
 if(layer.onScreen){let source,interval,shown;wrap('onScreen',()=>{const next=layer.deps.chartBarMs();if(source!==layer.drawings||interval!==next){source=layer.drawings;interval=next;shown=originals.onScreen.call(layer)}return shown})}
 // Data-driven tools use this range reader. Search sorted candles instead of scanning
 // the full loaded history for every fit/hover/paint. Plain lines never need it.
 const native=chart.renderer.renderer,range=native.barsInTimeRange;
 if(range){native.barsInTimeRange=function(from,to){const bars=this.bars,lo=Math.min(from,to),hi=Math.max(from,to);let a=0,b=bars.length;while(a<b){const m=(a+b)>>>1;if(bars[m].time<lo)a=m+1;else b=m}const first=a;b=bars.length;while(a<b){const m=(a+b)>>>1;if(bars[m].time<=hi)a=m+1;else b=m}return bars.slice(first,a)};releases.push(()=>{native.barsInTimeRange=range})}
 return ()=>{disposed=true;if(paint!==null)cancel(paint);if(move!==null)cancel(move);pending=null;for(const [name,fn] of Object.entries(originals))layer[name]=fn;releases.forEach(fn=>fn())};
}

// At most one request in flight and one replacement snapshot, never an unbounded
// chain retaining every intermediate drawing document during a slow connection.
export function latestLayoutWriter(write){
 let pending=null,running=null;
 const drain=async()=>{while(pending!==null){const value=pending;pending=null;await write(value)}};
 return value=>{pending=value;if(!running)running=drain().finally(()=>{running=null});return running};
}
