import {buildMarketCache} from './backtestingBars';
self.onmessage=({data})=>{
 try{const markets=Object.fromEntries(Object.entries(data.markets).map(([root,market])=>[root,buildMarketCache(market)]));
 const buffers=Object.values(markets).flatMap(cache=>Object.values(cache).flatMap(c=>[c.ids.buffer,c.high.buffer,c.low.buffer,c.volume.buffer]));
 self.postMessage({markets},buffers);
 }catch(error){self.postMessage({error:error.message})}
};
