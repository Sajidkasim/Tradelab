import {replayFrames} from '../src/replayFrames.js';
import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
test.skip(!existsSync(new URL('../../data/private/backtesting-preview.json',import.meta.url)),'Prepare local Databento sample first.');
test.beforeEach(async({page})=>{
 const identity=await (await page.request.get('http://127.0.0.1:8119/api/session')).json();
 const reset=await page.request.put('http://127.0.0.1:8119/api/backtesting/chart-defaults',{headers:{'X-Primus-CSRF':identity.csrf,Origin:'http://127.0.0.1:8119'},data:{layout:{}}});expect(reset.status()).toBe(200);
});
test('create, replay, scale out of two contracts, place/cancel a limit and resume saved practice without future results',async({page},testInfo)=>{
 let writes=0;
 page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/backtesting/'))writes++});
 await page.goto('http://127.0.0.1:8119/backtesting');
 await expect(page.getByRole('button',{name:'USD calendar',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New session',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New backtesting session',exact:true});
 await dialog.getByLabel('Session name',{exact:true}).fill('Morning practice');
 await dialog.getByLabel('Trading date',{exact:true}).fill('2010-06-07');
 await dialog.getByLabel('Starting capital ($)',{exact:true}).fill('10000');
 await page.screenshot({path:testInfo.outputPath('new-session.png')});
 await dialog.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.route('**/api/backtesting/economic-calendar?day=2010-06-07&scope=day', route => route.fulfill({json: {
  status:'available', events:[{name:'CPI inflation', source:'BLS', scheduled_at:'2010-06-07T10:00:00-04:00'}],
  sources:[{name:'BLS', url:'https://www.bls.gov/schedule/news_release/', available:true}],
 }}));
 await page.getByRole('button',{name:'Economic news',exact:true}).click();
 const calendar = page.getByRole('complementary',{name:'Economic news'});
 await expect(calendar).toContainText('7 June 2010');
 await expect(calendar).toContainText('CPI inflation');
 await expect(calendar).toContainText('Upcoming');
 await calendar.getByRole('button',{name:'Close economic news',exact:true}).click();
 await page.getByRole('button',{name:'Increase contracts',exact:true}).click();
 await expect(page.getByRole('spinbutton',{name:'Contracts',exact:true})).toHaveValue('2');
 await page.getByRole('button',{name:'Buy',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('BUY 2 NQ');
 await expect(page.locator('.bt-position-strip')).toContainText('Next open');
 await expect(page.getByRole('group',{name:'Pending entry price box',exact:true})).toBeVisible();
 const pendingEdit=page.waitForResponse(r=>r.url().includes('/action')&&r.request().postDataJSON()?.kind==='amend');
 const pendingStop=await page.getByRole('button',{name:'Drag stop price',exact:true}).boundingBox();
 await page.mouse.move(pendingStop.x+30,pendingStop.y+pendingStop.height/2);await page.mouse.down();await page.mouse.move(pendingStop.x+30,pendingStop.y+pendingStop.height/2+30,{steps:8});await page.mouse.up();
 const pendingReply=await pendingEdit;expect(pendingReply.status()).toBe(200);
 expect(replayFrames((await pendingReply.json()).projection.frames)[0].order.stop).not.toBeNull();
 await page.screenshot({path:testInfo.outputPath('pending-price-boxes.png')});
 await page.getByRole('button',{name:'Remove stop loss',exact:true}).click();
 await page.getByRole('button',{name:'Orders and trade history',exact:true}).click();
 const ledger=page.getByRole('dialog',{name:'Session trades',exact:true});
 await expect(ledger).toContainText('No closed trades yet');
 await ledger.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('Long 2 NQ');
 await page.getByRole('button',{name:'Toggle two charts',exact:true}).click();
 await expect(page.locator('[data-pane-id="secondary"]')).toContainText('Comparison');
 await expect(page.getByLabel('Position on chart',{exact:true})).toHaveCount(1);
 await expect(page.locator('[data-pane-id="secondary"] .bt-ticket-layer')).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle two charts',exact:true}).click();

 const amended=page.waitForResponse(r=>r.url().includes('/action')&&r.request().postDataJSON()?.kind==='amend');
 const stopHandle=page.getByRole('button',{name:'Drag stop price',exact:true});
 const handle=await stopHandle.boundingBox();
 await page.mouse.move(handle.x+30,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+30,handle.y+handle.height/2+40,{steps:10});await page.mouse.up();
 const amendment=await amended;expect(amendment.status()).toBe(200);
 const state=await amendment.json();expect(replayFrames(state.projection.frames)[1].position.stop).not.toBeNull();
 await page.screenshot({path:testInfo.outputPath('active-levels.png')});
 const clearedStop = page.waitForResponse(r=>r.url().includes('/action')&&r.request().postDataJSON()?.order?.stop===null);
 await page.getByRole('button',{name:'Remove stop loss',exact:true}).click();
 expect((await clearedStop).status()).toBe(200);
 await page.getByRole('button',{name:'Close chart position',exact:true}).click();
 const close = page.getByRole('dialog',{name:'Close position',exact:true});
 await close.getByRole('button',{name:'50% 1 to close',exact:true}).click();
 await close.getByRole('button',{name:'Take partial',exact:true}).click();
 await expect(close).not.toBeVisible();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 await page.getByRole('button',{name:'Close position',exact:true}).click();
 await close.getByRole('button',{name:'Close full position',exact:true}).click();
 await expect(close).not.toBeVisible();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('No open position');
 await page.getByRole('button',{name:'Orders and trade history',exact:true}).click();
 await expect(ledger.locator('.bt-trade-ledger article')).toHaveCount(1);
 await expect(ledger.locator('.bt-trade-ledger')).toContainText('Buy 2 NQ');
 await ledger.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('combobox',{name:'Order type',exact:true}).click();
 await page.getByRole('option',{name:'Limit',exact:true}).click();
 await page.getByRole('button',{name:'Sell',exact:true}).click();
 const ticket=page.getByRole('dialog',{name:'Sell limit · NQ',exact:true});
 await ticket.getByRole('spinbutton',{name:'Order price',exact:true}).fill('2000');
 await ticket.getByRole('button',{name:'Place sell limit',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('SELL 2 NQ');
 await page.getByRole('button',{name:'Cancel order',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('No open position');
 const before=writes;
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 expect(writes-before).toBeLessThanOrEqual(1); // at most a scheduled autosave, never candle-data requests
 await page.getByRole('button',{name:'Play replay',exact:true}).click();
 const initial=await page.getByLabel('Replay time',{exact:true}).textContent();
 await expect(page.getByLabel('Replay time',{exact:true})).not.toHaveText(initial,{timeout:5000});
 await page.getByRole('button',{name:'Pause replay',exact:true}).click();
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 await expect(page.locator('.bt-save-status')).toHaveText('Saved');
 const savedClock=await page.getByLabel('Replay time',{exact:true}).textContent();
 await page.screenshot({path:testInfo.outputPath('replay-order-workspace.png')});
 await page.getByRole('link',{name:'Back to sessions',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your practice desk.',exact:true})).toBeVisible();
 const card=page.locator('.bt-session-card').filter({hasText:'Morning practice'});
 await expect(card).toContainText('Starting capital $10,000.00');
 let releaseResume;
 const resumeGate = new Promise(resolve => { releaseResume = resolve });
 const resumeURL = '**/api/backtesting/sessions/*';
 await page.route(resumeURL, async route => { await resumeGate; await route.continue() }, {times:1});
 await card.getByRole('button',{name:'Resume',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Primus Trader',exact:true})).toBeVisible();
 await expect(page.locator('.replay-chart')).toHaveCount(0);
 releaseResume();
 await expect(page.getByLabel('Replay time',{exact:true})).toHaveText(savedClock);
 await page.reload();
 await expect(page.getByLabel('Replay time',{exact:true})).toHaveText(savedClock);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('replay-phone.png')});
});

 test('sessions require confirmation and are permanently deleted without an archive',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 const card=page.locator('.bt-session-card').filter({hasText:'Morning practice'});
 await card.getByRole('button',{name:'Delete Morning practice',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Permanently delete sessions?',exact:true});
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(card).toBeVisible();
 await card.getByRole('button',{name:'Delete Morning practice',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Delete permanently',exact:true})).toBeDisabled();
 await dialog.getByLabel('Type DELETE 1 to confirm').fill('DELETE 1');
 await dialog.getByRole('button',{name:'Delete permanently',exact:true}).click();await expect(card).toHaveCount(0);
 await expect(page.getByText(/Deleted sessions \(/)).toHaveCount(0);
 });

test('play preserves a zoomed and panned historical viewport',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Session name',{exact:true}).fill('Viewport check');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 expect(await page.locator('.replay-chart').evaluate(node=>getComputedStyle(node).contain)).toBe('layout style');
 const canvas=await page.locator('.replay-chart canvas').first().boundingBox();
 expect(canvas.width).toBeGreaterThan(0);expect(canvas.height).toBeGreaterThan(0);
 await page.mouse.move(650,400);await page.mouse.wheel(0,-600);
 await page.mouse.move(500,400);await page.mouse.down();await page.mouse.move(1000,400,{steps:20});await page.mouse.up();
 await page.mouse.move(1410,300);await page.mouse.down();await page.mouse.move(1410,400,{steps:10});await page.mouse.up();
 await page.getByRole('button',{name:'Play replay',exact:true}).hover();
 await page.screenshot({path:testInfo.outputPath('viewport-before.png')});
 await page.getByRole('button',{name:'Play replay',exact:true}).click();
 const clock=page.getByLabel('Replay time',{exact:true});
 const first=await clock.textContent();await expect(clock).not.toHaveText(first);
 const second=await clock.textContent();await expect(clock).not.toHaveText(second);
 await page.getByRole('button',{name:'Pause replay',exact:true}).click();
 await page.screenshot({path:testInfo.outputPath('viewport-after.png')});
});

test('right-click offers price-aware orders and settings include timeframe watermark',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByLabel('Timeframe watermark',{exact:true})).toHaveText('1m');
 await page.locator('.replay-chart').click({button:'right',position:{x:600,y:600}});
 const menu=page.getByRole('menu',{name:'Chart options',exact:true});
 await expect(menu).toBeVisible();await expect(menu).not.toContainText('Table view');
 await menu.getByRole('menuitem',{name:/Buy .* limit/}).click();
 await expect(page.getByRole('group',{name:'Pending entry price box',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel chart order',exact:true}).click();
 await expect(page.getByRole('group',{name:'Pending entry price box',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Chart settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Chart settings',exact:true});
 await settings.getByText('Symbol',{exact:true}).click();
 await settings.getByText('Timeframe watermark',{exact:true}).locator('..').getByRole('switch').click();
 await expect(page.getByLabel('Timeframe watermark',{exact:true}).filter({hasText:'1m'})).toHaveCount(0);
 await page.keyboard.press('Escape');
});

test('custom timeframe shortcuts save and survive reload',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'2m',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Manage timeframes',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Your timeframes',exact:true});
 await dialog.getByRole('button',{name:'Add timeframe',exact:true}).click();
 await page.screenshot({path:testInfo.outputPath('timeframe-settings.png')});
 await dialog.getByRole('button',{name:'Save timeframes',exact:true}).click();
 await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'3m',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByLabel('Timeframe watermark',{exact:true})).toHaveText('3m');
 await page.reload();
 await expect(page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'3m',exact:true})).toBeVisible();
});

test('daily charts and chart layouts survive save/reload and closed trades can be sent to the Lab',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Session name',{exact:true}).fill('Full workflow');
 await page.getByLabel('Trading date',{exact:true}).fill('2013-01-25');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'1D',exact:true}).click();
 await expect(page.getByLabel('Timeframe watermark',{exact:true})).toHaveText('1D');
 await page.getByRole('button',{name:'Indicators',exact:true}).click();
 const indicators=page.getByRole('dialog',{name:'Indicators',exact:true});
 await indicators.getByRole('searchbox').fill('sma');
 await indicators.locator('.bt-indicator-list').getByRole('button',{name:/^Add /}).first().click();
 await indicators.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 await expect(page.locator('.bt-save-status')).toHaveText('Saved');
 await page.reload();
 await expect(page.getByLabel('Timeframe watermark',{exact:true})).toHaveText('1D');
 await page.getByRole('button',{name:'Indicators',exact:true}).click();
 await expect(indicators.getByRole('region',{name:'Indicators on chart'})).toContainText('Moving Average');
 await indicators.getByRole('button',{name:'Done',exact:true}).click();
 await page.screenshot({path:testInfo.outputPath('daily-history.png')});
 await page.getByRole('button',{name:'Buy',exact:true}).click();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await page.getByRole('button',{name:'Close position',exact:true}).click();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await page.getByRole('button',{name:'Orders and trade history',exact:true}).click();
 await page.getByRole('button',{name:'Send to Lab / Journal',exact:true}).click();
 const transfer=page.getByRole('dialog',{name:'Send practice trade',exact:true});
 await transfer.getByRole('combobox',{name:'Strategy',exact:true}).click();
 await page.getByRole('option',{name:'Displacement continuation',exact:true}).click();
 await transfer.getByRole('combobox',{name:'Key level / PDA',exact:true}).click();
 await page.getByRole('option',{name:'FVG',exact:true}).click();
 await transfer.getByRole('button',{name:'Send trade',exact:true}).click();
 await expect(transfer.getByRole('status')).toContainText('Trade sent');
});

test('chart clocks, speed slider and saved session jump work without replay data requests',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Trading date',{exact:true}).fill('2013-01-25');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 const clock=page.getByLabel('Replay time',{exact:true});
 await expect(clock).toContainText('08:30:00');
 await page.getByRole('combobox',{name:'Chart timezone',exact:true}).click();
 await expect(page.getByRole('option',{name:'UTC',exact:true})).toBeVisible();await page.getByRole('option',{name:'London',exact:true}).click();
 await expect(clock).toContainText('13:30:00');
 await page.getByRole('slider',{name:'Replay speed',exact:true}).fill('5');
 await expect(page.locator('.bt-speed-slider output')).toHaveText('8×');
 await page.getByRole('button',{name:'Jump to session',exact:true}).click();
 await page.getByRole('button',{name:'Custom settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Session jump settings',exact:true});
 await settings.getByLabel('New York session start',{exact:true}).fill('09:30');
 await settings.getByRole('button',{name:'Save jump settings',exact:true}).click();
 await page.getByRole('button',{name:'Jump to session',exact:true}).click();
 await page.getByRole('button',{name:'Next New York session · 09:30',exact:true}).click();
 await expect(clock).toContainText('14:30:00');
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 await expect(page.locator('.bt-save-status')).toHaveText('Saved');
 await page.reload();
 await expect(clock).toContainText('14:30:00');
 await expect(page.getByRole('combobox',{name:'Chart timezone',exact:true})).toContainText('London');
 await page.getByRole('combobox',{name:'Chart timezone',exact:true}).click();
 await page.getByRole('option',{name:'UTC',exact:true}).click();
 await expect(clock).toContainText('(UTC+0)'); await page.getByRole('combobox',{name:'Chart timezone',exact:true}).click(); await page.getByRole('option',{name:'New York',exact:true}).click();
 await expect(clock).toContainText('(UTC-5)');
 await page.screenshot({path:testInfo.outputPath('clock-speed-jump.png')});
});

test('two charts share replay time and retain layouts without a Journal button',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'4h',exact:true}).click();
 await page.getByRole('button',{name:'Toggle two charts',exact:true}).click();
 await expect(page.locator('.replay-chart')).toHaveCount(2);
 await expect(page.getByRole('status',{name:'Chart status',exact:true}).last()).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByRole('button',{name:'ES · 4h',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 expect(await page.getByLabel('Replay time',{exact:true}).first().getAttribute('datetime')).toBe(await page.getByLabel('Replay time',{exact:true}).last().getAttribute('datetime'));
 await expect(page.getByRole('button',{name:'Backtesting journal',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 await page.screenshot({path:testInfo.outputPath('two-charts.png')});
 await page.reload();await expect(page.locator('.replay-chart')).toHaveCount(2);

});

test('calendar refreshes stale date choices and opens a 2020 session with years of 4h context',async({page},testInfo)=>{
 test.skip(!existsSync(new URL('../../data/private/replay-index.db',import.meta.url)),'Full local index required.');
 let listings=0;
 await page.route('**/api/backtesting/sessions',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch();const data=await response.json();listings++;
  if(listings===1)data.history.available_days=['2010-06-07','2013-01-25'];
  await route.fulfill({response,json:data});
 });
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 const input=page.getByLabel('Trading date',{exact:true});
 await expect(input).toHaveAttribute('type','date');
 await input.fill('2020-06-02');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/backtesting/sessions')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 const data=await (await response).json();expect(data.session.day).toBe('2020-06-02');
 expect(data.sample.markets.NQ.four_hour_history_ny).toBeUndefined();
 const prior=await page.request.get(`http://127.0.0.1:8119/api/backtesting/sessions/${data.session.id}/chart-history?root=NQ&timeframe=240&cursor=${data.session.cursor}&before=${Date.UTC(2011,0,1)}`);
 expect(prior.ok()).toBe(true);const earlier=await prior.json();expect(earlier.bars[0].time).toBeLessThan(Date.UTC(2011,0,1));
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'4h',exact:true}).click();
 await expect(page.getByLabel('Replay time',{exact:true})).toContainText('2020-06-02');
 expect(listings).toBeGreaterThanOrEqual(2);
 await page.screenshot({path:testInfo.outputPath('calendar-full-4h.png')});
});

test('backtesting setup dropdowns read the private Lab catalogue and retain all selected labels',async({page},testInfo)=>{
 const base='http://127.0.0.1:8119';
 const identity=await (await page.request.get(base+'/api/session')).json();
 const metadata=await (await page.request.get(base+'/api/metadata')).json();
 const headers={'Origin':base,'X-Primus-CSRF':identity.csrf};
 const book={strategies:metadata.strategies,levels:metadata.playbook.levels},lab=metadata.lab_settings;
 const choices={...lab,confirmations:[...new Set([...lab.confirmations,'Replay confirmation'])],level_timeframes:[...new Set([...lab.level_timeframes,'2H'])],entry_timeframes:[...new Set([...lab.entry_timeframes,'3m'])]};
 expect((await page.request.put(base+'/api/playbook',{headers,data:{strategies:[...book.strategies,'Replay custom strategy'],levels:[...book.levels,'Replay key level']}})).ok()).toBe(true);
 expect((await page.request.put(base+'/api/lab-settings',{headers,data:choices})).ok()).toBe(true);
 try{
  await page.goto(base+'/backtesting');
  await page.getByRole('button',{name:'New session',exact:true}).click();
  await page.getByRole('button',{name:'Open session',exact:true}).click();
  await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
  await page.getByRole('button',{name:'Buy',exact:true}).click();
  await page.getByRole('button',{name:'Next candle',exact:true}).click();
  await page.getByRole('button',{name:'Close position',exact:true}).click();
  await page.getByRole('button',{name:'Next candle',exact:true}).click();
  await page.getByRole('button',{name:'Orders and trade history',exact:true}).click();
  await page.getByRole('button',{name:'Send to Lab / Journal',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Send practice trade',exact:true});
  for(const [label,option] of [['Strategy','Replay custom strategy'],['Key level / PDA','Replay key level'],['Key level timeframe','2H'],['Entry timeframe','3m']]){
   await dialog.getByRole('combobox',{name:label,exact:true}).click();
   await page.getByRole('option',{name:option,exact:true}).click();
  }
  await dialog.getByLabel('Replay confirmation',{exact:true}).check();
  await dialog.getByRole('button',{name:'Send trade',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Trade sent');
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('lab-linked-replay-journal.png')});
 }finally{
  await page.request.put(base+'/api/playbook',{headers,data:book});
  await page.request.put(base+'/api/lab-settings',{headers,data:lab});
 }
});

test('an open position continues into the next day without resetting the chart and survives reload',async({page},testInfo)=>{
 test.skip(!existsSync(new URL('../../data/private/replay-index.db',import.meta.url)),'Full local index required.');
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Session name',{exact:true}).fill('Overnight continuation check');
 await page.getByLabel('Trading date',{exact:true}).fill('2010-06-07');
 await page.getByLabel('Start time (UTC)',{exact:true}).fill('23:59');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 const status=page.getByRole('status',{name:'Chart status',exact:true});
 await expect(status).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Buy',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('BUY 1 NQ');
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 let boundaryRequests=0;page.on('request',r=>{if(r.url().endsWith('/continue'))boundaryRequests++});
 await page.getByRole('button',{name:'Play replay',exact:true}).click();
 await expect(page.getByRole('button',{name:'Backtesting journal',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Replay time',{exact:true})).toHaveAttribute('datetime',/2010-06-08/);
 await page.getByRole('button',{name:'Pause replay',exact:true}).click();
 expect(boundaryRequests).toBe(0);
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 await expect(status).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 await expect(page.locator('.bt-save-status')).toHaveText('Saved');
 await page.reload();
 await expect(status).toHaveText('Chart ready',{timeout:15000});
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 await page.getByRole('button',{name:'Close position',exact:true}).click();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('No open position');
 await page.getByRole('button',{name:'Orders and trade history',exact:true}).click();
 await expect(page.locator('.bt-trade-ledger article')).toHaveCount(1);
 await expect(page.locator('.bt-trade-ledger')).toContainText('close');
 await page.screenshot({path:testInfo.outputPath('overnight-position.png')});
});

test('delete all drawings confirms once and preserves the simulated position and trade markers',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByRole('button',{name:'Backtesting journal',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Lines',exact:true}).click();
 await page.locator('.replay-chart').click({position:{x:400,y:250}});
 await page.locator('.replay-chart').click({position:{x:650,y:300}});
 await page.getByRole('button',{name:'Buy',exact:true}).click();
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 const id=new URL(page.url()).searchParams.get('session');
 const drawingCount=async()=>{const data=await (await page.request.get('http://127.0.0.1:8119/api/backtesting/sessions/'+id)).json();return Object.values(data.layout.drawings||{}).flatMap(x=>x.drawings||[]).length};
 await expect.poll(drawingCount).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Delete all drawings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Delete all drawings?',exact:true});
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 await page.getByRole('button',{name:'Delete all drawings',exact:true}).click();
 await dialog.getByRole('button',{name:'Delete drawings',exact:true}).click();
 await expect.poll(drawingCount).toBe(0);
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 await expect(page.getByRole('group',{name:'Entry price box',exact:true})).toBeVisible();
});

test('selected and all sessions can be permanently deleted with exact confirmation',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await expect(page.getByRole('heading',{name:'Your practice desk.'})).toBeVisible();
 await expect(page.getByText('Historical data', {exact:true})).toHaveCount(0);
 await expect(page.locator('.bt-sessions-heading').getByRole('button')).toHaveCount(1);
 await expect(page.locator('.bt-sessions-footer').getByRole('button',{name:'Give feedback'})).toBeVisible();
 for (const name of ['Purge preview','Purge remaining']) {
  await page.getByRole('button',{name:'New session',exact:true}).click();
  await page.getByLabel('Session name',{exact:true}).fill(name);
  await page.getByRole('button',{name:'Open session',exact:true}).click();
  await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
  await page.getByRole('link',{name:'Back to sessions',exact:true}).click();
 }
 await expect(page.getByRole('group',{name:'Session selection actions'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Delete all sessions',exact:true})).toHaveCount(0);
 await page.getByLabel('Select Purge preview',{exact:true}).check();
 await page.getByRole('button',{name:'Delete selected (1)',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Permanently delete sessions?',exact:true});
 await modal.getByLabel('Type DELETE 1 to confirm').fill('DELETE 1');
 await modal.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await expect(page.locator('.bt-session-card').filter({hasText:'Purge preview'})).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Session selection actions'})).toHaveCount(0);
 await page.getByLabel('Select Purge remaining',{exact:true}).check();
 await page.getByRole('button',{name:'Delete all sessions',exact:true}).click();
 const label=await modal.locator('label').innerText();await modal.locator('input').fill(label.match(/DELETE \d+/)[0]);
 await modal.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await expect(page.locator('.bt-session-card')).toHaveCount(0);
});

test('drawing gestures defer layout snapshots until release and save the final drawing',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Lines',exact:true}).click();
 await page.locator('.replay-chart').click({position:{x:400,y:250}});
 await page.locator('.replay-chart').click({position:{x:650,y:300}});
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 await page.waitForTimeout(1500);
 let snapshots=0;page.on('request',r=>{if(r.method()==='PUT'&&r.url().includes('/layout?'))snapshots++});
 const rect=await page.locator('.replay-chart').boundingBox();
 await page.mouse.move(rect.x+525,rect.y+275);await page.mouse.down();
 await page.mouse.move(rect.x+545,rect.y+295,{steps:20});
 await page.waitForTimeout(1600);expect(snapshots).toBe(0);
 await page.mouse.up();await expect.poll(()=>snapshots).toBeGreaterThan(0);
 const id=new URL(page.url()).searchParams.get('session');
 const saved=await (await page.request.get(`http://127.0.0.1:8119/api/backtesting/sessions/${id}`)).json();
 expect(Object.values(saved.layout.drawings).flatMap(doc=>doc.drawings)).toHaveLength(1);
});

for(const side of ['Buy','Sell'])test(`${side} TP and SL labels follow direction and both drag to valid prices`,async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:side,exact:true}).click();
 const target=page.getByRole('button',{name:'Drag target price',exact:true}),stop=page.getByRole('button',{name:'Drag stop price',exact:true});
 const t=await target.boundingBox(),s=await stop.boundingBox();expect(side==='Sell'?t.y>s.y:t.y<s.y).toBe(true);
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 for(const kind of ['target','stop']){
  const button=page.getByRole('button',{name:`Drag ${kind} price`,exact:true});const box=await button.boundingBox();
  const direction=(side==='Sell'?1:-1)*(kind==='target'?1:-1);
  const amended=page.waitForResponse(r=>r.url().includes('/action')&&r.request().postDataJSON()?.kind==='amend');
  await page.mouse.move(box.x+35,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+35,box.y+box.height/2+direction*65,{steps:12});await page.mouse.up();
  const response=await amended;expect(response.status()).toBe(200);const reply=await response.json();const position=replayFrames(reply.projection.frames)[reply.session.cursor-reply.session.spec.start_cursor].position;
  expect(position).toBeTruthy();expect((position[kind]-position.entry)*(side==='Buy'?1:-1)*(kind==='target'?1:-1)).toBeGreaterThanOrEqual(kind==='stop'?0:0.25);
 }
});

test('minute watermark preferences persist into a new session and after reload',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Chart settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Chart settings',exact:true});await settings.getByText('Symbol',{exact:true}).click();
 await settings.getByText('1-minute watermark',{exact:true}).locator('..').getByRole('switch').click();await page.keyboard.press('Escape');
 await page.getByRole('link',{name:'Back to sessions',exact:true}).click();
 await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByLabel('Timeframe watermark',{exact:true})).toHaveCount(0);
 await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'5m',exact:true}).click();
 await expect(page.getByLabel('Timeframe watermark',{exact:true})).toHaveText('5m');
 await page.getByRole('button',{name:'Save session',exact:true}).click();await page.reload();
 await expect(page.getByLabel('Timeframe watermark',{exact:true})).toHaveText('5m');
});

test('session ranges use editable NY defaults, save privately and restore on reload',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Indicators',exact:true}).click();await page.locator('.bt-study-row').filter({has:page.getByText('Sessions',{exact:true})}).getByRole('button',{name:'Add',exact:true}).click();await page.getByRole('button',{name:'Settings for Sessions',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Session ranges',exact:true});
 await expect(settings.getByLabel('Asia start',{exact:true})).toHaveValue('20:00');await expect(settings.getByLabel('Asia end',{exact:true})).toHaveValue('02:00');
 await expect(settings.getByLabel('NY AM start',{exact:true})).toHaveValue('07:00');
 await expect(settings.getByLabel('NY AM end',{exact:true})).toHaveValue('17:00');
 await expect(settings.getByLabel('Last session days (1–30)',{exact:true})).toHaveValue('5');
 await expect(settings).not.toContainText('VWAP');await expect(settings).not.toContainText('Trendline');
 await settings.getByLabel('NY AM color',{exact:true}).fill('#ff0000');
 await settings.getByRole('combobox',{name:'NY AM border',exact:true}).click();await page.getByRole('option',{name:'Dashed',exact:true}).click();
 await settings.getByLabel('Show session ranges',{exact:true}).check();await settings.getByLabel('Show dashboard',{exact:true}).check();
 await settings.getByRole('button',{name:'Save as my default',exact:true}).click();
 await expect(page.getByLabel('Session range overlays',{exact:true})).toBeVisible();expect(await page.getByLabel('Session range overlays',{exact:true}).evaluate(el=>parseFloat(el.style.left))).toBeGreaterThan(0);await expect(page.locator('.bt-session-dashboard')).toContainText('Asia');await expect.poll(()=>page.locator('.bt-session-ranges rect[stroke="#ff0000"][stroke-dasharray="5 4"]').count()).toBeGreaterThan(0);
 await page.reload();await expect(page.getByLabel('Session range overlays',{exact:true})).toBeVisible();
 const defaults=await (await page.request.get('http://127.0.0.1:8119/api/backtesting/chart-defaults')).json();
 expect(defaults.sessionRanges).toMatchObject({enabled:true,days:5,zone:'America/New_York'});
});

test('temporary execution timing diagnosis',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('primus-replay-profile','1');window.__primusReplayTimings=[]});
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 const started=Date.now();await page.getByRole('button',{name:'Buy',exact:true}).click();await expect(page.getByRole('group',{name:'Pending entry price box',exact:true})).toBeVisible();const click=Date.now()-started;
 let previews=0;page.on('request',r=>{if(r.url().includes('ticket-preview'))previews++});
 const handle=await page.getByRole('button',{name:'Drag stop price',exact:true}).boundingBox();
 const dragStarted=Date.now();await page.mouse.move(handle.x+20,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+20,handle.y+handle.height/2+40,{steps:100});await page.mouse.up();
 await expect(page.getByRole('button',{name:'Remove stop loss',exact:true})).toBeEnabled();
 const values=await page.evaluate(()=>window.__primusReplayTimings.filter(v=>v.name==='drag move handler'));
 console.log(JSON.stringify({clickVisible_ms:click,dragComplete_ms:Date.now()-dragStarted,previewRequests:previews,pointerCount:values.length,pointerPerSecond:values.length/((Date.now()-dragStarted)/1000),pointerMean_ms:values.reduce((n,v)=>n+v.ms,0)/values.length,pointerMax_ms:Math.max(...values.map(v=>v.ms))}));
});

test('order appears before slow acknowledgement; drag keeps replay moving, Escape cancels and drop commits once',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 let acknowledged=false;
 await page.route('**/api/backtesting/sessions/*/action',async route=>{if(route.request().postDataJSON().kind==='order'){await new Promise(r=>setTimeout(r,1000));await route.continue();acknowledged=true}else await route.continue()});
 await page.getByRole('button',{name:'Buy',exact:true}).click();
 await expect(page.getByRole('group',{name:'Pending entry price box',exact:true})).toBeVisible({timeout:600});expect(acknowledged).toBe(false);
 await expect(page.getByRole('button',{name:'Next candle',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Next candle',exact:true}).click();
 await expect(page.locator('.bt-position-strip')).toContainText('Long 1 NQ');
 let edits=0,previews=0;page.on('request',r=>{if(r.url().includes('ticket-preview'))previews++;if(r.url().endsWith('/action')&&r.postDataJSON().kind==='amend')edits++});
 await page.getByRole('button',{name:'Play replay',exact:true}).click();
 const clock=page.getByLabel('Replay time',{exact:true}),before=await clock.textContent();
 let handle=await page.getByRole('button',{name:'Drag target price',exact:true}).boundingBox();
 await page.mouse.move(handle.x+20,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+20,handle.y-50,{steps:30});
 await expect(clock).not.toHaveText(before);expect(edits).toBe(0);expect(previews).toBe(0);
 await page.keyboard.press('Escape');await page.mouse.up();expect(edits).toBe(0);
 await page.getByRole('button',{name:'Pause replay',exact:true}).click();
 handle=await page.getByRole('button',{name:'Drag stop price',exact:true}).boundingBox();
 const response=page.waitForResponse(r=>r.url().endsWith('/action')&&r.request().postDataJSON().kind==='amend');
 await page.mouse.move(handle.x+20,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+20,handle.y+60,{steps:20});await page.mouse.up();
 expect((await response).status()).toBe(200);expect(edits).toBe(1);expect(previews).toBe(0);
});

test('one toolbar targets the active pane, retains both charts and restores split layout',async({page},testInfo)=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 const esHistory=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.pathname.endsWith('/chart-history')&&url.searchParams.get('root')==='ES'&&url.searchParams.get('timeframe')==='1'&&response.ok();
 });
 await page.getByRole('button',{name:'Toggle two charts',exact:true}).click();
 const first=page.locator('[data-pane-id="primary"]'),second=page.locator('[data-pane-id="secondary"]');
 await expect(second.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByRole('group',{name:'Chart timeframe',exact:true})).toHaveCount(1);
 await expect(first.getByRole('button',{name:'Lines',exact:true})).toBeVisible();
 await expect(second.getByRole('button',{name:'Lines',exact:true})).toHaveCount(0);
 const divider=page.getByRole('separator',{name:'Resize split charts'});
 const startWidth=(await first.boundingBox()).width;
 const handleBounds=await divider.boundingBox();
 await page.mouse.move(handleBounds.x+handleBounds.width/2,handleBounds.y+handleBounds.height/2);
 await page.mouse.down();
 await page.mouse.move(handleBounds.x+handleBounds.width/2+130,handleBounds.y+handleBounds.height/2,{steps:6});
 await page.mouse.up();
 await expect.poll(async()=>(await first.boundingBox()).width).toBeGreaterThan(startWidth+90);
 await divider.dblclick();
 await expect.poll(async()=>Math.abs((await first.boundingBox()).width-startWidth)).toBeLessThan(2);

 await page.getByRole('button',{name:'Indicators',exact:true}).click();
 const indicators=page.getByRole('dialog',{name:'Indicators',exact:true});
 await expect(indicators.getByRole('region',{name:'Indicators on chart'})).toHaveCount(0);
 await indicators.getByRole('searchbox',{name:'Find an indicator'}).fill('Volume');
 await indicators.getByRole('button',{name:'Add Volume',exact:true}).click();
 await expect(indicators.getByRole('button',{name:'Add Volume',exact:true})).toBeDisabled();
 await indicators.getByRole('button',{name:'Done',exact:true}).click();
 const stay=first.getByRole('checkbox',{name:'Stay in drawing mode'});
 await expect(stay).toHaveCount(0);
 const magnet=first.getByRole('button',{name:'Magnet snap',exact:true});
 await magnet.hover();
 await first.getByRole('button',{name:'Magnet snap — more',exact:true}).press('Enter');
 await page.getByText('Strong',{exact:true}).click();
 for (const pane of [first,second]) {
  await first.getByRole('button',{name:'Lines',exact:true}).click();
  await pane.locator('.replay-chart').click({position:{x:240,y:220}});
  await pane.locator('.replay-chart').click({position:{x:420,y:260}});
 }
 await page.getByRole('button',{name:'Save session',exact:true}).click();
 const sessionId=new URL(page.url()).searchParams.get('session');
 const readLayouts=async()=>await (await page.request.get('http://127.0.0.1:8119/api/backtesting/sessions/'+sessionId+'/layouts')).json();
 const countDrawings=layout=>Object.values(layout?.drawings||{}).flatMap(doc=>doc.drawings).length;
 await expect.poll(async()=>{
  const layouts=await readLayouts();
  return [countDrawings(layouts.layout),countDrawings(layouts.layout_secondary)];
 }).toEqual([1,1]);
 const layouts=await readLayouts();
 const esBars=new Map((await (await esHistory).json()).bars.map(bar=>[bar.time,bar]));
 const esAnchors=Object.values(layouts.layout_secondary.drawings).flatMap(doc=>doc.drawings)[0].anchors;
 for(const anchor of esAnchors){
  const bar=esBars.get(anchor.time);
  expect(bar).toBeDefined();
  expect([bar.open,bar.high,bar.low,bar.close]).toContain(anchor.price);
 }
 for (const layout of [layouts.layout,layouts.layout_secondary]) {
  expect(layout.studies.some(study=>study.type==='volume')).toBe(false);
 }
 await first.locator('.bt-pane-tag').click();
 await page.evaluate(()=>{window.originalCharts=[...document.querySelectorAll('.replay-chart')];window.originalCanvases=[...document.querySelectorAll('.replay-chart canvas')]});
 await page.getByRole('button',{name:'1h',exact:true}).click();await expect(first.locator('.bt-pane-tag')).toHaveText('NQ · 1h');
 await second.locator('.bt-pane-tag').click();await expect(second).toHaveClass(/is-selected/);
 await expect(page.getByRole('combobox',{name:'Market',exact:true})).toHaveText('ES');
 await page.getByRole('button',{name:'15m',exact:true}).click();await expect(second.locator('.bt-pane-tag')).toHaveText('ES · 15m');await expect(first.locator('.bt-pane-tag')).toHaveText('NQ · 1h');
 await expect(second.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready');
 await page.getByRole('button',{name:'Play replay',exact:true}).click();const clock=first.getByLabel('Replay time',{exact:true}),before=await clock.textContent();
 await first.locator('.bt-pane-tag').click();await expect(page.getByRole('button',{name:'1h',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'5m',exact:true}).click();await expect(clock).not.toHaveText(before);await expect(page.getByRole('button',{name:'Pause replay',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Pause replay',exact:true}).click();
 expect(await first.getByLabel('Replay time',{exact:true}).getAttribute('datetime')).toBe(await second.getByLabel('Replay time',{exact:true}).getAttribute('datetime'));
 await second.locator('.bt-pane-tag').click();await page.getByRole('button',{name:'Sync crosshair',exact:true}).click();
 expect(await page.evaluate(()=>window.originalCharts.every((node,i)=>node===document.querySelectorAll('.replay-chart')[i])&&window.originalCanvases.every(node=>node.isConnected))).toBe(true);
 await page.getByRole('button',{name:'Save session',exact:true}).click();await page.reload();
 await expect(second.locator('.bt-pane-tag')).toHaveText('ES · 15m',{timeout:15000});await expect(first.locator('.bt-pane-tag')).toHaveText('NQ · 5m');await expect(second).toHaveClass(/is-selected/);
 await expect(page.getByRole('button',{name:'Sync crosshair',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:testInfo.outputPath('shared-toolbar-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 const a=await first.boundingBox(),b=await second.boundingBox();expect(b.y).toBeGreaterThan(a.y+a.height);expect(Math.abs(a.height-b.height)).toBeLessThan(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('shared-toolbar-phone.png')});
});

test('full calendar coverage, bounded 4h pages and free navigation preserve replay cutoff',async({page},testInfo)=>{
 let pages=0;const loaded=new Map();let selected='1';
 page.on('request',r=>{if(r.url().includes('/chart-history?'))pages++});
 page.on('response',async response=>{
  if(!response.url().includes('/chart-history?')||!response.ok())return;
  const query=new URL(response.url()).searchParams;if(query.get('root')!=='NQ')return;
  const {bars}=await response.json(),tf=query.get('timeframe');
  expect(bars.length).toBeLessThanOrEqual(750);
  const times=loaded.get(tf)||new Set();for(const bar of bars)times.add(bar.time);loaded.set(tf,times);
 });
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByLabel('Trading date',{exact:true}).fill('2023-09-12');await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 // Count fetched context: there is no candle-count label in the current UI.
 const count=async()=>loaded.get(selected)?.size||0;
 for(const [tf,min] of [['1D',700],['1W',600],['1M',150]]){
  selected=tf;await page.getByRole('button',{name:tf,exact:true}).click();await expect.poll(count).toBeGreaterThan(min);
 }
 selected='240';await page.getByRole('button',{name:'4h',exact:true}).click();await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready');
 expect(await count()).toBeLessThanOrEqual(750);
 await expect(page.getByLabel('Dataset coverage',{exact:true})).toHaveCount(0);
 const before=pages;
 // Pan well past the loaded left edge. The viewport stays free and older pages arrive.
 await page.mouse.move(650,350);await page.mouse.wheel(-12000,0);
 await expect.poll(()=>pages).toBeGreaterThan(before);await expect.poll(count).toBeGreaterThan(750);
 const clock=await page.getByLabel('Replay time',{exact:true}).getAttribute('datetime');
 await page.getByRole('button',{name:'1h',exact:true}).click();await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready');
 expect(await page.getByLabel('Replay time',{exact:true}).getAttribute('datetime')).toBe(clock);
 // Price-axis reset remains available after a vertical pan and zoom.
 await page.mouse.move(600,350);await page.mouse.down();await page.mouse.move(650,430,{steps:10});await page.mouse.up();
 await page.mouse.dblclick(1415,400);await page.mouse.move(650,350);await page.mouse.wheel(0,400);
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('paged-history-free-navigation.png')});
});

test('timeframe switching benchmark',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('primus-replay-profile','1');window.__primusReplayTimings=[]});
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByLabel('Trading date',{exact:true}).fill('2023-09-12');await page.getByRole('button',{name:'Open session',exact:true}).click();await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 for(const tf of ['4h','1D','1W','1M','4h','1D','1W','1M']){
  const n=await page.evaluate(()=>window.__primusReplayTimings.filter(x=>x.name.startsWith('switch:')).length);
  await page.getByRole('button',{name:tf,exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__primusReplayTimings.filter(x=>x.name.startsWith('switch:')).length),{timeout:20000}).toBeGreaterThan(n);
 }
 console.log(JSON.stringify(await page.evaluate(()=>window.__primusReplayTimings.filter(x=>x.name.startsWith('switch:')||x.name.startsWith('history-request:')))));
});

test('rapid timeframe changes cancel slow requests and keep the previous chart visible',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Open session',exact:true}).click();await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.route('**/chart-history?**',async route=>{if(new URL(route.request().url()).searchParams.get('timeframe')==='240')await new Promise(r=>setTimeout(r,1200));try{await route.continue()}catch{}});
 await page.getByRole('button',{name:'4h',exact:true}).click();await page.getByRole('button',{name:'1D',exact:true}).click();await page.getByRole('button',{name:'1W',exact:true}).click();await page.getByRole('button',{name:'1M',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:2000});await expect(page.getByRole('button',{name:'1M',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('alert')).toHaveCount(0);
});

test('indicator maximum interval hides Sessions above its limit and persists native study policy',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Indicators',exact:true}).click();
 await page.locator('.bt-study-row').filter({has:page.getByText('Sessions',{exact:true})}).first().getByRole('button',{name:'Add',exact:true}).click();
 await page.getByRole('button',{name:'Settings for Sessions',exact:true}).click();const modal=page.getByRole('dialog',{name:'Session ranges',exact:true});
 await modal.getByLabel('Maximum chart timeframe',{exact:true}).click();await page.getByRole('option',{name:'15m',exact:true}).click();await modal.getByRole('button',{name:'Save as my default',exact:true}).click();
 await expect(page.getByLabel('Session range overlays',{exact:true})).toBeVisible({timeout:15000});
 await page.getByRole('group',{name:'Chart timeframe',exact:true}).getByRole('button',{name:'1h',exact:true}).click();
 await expect(page.getByLabel('Session range overlays',{exact:true})).toHaveCount(0);
 await page.getByRole('group',{name:'Chart timeframe',exact:true}).getByRole('button',{name:'5m',exact:true}).click();
 await expect(page.getByLabel('Session range overlays',{exact:true})).toBeVisible({timeout:15000});
 await page.getByRole('button',{name:'Indicators',exact:true}).click();await page.getByLabel('Find an indicator',{exact:true}).fill('ema');
 const add=page.getByRole('button',{name:/^Add .*Moving Average/}).first();await add.click();await page.getByLabel('Find an indicator',{exact:true}).fill('');
 const maximum=page.getByLabel(/^Maximum timeframe for /).first();await maximum.click();await page.getByRole('option',{name:'15m',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('group',{name:'Chart timeframe',exact:true}).getByRole('button',{name:'1h',exact:true}).click();await page.getByRole('button',{name:'Save session',exact:true}).click();
 const sid=new URL(page.url()).searchParams.get('session');const saved=await (await page.request.get(`http://127.0.0.1:8119/api/backtesting/sessions/${sid}/layouts`)).json();
 expect(saved.layout.studies.find(x=>x.maximum==='15').visible).toBe(true);
 await page.reload();await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Indicators',exact:true}).click();await expect(page.getByLabel(/^Maximum timeframe for /).first()).toHaveAttribute('data-value','15');
});

test('Sync intervals follows either pane, persists and returns to independent intervals when disabled',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});await page.getByRole('button',{name:'Toggle two charts',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true}).last()).toHaveText('Chart ready',{timeout:15000});
 const sync=page.getByRole('button',{name:'Sync intervals',exact:true}),bar=page.getByRole('group',{name:'Chart timeframe',exact:true});
 await expect(sync).toHaveAttribute('aria-pressed','false');await sync.click();await bar.getByRole('button',{name:'1h',exact:true}).click();await expect(page.getByRole('button',{name:'ES · 1h',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'NQ · 1h',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'ES · 1h',exact:true}).click();await bar.getByRole('button',{name:'15m',exact:true}).click();await expect(page.getByRole('button',{name:'NQ · 15m',exact:true})).toBeVisible();await page.getByRole('button',{name:'Save session',exact:true}).click();
 const sid=new URL(page.url()).searchParams.get('session');
 await expect.poll(async()=>{const saved=await (await page.request.get(`http://127.0.0.1:8119/api/backtesting/sessions/${sid}/layouts`)).json();return [saved.layout?.timeframe,saved.layout_secondary?.timeframe,saved.layout?.chartGroup?.syncIntervals]}, {timeout:15000}).toEqual(['15','15',true]);
 await page.reload();await expect(sync).toHaveAttribute('aria-pressed','true',{timeout:15000});await expect(page.getByRole('button',{name:'ES · 15m',exact:true})).toBeVisible();await sync.click();await bar.getByRole('button',{name:'5m',exact:true}).click();await expect(page.getByRole('button',{name:'NQ · 15m',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'ES · 5m',exact:true})).toBeVisible();
});

test('native zoom limits keep the locked viewport sharp while horizontal paging stays free',async({page})=>{
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Trading date',{exact:true}).fill('2023-09-12');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByRole('button',{name:'Follow price',exact:true})).toHaveAttribute('aria-pressed','false');
 const sid=new URL(page.url()).searchParams.get('session');
 const snapshot=async()=>{
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.locator('.bt-save-status')).toHaveText('Saved');
  return (await (await page.request.get('http://127.0.0.1:8119/api/backtesting/sessions/'+sid+'/layouts')).json()).layout;
 };
 await page.mouse.move(650,350);
 for(let i=0;i<10;i++)await page.mouse.wheel(0,500);
 const wide=await snapshot();expect(wide.viewport.barSpacing).toBeGreaterThanOrEqual(2.5);
 const area=await page.locator('.replay-chart').boundingBox();
 expect(area.width/wide.viewport.barSpacing).toBeLessThanOrEqual(3000);
 await page.mouse.move(650,350);
 for(let i=0;i<10;i++)await page.mouse.wheel(0,-500);
 const zoomed=await snapshot();expect(zoomed.viewport.barSpacing).toBeLessThanOrEqual(1000);
 expect(zoomed.viewport.barSpacing).toBeGreaterThan(wide.viewport.barSpacing);
 // Horizontal wheel keeps both candle spacing and the stored vertical scale.
 await page.mouse.move(650,350);await page.mouse.wheel(-500,0);const panned=await snapshot();
 expect(panned.viewport.barSpacing).toBe(zoomed.viewport.barSpacing);
 expect(panned.viewport.rightOffset).not.toBe(zoomed.viewport.rightOffset);
 expect(panned.priceScale).toEqual(zoomed.priceScale);
 await page.getByRole('button',{name:'Next candle',exact:true}).click();
 const appended=await snapshot();expect(appended.viewport.barSpacing).toBe(panned.viewport.barSpacing);
 expect(appended.priceScale).toEqual(panned.priceScale);
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a stationary zoomed-out viewport stops paging and keeps its saved fractional viewport',async({page})=>{
 const requests=[],pending=new Set();page.on('request',request=>{
  if(!request.url().includes('/chart-history?'))return;
  const q=new URL(request.url()).searchParams;
  if(q.get('timeframe')==='1'&&(q.has('before')||q.has('after'))){requests.push(request.url());pending.add(request)}
 });
 page.on('requestfinished',request=>pending.delete(request));page.on('requestfailed',request=>pending.delete(request));
 const settled=async()=>expect.poll(async()=>{
  const count=requests.length;await page.waitForTimeout(350);return pending.size===0&&requests.length===count;
 },{timeout:15000}).toBe(true);
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Trading date',{exact:true}).fill('2023-09-12');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 const status=page.getByRole('status',{name:'Chart status',exact:true});
 await expect(status).toHaveText('Chart ready',{timeout:15000});
 const sid=new URL(page.url()).searchParams.get('session');
 const read=async()=>{
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.locator('.bt-save-status')).toHaveText('Saved');
  return (await (await page.request.get('http://127.0.0.1:8119/api/backtesting/sessions/'+sid+'/layouts')).json()).layout.viewport;
 };
 await page.mouse.move(650,350);
 for(let i=0;i<16;i++)await page.mouse.wheel(0,1000);
 await page.waitForTimeout(1000);const before=await read(),count=requests.length;
 expect(before.barSpacing).toBeGreaterThanOrEqual(2.5);
 await page.waitForTimeout(1500);const after=await read();
 expect(after).toEqual(before);expect(requests.length).toBe(count);
 await expect(status).toHaveText('Chart ready');await expect(page.getByRole('alert')).toHaveCount(0);
 // Zooming at the floor does not generate another stream of page requests.
 await page.mouse.move(650,350);for(let i=0;i<10;i++)await page.mouse.wheel(0,1000);
 await page.waitForTimeout(1000);expect(requests.length).toBe(count);expect(await read()).toEqual(before);
 // Cross the full 3000-bar memory window, including an actual opposite-edge trim.
 await page.mouse.move(650,350);await page.mouse.wheel(-12000,0);
 await expect.poll(()=>requests.length,{timeout:15000}).toBeGreaterThanOrEqual(count+4);await settled();
 const leftRequests=requests.length,left=await read();
 expect(requests.slice(count).every(url=>new URL(url).searchParams.has('before'))).toBe(true);
 expect(left.barSpacing).toBe(before.barSpacing);
 await page.waitForTimeout(1200);expect(requests.length).toBe(leftRequests);expect(await read()).toEqual(left);
 // A real opposite pan can fetch newer history; replacement events cannot.
 await page.mouse.move(650,350);await page.mouse.wheel(12000,0);
 await expect.poll(()=>requests.length,{timeout:15000}).toBeGreaterThan(leftRequests);await settled();
 const rightRequests=requests.length,right=await read();
 expect(requests.slice(leftRequests).every(url=>new URL(url).searchParams.has('after'))).toBe(true);
 expect(right.barSpacing).toBe(before.barSpacing);
 await page.waitForTimeout(1200);expect(requests.length).toBe(rightRequests);expect(await read()).toEqual(right);
 await expect(page.getByRole('alert')).toHaveCount(0);

});

test('replay chart runs without news controls or background news requests',async({page})=>{
 const requests=[];page.on('request',r=>{if(r.url().includes('/api/replay/news'))requests.push(r.url())});
 await page.goto('http://127.0.0.1:8119/backtesting');await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByRole('button',{name:'Economic news',exact:true})).toHaveCount(0);
 await expect(page.getByRole('complementary',{name:'Economic news',exact:true})).toHaveCount(0);
 expect(requests).toEqual([]);
});

