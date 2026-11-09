export function matrixFreshness(snapshot,now=Date.now()){
 const stamp=typeof snapshot?.asOf==='string'?Date.parse(snapshot.asOf):NaN;
 if(!Number.isFinite(stamp)||stamp>now+300000)return {label:'Update time unknown',stale:true,stamp:null};
 const age=Math.max(0,now-stamp);
 return {label:age>48*3600000?'Snapshot older than 48 hours':'Stored snapshot',stale:age>48*3600000,stamp};
}
