import {test,expect} from '@playwright/test';
test('header controls fit without an appearance switch at phone and desktop widths',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  for(const width of [320,390,768,1366,1920]){
    await page.setViewportSize({width,height:900});
    await expect(page.getByRole('button',{name:'My lab',exact:true})).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
