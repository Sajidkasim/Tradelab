import { describe, expect, it } from 'vitest';
import { createRadarSimulation, simulateRadarFrame, speedMultiplierAt } from './radarPhysics';

const sampleOrbs = [
  { x: 20, y: 30, vx: 42, vy: 18 },
  { x: 50, y: 30, vx: -42, vy: 18 },
  { x: 75, y: 70, vx: -28, vy: -35 },
  { x: 30, y: 75, vx: 34, vy: -26 },
];

describe('radarPhysics', () => {
  it('produces identical deterministic positions for the same elapsed timestamp', () => {
    const a = simulateRadarFrame(sampleOrbs, 2600, { trackMs: 4200, speedSurge: true });
    const b = simulateRadarFrame(sampleOrbs, 2600, { trackMs: 4200, speedSurge: true });
    expect(a.orbs.map(({ x, y }) => [x, y])).toEqual(b.orbs.map(({ x, y }) => [x, y]));
    expect(a.surging).toBe(true);
  });

  it('matches incremental simulation frames with one-shot simulation', () => {
    const sim = createRadarSimulation(sampleOrbs, { trackMs: 4200, speedSurge: false });
    let last;
    for (let t = 0; t <= 2400; t += 160) {
      last = sim.sample(t);
    }
    const direct = simulateRadarFrame(sampleOrbs, 2400, { trackMs: 4200, speedSurge: false });
    expect(last.orbs.map(({ x, y }) => [Number(x.toFixed(4)), Number(y.toFixed(4))])).toEqual(
      direct.orbs.map(({ x, y }) => [Number(x.toFixed(4)), Number(y.toFixed(4))]),
    );
  });

  it('keeps all orbs inside arena bounds and resolves head-on elastic collisions', () => {
    const headOn = [
      { x: 35, y: 50, vx: 60, vy: 0 },
      { x: 65, y: 50, vx: -60, vy: 0 },
    ];
    const afterBounce = simulateRadarFrame(headOn, 500, { trackMs: 4200, radius: 5.1 });
    // After colliding near x=50, orb 0 bounces left and orb 1 bounces right without overlapping
    expect(afterBounce.orbs[0].x).toBeLessThan(afterBounce.orbs[1].x);
    expect(Math.abs(afterBounce.orbs[1].x - afterBounce.orbs[0].x)).toBeGreaterThanOrEqual(9.5);

    const longRun = simulateRadarFrame(sampleOrbs, 4800, { trackMs: 4800, speedSurge: true });
    for (const orb of longRun.orbs) {
      expect(orb.x).toBeGreaterThanOrEqual(7.5);
      expect(orb.x).toBeLessThanOrEqual(92.5);
      expect(orb.y).toBeGreaterThanOrEqual(9.5);
      expect(orb.y).toBeLessThanOrEqual(90.5);
      expect(orb.trail.length).toBeGreaterThan(1);
    }
  });

  it('activates speed surge only during the middle window in Hard mode', () => {
    expect(speedMultiplierAt(400, 4800, true)).toBe(1);
    expect(speedMultiplierAt(2400, 4800, true)).toBeGreaterThan(1.35);
    expect(speedMultiplierAt(4500, 4800, true)).toBe(1);
    expect(speedMultiplierAt(2400, 4800, false)).toBe(1);
  });
});
