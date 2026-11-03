import {CHART_TIMEFRAMES,validTimeframe} from './backtestingBars';
// Calendar intervals follow the existing chart menu, after minute intervals.
export function intervalOrder(value){
 const calendar=CHART_TIMEFRAMES.filter(x=>!/^\d+$/.test(x.value)).findIndex(x=>x.value===value);
 return calendar>=0?1440*(calendar+1):validTimeframe(value)?Number(value):Infinity;
}
export function indicatorVisible(timeframe,maximum=''){
 return !maximum||!validTimeframe(maximum)||intervalOrder(timeframe)<=intervalOrder(maximum);
}
export function intervalChoices(shortcuts=[]){
 return [...new Set([...CHART_TIMEFRAMES.map(x=>x.value),...shortcuts])].filter(validTimeframe).sort((a,b)=>intervalOrder(a)-intervalOrder(b));
}
export function changePane(state,id,patch){
 return {...state,charts:state.charts.map(chart=>chart.id===id?{...chart,...patch}:state.syncIntervals&&patch.timeframe?{...chart,timeframe:patch.timeframe}:chart)};
}
export function toggleIntervalSync(state){
 const syncIntervals=!state.syncIntervals,timeframe=state.charts.find(x=>x.id===state.activeChartId)?.timeframe;
 return {...state,syncIntervals,charts:syncIntervals&&timeframe?state.charts.map(x=>({...x,timeframe})):state.charts};
}
export const favoriteTypes=['trendline','hline','hray','box','text','fibretracement','position'];
const copy=value=>JSON.parse(JSON.stringify(value));
export function favoriteSettings(drawing){
 const doc=drawing.serialize?.()||drawing;
 return copy({style:doc.style||{},...(doc.text?{text:doc.text}:{}),...(doc.props?{props:doc.props}:{})});
}
export function saveFavorite(list,drawing,name,id=crypto.randomUUID()){
 name=name.trim();if(!name)throw Error('Give your favorite a name.');
 if(!favoriteTypes.includes(drawing.type))throw Error('Choose a supported drawing.');
 if(list.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase()))throw Error('That name is already used.');
 return [...list.filter(x=>x.id!==id),{id,name:name.slice(0,40),type:drawing.type,settings:favoriteSettings(drawing)}];
}
export function renameFavorite(list,id,name){
 const item=list.find(x=>x.id===id);if(!item)throw Error('This favorite was removed.');
 return saveFavorite(list,{type:item.type,...copy(item.settings)},name,id);
}
export function chooseFavorite(chart,favorite){
 const settings=copy(favorite.settings);
 chart.drawings.setToolDefaults({...chart.drawings.toolDefaults(),[favorite.type]:settings});
 chart.drawings.setTool(favorite.type);
 return {type:favorite.type,settings};
}
export function placeFavorite(chart,id,pending){
 const drawing=chart.drawings.all().find(d=>d.id===id);
 if(drawing&&pending?.type===drawing.type)chart.drawings.update(id,copy(pending.settings));
}
// Preserve manual eye-toggle intent independently of interval-driven hiding.
export function visibilityController(){
 const rules=new Map();let applying=false;
 return {rules, remember(id,visible){if(!applying){const rule=rules.get(id)||{};rules.set(id,{...rule,visible})}},
 apply(chart,timeframe){if(applying)return;applying=true;try{for(const h of chart.indicators()){const rule=rules.get(h.id);if(!rule)continue;const visible=rule.visible!==false&&indicatorVisible(timeframe,rule.maximum);if(h.visible!==visible)h.setVisible(visible)}}finally{applying=false}}};
}
