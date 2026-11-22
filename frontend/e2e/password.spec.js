import { test, expect } from "@playwright/test";

test("one password unlocks the personal journal and Lock lab revokes access", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8112/");
  await expect(
    page.getByRole("heading", { name: /A clearer view\s*of your edge\./ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Google|Team/ })).toHaveCount(0);
  await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(
    page.getByLabel("Password", { exact: true }),
  ).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(
    page.getByLabel("Password", { exact: true }),
  ).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("did not unlock");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic password for browser tests only");
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).getByRole("link"),
  ).toHaveCount(1);
  // The existing personal lab also receives the guide once after rollout.
  await expect(page.locator('.guided-tour')).toBeVisible();
  await page.getByRole('button', {name:'Skip guide', exact:true}).click();
  await page.reload();
  await expect(page.locator('.guided-tour')).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Results", exact: true }),
  ).toBeVisible();
  const notes = page.getByRole('dialog', {name:'What’s new in PrimusTrader', exact:true});
  await notes.getByRole('button', {name:'Got it', exact:true}).click();
  await expect(notes).not.toBeVisible();
  await page.getByRole("button", { name: "My lab", exact: true }).click();
  await page.getByRole("button", { name: "Lock lab", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /A clearer view\s*of your edge\./ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /A clearer view\s*of your edge\./ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/primuslab-personal-password.png",
    fullPage: true,
  });
});

test("Primus entrance stays usable on mobile and with either journal theme", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8112/");
  await expect(
    page.getByRole("link", { name: "Primus Trader home", exact: true }),
  ).toBeVisible();
  const openJournal = page.getByRole("button", { name: "Continue", exact: true });
  await expect(openJournal).toBeEnabled();
  await page.getByLabel("Password", { exact: true }).focus();
  await expect(
    page.getByLabel("Password", { exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: "test-results/primuslab-entrance-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(openJournal).toBeInViewport();
  await page.screenshot({
    path: "test-results/primuslab-entrance-laptop.png",
    fullPage: true,
  });
  await page.evaluate(() => localStorage.setItem("primus-theme", "dark"));
  await page.reload();
  await expect(openJournal).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(openJournal).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/primuslab-entrance-mobile.png",
    fullPage: true,
  });
});
