import { test, expect } from "@playwright/test";

test("one password unlocks the personal journal and Lock journal revokes access", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8112/");
  await expect(
    page.getByRole("heading", { name: "Your journal.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Google|Team/ })).toHaveCount(0);
  await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Unlock journal" }).click();
  await expect(page.getByRole("alert")).toContainText("did not unlock");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic password for browser tests only");
  await page.getByRole("button", { name: "Unlock journal" }).click();
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).getByRole("link"),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My journal", exact: true }).click();
  await page.getByRole("button", { name: "Lock journal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your journal.", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your journal.", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-personal-password.png",
    fullPage: true,
  });
});
