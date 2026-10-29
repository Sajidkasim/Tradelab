import { describe, it, expect } from "vitest";
import { matchesTest, testOptions, reviewIssues } from "./research";

describe("research collections and review hints", () => {
  it("keeps all and unassigned distinct and exposes an archived current test", () => {
    const trade = { study_id: "first" };
    expect(matchesTest(trade, "")).toBe(true);
    expect(matchesTest(trade, "unassigned")).toBe(false);
    expect(matchesTest({ study_id: "" }, "unassigned")).toBe(true);
    expect(matchesTest(trade, "other")).toBe(false);
    const studies = [{ id: "first", name: "Original test", archived: true }];
    expect(testOptions(studies, "").map((item) => item.value)).toEqual([""]);
    expect(
      testOptions(studies, "first", true).map((item) => item.value),
    ).toEqual(["", "unassigned", "first"]);
  });
  it("uses the server's specific review issues without inventing missing risk", () => {
    const issues = [{ field: "risk", label: "Original risk missing" }];
    expect(reviewIssues({ review_issues: issues })).toBe(issues);
    expect(
      reviewIssues({ setup_name: "Reversal", labels: { reviewed: true } }),
    ).toEqual([]);
  });
});
