import { test, expect } from '@playwright/test';
const origin='http://127.0.0.1:8119';

test('Lab matches the Primus shell and keeps filters, settings and its phone guide usable',async({page},info)=>{
  await page.goto(origin);
  const brand=await page.getByRole('link',{name:'PrimusTrader home',exact:true}).boundingBox();
  const nav=await page.getByRole('navigation',{name:'Primus navigation'}).boundingBox();
  await page.getByRole('navigation',{name:'Primus navigation'}).getByRole('link',{name:'Strategy Lab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  await expect(page.getByText('Up to date',{exact:true})).toBeVisible();
  const labBrand=await page.getByRole('link',{name:'PrimusTrader home',exact:true}).boundingBox();
  const labNav=await page.getByRole('navigation',{name:'Primus navigation'}).boundingBox();
  expect(labBrand.x).toBe(brand.x);expect(labBrand.y).toBe(brand.y);
  expect(Math.abs(labNav.x-nav.x)).toBeLessThan(2);
  await page.getByRole('combobox',{name:'Strategy',exact:true}).click();
  await page.getByRole('option',{name:'Reversal at key level',exact:true}).click();
  await expect(page.locator('.results-caption')).toContainText('Reversal at key level');
  await expect(page.getByText('Up to date',{exact:true})).toBeVisible();
  expect(await page.locator('.history-card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('5px');
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`primus-lab-${width}.png`),fullPage:true});
    if(width<521)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await page.getByRole('button',{name:'My lab',exact:true}).click();
    await page.getByRole('button',{name:'Lab settings',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Lab settings',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Lab settings',exact:true})).toHaveCount(0);
    if(width<521)await page.getByRole('button',{name:'Close navigation',exact:true}).click();
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.locator('.history-card').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(19, 24, 22)');
  await page.screenshot({path:info.outputPath('primus-lab-dark.png'),fullPage:true});
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'Light mode',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'Quick guide',exact:true}).click();
  for(let i=0;i<4;i++)await page.locator('.guided-tour').getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.guided-tour').getByRole('heading',{name:'Make the lab yours',exact:true})).toBeVisible();
  await expect(page.locator('.workspace-menu .menu-panel')).toBeVisible();
  await page.locator('.guided-tour').getByRole('button',{name:'Skip guide',exact:true}).click();
});

