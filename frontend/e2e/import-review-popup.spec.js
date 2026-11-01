import {test,expect} from '@playwright/test';
for (const width of [1440,390]) {
  test(`unmatched tags explain review, cancel safely and import returns to Trades at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});
    await page.goto('/import');
    await expect(page.getByLabel('Choose a trade export')).toBeEnabled();
    const session=await (await page.request.get('/api/session')).json();
    const headers={Origin:'http://127.0.0.1:8111','X-Primus-CSRF':session.csrf};
    const before=await (await page.request.get('/api/trades')).json();
    const id=`popup-review-${width}`;
    try {
      await page.getByLabel('Choose a trade export').setInputFiles({name:'review.csv',mimeType:'text/csv',buffer:Buffer.from(`id,dateStart,dateEnd,pair,rPnL,side,status,tags\n${id},2026-07-01 13:30,2026-07-01 13:40,NQ,100,buy,closed,My unfamiliar CSV label\n`)});
      await page.getByRole('button',{name:'Preview trades',exact:true}).click();
      let dialog=page.getByRole('dialog',{name:'Review tags',exact:true});
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('My unfamiliar CSV label');
      await expect(dialog).toContainText('could mean more than one thing');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`review-popup-${width}.png`)});
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
      await expect(dialog).toHaveCount(0);
      expect((await (await page.request.get('/api/trades')).json()).length).toBe(before.length);
      await page.locator('.preview-card').getByRole('button',{name:'Review tags',exact:true}).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('button',{name:'Import 1 trades',exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'Confirm import',exact:true}).click();
      await expect(page).toHaveURL(/#trades$/);
      await expect(page.getByRole('heading',{name:'Trades',exact:true})).toBeInViewport();
      const row=(await (await page.request.get('/api/trades')).json()).find(t=>t.external_id===id);
      expect(row.tags).toContain('My unfamiliar CSV label');
    } finally {
      for(const row of (await (await page.request.get('/api/trades')).json()).filter(t=>t.external_id===id)) await page.request.delete(`/api/trades/${row.id}`,{headers});
    }
  });
}
