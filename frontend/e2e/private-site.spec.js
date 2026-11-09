import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8120';
test('one private sign-in connects Journal, Lab and Home, and preserves the chosen destination',async({page},info)=>{
  await page.route('https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?**',route=>route.fulfill({status:302,headers:{location:`${origin}/auth/callback?code=owner`},body:''}));
  await page.goto(`${origin}/journal`);
  await expect(page.getByRole('heading',{name:/Make room\s*to reflect/})).toBeVisible();
  await expect(page.getByLabel('Journal preview',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('journal-entrance.png'),fullPage:true});
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await expect(page).toHaveURL(`${origin}/journal`);
  await expect(page.getByRole('heading',{name:'Pause. Put it on paper.',exact:true})).toBeVisible();
  const journalNotes=page.getByRole('dialog',{name:'What’s new in PrimusTrader',exact:true});
  if(await journalNotes.count())await journalNotes.getByRole('button',{name:'Got it',exact:true}).click();
  await page.getByRole('navigation',{name:'Primus navigation'}).getByRole('link',{name:'Strategy Lab',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Results',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Skip guide',exact:true}).click();
  const notes=page.getByRole('dialog',{name:'What’s new in PrimusTrader',exact:true});
  if(await notes.count())await notes.getByRole('button',{name:'Got it',exact:true}).click();
  await expect(notes).not.toBeVisible();
  await page.getByRole('link',{name:'PrimusTrader home',exact:true}).click();
  await expect(page.locator('.pt-header-action')).toHaveCount(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('.pt-header-action')).toHaveText(/Sign in/);
  await page.goto(`${origin}/lab`);
  await expect(page.getByRole('heading',{name:/A clearer view\s*of your edge/})).toBeVisible();
  await page.screenshot({path:info.outputPath('lab-entrance.png'),fullPage:true});
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:950});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();
  }
});
