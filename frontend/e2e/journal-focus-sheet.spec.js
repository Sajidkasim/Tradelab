import { expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:8119';

test('Journal Focus Sheet reads all three sections clearly, edits live, and persists in light and dark modes', async ({ page }, info) => {
  await page.goto(`${origin}/journal`);

  const planText = 'Marked overnight high at 21,540 and London low at 21,390.\n\nOnly interested in a clean liquidity sweep followed by 1m displacement and fair value gap entry.';
  const duringText = 'NY open swept London low cleanly at 09:34. Waited for the 1m MSS and entered on the first pullback.\n\nHeld through minor mid-range consolidation without moving stops early. Scaled half at +2R and let the runner tag the overnight high.';
  const lessonText = 'Patience at the open paid off completely. Waiting for the level instead of reacting to the first 9:30 candle kept risk tight and headspace calm.';

  await page.getByRole('tab', { name: /Before the session/ }).click();
  await page.getByRole('textbox', { name: 'Before the session', exact: true }).fill(planText);

  await page.getByRole('tab', { name: /During the session/ }).click();
  await page.getByRole('textbox', { name: 'During the session', exact: true }).fill(duringText);

  await page.getByRole('tab', { name: /After the session/ }).click();
  await page.getByRole('textbox', { name: 'After the session', exact: true }).fill(lessonText);

  // Open full-day editorial reader
  await page.getByRole('button', { name: 'Read all', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /Journal focus view/ });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Marked overnight high at 21,540');
  await expect(sheet).toContainText('NY open swept London low cleanly at 09:34');
  await expect(sheet).toContainText('Patience at the open paid off completely');
  await expect(sheet).toContainText(/\d+ words/);
  await page.screenshot({ path: info.outputPath('journal-focus-read-light.png') });

  // Jump straight into writing mode for During the session, edit and save inside sheet
  await sheet.getByRole('button', { name: 'Edit', exact: true }).nth(1).click();
  const expandedBox = sheet.getByRole('textbox', { name: 'During the session (expanded)', exact: true });
  await expect(expandedBox).toBeVisible();
  await expandedBox.fill(`${duringText}\n\nAdded final execution note inside focus sheet.`);
  await page.screenshot({ path: info.outputPath('journal-focus-write-light.png') });
  await sheet.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(sheet.getByRole('status')).toContainText('Saved');

  // Escape closes cleanly and syncs text back to compact Journal editor
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'During the session', exact: true })).toContainText('Added final execution note inside focus sheet.');

  // Verify dark mode rendering + Expand trigger opens directly in Write mode
  await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Write', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: 'Save entry', exact: true })).toHaveCSS('background-color', 'rgb(200, 241, 105)');
  await page.screenshot({ path: info.outputPath('journal-focus-write-dark.png') });
  await sheet.getByRole('button', { name: 'Read', exact: true }).click();
  await sheet.getByRole('tab', { name: 'All sections', exact: true }).click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: info.outputPath('journal-focus-read-dark.png') });
  await sheet.getByRole('button', { name: 'Close expanded journal', exact: true }).click();
  await expect(sheet).toHaveCount(0);
});

test('Journal views and writing sections share the sliding highlight', async ({page}) => {
  await page.setViewportSize({width: 320, height: 760});
  await page.goto(`${origin}/journal`);
  const views = page.getByRole('tablist', {name: 'Journal views'});
  const viewHighlight = views.locator('.segment-indicator');
  const log = views.getByRole('tab', {name: 'Daily Log'});
  await log.click();
  await expect(log).toHaveAttribute('aria-selected', 'true');
  const logX = (await viewHighlight.boundingBox()).x;
  await expect(viewHighlight).toHaveCSS('transition-duration', '0.24s');
  await views.getByRole('tab', {name: 'Performance'}).click();
  await expect.poll(async () => (await viewHighlight.boundingBox()).x).toBeGreaterThan(logX);
  await log.click();

  const sections = page.getByRole('tablist', {name: 'Session writing sections'});
  const highlight = sections.locator('.segment-indicator');
  const beforeX = (await highlight.boundingBox()).x;
  await sections.getByRole('tab', {name: /After the session/}).click();
  await expect.poll(async () => (await highlight.boundingBox()).x).toBeGreaterThan(beforeX);
  await expect(page.getByRole('textbox', {name: 'After the session'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(viewHighlight).toHaveCSS('transition-duration', '0s');
  await expect(highlight).toHaveCSS('transition-duration', '0s');
});
