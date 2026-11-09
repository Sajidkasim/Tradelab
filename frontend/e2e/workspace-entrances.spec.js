import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
for(const [path,title,illustration] of [
 ['/journal',/Make room\s*to reflect/,'Journal preview'],
 ['/lab',/A clearer view\s*of your edge/,'Strategy research illustration, not actual performance'],
 ['/backtesting',/Find your pace.\s*Practise your edge/,'Illustrative replay controls'],
]){
 test(path+' has its own responsive entrance and preserves its Google destination',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/session',async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({json:{...body,authenticated:false,auth_mode:'google'}})});
  let destination;
  await page.route('**/api/login/google?**',route=>{destination=new URL(route.request().url()).searchParams.get('return_to');return route.fulfill({status:503,json:{detail:'Please try again shortly.'}})});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(origin+path);
  await expect(page.getByRole('heading',{name:title})).toBeVisible();
  await expect(page.getByLabel(illustration,{exact:true})).toBeVisible();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:1000});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();
   await page.screenshot({path:info.outputPath(`entrance-${path.slice(1)}-${width}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Please try again shortly.');
  expect(destination).toBe(path);expect(errors).toEqual([]);
 });
}

test('local design previews cannot submit authentication',async({page})=>{
 for(const path of ['/journal','/lab','/backtesting']){
  await page.goto(origin+path+'?preview=signin');
  await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeDisabled();
 }
});
