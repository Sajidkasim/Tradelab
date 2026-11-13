import { test, expect } from "@playwright/test";

test("Compound Edge shows private routine progress in the workspace", async ({ page }) => {
  await page.route("**/api/compound-edge", (route) => route.fulfill({ json: {
    today: "2026-11-10",
    days: [
      { date: "2026-11-09", score: 0, pillars: [0, 0, 0], off: true },
      { date: "2026-11-10", score: 50, pillars: [30, 20, 0], off: false },
    ],
    pillars: [30, 20, 0], score: 50, current_streak: 1, longest_streak: 1, days_kept: 1,
    tasks: { checklist: true, mindset: true, journal: true, plan: false, replay: false, lab: false },
  } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const card = page.getByRole("region", { name: "Compound Edge" });
  await expect(card.getByText("1 of 3 pillars done today")).toBeVisible();
  await card.getByRole("button", { name: "Prepare, 30 of 30" }).click();
  await expect(card.getByText("✓ Pre-session checklist")).toBeVisible();
  await card.getByRole("button", { name: /2026-11-09.*Rest day/ }).click();
  await expect(card.getByRole("status")).toContainText("Rest day");
  await expect(card.getByRole("img", { name: /routine consistency/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
