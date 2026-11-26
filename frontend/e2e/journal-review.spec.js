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
  await expect(page.getByLabel('Calendar account')).toHaveCount(0);
  await page.getByRole('tab', {name:'Performance', exact:true}).click();
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
  await expect(page.getByRole('tab', {name:'Performance', exact:true})).toHaveAttribute('aria-selected', 'true');
  await equity.getByRole('button', {name:'Empty account', exact:true}).click();
  await expect(equity).toContainText('No recorded Journal trade results');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('one Journal card can cover three copy-trading accounts', async ({page}) => {
  const origin = 'http://127.0.0.1:8119';
  const day = '2026-08-19';
  await page.goto(`${origin}/journal?day=${day}`);
  await expect(page.getByRole('heading', {name:'Trades taken today'})).toBeVisible();
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

test('Journal equity curve defaults to active accounts and excludes blown accounts', async ({page}) => {
  const origin = 'http://127.0.0.1:8119';
  const day = '2026-09-22';
  await page.goto(`${origin}/journal?day=${day}`);
  await expect(page.getByRole('heading', {name: 'Trades taken today'})).toBeVisible();
  const session = await (await page.request.get(`${origin}/api/session`)).json();
  const headers = {'X-Primus-CSRF': session.csrf, Origin: origin};

  const activeResp = await page.request.post(`${origin}/api/journal-accounts`, {
    headers, data: {name: 'Live Funded 50K', starting_balance: 50000, account_type: 'Funded', firm: 'Topstep', fee_paid: 150, payouts_total: 1200},
  });
  expect(activeResp.ok()).toBeTruthy();
  const activeAcct = await activeResp.json();

  const blownResp = await page.request.post(`${origin}/api/journal-accounts`, {
    headers, data: {name: 'Blown Eval 99', starting_balance: 50000, account_type: 'Eval', status: 'blown', fee_paid: 50},
  });
  expect(blownResp.ok()).toBeTruthy();
  const blownAcct = await blownResp.json();

  const saved = await page.request.put(`${origin}/api/journal/${day}`, {
    headers,
    data: {
      plan: 'Wait for London low sweep before entry.',
      plan_followed: 'Yes',
      mindset: 'Focused',
      trades: [
        {id: 'd'.repeat(32), symbol: 'NQ', account_id: activeAcct.id, net_pnl: 400},
        {id: 'e'.repeat(32), symbol: 'NQ', account_id: blownAcct.id, net_pnl: -2500},
      ],
    },
  });
  expect(saved.ok()).toBeTruthy();

  await page.reload();
  await page.getByRole('tab', {name: 'Performance', exact: true}).click();
  const equity = page.getByRole('region', {name: 'Journal equity curve'});
  // Default Active scope excludes Blown Eval 99 from chips and P&L
  await expect(equity.getByRole('group', {name: 'Equity curve account'}).getByRole('button', {name: 'Blown Eval 99', exact: true})).toHaveCount(0);
  await expect(equity).toContainText('excluding 1 blown');
  await expect(equity.getByRole('heading', {name: 'Discipline & mindset breakdown'})).toBeVisible();

  // Switching scope to Blown isolates the blown account's -$2,500 result
  await equity.getByRole('group', {name: 'Equity scope'}).getByRole('button', {name: /Blown/}).click();
  await expect(equity).toContainText('-$2,500');

  // Switch back to Daily Log and confirm sidebar search locates the saved entry by keyword
  await page.getByRole('tab', {name: 'Daily Log', exact: true}).click();
  await page.getByLabel('Search journal entries').fill('London low sweep');
  await expect(page.getByRole('button', {name: 'Edit entry 22 September 2026', exact: true})).toBeVisible();
  await page.getByLabel('Clear search and filters').click();

  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
