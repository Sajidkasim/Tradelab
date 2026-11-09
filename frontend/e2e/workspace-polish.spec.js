import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
test('Prime Trader sign-in continues to the Journal instead of home',async({page})=>{
 let authenticated=false;
 await page.route('**/api/session',async route=>{
  const response=await route.fetch();const body=await response.json();
  await route.fulfill({json:{...body,authenticated,auth_mode:'password'}});
 });
 await page.route('**/api/unlock',async route=>{authenticated=true;await route.fulfill({json:{csrf:'test'}})});
 await page.goto(origin);
 await page.getByRole('link',{name:'Sign in',exact:false}).click();
 await expect(page).toHaveURL(origin+'/signin');
 await expect(page.getByRole('heading',{name:'Sign in to Prime Trader.'})).toBeVisible();
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
  expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThan(180);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
test('navigation shares Beta badges across Backtesting Learn and Matrix',async({page})=>{
 await page.goto(origin);
 for(const href of ['/backtesting','/learn','/matrix'])await expect(page.locator(`nav a[href="${href}"] .pt-beta-badge`)).toHaveText('Beta');
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
test('Matrix explains snapshot age and retains data after failed refresh',async({page})=>{
 let calls=0;
 await page.route('**/api/matrix/snapshot',r=>{calls++;return calls===1?r.fulfill({json:{snapshot:{asOf:'2020-01-01T00:00:00Z',tickers:[{id:'dgs10',value:'4.31%',detail:'FRED · DGS10 · 2019-12-31'}]}}}):r.fulfill({status:503,json:{detail:'Unavailable'}})});
 await page.goto(origin+'/matrix');
 await expect(page.getByText('Snapshot older than 48 hours',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Data freshness')).toContainText('Check freshness before using this snapshot.');
 await page.getByRole('button',{name:'Refresh snapshot',exact:true}).click();
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
