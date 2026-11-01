import { test, expect } from "@playwright/test";

for (const appearance of ["Modern"]) {
  test(`${appearance}: strategy lists live in the larger Lab settings window`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Manage trades", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit strategies & levels", exact: true })).toHaveCount(0);
    await page.getByRole("heading", { name: "Trades", exact: true }).click();
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page.locator(".workspace-menu").getByRole("button", { name: "Lab settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Lab settings", exact: true });
    await dialog.getByRole("button", { name: "Strategies & levels", exact: true }).click();
    await expect(dialog.getByLabel("Strategies", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Key levels / PDA", { exact: true })).toBeVisible();
    expect((await dialog.boundingBox()).width).toBeGreaterThanOrEqual(1000);
    await page.screenshot({ path: testInfo.outputPath(`${appearance}-strategy-settings.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Save strategies & levels", exact: true })).toBeVisible();
  });
}
