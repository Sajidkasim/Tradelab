import { test, expect } from "@playwright/test";

test("new Lab choices import automatically with case, space and spelling variations", async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  const identity = await (await page.request.get('/api/session')).json();
  const headers = {Origin:'http://127.0.0.1:8111','X-Primus-CSRF':identity.csrf};
  const original = await (await page.request.get('/api/metadata')).json();
  let importedId;
  try {
    await page.getByRole('button',{name:'My lab',exact:true}).click();
    await page.getByRole('button',{name:'Lab settings',exact:true}).click();
    let dialog = page.getByRole('dialog',{name:'Lab settings',exact:true});
    await dialog.getByRole('button',{name:'Setup Labels',exact:true}).click();
    await dialog.getByLabel('Strategies',{exact:true}).fill([...original.playbook.strategies,'Breakout and retest'].join('\n'));
    await dialog.getByLabel('Key levels',{exact:true}).fill([...original.playbook.levels,'My weekly level'].join('\n'));
    await dialog.getByRole('button',{name:'Save setup labels',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button',{name:'My lab',exact:true}).click();
    await page.getByRole('button',{name:'Lab settings',exact:true}).click();
    dialog = page.getByRole('dialog',{name:'Lab settings',exact:true});
    for (const [label, value] of [['Confirmations / confluence', 'Volume reaction'], ['Key level timeframes', '2H'], ['Entry timeframes', '30s']]) {
      const input = dialog.getByLabel(label, { exact: true });
      await input.fill(value);
      await input.press('Enter');
    }
    await dialog.getByRole('button', { name: 'Save setup labels', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.explorer').getByLabel('Key level timeframe',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Import',exact:true}).click();
    const csv='id,dateStart,dateEnd,pair,rPnL,side,status,tags\nauto-lab-import,2026-07-01 13:30,2026-07-01 13:40,NQ,125,buy,closed,"breakout and reetst,MY WEEKLY LEVEL,2 hr,30 S,volume  reaction"\n';
    await page.getByLabel('Choose a trade export').setInputFiles({name:'automatic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.getByRole('button',{name:'Preview trades',exact:true}).click();
    await expect(page.locator('.preview-card tbody')).toContainText('Breakout and retest');
    await expect(page.locator('.preview-card tbody')).toContainText('My weekly level · 2H · 30s');
    await expect(page.locator('.preview-card tbody')).toContainText('Volume reaction');
    await expect(page.getByRole('button',{name:'Review new tags',exact:true})).toHaveCount(0);
    await page.getByText('5 tags recognised automatically',{exact:true}).click();
    await expect(page.getByText(/spelling matched/)).toBeVisible();
    await page.getByRole('button',{name:'Import 1 trades',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Confirm import',exact:true}).click();
    await expect(page).toHaveURL(/#trades$/);
    const saved = (await (await page.request.get('/api/trades')).json()).find(t=>t.external_id==='auto-lab-import');
    importedId=saved.id;
    expect(saved.setup_name).toBe('Breakout and retest');
    expect(saved.net_pnl).toBe(125);expect(saved.r_multiple).toBe(null);
    expect(saved.tags).toContain('breakout and reetst');
    await page.getByRole('button',{name:'Import',exact:true}).click();
    await page.getByLabel('Choose a trade export').setInputFiles({name:'automatic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.getByRole('button',{name:'Preview trades',exact:true}).click();
    await expect(page.getByText('Nothing new to import',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Review new tags',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Import settings',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Import settings',exact:true});
    await dialog.getByRole('button',{name:'Tag meanings',exact:true}).click();
    await dialog.getByText('Tags from your Lab settings · already connected',{exact:true}).click();
    await expect(dialog.getByText(/Turtle Soup ·.*Breakout and retest/)).toBeVisible();
    await page.screenshot({path:'test-results/automatic-import-tags.png',fullPage:false});
  } finally {
    if(importedId) await page.request.delete(`/api/trades/${importedId}`,{headers});
    await page.request.put('/api/playbook',{headers,data:original.playbook});
    await page.request.put('/api/lab-settings',{headers,data:original.lab_settings});
  }
});

test('ambiguous timeframe review explains why and remembers a one-click choice',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  const identity=await (await page.request.get('/api/session')).json();
  const headers={Origin:'http://127.0.0.1:8111','X-Primus-CSRF':identity.csrf};
  const original=await (await page.request.get('/api/metadata')).json();
  try {
    await page.getByRole('button',{name:'Import',exact:true}).click();
    await page.getByLabel('Choose a trade export').setInputFiles({name:'shared-timeframe.csv',mimeType:'text/csv',buffer:Buffer.from('id,dateStart,dateEnd,pair,rPnL,side,status,tags\nshared-timeframe,2026-07-01 13:30,2026-07-01 13:40,NQ,100,buy,closed,15m\n')});
    await page.getByRole('button',{name:'Preview trades',exact:true}).click();
    await page.getByRole('button',{name:'Review new tags',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Review tags',exact:true});
    await dialog.getByText('How to tag your CSV · a quick guide',{exact:true}).click();
    await expect(dialog.getByText(/where you found the level, for example a 1H FVG/)).toBeVisible();
    await dialog.getByRole('button',{name:'Review 15m',exact:true}).click();
    await expect(dialog.getByText('Why are we asking?',{exact:true})).toBeVisible();
    await expect(dialog.getByText(/This name is used in more than one category/)).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await dialog.getByRole('button',{name:'Use as Key level timeframe: 15m',exact:true}).click();
    await expect(dialog.locator('.tag-meaning-editor')).toHaveCount(0);
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('button',{name:'Review new tags',exact:true})).toHaveCount(0);
    await expect(page.locator('.preview-card tbody')).toContainText('15m');
    const meta=await (await page.request.get('/api/metadata')).json();
    expect(meta.tag_mappings['15m']).toEqual({field:'timeframe',value:'15m'});
  } finally {
    await page.request.put('/api/tag-mappings',{headers,data:original.tag_mappings});
  }
});
