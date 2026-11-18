import {expect,test} from 'vitest';
import {chartFindings} from './chartVisionLocal';

test('reads all nearby confirmations and matches a lowercase high and low level with its timeframe', () => {
  const line = (text,x,y) => ({
    text, confidence:85, box:{x,y,width:.08,height:.01},
    words:text.split(' ').map((word,index)=>({text:word,box:{x:x+.015*index,y,width:.013,height:.01}})),
  });
  const readings = [
    line('mss and smt',.49,.64),
    line('high and low ahr',.62,.58),
    line('high and low 4hr',.621,.582),
    line('Upper Quadrant OB',.67,.27),
  ];
  const result = chartFindings({header:[],lines:readings},{
    markets:[], confirmations:['MSS','SMT'], levels:['High and Low'],
    entryTimeframes:[], levelTimeframes:['4H'],
  },{x:.43,y:.59});
  expect(result.filter(item=>item.kind==='confirmation').map(item=>item.value)).toEqual(['MSS','SMT']);
  expect(result).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:'key_level',value:'High and Low'}),
    expect.objectContaining({kind:'level_timeframe',value:'4H'}),
    expect.objectContaining({kind:'visible_level',value:'Upper Quadrant OB'}),
  ]));
});
