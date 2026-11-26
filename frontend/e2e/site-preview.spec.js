import { test, expect } from '@playwright/test';
const origin='http://127.0.0.1:8119';

test('Lab matches the Primus shell and keeps filters, settings and its phone guide usable',async({page},info)=>{
  await page.goto(origin);
  const brand=await page.getByRole('link',{name:'PrimusTrader home',exact:true}).boundingBox();
  const nav=await page.getByRole('navigation',{name:'Primus navigation'}).boundingBox();
  await page.getByRole('navigation',{name:'Primus navigation'}).getByRole('link',{name:'Strategy Lab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Equity curve',exact:true})).toBeVisible();
  await expect(page.locator('.results-content')).toHaveAttribute('aria-busy','false');
  const labBrand=await page.getByRole('link',{name:'PrimusTrader home',exact:true}).boundingBox();
  const labNav=await page.getByRole('navigation',{name:'Primus navigation'}).boundingBox();
  expect(labBrand.x).toBe(brand.x);expect(labBrand.y).toBe(brand.y);
  expect(Math.abs(labNav.x-nav.x)).toBeLessThan(2);
  const labRail = page.getByRole('complementary',{name:'Strategy Lab quick views',exact:true});
  const railHighlight = labRail.locator('.sliding-selection-highlight');
  await expect(railHighlight).toBeVisible();
  const firstRailY = (await railHighlight.boundingBox()).y;
  await page.getByRole('button',{name:/^Filters/}).click();
  await expect.poll(async () => (await railHighlight.boundingBox()).y).toBeGreaterThan(firstRailY);
  await expect(page.locator('.sl-filter-drawer')).toHaveClass(/is-open/);
  await page.getByRole('combobox',{name:'Strategy',exact:true}).click();
  await page.getByRole('option',{name:'Reversal at key level',exact:true}).click();
  await page.getByRole('button',{name:'Apply & View Desk',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Setup',exact:true})).toHaveText('Reversal at key level');
  await expect(page.locator('.results-content')).toHaveAttribute('aria-busy','false');
  await expect(page.getByRole('region',{name:'Equity curve',exact:true})).toBeVisible();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
      message: `Strategy Lab fits a ${width}px viewport`,
    }).toBeLessThanOrEqual(width);
    await page.screenshot({path:info.outputPath(`primus-lab-${width}.png`),fullPage:true});
    if(width<521)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    await page.getByRole('button',{name:'My lab',exact:true}).click();
    await page.getByRole('button',{name:'Lab settings',exact:true}).click();
    const settings = page.getByRole('dialog',{name:'Lab settings',exact:true});
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('group',{name:'Lab settings sections',exact:true}).locator('.sliding-selection-highlight')).toBeVisible();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Lab settings',exact:true})).toHaveCount(0);
    if(width<521)await page.getByRole('button',{name:'Close navigation',exact:true}).click();
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.locator('.sl-equity-card').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(19, 24, 22)');
  await expect(page.locator('.sl-page-dock')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Strategies',exact:true})).toBeVisible();
  await expect(page.locator('.lab-key-metrics').getByText('Win rate',{exact:true})).toBeVisible();
  await expect(page.locator('.lab-key-metrics').getByText('Max drawdown',{exact:true})).toBeVisible();
  await expect(page.locator('.sl-dist-card')).toHaveCount(0);
  await page.getByRole('button',{name:'Advanced metrics',exact:true}).click();
  await expect(page.locator('.sl-dist-card')).toBeVisible();
  const breakdown = page.getByRole('region',{name:'Performance breakdown',exact:true});
  const backtest = breakdown.getByRole('region',{name:'Backtest breakdown',exact:true});
  await expect(backtest.getByText('Sharpe ratio',{exact:true})).toBeVisible();
  await expect(backtest.getByText('Sortino ratio',{exact:true})).toBeVisible();
  await expect(breakdown.getByRole('region',{name:'Live breakdown',exact:true})).toContainText('No closed trades match this selection.');
  const grouping = breakdown.getByRole('region',{name:'Grouped trades',exact:true});
  await grouping.getByRole('combobox',{name:'Group by',exact:true}).click();
  await page.getByRole('option',{name:'Session',exact:true}).click();
  await expect(grouping.getByRole('region',{name:'Backtest grouped trades',exact:true})).toBeVisible();
  await breakdown.screenshot({path:info.outputPath('strategy-lab-breakdown.png')});
  const sources = page.getByRole('group',{name:'Data source',exact:true});
  await sources.getByRole('button',{name:'Live results',exact:true}).click();
  await expect(breakdown.getByText('No closed trades match this selection.',{exact:true})).toBeVisible();
  await expect(breakdown.getByRole('combobox',{name:'Group by',exact:true})).toHaveCount(0);
  await expect(breakdown.getByText('Sharpe ratio',{exact:true})).toHaveCount(0);
  await sources.getByRole('button',{name:'Compare',exact:true}).click();
  await expect(page.locator('.results-content')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'Hide advanced metrics',exact:true}).click();
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
  expect(await page.locator('#traders').evaluate(el=>el.compareDocumentPosition(document.querySelector('.pt-tools-section'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(page.getByText('YOUR WORKSPACE',{exact:true})).toBeVisible();
  for(const name of ['Sajid Kasim','Safwaan Alad','Mubeen Patel','Mustafa Dal','Amir Patel'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width<521){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('navigation',{name:'Primus navigation'})).toBeVisible();await page.getByRole('button',{name:'Close navigation',exact:true}).click()}
    await page.screenshot({path:info.outputPath(`primus-home-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('link',{name:'Market news & calendar',exact:true}).click();
  await expect(page).toHaveURL(/\/matrix\?tab=briefing$/);
  await expect(page.getByRole('heading',{name:'Market News & Economic Calendar',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Economic calendar',exact:true}).click();
  await expect(page.getByTitle('TradingView economic calendar')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open full economic calendar on TradingView'})).toHaveAttribute('href','https://www.tradingview.com/economic-calendar/');
  await page.screenshot({path:info.outputPath('matrix-briefing-light.png'),fullPage:true});
  await page.goto(origin);
  await page.getByRole('link',{name:'Open Strategy Lab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Equity curve',exact:true})).toBeVisible();
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
  for(const selector of ['.pt-trader','.pt-section-heading>p','.pt-tool-journal']){
    await expect.poll(()=>page.locator(selector).first().evaluate(el=>{
      const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
      const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
      let bg=el;while(bg.parentElement&&getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;
      const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(getComputedStyle(bg).backgroundColor));return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    }),{message:`Dark contrast: ${selector}`}).toBeGreaterThanOrEqual(4.5);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:info.outputPath('home-dark.png'),fullPage:true});
  await page.goto(`${origin}/matrix?tab=briefing`);
  await page.getByRole('button',{name:'Economic calendar',exact:true}).click();
  await expect(page.getByTitle('TradingView economic calendar')).toHaveAttribute('srcdoc',/"colorTheme":"dark"/);
  await expect(page.getByTitle('TradingView economic calendar')).toHaveAttribute('srcdoc',/"isTransparent":true/);
  await page.screenshot({path:info.outputPath('matrix-briefing-dark.png'),fullPage:true});
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
  await expect(page.locator('.results-content')).toHaveAttribute('aria-busy','false');
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
  await expect(page.locator('.results-content')).toHaveAttribute('aria-busy','false');
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
  await expect(nav.getByRole('link')).toHaveText(['Journal', 'Strategy Lab', 'Mindset', 'Backtesting', 'Learn', 'The Matrix']);
  await expect(nav.getByRole('button', {name: /glossary/i})).toHaveCount(0);
  await page.getByRole('tab', {name: 'Accounts', exact: true}).click();
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

test('Strategy Lab compares independent equity curves and filters them from the setup table', async ({page}, info) => {
  const requests = [];
  await page.route('**/api/results', async route => {
    const query = route.request().postDataJSON();
    requests.push(query);
    if (query.scope !== 'Forward testing') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({response, json: {
      ...data,
      stats: {...data.stats, trades: 2, avg_r: .5},
      r_count: 2,
      r_equity: {values: [0, -.5, 1], net_r: 1, max_drawdown_r: .5},
      strategy_summary: [{setup_name: 'Reversal at key level', trades: 2, avg_r: .5, max_drawdown_r: .5}],
    }});
  });
  await page.goto(origin + '/lab');
  const sources = page.getByRole('group', {name: 'Data source', exact: true});
  await expect(sources.getByRole('button', {name: 'Compare', exact: true})).toHaveAttribute('aria-pressed', 'true');
  const chart = page.getByRole('region', {name: 'Equity curve', exact: true});
  const plot = chart.locator('.js-plotly-plot');
  await expect(plot).toBeVisible();
  expect(requests.map(({scope}) => scope)).toEqual(['Backtesting', 'Forward testing']);
  expect(requests.every(({combined}) => combined === false)).toBe(true);
  expect(await plot.evaluate(el => el.data.map(({name, y, line}) => ({name, origin: y[0], dash: line.dash})))).toEqual([
    {name: 'Backtest', origin: 0, dash: 'dash'},
    {name: 'Live', origin: 0, dash: 'solid'},
  ]);
  const strategies = page.getByRole('region', {name: 'Strategies', exact: true});
  await strategies.getByRole('button', {name: 'Reversal at key level', exact: true}).click();
  await expect(page.getByRole('combobox', {name: 'Setup', exact: true})).toHaveText('Reversal at key level');
  await expect.poll(() => requests.filter(({strategy}) => strategy === 'Reversal at key level').length).toBe(2);
  await expect(page.locator('.results-content')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button', {name: 'Switch to dark mode', exact: true}).click();
  await expect(page.locator('.results-content')).toHaveAttribute('aria-busy','false');
  await page.screenshot({path: info.outputPath('strategy-lab-compare.png')});
  await expect(page.getByRole('combobox',{name:'Setup',exact:true})).toHaveCSS('border-top-left-radius','999px');
  await expect(page.locator('.lab-result-dates > summary')).toHaveCSS('border-top-left-radius','999px');
  const indicator = sources.locator('.segment-indicator');
  await expect(indicator).toHaveCSS('transition-duration','0.24s');
  const compareX = (await indicator.boundingBox()).x;
  await sources.getByRole('button', {name: 'Backtest results', exact: true}).click();
  await expect.poll(async () => (await indicator.boundingBox()).x).toBeLessThan(compareX);
  await expect(chart.getByLabel('Show drawdown', {exact: true})).toBeVisible();
  await page.setViewportSize({width: 320, height: 750});
  await page.getByText('Date range', {exact: true}).first().click();
  await expect(page.getByLabel(/From ·/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
