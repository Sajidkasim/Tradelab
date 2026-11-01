import {test, expect} from '@playwright/test';

for(const appearance of ['Modern']) {
  test(`${appearance}: My lab opens Import settings and preserves an active CSV preview`, async({page})=>{
    await page.goto('/');
    async function openFromMenu(){
      await page.getByRole('button',{name:'My lab',exact:true}).click();
      await page.locator('.workspace-menu').getByRole('button',{name:'Import settings',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'Import settings',exact:true})).toBeVisible();
    }
    await openFromMenu();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByLabel('Choose a trade export').setInputFiles({name:'menu-preview.csv',mimeType:'text/csv',buffer:Buffer.from('id,dateStart,dateEnd,pair,rPnL,side,status\nmenu-unsaved,2013-01-25 14:30,2013-01-25 14:40,NQ,100,buy,closed\n')});
    await page.getByRole('button',{name:'Preview trades',exact:true}).click();
    await expect(page.getByRole('button',{name:'Import 1 trades',exact:true})).toBeEnabled();
    await page.setViewportSize({width:390,height:844});
    await openFromMenu();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('button',{name:'Import 1 trades',exact:true})).toBeEnabled();
    await expect(page.getByText('menu-preview.csv',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
