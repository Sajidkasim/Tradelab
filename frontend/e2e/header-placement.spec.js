import { test, expect } from '@playwright/test';

test('header controls retain their position when switching Modern and Classic', async ({page}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Results',exact:true})).toBeVisible();
  for (const width of [320,390,768,1366,1920]) {
    await page.setViewportSize({width,height:900});
    await page.getByRole('button',{name:'Modern',exact:true}).click();
    const rectangles = async () => page.locator('.site-header').evaluate(el => Object.fromEntries(['.brand','.appearance-switch','.workspace-menu > summary'].map(selector => {
      const r = el.querySelector(selector).getBoundingClientRect();
      return [selector,{x:r.x,y:r.y,width:r.width,height:r.height}];
    })));
    const modern = await rectangles();
    await page.getByRole('button',{name:'Classic',exact:true}).click();
    const classic = await rectangles();
    for(const selector of Object.keys(modern)) for(const dimension of ['x','y','width','height']) expect(Math.abs(classic[selector][dimension]-modern[selector][dimension])).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`classic-header-${width}.png`)});
    await page.getByRole('button',{name:'Modern',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath(`modern-header-${width}.png`)});
  }
});
