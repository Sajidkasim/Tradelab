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
  const aura = page.getByRole("region", { name: "Aura" });
  const execute = aura.getByRole("button", { name: /Execute/ });
  await expect(aura.getByRole("link", { name: "Open checklist" })).toBeVisible();
  await execute.click();
  await expect(execute).toHaveAttribute("aria-expanded", "true");
  await expect(aura.getByRole("link", { name: "Open plan check" })).toHaveAttribute("href", "/journal#journal-plan-followed");
  await expect(aura.getByRole("link", { name: "Open checklist" })).toHaveCount(0);
  const history = aura.getByRole("button", { name: "Open 365-day routine history" });
  await expect(history.locator(".ce-week-day")).toHaveCount(7);
  await history.click();
  const drawer = page.getByRole("dialog", { name: "Aura" });
  await expect(drawer.getByRole("region", { name: "Routine history" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(history).toBeFocused();
  await card.focus();
  await card.press("Enter");
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
  await expect(page.locator("#prep-checklist")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("daily habits save and appear in Aura", async ({ page }) => {
  await page.goto("http://127.0.0.1:8119/mindset");
  const tracker = page.getByRole("region", { name: "Daily Habit Tracker" });
  await tracker.getByRole("button", { name: "Edit habits" }).click();
  await tracker.getByRole("button", { name: "Add habit" }).click();
  await tracker.getByRole("textbox", { name: "Habit 1", exact: true }).fill("Review tomorrow’s plan");
  await tracker.getByRole("button", { name: "Done editing" }).click();
  await tracker.getByRole("checkbox", { name: "Review tomorrow’s plan" }).check();
  await expect(tracker.getByText("Habits saved")).toBeVisible();
  await page.getByRole("button", { name: /Open Aura/ }).click();
  const aura = page.getByRole("dialog", { name: "Aura" });
  await expect(aura.getByText("1 of 1 complete today")).toBeVisible();
  await aura.getByRole("button", { name: "Open habit tracker" }).click();
  await expect(tracker.getByRole("heading")).toBeFocused();
  await page.reload();
  await expect(tracker.getByRole("checkbox", { name: "Review tomorrow’s plan" })).toBeChecked();
});
