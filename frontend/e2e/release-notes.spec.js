import {test,expect} from '@playwright/test';
test('release notes can be reopened, fit phones, and remain dismissed after reload',async({page},testInfo)=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
 if(process.env.PRIMUSLAB_TEST_SHOW_RELEASE_NOTES){
   const first=page.getByRole('dialog',{name:'What’s new in PrimusTrader',exact:true});
   await expect(first).toBeVisible();
   await first.getByRole('button',{name:'Got it',exact:true}).click();
   await expect(first).toHaveCount(0);
 }

 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'What’s new',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'What’s new in PrimusTrader',exact:true});
  await expect(dialog).toContainText('3 November 2026');
  await expect(dialog).toContainText('Your trade notes are protected');
  await expect(dialog).toContainText('Backtesting is still in beta');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`release-notes-${width}.png`)});
  await dialog.getByRole('button',{name:'Got it',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  await expect(dialog).toHaveCount(0);
 }
});
