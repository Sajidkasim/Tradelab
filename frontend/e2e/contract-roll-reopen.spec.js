import {test,expect} from '@playwright/test';

test('a blocked speculative contract-roll preload does not prevent reopening or replaying a saved session',async({page})=>{
 const origin='http://127.0.0.1:8119';
 const identity=await (await page.request.get(origin+'/api/session')).json();
 const created=await page.request.post(origin+'/api/backtesting/sessions',{
  headers:{'X-Primus-CSRF':identity.csrf,Origin:origin},
  data:{name:'Roll reopen regression',day:'2022-09-01',start_time:'23:30',instrument:'NQ',capital:50000,commission:0.5,slippage:0}
 });expect(created.status()).toBe(200);
 const saved=await created.json();let blocked=0;
 await page.route('**/api/backtesting/sessions/*/continue',async route=>{
  blocked++;await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({code:'contract_roll',detail:'Contract boundary reached. Continue to the last loaded candle.'})});
 });
 await page.goto(origin+'/backtesting?session='+saved.session.id);
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready');
 await expect.poll(()=>blocked).toBe(1);
 await expect(page.getByRole('button',{name:'Next candle',exact:true})).toBeEnabled();
 const before=await page.getByLabel('Replay time',{exact:true}).innerText();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.getByLabel('Replay time',{exact:true})).not.toHaveText(before);
 await expect(page.getByText('Not saved · retry Save',{exact:true})).toHaveCount(0);
});

test('an open position can be explicitly closed at the old-contract boundary and continued',async({page})=>{
 const origin='http://127.0.0.1:8119';const identity=await (await page.request.get(origin+'/api/session')).json();
 const headers={'X-Primus-CSRF':identity.csrf,Origin:origin};
 const created=await page.request.post(origin+'/api/backtesting/sessions',{headers,data:{name:'Explicit roll close',day:'2022-09-12',start_time:'23:59',instrument:'NQ',capital:50000,commission:0.5,slippage:0}});
 expect(created.status()).toBe(200);const saved=await created.json();const url=origin+'/api/backtesting/sessions/'+saved.session.id;
 const ordered=await page.request.post(url+'/action',{headers,data:{version:0,cursor:saved.session.cursor,kind:'order',event_id:crypto.randomUUID(),order:{side:'buy',qty:1}}});expect(ordered.status()).toBe(200);
 await page.goto(origin+'/backtesting?session='+saved.session.id);
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready');
 await expect(page.getByText(/The next date changes futures contract/)).toBeVisible();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.getByRole('button',{name:'Close at contract boundary',exact:true})).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Close at contract boundary',exact:true}).click();
 await expect.poll(async()=>{const r=await page.request.get(url);return (await r.json()).projection.trades.at(-1)?.reason}).toBe('contract roll');
 await expect(page.getByText(/The next date changes futures contract/)).toHaveCount(0);
});
