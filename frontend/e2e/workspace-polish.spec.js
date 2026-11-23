import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
test('Primus Trader sign-in continues to the Journal instead of home',async({page})=>{
 let authenticated=false;
 await page.route('**/api/session',async route=>{
  const response=await route.fetch();const body=await response.json();
  await route.fulfill({json:{...body,authenticated,auth_mode:'password'}});
 });
 await page.route('**/api/unlock',async route=>{authenticated=true;await route.fulfill({json:{csrf:'test'}})});
 await page.goto(origin);
 await page.getByRole('link',{name:'Sign in',exact:false}).click();
 await expect(page).toHaveURL(origin+'/signin');
 await expect(page.getByRole('heading',{name:/Back to\s*your process/})).toBeVisible();
 await expect(page).toHaveTitle('Sign in — Primus Trader');
 await page.getByLabel('Password',{exact:true}).fill('test');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page).toHaveURL(origin+'/journal');
 await expect(page.getByRole('region',{name:'Daily journal editor'})).toBeVisible();
});
test('Journal rules save across reload and account controls have room',async({page})=>{
 await page.goto(origin+'/journal');
 await page.locator('.pj-rules summary').click();
 await page.getByLabel('Your personal trading rules').fill('Wait for confirmation before entry.');
 await page.getByRole('button',{name:'Save rules',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Rules saved.'})).toBeVisible();
 await page.reload();await page.locator('.pj-rules summary').click();
 await expect(page.getByLabel('Your personal trading rules')).toHaveValue('Wait for confirmation before entry.');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  const box=await page.getByLabel('Calendar account',{exact:true}).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThan(165);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
test('navigation keeps Beta badge on Learn while Backtesting and Matrix are graduated',async({page})=>{
 await page.goto(origin);
 for(const href of ['/backtesting','/matrix'])await expect(page.locator(`nav a[href="${href}"] .pt-beta-badge`)).toHaveCount(0);
 await expect(page.locator('nav a[href="/learn"] .pt-beta-badge')).toHaveText('Beta');
});

test('Journal delays Plotly until its results chart is approached',async({page})=>{
 await page.route('**/api/journal',async route=>{const response=await route.fetch();const rows=await response.json();await route.fulfill({json:rows.map(row=>({...row,trade_results:[{account_id:1,net_pnl:100}]}))})});
 const plotly=[];page.on('request',r=>{if(r.url().includes('plotly-basic'))plotly.push(r.url())});
 await page.goto(origin+'/journal');
 await expect(page.getByRole('region',{name:'Daily journal editor'})).toBeVisible();
 expect(plotly).toEqual([]);
 await page.locator('.chart').first().scrollIntoViewIfNeeded();
 await expect.poll(()=>plotly.length).toBe(1);
});
test('Matrix explains snapshot age, retains data after failed refresh and switches tabs cleanly',async({page})=>{
 await page.route('**/api/matrix/snapshot',r=>r.fulfill({json:{snapshot:{asOf:'2020-01-01T00:00:00Z',tickers:[{id:'dgs10',value:'4.31%',detail:'FRED · DGS10 · 2019-12-31'}]}}}));
 await page.route('**/api/matrix/refresh',r=>r.fulfill({status:503,json:{detail:'Unavailable'}}));
 await page.goto(origin+'/matrix');
 await expect(page.getByText('Snapshot older than 48 hours',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Data freshness')).toContainText('Check freshness before using this snapshot.');
 await expect(page.getByRole('region',{name:'Morning decision summary'})).toBeVisible();
 await page.getByRole('button',{name:'Get started',exact:true}).click();
 const guide=page.getByRole('dialog',{name:'Your 15-second morning check'});
 await expect(guide).toBeVisible();
 await expect(guide).toContainText('1 of 8');
 await guide.getByRole('button',{name:/^Next/}).click();
 await expect(page.getByRole('dialog',{name:'The 6 market drivers'})).toContainText('2 of 8');
 await page.getByRole('button',{name:'Skip guide',exact:true}).click();
 await expect(page.locator('dialog.mx-tour')).toHaveCount(0);
 await page.getByRole('tab',{name:/Positioning & Liquidity/}).click();
 await expect(page.getByRole('heading',{name:'COT Institutional Positioning'})).toBeVisible();
 await page.getByRole('tab',{name:/Catalyst Calendar/}).click();
 await expect(page.getByRole('heading',{name:'High-Impact US Economic Calendar'})).toBeVisible();
 await page.getByRole('button',{name:'Refresh Now',exact:true}).click();
 await expect(page.getByText('Refresh failed. Showing the last snapshot.')).toBeVisible();
 await expect(page.getByText('4.31%',{exact:true})).toBeVisible();
});
test('failed saved-session opening offers recovery instead of permanent loading',async({page})=>{
 await page.route('**/api/backtesting/sessions/broken',r=>r.fulfill({status:503,json:{detail:'History temporarily unavailable'}}));
 await page.goto(origin+'/backtesting?session=broken');
 await expect(page.getByRole('alert')).toContainText('History temporarily unavailable');
 await expect(page.getByRole('button',{name:'Retry loading',exact:true})).toBeVisible();
 await expect(page.getByText('Fetching saved session…',{exact:true})).toHaveCount(0);
});
test('homepage offers a clear return to Journal replay and results',async({page})=>{
 await page.goto(origin);
 const next=page.getByRole('region',{name:'Continue your work'});
 await expect(next).toBeVisible();
 await expect(next.getByRole('link',{name:'Today’s Journal'})).toHaveAttribute('href','/journal');
 await expect(next.getByRole('link',{name:'Review results'})).toHaveAttribute('href','/lab');
});

test('Primus Trader entrance has its own responsive design and recovers from Google errors',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/session',async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({json:{...body,authenticated:false,auth_mode:'google'}})});
 await page.route('**/api/login/google?**',route=>{expect(new URL(route.request().url()).searchParams.get('return_to')).toBe('/journal');return route.fulfill({status:503,json:{detail:'Sign-in is temporarily unavailable. Please try again.'}})});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(origin+'/signin');
 await expect(page.getByRole('heading',{name:/Back to\s*your process/})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
 await expect(page.locator('body')).not.toContainText('Prime Trader');
 await expect(page.locator('.pt-entrance-paper')).toHaveCount(0);
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`primus-signin-${width}.png`),fullPage:true});
 }
 await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Sign-in is temporarily unavailable');
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
 expect(errors).toEqual([]);
});
