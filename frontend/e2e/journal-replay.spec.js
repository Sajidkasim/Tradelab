import {test,expect} from '@playwright/test';
test('Journal replay shows synthetic execution markers forward only with the real Vela renderer',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const first=Date.parse('2024-05-15T12:30:00Z');
 const row={id:'synthetic-replay',symbol:'EURUSD',provider:'dukascopy',notes:'SYNTHETIC browser fixture — not a real trade.',executions:[{id:'entry',time:new Date(first).toISOString(),role:'entry',quantity:'1',price:'1.0800'},{id:'partial',time:new Date(first+120000).toISOString(),role:'exit',quantity:'0.5',price:'1.0802'}]};
 await page.route('**/api/journal-replay**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/candles'))return route.fulfill({json:{bars:Array.from({length:140},(_,i)=>({time:first+(i-120)*60000,open:1.08,high:1.0805,low:1.0795,close:1.0802,volume:1})),next:null}});
  return route.fulfill({json:path.endsWith('/synthetic-replay')?row:[row]});
 });
 await page.goto('http://127.0.0.1:8119/journal?day=2024-05-15');
 await page.locator('summary').filter({hasText:'Trade replay'}).click();
 await page.getByRole('button',{name:'Replay',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('button',{name:'Step forward',exact:true})).toBeEnabled();
 await expect(dialog.getByText(row.notes,{exact:true})).toBeVisible();
 await expect(dialog.locator('svg[aria-label="Reached execution markers"] g')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Step forward',exact:true}).click();
 await expect(dialog.locator('svg[aria-label="Reached execution markers"] g')).toHaveCount(1);
 await dialog.getByRole('button',{name:'Step forward',exact:true}).click();
 await dialog.getByRole('button',{name:'Step forward',exact:true}).click();
 await expect(dialog.locator('svg[aria-label="Reached execution markers"] g')).toHaveCount(2);
 await expect(dialog.getByRole('button',{name:/rewind|backward/i})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Play',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Pause',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Pause',exact:true}).click();
 await page.screenshot({path:info.outputPath('journal-replay.png')});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('real local import skips duplicates and reports disabled candle access without changing financial records',async({page})=>{
 await page.goto('http://127.0.0.1:8119/journal?day=2024-05-15');
 const before=await (await page.request.get('http://127.0.0.1:8119/api/trades')).json();
 await page.locator('summary').filter({hasText:'Trade replay'}).click();
 const file={name:'synthetic-executions.csv',mimeType:'text/csv',buffer:Buffer.from('trade_id,execution_id,symbol,timestamp,side,quantity,price,role,notes\nsynthetic-browser,one,EURUSD,2024-05-15T12:30:00Z,buy,1,1.08,entry,SYNTHETIC import verification\n')};
 await page.getByLabel('Replay execution CSV',{exact:true}).setInputFiles(file);
 await page.getByRole('button',{name:'Import trades',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'1 replay trade imported'})).toBeVisible();
 await page.getByLabel('Replay execution CSV',{exact:true}).setInputFiles(file);
 await page.getByRole('button',{name:'Import trades',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'1 already imported'})).toBeVisible();
 await page.getByRole('button',{name:'Replay',exact:true}).click();
 await expect(page.getByRole('dialog').getByRole('alert')).toContainText('not enabled for your workspace');
 expect(await (await page.request.get('http://127.0.0.1:8119/api/trades')).json()).toEqual(before);
});

test('native TopstepX import and FTMO website timezone guard use the local backend',async({page})=>{
 await page.goto('http://127.0.0.1:8119/journal?day=2026-11-10');
 await page.locator('summary').filter({hasText:'Trade replay'}).click();
 const input=page.getByLabel('Replay execution CSV',{exact:true});
 await input.setInputFiles({name:'synthetic-topstep.csv',mimeType:'text/csv',buffer:Buffer.from('Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Size,Type\nsynthetic-native,MNQZ6,11/10/2026 15:23:22 +00:00,11/10/2026 15:24:05 +00:00,20000.25,20001.50,1,Long\n')});
 await page.getByRole('button',{name:'Import trades',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'1 replay trade imported'})).toBeVisible();
 await expect(page.locator('.jr-import-row').filter({hasText:'CON.F.US.MNQ.Z26'}).locator('time')).toHaveAttribute('datetime','2026-11-10T15:23:22+00:00');
 const ftmo={name:'synthetic-ftmo.csv',mimeType:'text/csv',buffer:Buffer.from('Ticket,Open,Type,Volume,Symbol,Price,Close,Price\nsynthetic-native-ftmo,2026-06-05 18:23:30,buy,1,XAUUSD,2300.12,2026-06-05 18:24:30,2301.34\n')};
 await input.setInputFiles(ftmo);
 await page.getByRole('button',{name:'Import trades',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'FTMO website export has no timezone'})).toBeVisible();
 await page.getByRole('checkbox',{name:'Use FTMO MT5 platform time',exact:true}).check();
 await input.setInputFiles(ftmo);
 await page.getByRole('button',{name:'Import trades',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'1 replay trade imported'})).toBeVisible();
 await expect(page.locator('.jr-import-row').filter({hasText:'XAUUSD'}).locator('time')).toHaveAttribute('datetime','2026-06-05T15:23:30+00:00');
});

test('a replay can be linked to a Journal card, saved, and deleted separately', async ({page})=>{
 await page.goto('http://127.0.0.1:8119/journal?day=2026-11-13');
 await page.locator('summary').filter({hasText:'Trade replay'}).click();
 await page.getByLabel('Replay execution CSV').setInputFiles({
  name:'replay-link.csv', mimeType:'text/csv',
  buffer:Buffer.from('trade_id,execution_id,symbol,timestamp,side,quantity,price,role\nlink-test,entry,EURUSD,2026-11-13T15:30:00Z,buy,1,1.08,entry\n'),
 });
 await page.getByRole('button',{name:'Import trades',exact:true}).click();
 const imported=page.locator('.jr-import-row').filter({hasText:'1.08'}).filter({hasText:'13 Nov 2026'});
 await expect(imported).toBeVisible();
 await page.getByRole('button',{name:'Add trade',exact:true}).click();
 const card=page.getByRole('article',{name:'Journal trade 1'});
 await card.getByRole('button',{name:'Link imported replay'}).click();
 const picker=page.getByRole('dialog',{name:'Link an imported replay'});
 await picker.getByLabel('Imported trade').selectOption({index:1});
 await picker.getByRole('button',{name:'Link replay',exact:true}).click();
 await page.getByRole('button',{name:'Save entry',exact:true}).first().click();
 await expect(page.getByText('Entry saved for this local preview.').first()).toBeVisible();
 await page.reload();
 await card.locator('.pj-trade-summary').click();
 await expect(card.getByRole('button',{name:'Replay',exact:true})).toBeVisible();
 await page.locator('summary').filter({hasText:'Trade replay'}).click();
 await imported.getByRole('button',{name:'Delete import'}).click();
 await page.getByRole('dialog',{name:'Delete replay import?'}).getByRole('button',{name:'Delete import'}).click();
 await expect(imported).toHaveCount(0);
 await expect(card.getByRole('button',{name:'Link imported replay'})).toBeVisible();
});
