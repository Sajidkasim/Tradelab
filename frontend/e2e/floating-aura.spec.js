import {test, expect} from '@playwright/test';

test('Primax stays in the corner, opens without sending, and renders a requested review', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  let requests = 0;
  await page.route('**/api/journal/coach?*', async route => {
    requests += 1;
    expect(route.request().postDataJSON()).toEqual({question: 'How was my entry timing?', history: []});
    expect(route.request().headers()['x-primus-csrf']).toBeTruthy();
    await route.fulfill({json:{markdown:'### Risk check\nReview your **entry timing**.'}});
  });
  await page.goto('http://127.0.0.1:8119/journal');
  const orb = page.getByRole('button', {name:'Primax - Trading Assistant'});
  await expect(orb).toBeVisible();
  const start = await orb.boundingBox();
  expect(390 - start.x - start.width).toBeCloseTo(20);
  expect(844 - start.y - start.height).toBeCloseTo(20);
  const no = page.getByRole('group', {name:'Did you trade today?'}).getByRole('button', {name:'No'});
  await no.evaluate((button, bottom) => {
    const {top, height} = button.getBoundingClientRect();
    window.scrollBy(0, top + height / 2 - bottom);
  }, start.y + start.height / 2);
  expect(await orb.boundingBox()).toEqual(start);
  await no.click();
  await expect(no).toHaveAttribute('aria-pressed','true');
  await expect(orb).toHaveAttribute('aria-expanded', 'false');

  await orb.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('region', {name:'Primax',exact:true});
  await expect(panel).toBeVisible();
  await expect(orb).toBeHidden();
  await expect(panel.getByRole('group',{name:'Suggested questions'}).getByRole('button')).toHaveCount(3);
  const privacy = panel.getByRole('button',{name:'Journal privacy information'});
  await expect(panel.getByRole('tooltip')).toBeHidden();
  await privacy.click();
  await expect(panel.getByRole('tooltip')).toContainText('Cloudflare');
  expect(requests).toBe(0);
  const bounds = await panel.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await panel.getByLabel('Your question').fill('How was my entry timing?');
  await panel.getByRole('button', {name:'Send question'}).click();
  await expect(panel.getByRole('heading', {name:'Risk check'})).toBeVisible();
  await expect(panel.getByLabel('Primax',{exact:true}).locator('strong')).toHaveText('entry timing');
  expect(requests).toBe(1);
  await panel.getByLabel('Your question').press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(orb).toBeFocused();
});

test('Journal sidebar and writing controls use the updated layout on desktop and phone', async ({page}) => {
  await page.goto('http://127.0.0.1:8119/journal');
  const sidebar = page.getByRole('complementary', {name:'Journal calendar and history'});
  await expect(sidebar.getByRole('button', {name:'Today’s entry'})).toHaveCSS('border-top-width','0px');
  await sidebar.getByText('Rules', {exact:true}).click();
  await expect(sidebar.getByRole('textbox', {name:'Your personal trading rules'})).toBeVisible();
  await sidebar.getByText('Rules', {exact:true}).click();
  const writing = page.getByRole('tab', {name:/During the session/});
  await writing.click();
  await expect(writing).toHaveCSS('border-bottom-width','0px');
  await expect(page.getByRole('textbox', {name:'During the session'})).toHaveCSS('background-image','none');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:844});
    const calendar = sidebar.locator('.pt-calendar');
    await expect(calendar.getByRole('button',{pressed:true})).toHaveCSS('border-radius','50%');
    const previous = await calendar.getByRole('button',{name:'Previous month'}).boundingBox();
    const next = await calendar.getByRole('button',{name:'Next month'}).boundingBox();
    expect(next.x - previous.x).toBeLessThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
