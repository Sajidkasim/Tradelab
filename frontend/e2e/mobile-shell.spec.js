import { expect, test } from "@playwright/test";

test("mobile shell serves install assets and keeps one Primax launcher on Mindset", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const origin = "http://127.0.0.1:8119";
  const manifest = await page.request.get(origin + "/manifest.json");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  expect((await page.request.get(origin + "/pwa/icon-180.png")).ok()).toBe(true);
  await page.goto(origin + "/mindset");
  const launcher = page.getByRole("button", { name: "Ask Primax" });
  await expect(launcher).toHaveCount(1);
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
  await launcher.click();
  await expect(page.getByRole("dialog", { name: "Primax", exact: true })).toBeVisible();
});
