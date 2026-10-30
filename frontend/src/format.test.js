import { describe, it, expect } from "vitest";
import { nyToUtc, belongsTo, labelsOnly, blankLabels } from "./format";

describe("New York trade times", () => {
  it("handles winter and summer offsets", () => {
    expect(nyToUtc("2026-01-15T09:30")).toBe("2026-01-15T14:30:00.000Z");
    expect(nyToUtc("2026-07-15T09:30")).toBe("2026-07-15T13:30:00.000Z");
  });
  it("rejects DST gaps and repeated wall clocks", () => {
    expect(() => nyToUtc("2026-03-08T02:30")).toThrow(/daylight saving/);
    expect(() => nyToUtc("2026-11-01T01:30")).toThrow(/daylight saving/);
  });
});
it("browses All without including demos in a testing scope", () => {
  expect(belongsTo({ source: "fxreplay" }, "Backtesting")).toBe(true);
  expect(belongsTo({ source: "manual" }, "Backtesting")).toBe(false);
  expect(belongsTo({ source: "manual" }, "Forward testing")).toBe(true);
  expect(belongsTo({ source: "demo" }, "Forward testing")).toBe(false);
});
it("keeps explicit confirmation review separate from submitted label fields", () => {
  expect(labelsOnly({ ...blankLabels(), reviewed: true })).not.toHaveProperty(
    "reviewed",
  );
});

describe('UK journal times', () => {
  it('converts GMT and BST entries to UTC', () => {
    expect(nyToUtc('2026-01-15T09:30', 'Europe/London')).toBe('2026-01-15T09:30:00.000Z');
    expect(nyToUtc('2026-07-15T09:30', 'Europe/London')).toBe('2026-07-15T08:30:00.000Z');
  });
  it('rejects UK spring gaps and autumn repeated clocks', () => {
    expect(() => nyToUtc('2026-03-29T01:30', 'Europe/London')).toThrow(/daylight saving/);
    expect(() => nyToUtc('2026-10-25T01:30', 'Europe/London')).toThrow(/daylight saving/);
  });
});
