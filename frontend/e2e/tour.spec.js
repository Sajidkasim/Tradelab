import {test,expect} from '@playwright/test';

test('a new user gets an optional five-step tour after welcome and can replay it',async({page},testInfo)=>{
  const origin='http://127.0.0.1:8114';
  await page.setViewportSize({width:390,height:844});
  await page.route('https://abcdefghijklmnopqrst.supabase.co/auth/v1/authorize?**',async route=>route.fulfill({status:302,headers:{location:`${origin}/auth/callback?code=tour-user`},body:''}));
  await page.goto(origin);
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await page.getByRole('button',{name:'Open my lab',exact:true}).click();
  const tour=page.locator('.guided-tour');
  await expect(tour).toBeVisible();
  const titles=['Explore a setup','Add a trade','Import your trades','Read your results','Make the lab yours'];
  for(let step=0;step<5;step++){
    await expect(tour.getByRole('heading',{name:titles[step],exact:true})).toBeVisible();
    await expect(tour.getByLabel(`Step ${step+1} of 5`,{exact:true})).toBeVisible();
    await expect.poll(()=>tour.locator('.tour-highlight').count()).toBe(1);
    const selectors=['[data-tour="explore"]','[data-tour="add-trade"]','[data-tour="import"]','[data-tour="results"]','.workspace-menu .menu-panel'];
    await expect.poll(async()=>{
      const target=await page.locator(selectors[step]).boundingBox();
      const ring=await tour.locator('.tour-highlight').boundingBox();
      return Math.abs(ring.y-Math.max(6,target.y-8));
    }).toBeLessThan(2);

    const r=await tour.locator('.tour-card').boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x+r.width).toBeLessThanOrEqual(390);expect(r.y+r.height).toBeLessThanOrEqual(844);
    if(step===0){
      await tour.getByRole('button',{name:'Next',exact:true}).click();
      await tour.getByRole('button',{name:'Back',exact:true}).click();
      await expect(tour.getByRole('heading',{name:titles[0],exact:true})).toBeVisible();
    }
    await page.screenshot({path:testInfo.outputPath(`tour-step-${step+1}.png`)});
    await tour.getByRole('button',{name:step===4?'Finish':'Next',exact:true}).click();
  }
  await expect(tour.getByRole('heading',{name:'Ready to test',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('tour-ready.png')});
  expect((await(await page.request.get(`${origin}/api/metadata`)).json()).journal_preferences.tour_status).toBe('completed');
  expect(await(await page.request.get(`${origin}/api/trades`)).json()).toEqual([]);
  await tour.getByRole('button',{name:'Start testing',exact:true}).click();
  await expect(tour).toHaveCount(0);
  await page.reload();await expect(tour).toHaveCount(0);
  await page.getByRole('button',{name:'My lab',exact:true}).click();
  await page.getByRole('button',{name:'Quick guide',exact:true}).click();
  await expect(tour).toBeVisible();
  await tour.press('Escape');
  await expect(tour).toHaveCount(0);
});

for(const appearance of ['Modern','Classic']){
  test(`${appearance}: guide fits narrow phones and desktops and can be skipped`,async({page},testInfo)=>{
    await page.goto('/');
    await page.getByRole('button',{name:appearance,exact:true}).click();
    for(const width of [320,1440]){
      await page.setViewportSize({width,height:900});
      await page.getByRole('button',{name:'My lab',exact:true}).click();
      await page.getByRole('button',{name:'Quick guide',exact:true}).click();
      const tour=page.locator('.guided-tour');
      for(let step=0;step<5;step++){
        await expect(tour.getByLabel(`Step ${step+1} of 5`,{exact:true})).toBeVisible();
        const r=await tour.locator('.tour-card').boundingBox();
        expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x+r.width).toBeLessThanOrEqual(width);expect(r.y+r.height).toBeLessThanOrEqual(900);
        if(step===0 && width===1440){
          const target=await page.locator('[data-tour="explore"]').boundingBox();
          expect(r.x).toBeGreaterThanOrEqual(target.x+target.width);
          await page.screenshot({path:testInfo.outputPath(`${appearance.toLowerCase()}-guide-desktop.png`)});
        }
        if(step<4)await tour.getByRole('button',{name:'Next',exact:true}).click();
      }
      await tour.getByRole('button',{name:'Skip guide',exact:true}).click();
      await expect(tour).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  });
}
