// Chart-data aggregation only. Trade P&L and performance remain in the Python core.
// UTC buckets retain gaps: never invent prices or volume for missing minutes.
export const CHART_TIMEFRAMES = [
  {value: '1', label: '1m'},
  {value: '5', label: '5m'}, {value: '15', label: '15m'},
  {value: '30', label: '30m'}, {value: '60', label: '1h'},
  {value: '240', label: '4h'}, {value:'1D',label:'Daily'}, {value:'1W',label:'Weekly'}, {value:'1M',label:'Monthly'},
];

export function timeframeLabel(value){
 if(['1D','1W','1M'].includes(value))return value;
 const minutes=Number(value);return minutes%60===0?`${minutes/60}h`:`${minutes}m`;
}
export function validTimeframe(value){return ['1D','1W','1M'].includes(value)||/^\d+$/.test(String(value))&&Number(value)>=1&&Number(value)<=720}
export function savedTimeframes(raw){
 try{const values=JSON.parse(raw);if(!Array.isArray(values))throw Error();
 const valid=[...new Set(values.filter(v=>typeof v==='string'&&validTimeframe(v)).map(v=>(['1D','1W','1M'].includes(v)?v:String(Number(v)))))].slice(0,10);
 return valid.length?valid:CHART_TIMEFRAMES.map(x=>x.value);
 }catch{return CHART_TIMEFRAMES.map(x=>x.value)}
}

export function aggregateMinuteBars(bars, timeframe) {
  if (!validTimeframe(timeframe)) throw new Error('Unsupported sample timeframe');
  const interval = Number(timeframe) * 60000;
  const result = [];
  let previous = -Infinity;
  for (const bar of bars) {
    if (!Number.isFinite(bar.time) || bar.time <= previous) throw new Error('Candle times must be unique and increasing');
    previous = bar.time;
    let time;
    if(['1D','1W','1M'].includes(timeframe)){
      const date=new Date(bar.time);date.setUTCHours(0,0,0,0);
      if(timeframe==='1W')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
      if(timeframe==='1M')date.setUTCDate(1);
      time=date.getTime();
    }else time=Math.floor(bar.time/interval)*interval;
    const last = result.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume ?? 0;
    } else result.push({time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0});
  }
  return result;
}

export function chartHistory(market,replayTime,timeframe){
 const reached=market.bars.filter(b=>b.time<=replayTime);
 const earlier=['1D','1W','1M'].includes(timeframe)?(market.history||[]):(market.context||[]);
 return aggregateMinuteBars([...earlier,...reached],timeframe);
}
