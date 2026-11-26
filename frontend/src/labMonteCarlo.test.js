import { describe, expect, it } from "vitest";
import { mcRequestBody, niceTicks, VERDICTS } from "./LabMonteCarlo";

describe("LabMonteCarlo helpers", () => {
  it("builds single-source Monte Carlo request payloads without pooling", () => {
    const body = mcRequestBody(
      { scope: "All", strategy: "ORB", direction: "long" },
      "Forward testing",
      250,
      12.5,
      "block",
    );
    expect(body).toEqual({
      filters: { scope: "Forward testing", sample: "Forward testing", strategy: "ORB", direction: "long" },
      horizon: 250,
      drawdown_r: 12.5,
      method: "block",
    });
  });

  it("computes clean monotonic Y-axis ticks across negative and positive ranges", () => {
    const ticks = niceTicks(-12, 34, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks).toContain(0);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
  });

  it("defines copy and tones for every backend verdict state", () => {
    for (const key of ["strong", "likely", "unproven", "luck", "none", "negative", "insufficient"]) {
      expect(VERDICTS[key]).toBeTruthy();
      expect(VERDICTS[key].title).toBeTruthy();
      expect(VERDICTS[key].tone).toBeTruthy();
    }
  });
});
