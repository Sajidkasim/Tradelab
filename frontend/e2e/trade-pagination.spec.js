import {test, expect} from '@playwright/test';

test('the Lab fetches eight rows at a time and resolves off-page Journal links', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Results', exact: true})).toBeVisible();
  const identity = await (await page.request.get('/api/session')).json();
  const headers = {Origin:'http://127.0.0.1:8111', 'X-Primus-CSRF':identity.csrf};
  const meta = await (await page.request.get('/api/metadata')).json();
  const accountId = meta.accounts[0].id;
  let seeded = [];
  try {
    for (let index = 0; index < 10; index += 1) {
      const date = `2026-10-${String(index + 1).padStart(2, '0')}`;
      const response = await page.request.post('/api/trades', {headers, data:{
        symbol:'ES', direction:'long', account_id:accountId, source:'backtest', strategy:`Paged setup ${index}`, labels:{},
        entry_time:`${date}T09:30:00-04:00`, exit_time:`${date}T10:30:00-04:00`, net_pnl:50, risk_amount:100,
      }});
      expect(response.ok()).toBe(true);
    }
    seeded = (await (await page.request.get('/api/trades/page?size=100')).json()).items
      .filter((item) => item.setup_name.startsWith('Paged setup '));
    const linked = seeded.find((item) => item.setup_name === 'Paged setup 0').id;
    const loaded = [];
    page.on('request', (request) => loaded.push(new URL(request.url()).pathname));
    const first = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/trades/page');
    await page.reload();
    expect((await (await first).json()).items).toHaveLength(8);
    const next = page.waitForResponse((response) => new URL(response.url()).searchParams.get('page') === '1');
    await page.locator('.table-footer').getByRole('button',{name:'Next'}).click();
    expect((await (await next).json()).page).toBe(1);
    await page.goto(`/?trade=${linked}#trades`);
    await expect(page.getByRole('dialog',{name:'Review trade'}).getByLabel('Strategy',{exact:true})).toHaveValue('Paged setup 0');
    expect(loaded).toContain(`/api/trades/${linked}`);
    expect(loaded).not.toContain('/api/trades');
  } finally {
    if (!seeded.length) {
      seeded = (await (await page.request.get('/api/trades/page?size=100')).json()).items
        .filter((item) => item.setup_name.startsWith('Paged setup '));
    }
    for (const {id} of seeded) await page.request.delete(`/api/trades/${id}`, {headers});
  }
});