test('failed timeframe history waits for explicit retry without a loading loop',async({page})=>{
 let attempts=0,fail=true;
 await page.route('**/chart-history?**',route=>{
  if(new URL(route.request().url()).searchParams.get('timeframe')==='5'){
   attempts++;if(fail)return route.fulfill({status:503,json:{detail:'History temporarily unavailable'}});
  }
  return route.continue();
 });
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Trading date',{exact:true}).fill('2023-09-12');
 await page.getByRole('button',{name:'Open session',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:'5m',exact:true}).click();
 await expect(page.getByText('History temporarily unavailable',{exact:true})).toBeVisible();
 const count=attempts;await page.waitForTimeout(1800);expect(attempts).toBe(count);
 fail=false;await page.getByRole('button',{name:'Retry chart history',exact:true}).click();
 await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await expect(page.getByRole('alert')).toHaveCount(0);expect(attempts).toBe(count+1);
});

test('opens three preselected charts in a large-left layout and restores them', async ({page}) => {
  await page.goto('http://127.0.0.1:8119/backtesting');
  await page.getByRole('button', {name: 'New session', exact: true}).click();
  const setup = page.getByRole('dialog', {name: 'New backtesting session'});
  await setup.getByLabel('Session name').fill('Three chart layout');
  await setup.getByLabel('Trading date').fill('2010-06-07');
  await setup.getByRole('button', {name: 'Three charts', exact: true}).click();
  await setup.getByRole('button', {name: 'Open session', exact: true}).click();

  const primary = page.locator('[data-pane-id="primary"]');
  const secondary = page.locator('[data-pane-id="secondary"]');
  const tertiary = page.locator('[data-pane-id="tertiary"]');
  await expect(primary.getByRole('status', {name: 'Chart status', exact: true})).toHaveText('Chart ready', {timeout: 15000});
  await expect(secondary.locator('.bt-pane-tag')).toContainText('ES');
  await expect(tertiary.locator('.bt-pane-tag')).toContainText('NQ');
  const [left, top, bottom] = await Promise.all([primary.boundingBox(), secondary.boundingBox(), tertiary.boundingBox()]);
  expect(left.width).toBeGreaterThan(top.width);
  expect(top.x).toBe(bottom.x);
  expect(bottom.y).toBeGreaterThan(top.y);

  const widthDivider = page.getByRole('separator', {name: 'Resize split charts'});
  const heightDivider = page.getByRole('separator', {name: 'Resize right charts'});
  const handle = await widthDivider.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 70, handle.y + handle.height / 2, {steps: 4});
  await page.mouse.up();
  await expect.poll(async () => (await primary.boundingBox()).width).toBeGreaterThan(left.width + 40);
  await heightDivider.press('ArrowDown');
  await expect.poll(async () => (await secondary.boundingBox()).height).toBeGreaterThan(top.height);
  const savedWidth = await widthDivider.getAttribute('aria-valuenow');

  const clock = primary.getByLabel('Replay time', {exact: true});
  const before = await clock.textContent();
  await page.getByRole('button', {name: 'Next candle', exact: true}).click();
  await expect(clock).not.toHaveText(before);
  await page.getByRole('button', {name: 'Save session', exact: true}).click();
  await expect(primary.locator('.bt-save-status')).toHaveText('Saved');
  await page.reload();
  await expect(tertiary.locator('.bt-pane-tag')).toContainText('NQ', {timeout: 15000});
  await expect(widthDivider).toHaveAttribute('aria-valuenow', savedWidth);
  await expect(heightDivider).toHaveAttribute('aria-valuenow', '52');
  const savedClock = await clock.textContent();
  await page.getByRole('button', {name: 'Toggle two charts', exact: true}).click();
  await expect(tertiary).toHaveCount(0);
  await expect(secondary).toBeVisible();
  await page.getByRole('button', {name: 'Single chart', exact: true}).click();
  await expect(secondary).toHaveCount(0);
  await expect(clock).toHaveText(savedClock);
  await page.getByRole('button', {name: 'Toggle three charts', exact: true}).click();
  await expect(tertiary.locator('.bt-pane-tag')).toContainText('NQ');
  await expect(clock).toHaveText(savedClock);
});
