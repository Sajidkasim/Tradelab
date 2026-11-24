import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
const day='2026-08-12';
async function choose(card,label,value){await card.getByRole('combobox',{name:label,exact:true}).click();await card.getByRole('option',{name:value,exact:true}).click()}

test('reopens and saves changes to an existing trade on a past journal day',async({page})=>{
  await page.addInitScript(() => localStorage.setItem('primus_journal_autosave', 'false'));
  await page.goto(`${origin}/journal?day=2026-08-17`);
  await page.getByRole('button',{name:'Add trade',exact:true}).click();
  const card=page.getByRole('article',{name:'Journal trade 1',exact:true});
  const notes=card.getByRole('textbox',{name:'Trade notes',exact:true});
  await notes.fill('Original notes');
  await card.getByRole('button',{name:'Save trade',exact:true}).click();
  await expect(page.getByText('Entry saved for this local preview.',{exact:true})).toBeVisible();
  await page.reload();

  await card.getByRole('button',{name:/Edit trade/}).click();
  await expect(notes).toHaveValue('Original notes');
  await notes.fill('Amended notes');
  await card.getByRole('button',{name:'Loss',exact:true}).click();
  await card.getByRole('button',{name:'Save trade',exact:true}).click();
  await expect(page.getByText('Entry saved for this local preview.',{exact:true})).toBeVisible();
  await page.reload();

  await card.getByRole('button',{name:/Edit trade/}).click();
  await expect(notes).toHaveValue('Amended notes');
  await expect(card.getByRole('button',{name:'Loss',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('article',{name:/Journal trade/})).toHaveCount(1);
});

test('daily Journal saves trade cards and charts, marks the calendar, browses history and adds one linked Lab trade',async({page},info)=>{
  await page.goto(`${origin}/journal?day=${day}`);
  await expect(page.getByRole('heading',{name:'12 August 2026',exact:true})).toBeVisible();
  const before=await (await page.request.get(`${origin}/api/trades`)).json();
  await page.getByRole('textbox',{name:'Before the session',exact:true}).fill('Wait for a reaction at the level.');
  await page.getByRole('button',{name:'Add trade',exact:true}).click();
  const card=page.getByRole('article',{name:'Journal trade 1',exact:true});
  await expect(card.getByRole('button',{name:'Not recorded',exact:true})).toHaveCount(0);
  await expect(card.locator('.pj-outcome button[aria-pressed=true]')).toHaveCount(0);
  await card.getByRole('button',{name:'Win',exact:true}).click();
  await card.getByRole('checkbox',{name:'SMT',exact:true}).check();
  await choose(card,'Market','NQ');await choose(card,'Buy or sell','Buy');
  await choose(card,'Strategy','Displacement continuation');
  await card.getByRole('textbox',{name:'Trade notes',exact:true}).fill('Took the long after confirmation.');
  await card.getByLabel('Entry time',{exact:true}).fill('09:45');
  await card.getByText('Setup & result',{exact:false}).first().click();
  await choose(card,'Key level / PDA','FVG');
  await choose(card,'Key level timeframe','4H');
  await choose(card,'Entry timeframe','1m');
  await card.getByRole('spinbutton',{name:'Amount risked ($)',exact:true}).fill('50');
  await card.getByRole('spinbutton',{name:'Profit / loss ($)',exact:true}).fill('150');
  await card.getByLabel('Upload screenshot for trade 1',{exact:true}).setInputFiles('../assets/primus-compass.png');
  await expect(card.getByRole('button',{name:'Open screenshot 1',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add trade',exact:true}).click();
  const second=page.getByRole('article',{name:'Journal trade 2',exact:true});
  await choose(second,'Market','NQ');await choose(second,'Buy or sell','Sell');await choose(second,'Strategy','Range reversal');
  await page.getByRole('tab',{name:/After the session/}).click();
  await page.getByRole('textbox',{name:'After the session',exact:true}).fill('My entries were patient. Keep the same process.');
  await page.getByRole('button',{name:'Save entry',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'12 August 2026',exact:true})).toHaveClass(/has-entry/);
  expect(await (await page.request.get(`${origin}/api/trades`)).json()).toEqual(before);
  await page.reload();
  await expect(page.getByRole('article',{name:'Journal trade 2',exact:true})).toBeVisible();
  await card.locator('.pj-trade-summary').click();
  await expect(card.getByRole('button',{name:'Win',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(card.getByRole('checkbox',{name:'SMT',exact:true})).toBeChecked();
  await expect(card.getByRole('textbox',{name:'Trade notes',exact:true})).toHaveValue('Took the long after confirmation.');
  await expect(card.getByRole('spinbutton',{name:'Amount risked ($)',exact:true})).toHaveValue('50');
  await expect(card.getByRole('spinbutton',{name:'Profit / loss ($)',exact:true})).toHaveValue('150');
  await expect(card.getByRole('button',{name:'Open screenshot 1',exact:true})).toBeVisible();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.getByRole('button',{name:'12 August 2026',exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath(`journal-trades-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await card.getByRole('button',{name:'Add to Strategy Lab',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add Journal trade to Strategy Lab',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox',{name:'SMT',exact:true})).toBeChecked();
  await expect(dialog.getByRole('spinbutton',{name:'Net result ($)',exact:true})).toHaveValue('150');
  await expect(dialog.getByRole('spinbutton',{name:'Original risk ($)',exact:true})).toHaveValue('50');
  await dialog.getByRole('button',{name:'Save to Strategy Lab',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole('link',{name:'Open in Lab',exact:true})).toBeVisible();
  const after=await (await page.request.get(`${origin}/api/trades`)).json();
  expect(after.length).toBe(before.length+1);
  await card.getByRole('link',{name:'Open in Lab',exact:true}).click();
  await expect(page.getByRole('link',{name:'Open this trade’s Journal entry',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Open this trade’s Journal entry',exact:true}).click();
  await expect(card.getByRole('textbox',{name:'Trade notes',exact:true})).toHaveValue('Took the long after confirmation.');
  await page.getByRole('button',{name:'13 August 2026',exact:true}).click();
  await expect(page.getByRole('article',{name:'Journal trade 1',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Edit entry 12 August 2026',exact:true}).click();
  await expect(page.getByRole('article',{name:'Journal trade 2',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'12 August 2026',exact:true})).toBeFocused();
  await expect(page).toHaveURL(/day=2026-08-12/);
  await page.getByRole('tab',{name:/Before the session/}).click();
  const plan = page.getByRole('textbox',{name:'Before the session',exact:true});
  await plan.fill('Updated the plan after reviewing this past session.');
  await page.locator('#journal-entry').getByRole('button',{name:'Save entry',exact:true}).click();
  await expect(page.getByText(/Entry saved/)).toBeVisible();
  await page.reload();
  await expect(plan).toHaveValue('Updated the plan after reviewing this past session.');
  await expect(page.getByRole('article',{name:'Journal trade 2',exact:true})).toBeVisible();
});

test('Journal entry deletion is confirmed, reversible and leaves Lab trades alone',async({page})=>{
  await page.goto(`${origin}/journal?day=2026-09-15`);
  await page.getByRole('textbox',{name:'Before the session',exact:true}).fill('An entry to restore.');
  await page.getByRole('button',{name:'Save entry',exact:true}).first().click();
  await expect(page.getByText('Entry saved for this local preview.',{exact:true})).toBeVisible();
  const before=await (await page.request.get(`${origin}/api/trades`)).json();
  await page.getByRole('button',{name:'Delete journal entry',exact:true}).click();
  await page.getByRole('button',{name:'Keep entry',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Before the session',exact:true})).toHaveValue('An entry to restore.');
  await page.getByRole('button',{name:'Delete journal entry',exact:true}).click();
  await page.getByRole('dialog',{name:'Delete journal entry?',exact:true}).getByRole('button',{name:'Delete entry',exact:true}).click();
  await expect(page.getByRole('button',{name:'15 September 2026',exact:true})).not.toHaveClass(/has-entry/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Before the session',exact:true})).toHaveValue('An entry to restore.');
  await page.getByRole('button',{name:'Delete journal entry',exact:true}).click();
  await page.getByRole('dialog',{name:'Delete journal entry?',exact:true}).getByRole('button',{name:'Delete entry',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'Deleted entries',exact:true}).click();
  await page.getByRole('dialog',{name:'Deleted entries',exact:true}).getByRole('button',{name:'Restore',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Before the session',exact:true})).toHaveValue('An entry to restore.');
  expect(await (await page.request.get(`${origin}/api/trades`)).json()).toEqual(before);
});

test('Lab Add trade protects notes and inputs from backdrop, Escape and Cancel',async({page})=>{
 await page.goto(`${origin}/lab#trades`);await page.getByRole('button',{name:'Add trade',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Add trade',exact:true});
 await form.getByText('Timing & notes',{exact:true}).click();
 await form.getByRole('textbox',{name:'One useful observation',exact:true}).fill('Important notes that must not disappear.');
 let prompts=0;page.on('dialog',async dialog=>{prompts++;expect(dialog.message()).toContain('unsaved trade details and notes');await dialog.dismiss()});
 await page.keyboard.press('Escape');await expect(form).toBeVisible();await expect(form.getByRole('textbox',{name:'One useful observation',exact:true})).toHaveValue('Important notes that must not disappear.');
 await page.mouse.click(2,2);await expect(form).toBeVisible();
 await form.getByRole('button',{name:'Cancel',exact:true}).click();await expect(form).toBeVisible();expect(prompts).toBe(3);
 page.removeAllListeners('dialog');page.once('dialog',d=>d.accept());await form.getByRole('button',{name:'Close',exact:true}).click();await expect(form).toHaveCount(0);
 await page.getByRole('button',{name:'Add trade',exact:true}).click();await form.getByRole('button',{name:'Cancel',exact:true}).click();await expect(form).toHaveCount(0);
});

test('Journal-only grades persist and calendar dots follow whole-day P&L',async({page})=>{
 const resultDay='2026-09-18';await page.goto(`${origin}/journal?day=${resultDay}`);
 await page.getByRole('button',{name:'Add trade',exact:true}).click();const card=page.getByRole('article',{name:'Journal trade 1',exact:true});await choose(card,'Setup grade','A+ setup');
 await card.getByText('Setup & result',{exact:false}).first().click();await card.getByRole('spinbutton',{name:'Profit / loss ($)',exact:true}).fill('100');
 await page.getByRole('button',{name:'Save entry',exact:true}).first().click();const calendar=page.getByRole('button',{name:'18 September 2026',exact:true});await expect(calendar.locator('.pj-day-dot.win')).toBeVisible();await expect(page.getByLabel('Day profit and loss')).toContainText('$100.00');
 await page.reload();await card.locator('.pj-trade-summary').click();await expect(card.getByRole('combobox',{name:'Setup grade',exact:true})).toHaveText('A+ setup');
 await page.getByRole('button',{name:'Add trade',exact:true}).click();const second=page.getByRole('article',{name:'Journal trade 2',exact:true});await choose(second,'Setup grade','B setup');await second.getByText('Setup & result',{exact:false}).first().click();await second.getByRole('spinbutton',{name:'Profit / loss ($)',exact:true}).fill('-150');
 await page.getByRole('button',{name:'Save entry',exact:true}).first().click();await expect(calendar.locator('.pj-day-dot.loss')).toBeVisible();await expect(page.getByLabel('Day profit and loss')).toContainText('-$50.00');
 await second.getByRole('spinbutton',{name:'Profit / loss ($)',exact:true}).fill('-100');await page.getByRole('button',{name:'Save entry',exact:true}).first().click();await expect(calendar.locator('.pj-day-dot.breakeven')).toBeVisible();
 await second.getByRole('spinbutton',{name:'Profit / loss ($)',exact:true}).fill('');await page.getByRole('button',{name:'Save entry',exact:true}).first().click();await expect(calendar.locator('.pj-day-dot')).toHaveCount(0);await expect(page.getByLabel('Day profit and loss')).toContainText('incomplete');
});

for (const [device,viewport,day] of [
  ['desktop',{width:1440,height:1000},'2026-08-21'],
  ['mobile',{width:390,height:844},'2026-08-20'],
]) {
test(`local chart scan reuses its worker on ${device}`, async ({page}) => {
  await page.setViewportSize(viewport);
  const ocrWorkers = [];
  let closedWorkers = 0;
  page.on('worker',worker=>{
    if(!new URL(worker.url()).pathname.includes('/worker.min-'))return;
    ocrWorkers.push(worker);
    worker.on('close',()=>closedWorkers++);
  });
  await page.route('**/api/session', async route => {
    const response = await route.fetch();
    await route.fulfill({response, json: {...await response.json(), chart_vision_cloud_enabled: true}});
  });
  let cloudScans = 0;
  await page.route('**/api/vision/extract', async route => {
    cloudScans++;
    expect(route.request().postDataBuffer().length).toBeLessThan(540000);
    await route.fulfill({json: {findings: [
      {kind: 'confirmation', value: 'SMT', text: 'SMT', box: {x:.2,y:.3,width:.12,height:.1}},
    ]}});
  });
  await page.goto(`${origin}/journal?day=${day}`);
  await page.getByRole('button', {name: 'Add trade', exact: true}).click();
  const card = page.getByRole('article', {name: 'Journal trade 1', exact: true});
  await choose(card, 'Buy or sell', 'Buy');
  const encoded = await page.evaluate(() => {
    const canvas=document.createElement('canvas');
    canvas.width=1600;
    canvas.height=800;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,1600,800);
    ctx.fillStyle='#afe9d8';ctx.fillRect(570,235,410,155);
    ctx.fillStyle='#efa6a3';ctx.fillRect(570,390,410,93);
    ctx.fillStyle='black';ctx.font='bold 38px sans-serif';
    ctx.fillText('NQ  1m',40,63);ctx.fillText('MSS',480,364);
    return canvas.toDataURL().split(',')[1];
  });
  const upload=card.getByLabel('Choose chart to scan');
  const initialStarted = performance.now();
  await upload.setInputFiles({name:'chart.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')});
  await expect(card.getByRole('combobox', {name:'Market',exact:true})).toHaveText('NQ',{timeout:45000});
  await expect(card.getByRole('combobox', {name:'Buy or sell',exact:true})).toHaveText('Buy');
  await expect(card.getByRole('checkbox', {name:/^MSS/})).toBeChecked();
  const initialMs = performance.now()-initialStarted;
  expect(ocrWorkers).toHaveLength(1);
  expect(cloudScans).toBe(0);
  await card.getByRole('checkbox', {name:/^MSS/}).focus();
  await expect(card.getByRole('button', {name:'Add MSS to confirmations'})).toHaveClass(/is-highlighted/);
  await card.getByRole('checkbox', {name:/^MSS/}).uncheck();
  await card.getByRole('button', {name:'Improve with Cloudflare'}).click();
  await expect(card.getByRole('checkbox', {name:/^SMT/})).toBeChecked();
  await expect(card.getByRole('checkbox', {name:/^MSS/})).not.toBeChecked();
  expect(cloudScans).toBe(1);
  await card.getByRole('button',{name:'Rescan a label',exact:true}).click();
  const labelArea=card.getByRole('button',{name:'Pick label area on chart',exact:true});
  const bounds=await labelArea.boundingBox();
  const rescanStarted = performance.now();
  await labelArea.click({position:{x:bounds.width*.327,y:bounds.height*.435}});
  await expect(card.getByRole('button',{name:'Add MSS',exact:true})).toBeVisible({timeout:10000});
  const rescanMs = performance.now()-rescanStarted;
  expect(ocrWorkers).toHaveLength(1);
  console.log(`OCR ${device}: full chart ${Math.round(initialMs)} ms, label rescan ${Math.round(rescanMs)} ms`);
  await card.getByRole('button',{name:'Add MSS',exact:true}).click();
  await expect(card.getByRole('checkbox', {name:/^MSS/})).toBeChecked();
  expect(cloudScans).toBe(1);

  await card.getByText('Remember a chart label',{exact:true}).click();
  await card.getByLabel('Chart text',{exact:true}).fill('CHOCH');
  await card.getByLabel('Journal confirmation',{exact:true}).selectOption('MSS');
  await card.getByRole('button',{name:'Save mapping',exact:true}).click();
  await expect(card.getByText('CHOCH → MSS',{exact:true})).toBeVisible();

  await card.getByText('Projection & trade result',{exact:true}).click();
  await expect(card.getByText(/Planned R:R 1:/)).toBeVisible();
  await card.getByLabel('Entry price',{exact:true}).fill('26923.25');
  await card.getByLabel('Stop price',{exact:true}).fill('26839.25');
  await card.getByLabel('Target price',{exact:true}).fill('27133.25');
  await card.getByLabel('Actual exit price',{exact:true}).fill('27100');
  await card.getByRole('button',{name:'Use R:R and outcome',exact:true}).click();
  await expect(card.getByRole('button',{name:'Win',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(card.getByText('1:2.50',{exact:true})).toBeVisible();
  await card.getByText('Setup & result',{exact:false}).first().click();
  await card.getByRole('spinbutton',{name:'Amount risked ($)',exact:true}).fill('100');
  await card.getByRole('spinbutton',{name:'Profit / loss ($)',exact:true}).fill('140');
  await expect(card.locator('.pj-trade-metrics').getByText('+1.40R',{exact:true})).toBeVisible();
  await page.locator('#journal-entry').getByRole('button',{name:'Save entry',exact:true}).click();
  await expect(page.getByText(/Entry saved/)).toBeVisible();
  await card.locator('.pj-trade-summary').click();
  await expect.poll(()=>closedWorkers).toBe(1);
  await page.reload();
  await expect(card.getByText('1:2.50',{exact:true})).toBeVisible();

});
}
