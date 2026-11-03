import {describe,it,expect,vi} from 'vitest';
import {indicatorVisible,intervalChoices,changePane,toggleIntervalSync,saveFavorite,renameFavorite,chooseFavorite,placeFavorite,visibilityController} from './replayPreferences';
describe('indicator interval policy',()=>{
 it('uses minute magnitude then daily/weekly/monthly ordering, including custom intervals',()=>{
  expect(['1','5','15','60','240','1D','1W','1M'].map(tf=>indicatorVisible(tf,'15'))).toEqual([true,true,true,false,false,false,false,false]);
  expect(indicatorVisible('90','120')).toBe(true);expect(indicatorVisible('1M','1W')).toBe(false);expect(indicatorVisible('1W','1M')).toBe(true);
  expect(indicatorVisible('1M')).toBe(true);expect(intervalChoices(['90','3','bad'])).toEqual(['1','3','5','15','30','60','90','240','1D','1W','1M']);
 });
 it('restores visibility when returning, respects eye toggles, and avoids recursive event loops',()=>{
  const controller=visibilityController(),h={id:'ema',visible:true,setVisible:vi.fn(v=>{h.visible=v;controller.remember(h.id,v);controller.apply(chart,'60')})},chart={indicators:()=>[h]};
  controller.rules.set(h.id,{maximum:'15',visible:true});controller.apply(chart,'60');expect(h.visible).toBe(false);controller.apply(chart,'5');expect(h.visible).toBe(true);
  controller.remember(h.id,false);controller.apply(chart,'5');expect(h.visible).toBe(false);expect(h.setVisible).toHaveBeenCalledTimes(3);
 });
});
describe('styled drawing favorites',()=>{
 for(const type of ['trendline','hline','hray','box'])it(`round trips ${type} style, text and properties without anchors or mutation`,()=>{
  const d={type,anchors:[{time:1,price:12}],style:{color:'#abc',width:3,lineStyle:'dashed'},text:{value:'My level',size:14},props:{extendRight:true}};
  const saved=saveFavorite([],d,' Favorite ','id'),restored=JSON.parse(JSON.stringify(saved));
  expect(restored[0].settings).toEqual({style:d.style,text:d.text,props:d.props});expect(restored[0].settings.anchors).toBeUndefined();
  const drawing={id:'new',type},chart={drawings:{all:()=>[drawing],toolDefaults:()=>({}),setToolDefaults:vi.fn(),setTool:vi.fn(),update:vi.fn()}};
  const pending=chooseFavorite(chart,restored[0]);placeFavorite(chart,'new',pending);expect(chart.drawings.update).toHaveBeenCalledWith('new',restored[0].settings);
  chart.drawings.update.mock.calls[0][1].text.value='Edited';pending.settings.style.width=8;expect(restored[0].settings.text.value).toBe('My level');expect(restored[0].settings.style.width).toBe(3);
  expect(renameFavorite(restored,'id','Renamed')[0].name).toBe('Renamed');expect(restored[0].name).toBe('Favorite');expect(restored.filter(x=>x.id!=='id')).toEqual([]);
 });
 it('rejects empty or duplicate names and missing favorites',()=>{
  const d={type:'box',style:{}};expect(()=>saveFavorite([],d,'  ','a')).toThrow();const list=saveFavorite([],d,'Box','a');expect(()=>saveFavorite(list,d,'BOX','b')).toThrow();expect(()=>renameFavorite(list,'missing','new')).toThrow();
 });
});
describe('split interval sync',()=>{
 const state={activeChartId:'secondary',syncIntervals:false,charts:[{id:'primary',symbol:'NQ',timeframe:'1',drawings:{line:1}},{id:'secondary',symbol:'ES',timeframe:'15',viewport:{x:4}}]};
 it('keeps independent charts when off and updates both atomically when on',()=>{
  const independent=changePane(state,'primary',{timeframe:'60'});expect(independent.charts[1]).toBe(state.charts[1]);
  const enabled=toggleIntervalSync(state);expect(enabled.charts.map(x=>x.timeframe)).toEqual(['15','15']);
  const changed=changePane(enabled,'primary',{timeframe:'240'});expect(changed.charts.map(x=>x.timeframe)).toEqual(['240','240']);expect(changed.charts[1].viewport).toBe(state.charts[1].viewport);expect(changed.charts[0].drawings).toBe(state.charts[0].drawings);
  const symbol=changePane(changed,'primary',{symbol:'ES'});expect(symbol.charts[1]).toBe(changed.charts[1]);
  const off=toggleIntervalSync(changed);expect(changePane(off,'secondary',{timeframe:'5'}).charts.map(x=>x.timeframe)).toEqual(['240','5']);
 });
});
