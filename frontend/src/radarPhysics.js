/**
 * Deterministic 2D elastic physics engine for the Neural Radar cognitive drill.
 * Runs in normalized 0..100 arena coordinates so SVG vector trails and HTML orb
 * hit targets stay pixel-locked across desktop and mobile viewports.
 */

const STEP_MS = 16;
const TRAIL_STRIDE = 3; // sample every 48ms
const DEFAULT_BOUNDS = { minX: 7.5, maxX: 92.5, minY: 9.5, maxY: 90.5 };

export function speedMultiplierAt(elapsedMs, trackMs, speedSurge) {
  if (!speedSurge || trackMs <= 0) return 1;
  const ratio = elapsedMs / trackMs;
  if (ratio < 0.28 || ratio > 0.72) return 1;
  const phase = (ratio - 0.28) / 0.44;
  return 1 + 0.42 * Math.sin(Math.PI * phase);
}

function cloneInitial(initialOrbs, bounds) {
  return initialOrbs.map((orb) => ({
    x: Math.min(bounds.maxX, Math.max(bounds.minX, Number(orb.x) || 50)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, Number(orb.y) || 50)),
    vx: Number(orb.vx) || 0,
    vy: Number(orb.vy) || 0,
    lastHitMs: -9999,
    trail: [{ x: Number(orb.x) || 50, y: Number(orb.y) || 50 }],
  }));
}

function advanceStep(state, stepMs, currentTimeMs, trackMs, { speedSurge, radius, bounds, recordTrail, maxTrail }) {
  const mult = speedMultiplierAt(currentTimeMs, trackMs, speedSurge);
  const dt = (stepMs / 1000) * mult;
  const count = state.length;
  const minDist = radius * 2;
  const minDistSq = minDist * minDist;

  for (let i = 0; i < count; i += 1) {
    const o = state[i];
    o.x += o.vx * dt;
    o.y += o.vy * dt;

    if (o.x < bounds.minX) {
      o.x = bounds.minX + (bounds.minX - o.x);
      o.vx = Math.abs(o.vx);
    } else if (o.x > bounds.maxX) {
      o.x = bounds.maxX - (o.x - bounds.maxX);
      o.vx = -Math.abs(o.vx);
    }

    if (o.y < bounds.minY) {
      o.y = bounds.minY + (bounds.minY - o.y);
      o.vy = Math.abs(o.vy);
    } else if (o.y > bounds.maxY) {
      o.y = bounds.maxY - (o.y - bounds.maxY);
      o.vy = -Math.abs(o.vy);
    }
  }

  // Elastic orb-to-orb collision resolution with positional separation
  for (let i = 0; i < count; i += 1) {
    const a = state[i];
    for (let j = i + 1; j < count; j += 1) {
      const b = state[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq >= minDistSq) continue;

      let dist = Math.sqrt(distSq);
      let nx;
      let ny;
      if (dist < 1e-4) {
        nx = ((i + j) % 2 === 0 ? 1 : -1) * 0.7071;
        ny = 0.7071;
        dist = 1e-4;
      } else {
        nx = dx / dist;
        ny = dy / dist;
      }

      const overlap = (minDist - dist) * 0.52;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;

      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const relNormal = rvx * nx + rvy * ny;
      if (relNormal < 0) {
        a.vx += relNormal * nx;
        a.vy += relNormal * ny;
        b.vx -= relNormal * nx;
        b.vy -= relNormal * ny;
        a.lastHitMs = currentTimeMs;
        b.lastHitMs = currentTimeMs;
      }
    }
  }

  // Re-clamp cleanly inside arena after separation
  for (let i = 0; i < count; i += 1) {
    const o = state[i];
    if (o.x < bounds.minX) o.x = bounds.minX;
    else if (o.x > bounds.maxX) o.x = bounds.maxX;
    if (o.y < bounds.minY) o.y = bounds.minY;
    else if (o.y > bounds.maxY) o.y = bounds.maxY;

    if (recordTrail) {
      o.trail.push({ x: o.x, y: o.y });
      if (o.trail.length > maxTrail) o.trail.shift();
    }
  }
}

export function createRadarSimulation(
  initialOrbs,
  {
    trackMs = 4200,
    speedSurge = false,
    radius = 5.1,
    bounds = DEFAULT_BOUNDS,
    trailSteps = 7,
  } = {},
) {
  let simTime = 0;
  let stepIndex = 0;
  let state = cloneInitial(initialOrbs, bounds);

  function reset() {
    simTime = 0;
    stepIndex = 0;
    state = cloneInitial(initialOrbs, bounds);
  }

  function sample(elapsedTrackMs) {
    const targetMs = Math.max(0, Math.min(trackMs, Number(elapsedTrackMs) || 0));
    if (targetMs < simTime) {
      reset();
    }

    while (simTime + STEP_MS <= targetMs) {
      simTime += STEP_MS;
      stepIndex += 1;
      advanceStep(state, STEP_MS, simTime, trackMs, {
        speedSurge,
        radius,
        bounds,
        recordTrail: stepIndex % TRAIL_STRIDE === 0,
        maxTrail: trailSteps,
      });
    }

    const remainder = targetMs - simTime;
    const mult = speedMultiplierAt(targetMs, trackMs, speedSurge);
    const orbs = state.map((o) => {
      if (remainder <= 0.1) {
        return {
          x: o.x,
          y: o.y,
          trail: o.trail,
          collidedRecently: targetMs - o.lastHitMs >= 0 && targetMs - o.lastHitMs <= 220,
        };
      }
      const dt = (remainder / 1000) * mult;
      const x = Math.min(bounds.maxX, Math.max(bounds.minX, o.x + o.vx * dt));
      const y = Math.min(bounds.maxY, Math.max(bounds.minY, o.y + o.vy * dt));
      return {
        x,
        y,
        trail: [...o.trail, { x, y }].slice(-trailSteps),
        collidedRecently: targetMs - o.lastHitMs >= 0 && targetMs - o.lastHitMs <= 220,
      };
    });

    return {
      orbs,
      surging: mult > 1.08,
      speedMultiplier: mult,
      progress: trackMs > 0 ? targetMs / trackMs : 1,
    };
  }

  return { sample, reset };
}

export function simulateRadarFrame(initialOrbs, elapsedTrackMs, options = {}) {
  return createRadarSimulation(initialOrbs, options).sample(elapsedTrackMs);
}
