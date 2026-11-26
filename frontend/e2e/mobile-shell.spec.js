import { expect, test } from "@playwright/test";

test("mobile shell serves install assets and keeps floating Primax bubble only on Journal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const origin = "http://127.0.0.1:8119";
  const manifest = await page.request.get(origin + "/manifest.json");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect((await page.request.get(origin + "/pwa/icon-180.png")).ok()).toBe(true);
  await page.goto(origin + "/mindset");
  await expect(page.getByRole("button", { name: "Ask Primax" })).toHaveCount(0);
  await expect(page.locator(".mw-aura-card")).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await toggle.click();
  const nav = page.getByRole("navigation", { name: "Primus navigation" });
  const links = await nav.getByRole("link").all();
  expect(await links[0].innerText()).toBe("Journal");
  expect(await links[1].innerText()).toContain("Strategy Lab");
  expect((await links[0].boundingBox()).height).toBeGreaterThanOrEqual(44);
  await links[0].press("Escape");
  await expect(toggle).toBeFocused();
  await page.goto(origin + "/journal");
  await expect(page.getByRole("button", { name: "Primax - Trading Assistant" })).toBeVisible();
});

test("home actions and mobile navigation keep readable contrast in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:8119/");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const cta = page.getByRole("link", { name: "Open Strategy Lab", exact: true });
    await expect(cta).toHaveCSS("color", "rgb(23, 52, 41)");
    await expect(cta).toHaveCSS("background-color", "rgb(244, 243, 235)");
    const resume = page.getByRole("region", { name: "Continue your work" }).getByRole("link", { name: "Review results" });
    await resume.hover();
    await expect(resume).toHaveCSS("color", "rgb(16, 35, 28)");
    await expect(resume).toHaveCSS("background-color", "rgb(200, 241, 105)");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Primus navigation" });
    for (const name of ["Journal", "Strategy Lab"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveCSS("color", "rgb(244, 243, 235)");
    }
    await page.getByRole("button", { name: "Close navigation" }).click();
  }
});

test("workspace navigation uses the same moving indicator on desktop and mobile", async ({ page }) => {
  await page.goto("http://127.0.0.1:8119/journal");
  const navigation = page.getByRole("navigation", { name: "Primus navigation" });
  const selection = navigation.locator(".sliding-selection-highlight");
  await expect(navigation.getByRole("link", { name: "Journal", exact: true })).toHaveAttribute("data-slide-selected", "");
  const journalX = (await selection.boundingBox()).x;
  await navigation.getByRole("link", { name: "Strategy Lab", exact: true }).click();
  await expect(navigation.getByRole("link", { name: "Strategy Lab", exact: true })).toHaveAttribute("data-slide-selected", "");
  await expect.poll(async () => (await selection.boundingBox()).x).toBeGreaterThan(journalX);

  await page.setViewportSize({ width: 320, height: 760 });
  const dock = page.getByRole("navigation", { name: "Mobile workspace bar" });
  await expect(dock.getByRole("link", { name: "Lab", exact: true })).toHaveAttribute("data-slide-selected", "");
  const marker = dock.locator(".sliding-selection-highlight");
  const labX = (await marker.boundingBox()).x;
  await dock.getByRole("link", { name: "Journal", exact: true }).click();
  await expect(dock.getByRole("link", { name: "Journal", exact: true })).toHaveAttribute("data-slide-selected", "");
  await expect.poll(async () => (await marker.boundingBox()).x).toBeLessThan(labX);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(marker).toHaveCSS("transition-duration", "0s");
});
