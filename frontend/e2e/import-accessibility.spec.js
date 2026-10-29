import { test, expect } from "@playwright/test";

const csv = (count) => 'id,dateStart,dateEnd,pair,rPnL,side,status\n' + Array.from({ length: count }, (_, i) => `reachable-import-${i},2013-01-25 14:30:00,2013-01-25 14:40:00,CME_MINI:NQ1,100,buy,closed`).join('\n');

test('large previews keep import reachable, paginate, and safely skip duplicates in both appearances', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/import');
  await expect(page.getByRole('heading', { name: 'Import trades', exact: true })).toBeVisible();
  const before = new Set((await (await page.request.get('/api/trades')).json()).map((row) => row.id));
  const session = await (await page.request.get('/api/session')).json();
  async function preview(count) {
    await page.getByLabel('Choose a trade export').setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(count)) });
    await page.getByRole('button', { name: 'Preview trades', exact: true }).click();
    await expect(page.locator('.import-action-bar')).toBeVisible();
  }
  async function reachable() {
    const bounds = await page.locator('.import-action-bar > button').boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  try {
    await preview(45);
    await expect(page.locator('.preview-card tbody tr')).toHaveCount(20);
    await expect(page.locator('.import-action-bar')).toContainText('45 new trades');
    await reachable();
    await page.getByRole('navigation', { name: 'Preview pages' }).getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Preview pages' })).toContainText('21–40');
    for (const appearance of ['Modern', 'Modern dark', 'Classic']) {
      await page.getByRole('button', { name: appearance === 'Modern dark' ? 'Modern' : appearance, exact: true }).click();
      if (appearance === 'Modern dark') {
        await page.getByRole('button', { name: 'My journal', exact: true }).click();
        await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
      }
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await reachable();
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await reachable();
        await expect(page.locator('.preview-card tbody td').first()).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`${appearance}-${width}-import.png`) });
      }
    }
    await expect(page.getByRole('navigation', { name: 'Classic navigation' }).getByRole('button', { name: 'Trades', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Import 45 trades', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm import', exact: true }).click();
    await expect(page.getByRole('heading', { name: '45 trades added', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Import another file', exact: true }).click();
    await preview(45);
    await expect(page.locator('.import-action-bar')).toContainText('Nothing new to import');
    await expect(page.getByRole('button', { name: 'Import 0 trades', exact: true })).toBeDisabled();
    await preview(46);
    await expect(page.locator('.import-action-bar')).toContainText('1 new trades · 45 duplicates skipped');
    await page.getByRole('button', { name: 'Import 1 trades', exact: true }).click();
    await page.getByRole('button', { name: 'Back to preview', exact: true }).click();
    expect((await (await page.request.get('/api/trades')).json()).length).toBe(before.size + 45);
    expect(errors).toEqual([]);
  } finally {
    const rows = await (await page.request.get('/api/trades')).json();
    for (const row of rows.filter((item) => !before.has(item.id))) {
      const response = await page.request.delete(`/api/trades/${row.id}`, { headers: { Origin: 'http://127.0.0.1:8111', 'X-Primus-CSRF': session.csrf } });
      expect(response.ok()).toBe(true);
    }
  }
});
