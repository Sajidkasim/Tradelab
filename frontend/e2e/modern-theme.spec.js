import {test,expect} from '@playwright/test';
test('retired appearance preference safely opens the current light and dark interface',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('primus-appearance','classic');localStorage.setItem('primus-theme','dark')});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByRole('group',{name:'Website appearance',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('primus-appearance'))).toBeNull();
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'Light mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
