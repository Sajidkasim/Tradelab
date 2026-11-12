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
  if(accounts.length>1) await trade.getByRole('checkbox',{name:account.name,exact:true}).check();
  else await trade.getByLabel('Trade account').selectOption(String(account.id));
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

test('one Journal card can cover three copy-trading accounts', async ({page}) => {
  const origin = 'http://127.0.0.1:8119';
  const day = '2026-08-19';
  await page.goto(`${origin}/journal?day=${day}`);
  const session = await (await page.request.get(`${origin}/api/session`)).json();
  const headers = {'X-Primus-CSRF': session.csrf, Origin: origin};
  const names = ['Copy account one', 'Copy account two', 'Copy account three'];
  const accounts = [];
  for (const name of names) {
    const response = await page.request.post(`${origin}/api/journal-accounts`, {
      headers, data:{name, starting_balance:50000, account_type:'Eval'},
    });
    expect(response.ok()).toBeTruthy();
    accounts.push(await response.json());
  }
  await page.reload();
  await page.getByRole('button',{name:'Add trade',exact:true}).click();
  const card = page.getByRole('article',{name:'Journal trade 1',exact:true});
  for (const name of names) await card.getByRole('checkbox',{name,exact:true}).check();
  await card.getByRole('textbox',{name:'Trade notes',exact:true}).fill('One shared review.');
  const pending = page.waitForResponse(response=>response.url().endsWith(`/api/journal/${day}`)&&response.request().method()==='PUT');
  await page.getByRole('button',{name:'Save entry',exact:true}).first().click();
  const entry = await (await pending).json();
  expect(entry.trades).toHaveLength(1);
  expect(entry.trades[0].account_ids).toEqual(accounts.map(account=>account.id));
  await page.reload();
  await expect(card).toContainText(names.join(', '));
  await card.locator('.pj-trade-summary').click();
  for (const name of names) await expect(card.getByRole('checkbox',{name,exact:true})).toBeChecked();
});
