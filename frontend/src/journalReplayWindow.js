export const REPLAY_LIMIT=3000;
export const mergeReplayBars=(a,b)=>[...new Map([...a,...b].map(x=>[x.time,x])).values()].sort((a,b)=>a.time-b.time).slice(-REPLAY_LIMIT);
// Only completed minute bars are shown. Markers retain their original execution timestamp.
export const reachedExecutions=(events,time)=>(events||[]).filter(e=>Date.parse(e.time)<=time);
export const advanceWindow=(active,pending,count)=>({active:mergeReplayBars(active,pending.slice(0,count)),pending:pending.slice(count)});
