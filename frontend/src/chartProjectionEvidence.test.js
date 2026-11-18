import {expect,test} from 'vitest';
import {fitChartPriceAxis,firstBoundaryTouch} from './chartProjectionEvidence';

test('reads a linear axis and rejects stray quotes',()=>{
  const at=fitChartPriceAxis([{y:.1,price:110},{y:.2,price:100},{y:.3,price:90},{y:.4,price:80},{y:.25,price:180}]);
  expect(at(.35)).toBeCloseTo(85);
  expect(fitChartPriceAxis([{y:.2,price:100},{y:.3,price:95}])).toBeNull();
});

test('keeps nearby competing touches ambiguous',()=>{
  expect(firstBoundaryTouch({target:25,stop:42})).toBe('target');
  expect(firstBoundaryTouch({target:60,stop:25})).toBe('stop');
  expect(firstBoundaryTouch({target:25,stop:26})).toBe('ambiguous');
  expect(firstBoundaryTouch({target:null,stop:null})).toBeNull();
});
