import {expect, test} from 'vitest';
import {readProjection, realisedR} from './journalProjection';

test('calculates planned R:R separately from the confirmed exit', () => {
  expect(readProjection({entry:100,stop:96,target:110})).toEqual({direction:'long',plannedRR:2.5,outcome:null});
  expect(readProjection({entry:100,stop:104,target:90,exit:98})).toEqual({direction:'short',plannedRR:2.5,outcome:'win'});
  expect(readProjection({entry:100,stop:96,target:110,exit:99})?.outcome).toBe('loss');
  expect(readProjection({entry:100,stop:96,target:110,exit:100})?.outcome).toBe('breakeven');
  expect(readProjection({entry:100,stop:104,target:110})).toBeNull();
});

test('realised R uses net P&L and original risk, including flat and loss results', () => {
  expect(realisedR(140,100)).toBe(1.4);
  expect(realisedR(-40,100)).toBe(-.4);
  expect(realisedR(0,100)).toBe(0);
  expect(realisedR(null,100)).toBeNull();
  expect(realisedR(140,0)).toBeNull();
});
