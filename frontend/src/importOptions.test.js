import { it, expect } from 'vitest';
import { sourceOptions, sourceForType, testingType, testingLabel } from './importOptions';
it('exposes only Backtesting and Live while retaining existing source identities', () => {
  expect(sourceOptions.map(item=>item.label)).toEqual(['Backtesting','Live']);
  for(const source of ['fxreplay','backtest','csv','excel']) {
    expect(sourceForType(testingType(source),source)).toBe(source);
  }
});
it('selects compatible import sources when the testing type changes', () => {
  expect(sourceForType('live','fxreplay')).toBe('csv');
  expect(sourceForType('backtesting','excel')).toBe('fxreplay');
  expect(testingLabel('backtest')).toBe('Backtesting');
  expect(testingLabel('manual')).toBe('Live');
});
