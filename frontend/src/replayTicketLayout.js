// Screen Y grows downwards. Move overlapping labels away from entry without
// moving the actual price line or changing the order's financial levels.
export function ticketLabelOffset(kind,side,entryY,lineY){
 if(kind==='entry'||Math.abs(lineY-entryY)>=48)return 0;
 const profitDirection=side==='sell'?1:-1;
 return entryY+(kind==='target'?profitDirection:-profitDirection)*52-lineY;
}
