import {test, expect} from '@playwright/test';

test('Journal accounts, plan chips and equity use saved entries', async ({page}) => {
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
  const plan = page.getByRole('group', {name:'Plan followed?', exact:true});
  const save = page.getByRole('button', {name:'Save entry', exact:true}).first();
  const daily = page.getByLabel('Day profit and loss');
  for (const status of ['Yes', 'Partly', 'No', '']) {
    await plan.getByRole('button', {name: status || 'No', exact:true}).click();
    await expect(plan.getByRole('button', {name:status || 'No', exact:true})).toHaveAttribute('aria-pressed', String(!!status));
    const response = page.waitForResponse(res => res.url().endsWith('/api/journal/' + day) && res.request().method() === 'PUT');
    await save.click();
    const payload = await (await response).json();
    expect(payload.plan_followed).toBe(status || null);
    expect(payload.trades[0].account_id).toBe(account.id);
    expect(payload.trades[1].account_id).toBeUndefined();
    if (status) await expect(daily).toContainText('Plan followed: ' + status);
    else await expect(daily).not.toContainText('Plan followed:');
  }
  await expect(page.getByRole('heading', {name:'Weekly Review'})).toHaveCount(0);
  await page.getByLabel('Calendar account').selectOption(String(account.id));
  await expect(page.getByRole('article', {name:'Journal trade 2', exact:true})).toHaveCount(0);
  await expect(daily).toContainText('$125');
  const equity = page.getByRole('region', {name:'Journal equity curve'});
  await expect(equity).toContainText('Total P&L +$100');
  await equity.getByRole('group', {name:'Equity curve account'}).getByRole('button', {name:account.name, exact:true}).click();
  await expect(equity).toContainText('Total P&L +$125');
  await equity.getByRole('button', {name:'1W', exact:true}).click();
  await expect(equity.getByRole('button', {name:'1W', exact:true})).toHaveAttribute('aria-pressed','true');
  const empty = await page.request.post(origin + '/api/journal-accounts', {
    headers, data:{name:'Empty account', starting_balance:10000, account_type:'Eval'},
  });
  expect(empty.ok()).toBeTruthy();
  await page.reload();
  await equity.getByRole('button', {name:'Empty account', exact:true}).click();
  await expect(equity).toContainText('No recorded Journal trade results');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
