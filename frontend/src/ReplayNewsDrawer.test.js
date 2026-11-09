import React from 'react';
import {renderToString} from 'react-dom/server';
import {test,expect} from 'vitest';
import ReplayNewsDrawer from './ReplayNewsDrawer';
const render=props=>renderToString(React.createElement(ReplayNewsDrawer,props));
test.each([undefined,null,'invalid','2015-02-30'])('drawer mounts with invalid cursor date %s',replayDate=>{
 expect(()=>render({open:true,replayDate})).not.toThrow();
 expect(render({open:true,replayDate})).toContain('Waiting for replay date');
});
test('valid timestamp fallback retains historical year; hidden drawer mounts without a cursor',()=>{
 expect(render({open:true,replayTime:Date.parse('2015-05-15T12:30:00Z')})).toContain('2015');
 expect(()=>render({open:false})).not.toThrow();
 expect(()=>render({open:true,replayTime:Number.MAX_VALUE})).not.toThrow();
});
