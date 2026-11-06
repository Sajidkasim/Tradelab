import React, {useEffect, useRef, useState} from 'react';
import {api} from './api';
import {replayBucketOpen} from './replayHistoryCalendar';
import {replayProjector} from './replayViewport';

export default function ReplayDailyPivots({chart, sessionId, symbol, cursor, replayTime}){
  const canvas=useRef(null);
  const cursorRef=useRef(cursor);
  cursorRef.current=cursor;
  const day=replayBucketOpen(replayTime,'1D');
  const [result,setResult]=useState(null);
  const [failed,setFailed]=useState(false);

  useEffect(()=>{
    const controller=new AbortController();
    setFailed(false);
    api(`/backtesting/sessions/${sessionId}/daily-pivots?root=${symbol}&cursor=${cursorRef.current}`,
      {signal:controller.signal})
      .then(segments=>{if(!controller.signal.aborted)setResult({day,symbol,sessionId,segments})})
      .catch(()=>{if(!controller.signal.aborted)setFailed(true)});
    return ()=>controller.abort();
  },[day,sessionId,symbol]);

  const segments=result?.day===day&&result.symbol===symbol&&result.sessionId===sessionId?result.segments:null;
  useEffect(()=>{
    if(!segments?.length||!canvas.current)return;
    const node=canvas.current;
    const ctx=node.getContext('2d');
    let frame, previous;
    function draw(){
      frame=requestAnimationFrame(draw);
      const projector=replayProjector(chart);
      const pane=projector?.paneRect('price');
      if(!pane)return;
      const width=projector.width;
      const left=chart.renderer.renderer.plot?.offsetLeft||0;
      const dpr=window.devicePixelRatio||1;
      const geometry=segments.map(({start,end,levels})=>({
        start:projector.xOf(start),
        end:projector.xOf(end),
        lines:Object.entries(levels).map(([name,price])=>[name,price,projector.yOf(price,'price')-pane.top]),
      }));
      const signature=JSON.stringify([width,pane.height,pane.top,left,dpr,geometry]);
      if(signature===previous)return;
      previous=signature;
      node.style.left=`${left}px`;
      node.style.top=`${pane.top}px`;
      node.style.width=`${width}px`;
      node.style.height=`${pane.height}px`;
      node.width=Math.round(width*dpr);
      node.height=Math.round(pane.height*dpr);
      ctx.scale(dpr,dpr);
      ctx.strokeStyle=ctx.fillStyle='#fb8c00';
      ctx.font='11px system-ui';
      for(const period of geometry){
        const x1=Math.max(0,period.start), x2=Math.min(width,period.end);
        if(!Number.isFinite(x1)||!Number.isFinite(x2)||x2<=x1)continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1,0,x2-x1,pane.height);
        ctx.clip();
        for(const [name,price,y] of period.lines){
          if(!Number.isFinite(y)||y<0||y>pane.height)continue;
          ctx.beginPath();
          ctx.moveTo(x1,y);
          ctx.lineTo(x2,y);
          ctx.stroke();
          ctx.fillText(`${name} ${price.toFixed(2)}`,x1+4,y-4);
        }
        ctx.restore();
      }
    }
    draw();
    return ()=>cancelAnimationFrame(frame);
  },[chart,segments]);

  if(failed||segments?.length===0)return <div className="bt-history-note" role="status">Daily pivot history is unavailable for this session.</div>;
  return segments?.length?<canvas ref={canvas} className="bt-daily-pivots" aria-label="Traditional daily pivot levels"/>:null;
}
