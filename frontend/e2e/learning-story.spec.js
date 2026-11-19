import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
test('Mindset brain is interactive by region, pointer and keyboard with no animation while idle',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*.glb',route=>route.abort());await page.goto(origin+'/mindset');
 const canvas=page.getByRole('img',{name:/Rotatable schematic brain/});await expect(canvas).toBeVisible();
 const before=await canvas.evaluate(el=>el.toDataURL());
 await page.getByRole('button',{name:'Rotate brain right',exact:true}).click();await expect.poll(()=>canvas.evaluate(el=>el.toDataURL())).not.toBe(before);
 await canvas.focus();await page.keyboard.press('ArrowLeft');await page.getByRole('button',{name:'Reset brain view',exact:true}).click();await expect.poll(()=>canvas.evaluate(el=>el.toDataURL())).toBe(before);
 const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.52,{steps:12});await page.mouse.up();await expect.poll(()=>canvas.evaluate(el=>el.toDataURL())).not.toBe(before);
 await page.getByRole('button',{name:'Amygdala',exact:true}).click();await expect(page.getByRole('heading',{name:'Catch the urge to chase.',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Locate Amygdala',exact:true})).toBeVisible();await page.getByRole('button',{name:'Hippocampus',exact:true}).click();await expect(page.getByRole('heading',{name:'Review the setup in front of you.',exact:true})).toBeVisible();
 await expect.poll(()=>canvas.evaluate(el=>el.width)).toBeGreaterThan(0);await page.waitForTimeout(100);const still=await canvas.evaluate(el=>el.toDataURL());await page.waitForTimeout(250);expect(await canvas.evaluate(el=>el.toDataURL())).toBe(still);
 await page.screenshot({path:info.outputPath('mindset-desktop.png'),fullPage:true});expect(errors).toEqual([]);
});
test('Learn starter path and glossary work alongside the existing resource library',async({page},info)=>{
 await page.goto(origin+'/learn');await expect(page.getByRole('heading',{name:'Start with what the candle tells you.',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/02 Define the risk/}).click();await expect(page.getByRole('heading',{name:'Know the size before the result.',exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'Search glossary',exact:true}).fill('reward');await page.locator('.glossary-grid summary').filter({hasText:'Reward-to-risk / target RR'}).click();await expect(page.locator('.glossary-grid details[open]')).toContainText('not a recorded +3R result');
 await page.getByRole('searchbox',{name:'Search glossary',exact:true}).fill('qwerty-none');await expect(page.getByText('No terms match. Try a shorter word or clear your search.',{exact:true})).toBeVisible();await page.getByRole('searchbox',{name:'Search glossary',exact:true}).fill('');
 await expect(page.getByRole('region',{name:'Learning resources',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('learn-desktop.png'),fullPage:true});
});
test('new stories fit phone layouts, dark mode and reduced motion',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin+'/mindset');await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
 await page.getByRole('button',{name:'Amygdala',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('mindset-phone-dark.png'),fullPage:true});
 await page.goto(origin+'/learn');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('learn-phone-dark.png'),fullPage:true});
});
