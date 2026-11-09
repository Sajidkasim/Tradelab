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
