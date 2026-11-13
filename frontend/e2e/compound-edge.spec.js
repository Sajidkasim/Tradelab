import { test, expect } from "@playwright/test";

test("Aura shows private routine progress in the Mindset", async ({ page }) => {
  await page.route("**/api/compound-edge", (route) => route.fulfill({ json: {
    today: "2026-11-10",
    days: [
      { date: "2026-11-09", score: 0, pillars: [0, 0, 0], off: true },
      { date: "2026-11-10", score: 50, pillars: [30, 20, 0], off: false },
    ],
    pillars: [30, 20, 0], score: 50, current_streak: 1, longest_streak: 1, days_kept: 1,
    tasks: { checklist: true, mindset: true, journal: true, plan: false, replay: false, lab: false },
  } }));
  await page.setViewportSize({ width: 380, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://127.0.0.1:8119/mindset");
  const card = page.getByRole("button", { name: /Open Aura/ });
  await expect(card).toContainText("1 of 3 pillars done today");
  await expect(page.locator(".ce-drawer")).toHaveCount(0);
  await expect(card.locator(".ce-ring-progress")).toHaveCount(2);
  await expect(card.getByRole("img", { name: "Execute: 50% complete" })).toBeVisible();
  await card.focus();
  await card.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Aura" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Open checklist" })).toBeVisible();
  await expect(drawer.getByRole("tooltip")).toHaveCount(0);
  await drawer.getByRole("button", { name: /2026-11-09.*Rest day/ }).focus();
  await expect(drawer.getByRole("tooltip")).toContainText("Rest day");
  await drawer.getByRole("button", { name: "Close" }).focus();
  await expect(drawer.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(card).toBeFocused();
  await card.click();
  await drawer.getByRole("link", { name: "Open checklist" }).click();
  await expect(page.getByRole("heading", { name: "Pre-Session Checklist" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
