import { it, expect } from "vitest";
import {
  BRAIN_MESH,
  BRAIN_REGIONS,
  DEFAULT_BRAIN_VIEW,
  clampBrainView,
  projectPoint,
  rotatePoint,
} from "./brainModel";
import { searchGlossary } from "./learningContent";
it("brain transforms preserve length and keep projected regions inside phone and desktop scenes", () => {
  const point = [1, 0.4, -0.3],
    rotated = rotatePoint(point, { yaw: 1.2, pitch: 0.4 });
  expect(Math.hypot(...rotated)).toBeCloseTo(Math.hypot(...point), 10);
  for (const [w, h] of [
    [340, 280],
    [670, 390],
  ])
    for (const region of BRAIN_REGIONS) {
      const p = projectPoint(region.point, DEFAULT_BRAIN_VIEW, w, h);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(w);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(h);
    }
  expect(clampBrainView({ yaw: 2, pitch: 10 })).toEqual({
    yaw: 2,
    pitch: 0.65,
  });
  expect(clampBrainView({ yaw: 0, pitch: -10 }).pitch).toBe(-0.65);
});
it("procedural mesh stays finite at poles and has a bounded render budget", () => {
  expect(BRAIN_MESH.length).toBeLessThanOrEqual(3200);
  expect(
    BRAIN_MESH.every((f) => f.vertices.flat().every(Number.isFinite)),
  ).toBe(true);
});
it("glossary search accepts whitespace and case and searches explanations", () => {
  expect(searchGlossary("  SLIPPAGE  ").map((t) => t[0])).toContain("Slippage");
  expect(searchGlossary("original monetary risk").map((t) => t[0])).toContain(
    "R-multiple",
  );
  expect(searchGlossary("no-such-term")).toEqual([]);
});
