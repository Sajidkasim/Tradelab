import { test, expect } from "@playwright/test";

test.afterEach(async ({ page }) => {
  // These fixtures share one disposable journal with the workflow suite.
  if (!page.url().startsWith("http://127.0.0.1:8111")) return;
  const session = await (await page.request.get("/api/session")).json();
  const rows = await (await page.request.get("/api/trades")).json();
  for (const row of rows.filter((trade) => trade.notes === "Disposable scaling check")) {
    const response = await page.request.delete(`/api/trades/${row.id}`, {
      headers: { Origin: "http://127.0.0.1:8111", "X-Primus-CSRF": session.csrf },
    });
    expect(response.ok()).toBe(true);
  }
});

for (const appearance of ["modern-light", "modern-dark"]) {
  test(`${appearance}: readable layouts from small phones to wide desktops`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    const session = await (await page.request.get("/api/session")).json();
    const meta = await (await page.request.get("/api/metadata")).json();
    const inserted = await page.request.post("/api/trades", {
      headers: { Origin: "http://127.0.0.1:8111", "X-Primus-CSRF": session.csrf },
      data: { symbol: "NQ", direction: "long", account_id: meta.accounts[0].id, source: "backtest",
        strategy: "Scaling check: displacement at a previous weekly key level",
        labels: {}, confirmed: false, entry_time: "2026-08-02T09:30:00-04:00",
        exit_time: "2026-08-02T10:00:00-04:00", net_pnl: 1234.56, risk_amount: 400,
        notes: "Disposable scaling check" },
    });
    expect(inserted.ok()).toBe(true);
    await page.reload();
    if (appearance === "modern-dark") {
      await page.getByRole("button", { name: "My lab", exact: true }).click();
      await page.getByRole("button", { name: "Dark mode", exact: true }).click();
    }
    await expect(page.locator(".chart .main-svg").first()).toBeVisible();
    for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1024, 768], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const metrics = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const font = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        return { content: rect(".content").width, chart: rect(".chart").width,
          body: font("body"), input: font(".explorer select, .explorer .styled-select .picker-trigger"), caption: font(".stat small"),
          table: font(".trade-table"), header: rect(".site-header").width };
      });
      expect(metrics.content).toBeLessThanOrEqual(1440);
      expect(metrics.header).toBeLessThanOrEqual(width);
      expect(metrics.chart).toBeGreaterThanOrEqual(Math.min(width - 100, 250));
      expect(metrics.body).toBeGreaterThanOrEqual(13);
      expect(metrics.input).toBeGreaterThanOrEqual(width <= 700 ? 16 : 14);
      expect(metrics.caption).toBeGreaterThanOrEqual(11);
      expect(metrics.table).toBeGreaterThanOrEqual(12);
      if ([390, 1366, 1920].includes(width)) await page.screenshot({ path: testInfo.outputPath(`${appearance}-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Add trade", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByRole("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "My lab", exact: true }).click();
    await page.locator(".workspace-menu").getByRole("button", { name: "Lab settings", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.getByRole("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(failures).toEqual([]);
  });
}

for (const appearance of ["Modern"]) {
  test(`${appearance}: Google entrance fits phones and desktops`, async ({ page }) => {
    await page.goto("http://127.0.0.1:8114/");
    for (const width of [320, 390, 768, 1440, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
      expect(await page.locator(".login-shell").evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1200);
    }
  });
}
