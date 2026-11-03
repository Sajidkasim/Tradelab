import {it,expect} from 'vitest';
import {SESSION_DEFAULTS,sessionOptions,sessionRanges,sessionWall} from './replaySessionRanges';
const bar=(stamp,high=110,low=90)=>({time:Date.parse(stamp),high,low,volume:10});
it('uses the requested defaults and clamps lookback',()=>{
 expect(SESSION_DEFAULTS.zone).toBe('America/New_York');expect(sessionOptions().days).toBe(5);
 expect(sessionOptions({days:300}).days).toBe(30);
 expect(SESSION_DEFAULTS.sessions.map(s=>[s.name,s.start,s.end])).toEqual([['Asia','20:00','02:00'],['London','02:00','07:00'],['NY AM','07:00','17:00']]);
});
it('joins overnight Asia across midnight, excludes its closing boundary and hides future prices',()=>{
 const bars=[bar('2023-01-10T01:00:00Z'),bar('2023-01-10T06:59:00Z',120,80),bar('2023-01-10T07:00:00Z',130,70),bar('2023-01-10T07:01:00Z',999,1)];
 const result=sessionRanges(bars,sessionOptions(),Date.parse('2023-01-10T07:00:00Z'));
 expect(result.ranges[0]).toMatchObject({name:'Asia',day:'2023-01-10',high:120,low:80,volume:20,bars:2});
 expect(result.ranges[1]).toMatchObject({name:'London',high:130,low:70,volume:10});
});
it('uses DST-aware New York time in winter and summer and through fallback',()=>{
 expect(sessionWall(Date.parse('2023-01-10T01:00:00Z'),'America/New_York')).toEqual({day:'2023-01-09',minute:1200});
 expect(sessionWall(Date.parse('2023-07-10T00:00:00Z'),'America/New_York')).toEqual({day:'2023-07-09',minute:1200});
 const bars=[bar('2023-11-05T05:30:00Z'),bar('2023-11-05T06:30:00Z')];
 expect(sessionRanges(bars,sessionOptions(),Infinity).ranges[0].bars).toBe(2);
});
it('keeps only configured recent trading dates and honors disabled sessions',()=>{
 const bars=['03','06','07','08','09','10'].map(day=>bar(`2023-01-${day}T15:00:00Z`));
 const options=sessionOptions({days:2});expect(sessionRanges(bars,options,Infinity).ranges.map(g=>g.day)).toEqual(['2023-01-09','2023-01-10']);
 options.sessions[2].enabled=false;expect(sessionRanges(bars,options,Infinity).ranges).toEqual([]);
});
