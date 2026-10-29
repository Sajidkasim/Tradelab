import { test, expect } from "@playwright/test";

test("Classic persists across pages and reloads, while Modern retains its dark preference", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "classic");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const nav = page.getByRole("navigation", { name: "Classic navigation" });
  await nav.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page).toHaveURL(/\/import$/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Classic", exact: true })).toHaveAttribute("aria-pressed", "true");
  await nav.getByRole("button", { name: "Lab settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await nav.getByRole("button", { name: "Results", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".explorer").getByRole("combobox", { name: "Entry timeframe", exact: true }).click();
  await page.getByRole("option", { name: "1m", exact: true }).click();
  await expect(page.locator(".explorer").getByRole("combobox", { name: "Entry timeframe", exact: true })).toHaveText("1m");
  await page.getByRole("button", { name: "Modern", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(nav).toHaveCount(0);
});

test("Classic is available before Google sign-in", async ({ page }) => {
  await page.goto("http://127.0.0.1:8114/");
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "classic");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Classic", exact: true })).toHaveAttribute("aria-pressed", "true");
});
