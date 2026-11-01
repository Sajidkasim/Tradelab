import { test, expect } from '@playwright/test';
import { pick } from './select-helpers';

for (const theme of ['light', 'dark']) {
  test(`phone: key level and timeframe menus match in Modern ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    if (theme === 'dark') {
      await page.getByRole('button', { name: 'My lab', exact: true }).click();
      await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Add trade', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const level = dialog.getByRole('combobox', { name: 'Key level / PDA', exact: true });
    await level.click();
    await expect(page.getByRole('option', { name: 'FVG', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');
    await page.screenshot({ path: testInfo.outputPath(`phone-${theme}-levels.png`) });
    const levelStyle = await page.getByRole('option', { name: 'FVG', exact: true }).evaluate((el) => ({ font: getComputedStyle(el).font, color: getComputedStyle(el).color }));
    await page.getByRole('option', { name: 'FVG', exact: true }).click();
    await expect(level).toHaveText('FVG');
    const timeframe = dialog.getByRole('combobox', { name: 'Key level timeframe', exact: true });
    await timeframe.click();
    const row = page.getByRole('option', { name: '4H', exact: true });
    expect(await row.evaluate((el) => ({ font: getComputedStyle(el).font, color: getComputedStyle(el).color }))).toEqual(levelStyle);
    await row.click();
    await pick(dialog.getByRole('combobox', { name: 'Entry timeframe', exact: true }), '1m');
    await expect(dialog.getByRole('combobox', { name: 'Entry timeframe', exact: true })).toHaveText('1m');
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await level.click();
    await page.getByRole('listbox', { name: 'Key level / PDA', exact: true }).press('Escape');
    await expect(dialog).toBeVisible();
    await expect(level).toBeFocused();
  });
}
