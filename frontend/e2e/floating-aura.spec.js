import {test, expect} from '@playwright/test';

test('Aura drags, opens without sending, and renders a requested review', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  let requests = 0;
  await page.route('**/api/journal/coach?*', async route => {
    requests += 1;
    expect(route.request().postDataJSON()).toEqual({question: 'How was my entry timing?'});
    expect(route.request().headers()['x-primus-csrf']).toBeTruthy();
    await route.fulfill({json:{markdown:'### Risk check\nReview your **entry timing**.'}});
  });
  await page.goto('http://127.0.0.1:8119/journal');
  const orb = page.getByRole('button', {name:'Aura - Trading Assistant'});
  await expect(orb).toBeVisible();
  const start = await orb.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(90, 125, {steps: 10});
  await page.mouse.up();
  expect((await orb.boundingBox()).y).toBeLessThan(start.y);
  await expect(orb).toHaveAttribute('aria-expanded', 'false');

  await orb.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', {name:'Aura - Trading Assistant'});
  await expect(panel).toBeVisible();
  expect(requests).toBe(0);
  const bounds = await panel.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await panel.getByLabel('Your question').fill('How was my entry timing?');
  await panel.getByRole('button', {name:'Send question'}).click();
  await expect(panel.getByRole('heading', {name:'Risk check'})).toBeVisible();
  await expect(panel.locator('strong')).toHaveText('entry timing');
  expect(requests).toBe(1);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(orb).toBeFocused();
});
