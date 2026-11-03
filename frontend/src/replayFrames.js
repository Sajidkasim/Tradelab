// Lossless, lazy snapshots. Materialise only the frame currently being displayed.
export function replayFrames(value){
 if(value?.encoding!=='columns-v1')return value;
 return new Proxy({length:value.length},{get(target,key){
  if(key==='length')return target.length;
  if(typeof key!=='string'||!/^\d+$/.test(key))return target[key];
  const i=Number(key);if(i>=target.length)return undefined;
  const frame={cursor:value.start+i};
  for(const [name,numbers] of Object.entries(value.numbers))frame[name]=numbers[i];
  for(const [name,ids] of Object.entries(value.ids))frame[name]=value.states[name][ids[i]];
  return frame;
 }});
}
