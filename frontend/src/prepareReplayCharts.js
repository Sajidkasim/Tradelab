import {registerMarketCache} from './backtestingBars';
const jobs=new WeakMap();
export function prepareReplayCharts(sample){
 if(jobs.has(sample))return jobs.get(sample);
 const job=new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./replayBars.worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{worker.terminate();if(data.error){reject(Error(data.error));return}for(const [root,cache] of Object.entries(data.markets))registerMarketCache(sample.markets[root],cache);resolve(sample)};
  worker.onerror=()=>{worker.terminate();reject(Error('Unable to prepare replay candles. Please reopen this session.'))};
  worker.postMessage({markets:sample.markets});
 });jobs.set(sample,job);return job;
}
