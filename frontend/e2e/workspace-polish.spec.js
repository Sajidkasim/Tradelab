import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
test('Primus Trader sign-in continues to the Journal instead of home',async({page})=>{
 let authenticated=false;
 await page.route('**/api/session',async route=>{
  const response=await route.fetch();const body=await response.json();
  await route.fulfill({json:{...body,authenticated,auth_mode:'password'}});
 });
 await page.route('**/api/unlock',async route=>{authenticated=true;await route.fulfill({json:{csrf:'test'}})});
 await page.goto(origin);
 await page.getByRole('link',{name:'Sign in',exact:false}).click();
 await expect(page).toHaveURL(origin+'/signin');
 await expect(page.getByRole('heading',{name:/Back to\s*your process/})).toBeVisible();
 await expect(page).toHaveTitle('Sign in — Primus Trader');
 await page.getByLabel('Password',{exact:true}).fill('test');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page).toHaveURL(origin+'/journal');
 await expect(page.getByRole('region',{name:'Daily journal editor'})).toBeVisible();
});
test('Journal rules save in popup modal across reload and Calendar account filter is removed',async({page})=>{
 await page.goto(origin+'/journal');
 await expect(page.getByLabel('Calendar account',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/^Rules/}).click();
 const dialog=page.getByRole('dialog',{name:'Personal trading rules'});
 await expect(dialog).toBeVisible();
 await dialog.getByLabel('Your personal trading rules').fill('Wait for confirmation before entry.');
 await dialog.getByRole('button',{name:'Save rules',exact:true}).click();
 await expect(dialog.getByRole('status').filter({hasText:'Rules saved.'})).toBeVisible();
 await dialog.getByRole('button',{name:'Read',exact:true}).click();
 await expect(dialog.locator('.pj-rules-read-list')).toContainText('Wait for confirmation before entry.');
 await page.reload();
 await page.getByRole('button',{name:/^Rules/}).click();
 const reopened=page.getByRole('dialog',{name:'Personal trading rules'});
 await expect(reopened.getByLabel('Your personal trading rules')).toHaveValue('Wait for confirmation before entry.');
 await reopened.getByRole('button',{name:/^Done/}).click();
 await expect(reopened).toHaveCount(0);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  const tabsBox=await page.locator('.pt-entry-tabs').boundingBox();
  const editorBox=await page.locator('.pt-day-editor').boundingBox();
  expect(tabsBox.height).toBeLessThanOrEqual(56);
  expect(tabsBox.x).toBeGreaterThan(editorBox.x + 8);
  expect(tabsBox.x + tabsBox.width).toBeLessThan(editorBox.x + editorBox.width - 8);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
test('all workspace modules are graduated with zero Beta badges in navigation',async({page})=>{
 await page.goto(origin+'/learn');
 await expect(page.locator('nav .pt-beta-badge')).toHaveCount(0);
 await page.getByRole('button',{name:'Get started',exact:true}).click();
 const tour=page.getByRole('dialog',{name:'Four core foundations'});
 await expect(tour).toBeVisible();
 await expect(tour).toContainText('1 of 4');
 await tour.getByRole('button',{name:'Skip guide',exact:true}).click();
 await expect(page.locator('dialog.learn-tour')).toHaveCount(0);
});

test('Journal delays Plotly until its results chart is approached',async({page})=>{
 await page.route('**/api/journal',async route=>{const response=await route.fetch();const rows=await response.json();await route.fulfill({json:rows.map(row=>({...row,trade_results:[{account_id:1,net_pnl:100}]}))})});
 const plotly=[];page.on('request',r=>{if(r.url().includes('plotly-basic'))plotly.push(r.url())});
 await page.goto(origin+'/journal');
 await expect(page.getByRole('region',{name:'Daily journal editor'})).toBeVisible();
 expect(plotly).toEqual([]);
 await page.getByRole('tab',{name:'Performance',exact:true}).click();
 await page.locator('.chart').first().scrollIntoViewIfNeeded();
 await expect.poll(()=>plotly.length).toBe(1);
});
test('Matrix explains snapshot age, retains data after failed refresh and switches tabs cleanly',async({page})=>{
 const assets=['nq','es'].map((id,index)=>({
  id,symbol:id.toUpperCase(),name:id.toUpperCase()+' Futures',category:'Index',
  price:'100.25',score:75-index,rawScore:6,bias:'Bullish',
 }));
 await page.route('**/api/matrix/snapshot',r=>r.fulfill({json:{snapshot:{asOf:'2020-01-01T00:00:00Z',tickers:[{id:'dgs10',value:'4.31%',detail:'FRED · DGS10 · 2019-12-31'}],assets}}}));
 await page.route('**/api/matrix/refresh',r=>r.fulfill({status:503,json:{detail:'Unavailable'}}));
 await page.goto(origin+'/matrix');
 await expect(page.getByText('Snapshot older than 48 hours',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Data freshness')).toContainText('Check freshness before using this snapshot.');
 await expect(page.getByRole('region',{name:'Morning decision summary'})).toBeVisible();
 await page.getByRole('button',{name:'Get started',exact:true}).click();
 const guide=page.getByRole('dialog',{name:'Your 15-second morning check'});
 await expect(guide).toBeVisible();
 await expect(guide).toContainText('1 of 8');
 await guide.getByRole('button',{name:/^Next/}).click();
 await expect(page.getByRole('dialog',{name:'The 6 market drivers'})).toContainText('2 of 8');
 await page.getByRole('button',{name:'Skip guide',exact:true}).click();
 await expect(page.locator('dialog.mx-tour')).toHaveCount(0);
 const scoreboard=page.locator('.mx-scoreboard-selection');
 const highlight=scoreboard.locator('.sliding-selection-highlight');
 const beforeY=(await highlight.boundingBox()).y;
 await scoreboard.getByRole('button',{name:'ES',exact:true}).press('Enter');
 await expect(page.getByRole('heading',{name:'ES · Pillar Breakdown',exact:true})).toBeVisible();
 await expect.poll(async()=>(await highlight.boundingBox()).y).toBeGreaterThan(beforeY);
 const tabs=page.getByRole('tablist',{name:'Matrix desk sections'});
 await tabs.getByRole('tab',{name:/Positioning & Liquidity/}).click();
 await expect(tabs.locator('[data-slide-selected]')).toHaveText('Positioning & Liquidity');
 await expect(page.getByRole('heading',{name:'COT Institutional Positioning'})).toBeVisible();
 await page.getByRole('tab',{name:/Catalyst Calendar/}).click();
 await expect(page.getByRole('heading',{name:'High-Impact US Economic Calendar'})).toBeVisible();
 await page.getByRole('button',{name:'Refresh Now',exact:true}).click();
 await expect(page.getByText('Refresh failed. Showing the last snapshot.')).toBeVisible();
 await expect(page.getByText('4.31%',{exact:true})).toBeVisible();
});
test('failed saved-session opening offers recovery instead of permanent loading',async({page})=>{
 await page.route('**/api/backtesting/sessions/broken',r=>r.fulfill({status:503,json:{detail:'History temporarily unavailable'}}));
 await page.goto(origin+'/backtesting?session=broken');
 await expect(page.getByRole('alert')).toContainText('History temporarily unavailable');
 await expect(page.getByRole('button',{name:'Retry loading',exact:true})).toBeVisible();
 await expect(page.getByText('Fetching saved session…',{exact:true})).toHaveCount(0);
});
test('homepage offers a clear return to Journal replay and results',async({page})=>{
 await page.goto(origin);
 const next=page.getByRole('region',{name:'Continue your work'});
 await expect(next).toBeVisible();
 await expect(next.getByRole('link',{name:'Today’s Journal'})).toHaveAttribute('href','/journal');
 await expect(next.getByRole('link',{name:'Review results'})).toHaveAttribute('href','/lab');
 await page.getByRole('tablist',{name:'Desk preview views'}).getByRole('tab',{name:'The Matrix'}).click();
 await expect(page.getByText('SIZING GATE',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Quick navigation',exact:true}).click();
 const cmd=page.getByRole('dialog',{name:'Quick navigation'});
 await expect(cmd).toBeVisible();
 await cmd.getByRole('textbox',{name:'Jump to workspace'}).fill('Matrix');
 await cmd.getByRole('option',{name:/The Matrix/}).click();
 await expect(page).toHaveURL(/\/matrix$/);
});

test('Primus Trader entrance has its own responsive design and recovers from Google errors',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/session',async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({json:{...body,authenticated:false,auth_mode:'google'}})});
 await page.route('**/api/login/google?**',route=>{expect(new URL(route.request().url()).searchParams.get('return_to')).toBe('/journal');return route.fulfill({status:503,json:{detail:'Sign-in is temporarily unavailable. Please try again.'}})});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(origin+'/signin');
 await expect(page.getByRole('heading',{name:/Back to\s*your process/})).toBeVisible();
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
 await expect(page.locator('body')).not.toContainText('Prime Trader');
 await expect(page.locator('.pt-entrance-paper')).toHaveCount(0);
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`primus-signin-${width}.png`),fullPage:true});
 }
 await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Sign-in is temporarily unavailable');
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
 expect(errors).toEqual([]);
});

test('Journal Session Risk Guard tracks live loss buffer, triggers lockout, and launches 60s Tilt Reset',async({page})=>{
 await page.goto(origin+'/journal?day=2026-06-15');
 const guard=page.getByRole('region',{name:'Session risk guard',exact:true});
 await expect(guard).toBeVisible();
 await guard.getByRole('button',{name:/^(Set|Edit) limits$/}).click();
 await guard.getByLabel('Daily max loss ($)',{exact:true}).fill('500');
 await guard.getByLabel('Max trades / day',{exact:true}).fill('3');
 await guard.getByRole('button',{name:'Save limits',exact:true}).click();
 await expect(guard).toContainText('Risk Guard · Clear');
 await expect(guard).toContainText('$500 buffer intact');
 await expect(guard).toContainText('0 / 3 trades');

 // Log a trade exceeding the daily loss limit and confirm live lockout appears immediately
 await page.getByRole('button',{name:'Add trade',exact:true}).first().click();
 await page.locator('.pj-setup-result > summary').first().click();
 await page.getByLabel('Profit / loss ($)',{exact:true}).first().fill('-520');
 await expect(guard).toContainText('Daily loss limit reached — lock the desk');
 await expect(guard.getByRole('progressbar',{name:'Daily loss limit used'})).toHaveAttribute('aria-valuetext','100% of daily loss limit used');
 await expect(guard).toContainText('1 / 3 trades');

 // Clicking 60s Tilt Reset navigates to Mindset and auto-opens the 60s Tilt Reset dialog
 const resetLink=guard.getByRole('link',{name:/60s Tilt Reset/});
 await expect(resetLink).toHaveAttribute('href','/mindset?reset=1');
 await resetLink.click();
 const resetDialog=page.getByRole('dialog',{name:'60s Tilt Reset'});
 await expect(resetDialog).toBeVisible();
 await resetDialog.getByRole('button',{name:'Done early',exact:true}).click();
 await expect(resetDialog).toHaveCount(0);

 // Clean up risk guard limits so other tests start cleanly
 await page.goto(origin+'/journal?day=2026-06-15');
 const cleanGuard=page.getByRole('region',{name:'Session risk guard',exact:true});
 await cleanGuard.getByRole('button',{name:'Edit limits',exact:true}).click();
 await cleanGuard.getByRole('button',{name:'Clear limits',exact:true}).click();
 await expect(cleanGuard).toContainText('Set a daily loss cap');
});


test('Journal mobile Go-to-date input fits the viewport and aligns with the calendar',async({page})=>{
 await page.goto(origin+'/journal');
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  const input=page.locator('.pt-mobile-date input');
  await expect(input).toBeVisible();
  const box=await input.boundingBox(), cal=await page.locator('.pt-journal-sidebar > .pt-calendar').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(width);
  expect(Math.abs((box.x+box.width)-(cal.x+cal.width))).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});

test('Strategy Lab Monte Carlo stress test renders live state, interactive fan chart, and fits mobile viewports',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/lab');
 const card=page.locator('section.mc-card');
 await card.scrollIntoViewIfNeeded();
 await expect(card.getByRole('heading',{name:'Edge stress test',exact:true})).toBeVisible();
 // Seeded preview has 16 risk-recorded backtest trades + 2 missing risk -> shows progress & action
 await expect(card).toContainText('Need more trades');
 await expect(card).toContainText('16 of 20 trades with recorded risk');
 await expect(card).not.toContainText('\\$');

 // Now test the full populated stress-test view & interactive controls without mutating shared DB
 const seen=[];
 await page.route('**/api/lab/monte-carlo',async route=>{
  const body=route.request().postDataJSON();
  seen.push(body);
  const h=body.horizon||100, dd=body.drawdown_r||10;
  const steps=[0,Math.round(h*0.25),Math.round(h*0.5),Math.round(h*0.75),h];
  const scale=h/100;
  await route.fulfill({json:{
   scope:body.filters?.sample||'Backtesting',method:body.method||'block',n_sims:5000,horizon:h,drawdown_r:dd,min_trades:20,
   closed_trades:84,missing_risk:4,
   sample:{trades:80,mean_r:0.34,std_r:1.38,win_rate:0.46,net_r:27.2,sqn:2.2,block_length:4,constant_r:false},
   edge:{verdict:'strong',p_value:0.004,prob_positive:0.992,ci95:[0.07,0.61],resamples:4000,trades_needed:45,more_trades_needed:0},
   projection:{
    steps,
    bands:{
     '5':[0,-4*scale,-2*scale,3*scale,8*scale],
     '25':[0,2*scale,9*scale,16*scale,23*scale],
     '50':[0,8.5*scale,17*scale,25.5*scale,34*scale],
     '75':[0,14*scale,26*scale,37*scale,47*scale],
     '95':[0,22*scale,40*scale,56*scale,71*scale],
    },
    paths:[
     [0,-3*scale,-1*scale,5*scale,11*scale],
     [0,6*scale,15*scale,24*scale,32*scale],
     [0,15*scale,30*scale,44*scale,58*scale],
     [0,-5*scale,-8*scale,-4*scale,-1*scale],
    ],
    final:{'5':8*scale,'25':23*scale,'50':34*scale,'75':47*scale,'95':71*scale},
    prob_profit:0.978,expected_r:34*scale,
   },
   drawdown:{
    ladder:[3,5,10,15,20,30].concat(dd).filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b)
     .map(r=>({r,prob:Math.max(0.01,Math.min(0.99,Math.exp(-r/9.5)))})),
    target:{r:dd,prob:Math.max(0.01,Math.min(0.99,Math.exp(-dd/9.5))),standard_error:0.0068},
    max_dd:{'5':3.1,'25':5.2,'50':7.4,'75':10.1,'95':14.8},
    losing_streak:{median:5,p95:9},
   },
   history:{actual_max_dd:6.2,worse_share:0.68,typical_max_dd:7.4,permutations:2000},
  }});
 });

 // Switch horizon -> triggers full populated render
 await card.getByRole('button',{name:'250',exact:true}).click();
 await expect(card.getByRole('heading',{name:'Strong edge',exact:true})).toBeVisible();
 await expect(card).toContainText('Next 250 trades');
 await expect(card).toContainText('In 4,000 resamples');
 await card.getByRole('button',{name:'20R',exact:true}).click();
 await expect(card).toContainText('Chance of hitting −20R');
 await card.getByRole('button',{name:'Independent',exact:true}).click();
 await expect.poll(()=>seen.at(-1)?.method).toBe('iid');

 // Hover over fan chart -> tooltip appears inside chart bounds
 const svg=card.locator('.mc-fan svg');
 await svg.scrollIntoViewIfNeeded();
 const svgBox=await svg.boundingBox();
 await svg.hover({position:{x:Math.round(svgBox.width*0.5),y:Math.round(svgBox.height*0.5)}});
 await expect(card.locator('.mc-tip')).toBeVisible();
 await expect(card.locator('.mc-tip')).toContainText('Median:');

 // Check layout fit & capture visual checks across desktop + mobile
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const box=await card.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(width+1);
  if(width!==320) await card.screenshot({path:info.outputPath(`monte-carlo-${width}.png`)});
 }
 // Also capture dark mode desktop screenshot
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
 await card.screenshot({path:info.outputPath('monte-carlo-1440-dark.png')});
 expect(errors).toEqual([]);
});
