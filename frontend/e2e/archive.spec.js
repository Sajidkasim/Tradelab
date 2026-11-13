import {test,expect} from '@playwright/test';
import {options,pick} from './select-helpers';

test('removed labels stay archived, can filter old trades, and restore from settings',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  const identity=await(await page.request.get('/api/session')).json();
  const headers={Origin:'http://127.0.0.1:8111','X-Primus-CSRF':identity.csrf};
  const original=await(await page.request.get('/api/metadata')).json();
  let tradeId;
  try {
    await page.request.put('/api/playbook',{headers,data:{strategies:[...original.strategies,'Archived setup'],levels:[...original.playbook.levels,'Archived level']}});
    await page.request.put('/api/lab-settings',{headers,data:{...original.lab_settings,level_timeframes:[...original.level_timeframes,'2H'],entry_timeframes:[...original.entry_timeframes,'30s']}});
    const created=await page.request.post('/api/trades',{headers,data:{symbol:'NQ',direction:'long',account_id:original.accounts[0].id,source:'backtest',strategy:'Archived setup',labels:{level:'Archived level',timeframe:'2H',entry_timeframe:'30s',confirmations:[]},confirmed:true,entry_time:'2026-07-01T10:00:00Z',exit_time:'2026-07-01T10:10:00Z',net_pnl:100,risk_amount:50}});
    expect(created.ok()).toBe(true);
    tradeId=(await(await page.request.get('/api/trades')).json()).find(t=>t.setup_name==='Archived setup').id;
    await page.request.put('/api/playbook',{headers,data:original.playbook});
    await page.request.put('/api/lab-settings',{headers,data:original.lab_settings});
    await page.reload();
    const explorer=page.locator('.explorer');
    const strategy=explorer.getByRole('combobox',{name:'Strategy',exact:true});
    await expect(await options(strategy)).not.toContainText(['Archived setup']);
    await page.getByRole('listbox',{name:'Strategy',exact:true}).press('Escape');
    await explorer.getByRole('button',{name:/Show archived strategy/}).click();
    await pick(strategy,'Archived setup');
    await expect(page.locator('.stat').filter({hasText:'Trades analysed'})).toContainText('1');
    await expect(explorer.getByRole('button',{name:/Show archived key level ·/i})).toBeVisible();
    await expect(explorer.getByRole('button',{name:/Show archived key level timeframe/})).toBeVisible();
    await expect(explorer.getByRole('button',{name:/Show archived entry timeframe/})).toBeVisible();
    await page.getByRole('button',{name:'My lab',exact:true}).click();
    await page.getByRole('button',{name:'Lab settings',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Lab settings',exact:true});
    await dialog.getByRole('button',{name:'Maintenance',exact:true}).click();
    await dialog.getByText('Archived key levels · 1',{exact:true}).click();
    await dialog.getByRole('button',{name:'Delete archived Archived level',exact:true}).click();
    await page.getByRole('dialog',{name:'Delete archived choice?'}).getByRole('button',{name:'Delete from archive'}).click();
    await expect(dialog.getByText('Archived key levels · 1',{exact:true})).toHaveCount(0);
    expect((await(await page.request.get('/api/trades')).json()).find(t=>t.id===tradeId).labels.level).toBe('Archived level');
    await dialog.getByText('Archived strategies · 1',{exact:true}).first().click();
    await dialog.getByRole('button',{name:'Restore Archived setup',exact:true}).click();
    await dialog.getByRole('button',{name:'Save setup labels',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    expect((await(await page.request.get('/api/metadata')).json()).strategies).toContain('Archived setup');
  } finally {
    if(tradeId)await page.request.delete(`/api/trades/${tradeId}`,{headers});
    await page.request.put('/api/playbook',{headers,data:original.playbook});
    await page.request.put('/api/lab-settings',{headers,data:original.lab_settings});
  }
});
