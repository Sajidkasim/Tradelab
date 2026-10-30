import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Radio } from 'lucide-react';

// Official TradingView embeds are isolated from the signed-in Primus origin.
// No API keys, private trades or journal text are sent to the provider.
export default function TradingViewWidget({kind,theme='light'}){
  const [loaded,setLoaded]=useState(false);
  const [active,setActive]=useState(false);
  const ref=useRef();
  const calendar=kind==='calendar';
  const link=calendar?'https://www.tradingview.com/economic-calendar/':'https://www.tradingview.com/news/';
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setActive(true);observer.disconnect()}},{rootMargin:'100px'});
    observer.observe(ref.current);return()=>observer.disconnect();
  },[]);
  const configuration=calendar?{colorTheme:theme,isTransparent:false,locale:'en',countryFilter:'us,gb,eu',importanceFilter:'0,1',width:'100%',height:480}:{feedMode:'all_symbols',displayMode:'regular',colorTheme:theme,isTransparent:false,locale:'en',width:'100%',height:480};
  const source=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;background:${theme==='dark'?'#152b21':'#fff'};color:${theme==='dark'?'#edf0e5':'#17271f'};font:12px Arial}a{color:${theme==='dark'?'#c0d89f':'#506c54'}}.tradingview-widget-container{height:100%}.tradingview-widget-container__widget{height:calc(100% - 28px)}.tradingview-widget-copyright{text-align:center;padding:5px}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="${link}" target="_blank" rel="noopener">${calendar?'Economic Calendar':'Market news'} by TradingView</a></div><script src="https://s3.tradingview.com/external-embedding/${calendar?'embed-widget-events.js':'embed-widget-timeline.js'}" async>${JSON.stringify(configuration)}</script></div></body></html>`;
  return <div className="pt-market-widget" ref={ref}>
    {!loaded&&<div className="pt-widget-loading"><Radio size={21}/><span>Opening the TradingView {calendar?'calendar':'news feed'}…</span></div>}
    {active&&<iframe title={calendar?'TradingView economic calendar':'TradingView market news'} srcDoc={source} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" loading="lazy" onLoad={()=>setLoaded(true)}/>}
    <a className="pt-widget-source" href={link} target="_blank" rel="noopener noreferrer">{calendar?'Open full economic calendar':'Read market news'} on TradingView <ArrowUpRight size={13}/></a>
  </div>;
}
