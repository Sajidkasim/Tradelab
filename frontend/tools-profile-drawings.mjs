// Disposable Vela benchmark. Run Vite on port 8140, then:
// node frontend/tools-profile-drawings.mjs
// Synthetic data only; no accounts, API writes or saved sessions.
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto('http://127.0.0.1:8140');
 const results=await page.evaluate(async()=>{
  const {Vela}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  const {installDrawingPerformance}=await import('/src/replayDrawingPerformance.js');
  document.body.innerHTML='<div id="profile" style="width:1400px;height:900px"></div>';
  const bars=Array.from({length:750},(_,i)=>({time:1600000000000+i*60000,open:100,high:102,low:99,close:101,volume:100}));
  const chart=new Vela(document.querySelector('#profile'),{symbol:'practice:NQ',timeframe:'1',live:true,animations:false});
  chart.data.registerProvider('practice',{getBars:async()=>bars,subscribe:()=>()=>{}});await chart.ready();
  const native=chart.renderer.renderer,layer=native.userDrawings;
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const rows=[];
  for(const optimized of [false,true]){
   const dispose=optimized?installDrawingPerformance(chart):()=>{};
   for(const count of [20,100,300]){
    const template={type:'trendline',paneId:'price',anchors:[{time:bars[100].time,price:100},{time:bars[700].time,price:101}],style:{lineColor:'#38c0fd',lineWidth:2,lineStyle:'solid'},locked:false,visible:true,zIndex:1};
    chart.drawings.fromJSON({version:1,drawings:Array.from({length:count},(_,i)=>({...template,id:`profile-${i}`}))});
    native.applyViewport({barSpacing:8,rightOffset:6});await frame();await frame();
    let paints=0;const original=layer.painter.paintAll;
    layer.painter.paintAll=function(...args){paints++;return original.apply(this,args)};
    const proj=native.drawingProjector(),x=proj.xOf(bars[690].time),y=proj.yOf(100+590/600,'price');
    let committed=0;const unsubscribe=chart.on('drawing:edited',()=>committed++);
    const start=performance.now();layer.pointerDown(x,y);
    for(let i=1;i<=240;i++)layer.pointerMove(x+i/12,y+i/8);
    layer.pointerUp(x+20,y+30);const handlerMs=performance.now()-start;
    await frame();await frame();
    rows.push({optimized,drawings:count,pointerEvents:240,paintCalls:paints,commits:committed,handlerMs:Number(handlerMs.toFixed(2)),throughPaintMs:Number((performance.now()-start).toFixed(2)),canvases:document.querySelectorAll('canvas').length});
    unsubscribe();layer.painter.paintAll=original;
   }
   dispose();
  }
  chart.destroy();return rows;
 });
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}
