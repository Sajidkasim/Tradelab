import {test,expect} from '@playwright/test';
test.use({launchOptions:{args:['--enable-unsafe-swiftshader']}});
const base='http://127.0.0.1:8119';
test('private guide completion resumes and learning trail connects practice and reflection',async({page})=>{
 await page.goto(base+'/learn');await page.getByRole('button',{name:/02 Define the risk/}).click();await page.getByRole('button',{name:'Mark guide complete',exact:true}).click();await expect(page.getByText('Progress saved privately.',{exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Know the size before the result.',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Completed ✓ — undo',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Reflect on this lesson in Journal',exact:false}).click();await expect(page.getByRole('complementary',{name:'Learning journey'})).toContainText('Define the risk');await page.getByRole('complementary',{name:'Learning journey'}).getByRole('link',{name:'Read',exact:true}).click();await expect(page.getByRole('heading',{name:'Know the size before the result.',exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'Search glossary'}).fill('slippage');
 await page.locator('.glossary-grid summary').filter({hasText:'Slippage'}).click();
 await expect(page.locator('.glossary-grid details[open]')).toContainText('expected execution price');
});
test('anatomical model loads automatically and responds to controls; situation cards stay reflective',async({page},info)=>{
 const requests=[];page.on('request',r=>{if(r.url().includes('.glb'))requests.push(r.url())});await page.goto(base+'/mindset');await expect(page.getByRole('status').filter({hasText:'Anatomy ready'})).toBeVisible({timeout:20000});expect(requests.length).toBe(1);await expect(page.locator('.anatomy-canvas canvas')).toBeVisible();
 await page.getByRole('button',{name:'Amygdala',exact:true}).click();await expect(page.getByText('Outer anatomy opacity',{exact:true})).toBeVisible();await page.getByRole('slider').fill('5');await page.getByRole('combobox',{name:'Visible hemisphere',exact:true}).selectOption('Left');await page.getByRole('button',{name:'Side',exact:true}).click();
 await page.getByRole('button',{name:'I’ve had consecutive losses',exact:true}).click();await expect(page.locator('.situation-reading')).toContainText('loss and stopping limits');await page.screenshot({path:info.outputPath('anatomy-final.png'),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Zoom brain in',exact:true}).click();
});
