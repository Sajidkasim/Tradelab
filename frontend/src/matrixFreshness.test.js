import {expect,it} from 'vitest';
import {matrixFreshness} from './matrixFreshness';
it('distinguishes fresh cached snapshots from stale and invalid update times',()=>{
 const now=Date.parse('2026-11-09T12:00:00Z');
 expect(matrixFreshness({asOf:'2026-11-09T10:00:00Z'},now).label).toBe('Stored snapshot');
 expect(matrixFreshness({asOf:'2026-11-05T10:00:00Z'},now).stale).toBe(true);
 for(const asOf of [undefined,'bad','2027-01-01'])expect(matrixFreshness({asOf},now).label).toBe('Update time unknown');
});
