import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
async function choose(page,label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click()}
test('Learn publishes real authored content, searches and edits it without unsafe markup',async({page})=>{
 await page.goto(origin+'/learn');await expect(page.getByRole('heading',{name:'Learn',exact:true})).toBeVisible();await expect(page.getByText('The next lesson starts here.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Publish your first resource',exact:true}).click();const editor=page.getByRole('dialog',{name:'Publish a resource'});
 await choose(editor,'Resource type','article');await editor.getByRole('textbox',{name:'Title',exact:true}).fill('My test guide');await editor.getByRole('textbox',{name:'Article or guide text',exact:true}).fill('<script>window.bad=true</script> My original notes.');await editor.getByRole('textbox',{name:'Description',exact:true}).fill('Written for this isolated test.');await editor.getByRole('textbox',{name:'Tags (comma separated)',exact:true}).fill('process, practice');await editor.getByRole('button',{name:'Publish resource',exact:true}).click();await expect(page.getByText('Resource published.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Read resource',exact:true}).click();const reader=page.getByRole('dialog',{name:'My test guide',exact:true});await expect(reader).toContainText('<script>window.bad=true</script>');expect(await page.evaluate(()=>window.bad)).toBeUndefined();await reader.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search resources',exact:true}).fill('not-found');await expect(page.getByText('No resources match. Try another topic or search.',{exact:true})).toBeVisible();await page.getByRole('searchbox',{name:'Search resources',exact:true}).fill('practice');await expect(page.getByRole('heading',{name:'My test guide',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('dialog',{name:'Edit resource'}).getByRole('textbox',{name:'Title',exact:true}).fill('Updated guide');await page.getByRole('button',{name:'Publish resource',exact:true}).click();await expect(page.getByRole('heading',{name:'Updated guide',exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:'Remove resource',exact:true}).click();await expect(page.getByText('The next lesson starts here.',{exact:true})).toBeVisible();
});
test('Mindset private goals persist with uploaded images',async({page})=>{
 await page.goto(origin+'/mindset');
 await expect(page.getByRole('heading',{name:'Your Anchor'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add a goal',exact:true})).toHaveCount(0);
 await expect(page.getByRole('searchbox',{name:'Search resources'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Add resource',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Manage publishers',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Add your first goal',exact:true}).click();const modal=page.getByRole('dialog',{name:'Add a goal',exact:true});await modal.getByRole('textbox',{name:'Goal or reminder',exact:true}).fill('Stay patient');await modal.getByRole('textbox',{name:'Personal notes',exact:true}).fill('A private reminder.');await modal.getByRole('button',{name:'Save goal',exact:true}).click();await expect(page.getByText('Goal saved privately.',{exact:true})).toBeVisible();await page.getByLabel('Image for Stay patient',{exact:true}).setInputFiles('../assets/primus-compass.png');await expect(page.getByRole('img',{name:'Image for Stay patient',exact:true})).toBeVisible();await page.reload();await expect(page.getByText('A private reminder.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add a goal',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Pin for warm-up'}).click();
 await expect(page.getByText('PINNED FOR WARM-UP')).toBeVisible();
 await page.getByRole('button',{name:'Breathwork',exact:true}).click();
 const warmUp=page.getByRole('dialog',{name:'Pre-Market Warm-Up'});
 await expect(warmUp).toContainText('Stay patient');
 await warmUp.getByRole('button',{name:'Close'}).click();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove',exact:true}).click();
 await expect(page.getByRole('button',{name:'Add your first goal'})).toBeVisible();
});
test('Market Lab uses prepared history, validates bounded runs and saves results',async({page})=>{
 await page.goto(origin+'/market-lab');await expect(page.getByRole('heading',{name:'Market Lab',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Run research test',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Run research test',exact:true}).click();await expect(page.getByRole('region',{name:'Research results',exact:true})).toBeVisible({timeout:15000});await expect(page.getByRole('region',{name:'Research results',exact:true})).toContainText('prepared trading dates');await page.reload();await expect(page.locator('.wp-run-list button')).toHaveCount(1);
 await page.getByRole('spinbutton',{name:'Opening range (minutes)',exact:true}).fill('16');await page.getByRole('button',{name:'Run research test',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
});
test('new navigation and pages remain readable on a phone and in dark mode',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/learn');await page.getByRole('button',{name:'Open navigation',exact:true}).click();const nav=page.getByRole('navigation',{name:'Primus navigation'});await expect(nav.getByRole('link',{name:/^Learn(?: Beta)?$/})).toHaveAttribute('aria-current','page');await nav.getByRole('link',{name:'Mindset',exact:true}).click();await expect(page.getByRole('heading',{name:'Pre-Market Warm-Up',exact:true})).toBeVisible();await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('mindset-phone-dark.png'),fullPage:true});
 await page.goto(origin+'/market-lab');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('market-lab-phone-dark.png'),fullPage:true});
});

test('Journal, Mindset and Backtesting share light and dark workspace colours', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto(origin+'/mindset');
  for (const [theme, pageColor, ink] of [
    ['light','rgb(244, 243, 235)','rgb(23, 39, 31)'],
    ['dark','rgb(32, 34, 37)','rgb(243, 241, 235)'],
  ]) {
    await page.evaluate((mode) => localStorage.setItem('primus-theme',mode), theme);
    for (const [path, selector] of [
      ['/mindset','.mw-page'],
      ['/journal','.pj-workspace'],
      ['/backtesting','.bt-session-site'],
    ]) {
      await page.goto(origin+path);
      const workspace=page.locator(selector);
      await expect(workspace).toHaveCSS('background-color',pageColor);
      await expect(workspace).toHaveCSS('color',ink);
      await expect(workspace).toHaveCSS('font-family',/Inter/);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  }
});
