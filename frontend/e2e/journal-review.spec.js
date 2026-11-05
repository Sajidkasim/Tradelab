import {test, expect} from '@playwright/test';

test('Journal accounts, plan, weekly reflections and equity use saved entries', async ({page}) => {
  const origin = 'http://127.0.0.1:8119';
  const day = new Date().toLocaleDateString('sv-SE');
  await page.goto(origin + '/journal?day=' + day);
  await expect(page.getByRole('heading', {name:'Trades taken today'})).toBeVisible();
  const session = await (await page.request.get(origin + '/api/session')).json();
  const headers = {'X-Primus-CSRF': session.csrf, Origin: origin};
  const accounts = await (await page.request.get(origin + '/api/journal-accounts')).json();
  const account = accounts[0];
  const legacy = [
    {id:'a'.repeat(32), symbol:'ES', net_pnl:125},
    {id:'b'.repeat(32), symbol:'NQ', net_pnl:-25},
    {id:'c'.repeat(32), symbol:'YM'},
  ];
  const saved = await page.request.put(origin + '/api/journal/' + day, {
    headers, data:{plan:'Wait for a clean setup', trades:legacy},
  });
  expect(saved.ok()).toBeTruthy();
  await page.reload();
  const trade = page.getByRole('article', {name:'Journal trade 1', exact:true});
  await expect(trade).toContainText('Unassigned');
  await trade.locator('button').first().click();
  await trade.getByLabel('Trade account').selectOption(String(account.id));
  const plan = page.getByLabel('Plan followed?', {exact:true});
  const save = page.getByRole('button', {name:'Save entry', exact:true}).first();
  const daily = page.getByLabel('Day profit and loss');
  for (const status of ['Yes', 'Partly', 'No', '']) {
    await plan.selectOption(status);
    const response = page.waitForResponse(res => res.url().endsWith('/api/journal/' + day) && res.request().method() === 'PUT');
    await save.click();
    const payload = await (await response).json();
    expect(payload.plan_followed).toBe(status || null);
    expect(payload.trades[0].account_id).toBe(account.id);
    expect(payload.trades[1].account_id).toBeUndefined();
    if (status) await expect(daily).toContainText('Plan followed: ' + status);
    else await expect(daily).not.toContainText('Plan followed:');
  }
  const weekly = page.getByRole('region', {name:'Weekly Review'});
  await expect(weekly).toContainText('$100');
  await page.getByLabel('Calendar and review account').selectOption(String(account.id));
  await expect(page.getByRole('article', {name:'Journal trade 2', exact:true})).toHaveCount(0);
  await expect(daily).toContainText('$125');
  await expect(weekly).toContainText('$125');
  await expect(weekly).toContainText('Wait for a clean setup');
  await weekly.getByLabel('What should I repeat?').fill('Wait for confirmation');
  await weekly.getByLabel('What will I change?').fill('Use a checklist');
  await weekly.getByRole('button', {name:'Save weekly review'}).click();
  await expect(weekly).toContainText('Weekly review saved.');
  await weekly.getByRole('button', {name:'Next week'}).click();
  await expect(weekly).toContainText('No recorded results');
  await expect(weekly.getByLabel('What should I repeat?')).toHaveValue('');
  await weekly.getByRole('button', {name:'Previous week'}).click();
  await expect(weekly.getByLabel('What should I repeat?')).toHaveValue('Wait for confirmation');

  const equity = page.getByRole('region', {name:'Journal equity curve'});
  const combined = await equity.getByRole('img').getAttribute('aria-label');
  await equity.getByLabel('Equity curve account').selectOption(String(account.id));
  await expect(equity.getByRole('img')).not.toHaveAttribute('aria-label', combined);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
