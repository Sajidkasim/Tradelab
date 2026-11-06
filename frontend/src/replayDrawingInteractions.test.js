import {describe, expect, it, vi} from 'vitest';
import {installReplayDrawingInteractions, rectangleHandles, resizeRectangle} from './replayDrawingInteractions';

describe('replay drawing gestures',()=>{
  it('exposes eight handles and updates only the edge dimensions being dragged',()=>{
    expect(rectangleHandles({x1:0,y1:0,x2:20,y2:30})).toHaveLength(8);
    const points=[{time:10,price:30},{time:20,price:10}];
    const next={time:40,price:50};
    expect(resizeRectangle(points,4,next)).toEqual([{time:10,price:50},points[1]]);
    expect(resizeRectangle(points,5,next)).toEqual([points[0],{time:40,price:10}]);
    expect(resizeRectangle(points,2,next)).toEqual([{time:10,price:50},{time:40,price:10}]);
  });
  it('keeps axis presses and double clicks outside drawing hit testing',()=>{
    const claim=vi.fn(()=>true), open=vi.fn();
    const layer={interaction:{finishPlacing:()=>false,hitAt:()=>({id:'box'})},
      emit:vi.fn(), dblClick:(...args)=>layer.interaction.hitAt(...args), onScreen:()=>[]};
    const input={regionAt:(x,y)=>y===10?'separator':'data',deps:{
      drawingsClaim:claim,drawingsDblClick:(...args)=>layer.dblClick(...args),
      drawingsDeleteAt:()=>true,drawingsCursor:()=>true}};
    const renderer={userDrawings:layer,input,coords:{width:500,height:400}};
    const remove=installReplayDrawingInteractions({renderer:{renderer}},open);
    expect(input.deps.drawingsClaim(510,30)).toBeFalsy();
    expect(input.deps.drawingsDblClick(510,30)).toBeFalsy();
    expect(input.deps.drawingsClaim(490,10)).toBeFalsy();
    expect(claim).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(input.deps.drawingsDblClick(490,30)).toBe(true);
    expect(open).toHaveBeenCalledWith('box');
    remove();
    expect(input.deps.drawingsClaim).toBe(claim);
  });
});