test('Primus home shows the actual five traders and responsive private-tool links',async({page},info)=>{
  await page.route('https://s3.tradingview.com/**',route=>route.fulfill({contentType:'application/javascript',body:'document.body.dataset.widgetLoaded="yes";'}));
  await page.goto(origin);
  await expect(page.getByRole('heading',{name:'Less noise. More perspective.',exact:true})).toBeVisible();
  expect(await page.locator('#briefing').evaluate(el=>el.compareDocumentPosition(document.querySelector('.pt-tools-section'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(page.getByText('02 / THE MARKET BRIEFING',{exact:true})).toBeVisible();
  await expect(page.getByText('03 / YOUR WORKSPACE',{exact:true})).toBeVisible();
  for(const name of ['Sajid Kasim','Safwaan Alad','Mubeen Patel','Mustafa Dal','Amir Patel'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width<521){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('navigation',{name:'Primus navigation'})).toBeVisible();await page.getByRole('button',{name:'Close navigation',exact:true}).click()}
    await page.screenshot({path:info.outputPath(`primus-home-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Economic calendar',exact:true}).click();
  await expect(page.getByTitle('TradingView economic calendar')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open full economic calendar on TradingView'})).toHaveAttribute('href','https://www.tradingview.com/economic-calendar/');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('link',{name:'Explore the Lab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Primus navigation'}).getByRole('link',{name:'Journal',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Pause. Put it on paper.',exact:true})).toBeVisible();
});

test('private daily notes and screenshots persist across reload and image removal preserves unsaved writing',async({page},info)=>{
  await page.goto(`${origin}/journal`);
  await page.getByRole('tab',{name:/Before the session/}).click();
  await page.getByRole('textbox',{name:'Before the session',exact:true}).fill('Wait for the reaction at the level. Local test only.');
  await page.getByRole('tab',{name:/During the session/}).click();
  await page.getByRole('textbox',{name:'During the session',exact:true}).fill('Recorded the entry and waited for confirmation.');
  await page.getByRole('tab',{name:/After the session/}).click();
  await page.getByRole('textbox',{name:'After the session',exact:true}).fill('Patience is part of the setup.');
  await page.getByRole('button',{name:'Patient',exact:true}).click();
  await page.getByRole('button',{name:'Save entry',exact:true}).first().click();
  await expect(page.getByText('Entry saved for this local preview.',{exact:true})).toBeVisible();
  await page.getByLabel('Upload screenshot',{exact:true}).setInputFiles('../assets/primus-compass.png');
  await expect(page.getByRole('button',{name:'Open screenshot 1',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Before the session',exact:true})).toHaveValue('Wait for the reaction at the level. Local test only.');
  await expect(page.getByRole('button',{name:'Patient',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Open screenshot 1',exact:true}).click();
  await expect(page.getByAltText('Expanded trading screenshot')).toBeVisible();
  await page.getByRole('button',{name:'Close screenshot',exact:true}).click();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`primus-journal-${width}.png`),fullPage:true});
  }
  await page.getByRole('textbox',{name:'Before the session',exact:true}).fill('Unsaved writing must survive image removal.');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove screenshot 1',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open screenshot 1',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Before the session',exact:true})).toHaveValue('Unsaved writing must survive image removal.');
  await page.getByRole('button',{name:'Save entry',exact:true}).first().click();
  const download=page.waitForEvent('download');
  await page.getByRole('link',{name:'Download your Journal',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('primus-journal-notes.json');
});

test('dark mode persists across Home, Journal and Lab with readable surfaces and matching embeds',async({page},info)=>{
  await page.route('https://s3.tradingview.com/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto(origin);
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.locator('.pt-site').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(12, 15, 14)');
  for(const selector of ['.pt-trader','.pt-section-heading>p','.pt-tool-journal','.pt-widget-source']){
    await expect.poll(()=>page.locator(selector).first().evaluate(el=>{
      const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
      const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      let bg=el;while(bg.parentElement&&getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;
      const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(getComputedStyle(bg).backgroundColor));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    }),{message:`Dark contrast: ${selector}`}).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByRole('button',{name:'Economic calendar',exact:true}).click();
  await expect(page.getByTitle('TradingView economic calendar')).toHaveAttribute('srcdoc',/"colorTheme":"dark"/);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:info.outputPath('home-dark.png'),fullPage:true});
  await page.getByRole('navigation',{name:'Primus navigation'}).getByRole('link',{name:'Journal',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Pause. Put it on paper.',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.locator('.pt-day-editor').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(19, 24, 22)');
  await page.getByRole('button',{name:'Patient',exact:true}).click();
  await page.getByRole('button',{name:'Save entry',exact:true}).first().click();
  await expect(page.getByText('Entry saved for this local preview.',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('journal-dark.png'),fullPage:true});
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.getByRole('button',{name:'Switch to light mode',exact:true})).toBeVisible();
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('navigation',{name:'Primus navigation'}).getByRole('link',{name:'Strategy Lab',exact:true}).click();
  await expect(page.getByText('Up to date',{exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'Light mode',exact:true}).click();
  await page.getByRole('link',{name:'PrimusTrader home',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.getByRole('button',{name:'Switch to dark mode',exact:true})).toBeVisible();
});

test('Lab uses the Primus loading logo and exposes its theme button on desktop and phone',async({page},info)=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/session',async route=>{await gate;await route.continue()});
  await page.goto(`${origin}/lab`);
  await expect(page.getByRole('heading',{name:'Your Strategy Lab',exact:true})).toBeVisible();
  await expect(page.getByAltText('Primus compass',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('lab-loading.png')});
  release();
  await expect(page.getByText('Up to date',{exact:true})).toBeVisible();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:950});
    await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  }
});

test('navigation order and Journal account management', async ({page}) => {
  await page.goto(origin + '/journal');
  const nav = page.getByRole('navigation', {name: 'Primus navigation'});
  await expect(nav.getByRole('link')).toHaveText(['Journal', 'Strategy Lab', 'Mindset', 'Backtesting', 'Learn Beta', 'The Matrix']);
  await expect(nav.getByRole('button', {name: /glossary/i})).toHaveCount(0);
  await page.locator('.pj-accounts > summary').click();
  await page.getByRole('button', {name: 'Add account', exact: true}).click();
  const form = page.getByRole('dialog', {name: 'Add account'});
  await form.getByLabel('Account name').fill('Browser evaluation');
  await form.getByLabel('Account size ($)').fill('25000');
  await form.getByLabel('Account type').selectOption('Eval');
  await form.getByRole('button', {name: 'Save account'}).click();
  const row = page.locator('.pj-account-row').filter({hasText: 'Browser evaluation'});
  await expect(row).toContainText('$25,000.00 · Eval');
  await row.getByRole('button', {name: 'Edit Browser evaluation'}).click();
  const edit = page.getByRole('dialog', {name: 'Edit account'});
  await edit.getByLabel('Account type').selectOption('Funded');
  await edit.getByRole('button', {name: 'Save account'}).click();
  await expect(row).toContainText('Funded');
  await row.getByRole('button', {name: 'Delete Browser evaluation'}).click();
  await page.getByRole('dialog', {name: 'Delete account?'}).getByRole('button', {name: 'Cancel'}).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', {name: 'Delete Browser evaluation'}).click();
  await page.getByRole('dialog', {name: 'Delete account?'}).getByRole('button', {name: 'Delete account', exact: true}).click();
  await expect(row).toHaveCount(0);
});
