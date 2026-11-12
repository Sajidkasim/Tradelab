import {expect, test} from '@playwright/test';

const origin = 'http://127.0.0.1:8119';
const memoryRound = {cells:[0, 3, 8, 14]};

async function stubDrill(page, responses) {
  const attemptId = 'a'.repeat(32);
  await page.route('**/api/mindset/drill', route => {
    expect(route.request().postDataJSON().mode).toBe('memory');
    return route.fulfill({json:{attempt_id:attemptId,duration:60,rounds:Array(6).fill(memoryRound)}});
  });
  await page.route('**/api/mindset/score', route => {
    expect(route.request().postDataJSON()).toEqual({attempt_id:attemptId,responses});
    return route.fulfill({json:{score:10,max_score:60}});
  });
  await page.route('**/api/mindset/complete', route => {
    expect(route.request().postDataJSON()).toEqual({attempt_id:attemptId,day:expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)});
    return route.fulfill({json:{completed:true,team_eligible:false}});
  });
}

async function warmup(page) {
  await page.getByRole('button',{name:'Breathwork',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Pre-Market Warm-Up'});
  await expect(dialog.getByRole('heading',{name:'Breathwork'})).toBeVisible();
  return dialog;
}

test('private morning prep persists and the warm-up leads to a saved affirmation',async({page},info)=>{
  await page.clock.install();
  await page.route('**/api/mindset/check-in/reflect', route => {
    const {step, reflection, history} = route.request().postDataJSON();
    expect(step).toBe('question');
    const firstQuestion = 'I rushed into trades after a loss.';
    const firstAnswer = 'Pause before you place another trade.';
    if (reflection === firstQuestion) {
      expect(history).toEqual([]);
      return route.fulfill({json:{text:firstAnswer}});
    }
    expect(reflection).toBe('How long should I pause?');
    expect(history).toEqual([{question:firstQuestion, answer:firstAnswer}]);
    return route.fulfill({json:{text:'Until you can clearly state your entry criteria.'}});
  });
  await page.goto(`${origin}/mindset`);
  await page.getByRole('button',{name:'Ask Aura'}).click();
  const aura = page.getByRole('dialog',{name:'Aura',exact:true});
  const composer = aura.getByRole('textbox',{name:'Message Aura'});
  const thread = aura.getByRole('log');
  await composer.fill('I rushed into trades after a loss.');
  await composer.press('Enter');
  await expect(composer).toBeEmpty();
  await expect(thread).toContainText('I rushed into trades after a loss.');
  await expect(thread).toContainText('Pause before you place another trade.');
  await composer.fill('How long should I pause?');
  await aura.getByRole('button',{name:'Send message'}).click();
  await expect(composer).toBeEmpty();
  await expect(thread).toContainText('Until you can clearly state your entry criteria.');
  await aura.getByRole('button',{name:'Close'}).click();
  await page.getByRole('button',{name:'Ask Aura'}).click();
  await expect(thread).not.toContainText('I rushed into trades after a loss.');
  await aura.getByRole('button',{name:'Close'}).click();
  const progress = page.getByRole('progressbar',{name:'Pre-session checklist progress'});
  await expect(progress).toHaveAttribute('aria-valuenow','0');
  for (const [index, name] of ['HTF levels marked','News checked','Give to charity'].entries()) {
    await page.getByRole('checkbox',{name:new RegExp(name)}).check();
    await expect(progress).toHaveAttribute('aria-valuenow',String(index + 1));
  }
  await expect(page.getByText('Session Ready',{exact:true})).toBeVisible();
  await expect(page.locator('.mw-check-finish')).toHaveClass(/is-celebrating/);
  const lossLimit = page.getByRole('checkbox',{name:'Give to charity',exact:true});
  await lossLimit.uncheck();
  await expect(progress).toHaveAttribute('aria-valuetext','2 of 3 complete');
  await expect(page.getByText('Session Ready',{exact:true})).toHaveCount(0);
  await lossLimit.check();
  await expect(page.getByText('Checklist saved',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Recent check-ins',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Session Ready',{exact:true})).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuetext','3 of 3 complete');
  await expect(page.locator('.mw-check-finish')).not.toHaveClass(/is-celebrating/);
  await expect(page.getByText('Take a steady breath',{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('mindset-warmup-desktop.png')});
  await expect(page.getByRole('heading',{name:'Pre-Market Affirmation',exact:true})).toHaveCount(0);
  const dialog = await warmup(page);
  const next = dialog.getByRole('button',{name:'Next: Focus Games'});
  await expect(dialog.getByRole('button',{name:'Skip to Focus Games'})).toBeEnabled();
  await page.clock.fastForward(4100);
  await expect(dialog.getByRole('status')).toHaveText('Hold');
  await dialog.getByRole('button',{name:'Pause',exact:true}).click();
  await page.clock.fastForward(125000);
  await expect(dialog.getByRole('status')).toHaveText('Paused');
  await expect(dialog.getByRole('button',{name:'Skip to Focus Games'})).toBeEnabled();
  await dialog.getByRole('button',{name:'Resume',exact:true}).click();
  await page.clock.fastForward(120000);
  await next.click();
  await expect(dialog.getByRole('heading',{name:'Pattern Match'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Take or Pass'})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Skip to Affirmation'}).click();
  await expect(dialog.getByText('1 / 18',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Next affirmation'}).click();
  await expect(dialog.getByText('If my entry is gone, I wait for the next setup.',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Next affirmation'}).click();
  await expect(dialog.getByText('3 / 18',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:"I'm Ready — Complete Warm-Up"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Warm-Up Complete',{exact:true})).toBeVisible();
  const saved = await (await page.request.get(`${origin}/api/mindset/warmup`)).json();
  expect(saved.affirmation).toBe('The next trade has to meet my rules. It does not owe me back the last loss.');
  await expect(page.getByRole('button',{name:'Ask Aura'})).toHaveCSS('border-radius','50%');
});

test('Pattern Match works at 390px in dark mode with reduced motion',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.install();
  await stubDrill(page, [{round:0,cells:memoryRound.cells}]);
  await page.goto(`${origin}/mindset`);
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const dialog = await warmup(page);
  expect(await dialog.locator('.mw-breath-wave span').first().evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.clock.fastForward(120100);
  await dialog.getByRole('button',{name:'Next: Focus Games'}).click();
  await dialog.getByRole('button',{name:'Start 60-second drill'}).click();
  const first = dialog.getByRole('button',{name:'Tile 1',exact:true});
  await expect(first).toBeDisabled();
  await expect(first).toHaveAttribute('aria-pressed','true');
  await page.clock.fastForward(2700);
  await expect(first).toBeEnabled();
  await expect(first).toHaveAttribute('aria-pressed','false');
  for (const cell of memoryRound.cells) await dialog.getByRole('button',{name:`Tile ${cell+1}`,exact:true}).click();
  await dialog.getByRole('button',{name:'Lock pattern'}).click();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('mindset-memory-mobile.png')});
  await page.clock.fastForward(58000);
  await expect(dialog.getByText('Your score: 10 / 60')).toBeVisible();
  await dialog.getByRole('button',{name:'Submit Score & Continue'}).click();
  await expect(dialog.getByRole('heading',{name:'Affirmation & Lock-In'})).toBeVisible();
});

test('custom checklist persists and every warm-up step can be skipped', async ({page}) => {
  await page.goto(`${origin}/mindset`);
  await page.getByRole('group',{name:'Open a warm-up step'}).getByRole('button',{name:'Focus Games'}).click();
  const direct = page.getByRole('dialog',{name:'Pre-Market Warm-Up'});
  await expect(direct.getByRole('heading',{name:'Pattern Match'})).toBeVisible();
  await direct.getByRole('button',{name:'Close'}).click();
  await page.getByRole('button',{name:'Edit checklist',exact:true}).click();
  await page.getByRole('textbox',{name:'Checklist item 1',exact:true}).fill('Mark overnight high');
  await page.getByRole('button',{name:'Add checklist item',exact:true}).click();
  await page.getByRole('textbox',{name:'Checklist item 4',exact:true}).fill('Review risk rules');
  await page.getByRole('button',{name:'Remove checklist item 2',exact:true}).click();
  await page.getByRole('button',{name:'Done editing',exact:true}).click();
  await page.getByRole('checkbox',{name:'Review risk rules',exact:true}).check();
  await expect(page.getByText('Checklist saved',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox',{name:'Review risk rules',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Mark overnight high',exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'News checked',exact:true})).toHaveCount(0);
  const dialog = await warmup(page);
  const technique = dialog.getByLabel('Breathing technique');
  await expect(technique).toHaveAccessibleDescription(/when you feel rushed/);
  await technique.selectOption({label:'Box breathing'});
  await expect(technique).toHaveAccessibleDescription(/attention is scattered/);
  await expect(dialog.locator('.mw-breath-counts').getByText('Exhale 4s')).toBeVisible();
  await technique.selectOption({label:'Slow exhale'});
  await expect(technique).toHaveAccessibleDescription(/with no holds/);
  await expect(dialog.locator('.mw-breath-counts').getByText('Exhale 6s')).toBeVisible();
  await technique.selectOption({label:'Equal breathing'});
  await expect(technique).toHaveAccessibleDescription(/when you already feel settled/);
  await dialog.getByRole('button',{name:'Skip to Focus Games'}).click();
  await dialog.getByRole('button',{name:'Skip to Affirmation'}).click();
  await dialog.getByRole('button',{name:'Skip affirmation & finish'}).click();
  await expect(page.getByText('Warm-Up Complete',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Warm-Up Complete',{exact:true})).toBeVisible();
});

test('Aura puts dictated words into the composer for review', async ({page}) => {
  await page.addInitScript(()=>{
    window.SpeechRecognition = class {
      start(){setTimeout(()=>{
        this.onresult?.({results:[[{transcript:'I feel ready to wait for my setup.'}]]});
        this.onend?.();
      },50);}
      abort(){}
    };
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${origin}/mindset`);
  await page.getByRole('button',{name:'Ask Aura'}).click();
  const dialog=page.getByRole('dialog',{name:'Aura',exact:true});
  await dialog.getByRole('button',{name:'Dictate message'}).click();
  await expect(dialog.getByRole('textbox',{name:'Message Aura'})).toHaveValue('I feel ready to wait for my setup.');
  await expect(dialog.getByRole('button',{name:'Send message'})).toBeEnabled();
});

for (const failure of ['timeout', 'server error']) {
  test(`Aura keeps the message available to retry after a ${failure}`, async ({page}) => {
    await page.clock.install();
    await page.route('**/api/mindset/check-in/reflect', (route) => failure === 'timeout'
      ? new Promise((resolve) => setTimeout(() => resolve(route.abort().catch(() => {})), 6500))
      : route.fulfill({status:500, json:{detail:'unavailable'}}));
    await page.goto(`${origin}/mindset`);
    await page.getByRole('button',{name:'Ask Aura'}).click();
    const aura = page.getByRole('dialog',{name:'Aura',exact:true});
    const composer = aura.getByRole('textbox',{name:'Message Aura'});
    await composer.fill('I’m tempted to rush');
    await aura.getByRole('button',{name:'Send message'}).click();
    if (failure === 'timeout') await page.clock.fastForward(5001);
    await expect(aura.getByRole('log')).toContainText('Aura is resting');
    await expect(aura.getByRole('log')).toContainText('I’m tempted to rush');
    await page.route('**/api/mindset/check-in/reflect', (route) =>
      route.fulfill({json:{text:'Wait for your entry criteria.'}}));
    await aura.getByRole('button',{name:'Try again'}).click();
    await expect(aura.getByRole('log')).toContainText('Wait for your entry criteria.');
    await expect(composer).toBeEmpty();
  });
}

test('Aura shows and clears a blocked microphone state', async ({page}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      start() { setTimeout(() => { this.onerror({error:'not-allowed'}); this.onend(); }, 100); }
      abort() {}
    };
  });
  await page.goto(`${origin}/mindset`);
  await page.getByRole('button',{name:'Ask Aura'}).click();
  const aura = page.getByRole('dialog',{name:'Aura',exact:true});
  await aura.getByRole('button',{name:'Dictate message'}).click();
  await expect(aura.getByRole('button',{name:'Stop dictation'})).toBeVisible();
  await page.clock.fastForward(100);
  await expect(aura.getByRole('button',{name:'Microphone blocked'})).toBeDisabled();
  await page.clock.fastForward(3000);
  await expect(aura.getByRole('button',{name:'Dictate message'})).toBeEnabled();
});

test('the two focus games remember separate difficulty settings and hard Visual Search lasts a minute', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.clock.install();
  const searchRound = {grid_size:5,target:'north-east',symbols:[...Array(24).fill('north-west'),'north-east']};
  const attemptId = 'b'.repeat(32);
  await page.route('**/api/mindset/drill', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({mode:'search',difficulty:'hard'});
    return route.fulfill({json:{attempt_id:attemptId,duration:60,rounds:Array(6).fill(searchRound)}});
  });
  await page.route('**/api/mindset/score', (route) => {
    expect(route.request().postDataJSON()).toEqual({attempt_id:attemptId,responses:[{round:0,cells:[24]}]});
    return route.fulfill({json:{score:10,max_score:60}});
  });
  await page.goto(`${origin}/mindset`);
  const dialog = await warmup(page);
  await dialog.getByRole('button',{name:'Skip to Focus Games'}).click();
  const pattern = dialog.getByRole('switch',{name:'Hard difficulty for Pattern Match'});
  await expect(pattern).not.toBeChecked();
  await pattern.press('Space');
  await expect(pattern).toBeChecked();
  await expect(dialog).toContainText('Memorise five tiles');
  await dialog.getByRole('button',{name:'Visual Search'}).click();
  const search = dialog.getByRole('switch',{name:'Hard difficulty for Visual Search'});
  await expect(search).not.toBeChecked();
  await search.press('Space');
  await dialog.getByRole('button',{name:'Pattern Match'}).click();
  await expect(pattern).toBeChecked();
  await dialog.getByRole('button',{name:'Visual Search'}).click();
  await expect(search).toBeChecked();
  await dialog.getByRole('button',{name:'Start 60-second drill'}).click();
  await expect(dialog.getByLabel('Drill time remaining')).toHaveText('1:00');
  const grid = dialog.getByRole('group',{name:'Visual Search grid'});
  await expect(grid.getByRole('button')).toHaveCount(25);
  await grid.getByRole('button',{name:'Tile 25: north-east'}).click();
  await expect(dialog.getByRole('status')).toHaveText('Match found.');
  await page.clock.fastForward(59000);
  await expect(dialog.getByRole('button',{name:'Submit Score & Continue'})).toHaveCount(0);
  await page.clock.fastForward(1200);
  await expect(dialog.getByText('Your score: 10 / 60')).toBeVisible();
  await dialog.getByRole('button',{name:'Submit Score & Continue'}).click();
  await expect(dialog.getByRole('heading',{name:'Affirmation & Lock-In'})).toBeVisible();
});

test('Journal shows the saved Mindset checklist on its matching date', async ({page}) => {
  await page.goto(`${origin}/mindset`);
  const prep = await (await page.request.get(`${origin}/api/mindset/warmup`)).json();
  await page.getByRole('checkbox',{name:prep.items[0].label,exact:true}).uncheck();
  for (const item of prep.items) {
    await page.getByRole('checkbox',{name:item.label,exact:true}).check();
  }
  await expect(page.getByText('Checklist saved',{exact:true})).toBeVisible();
  await page.getByRole('group',{name:'Open a warm-up step'}).getByRole('button',{name:'Affirmation'}).click();
  await page.getByRole('dialog',{name:'Pre-Market Warm-Up'}).getByRole('button',{name:'Skip affirmation & finish'}).click();
  await expect(page.getByText('Warm-Up Complete',{exact:true})).toBeVisible();
  await page.goto(`${origin}/journal?day=${prep.day}`);
  const summary = page.getByRole('complementary',{name:'Pre-session checklist'});
  await expect(summary.getByText('Warm-up complete',{exact:true})).toBeVisible();
  await summary.getByText('Pre-session checklist',{exact:true}).click();
  await expect(summary).toContainText(`${prep.items[0].label} · Done`);
});

test('Aura opens with a contextual prompt and quick replies on a dark surface', async ({page}) => {
  await page.route('**/api/mindset/check-in/opening', (route) => route.fulfill({json:{
    text:'Yesterday was a red day. What will help you trade your plan today?',
    suggestions:['Help me reset after yesterday'],
  }}));
  await page.route('**/api/mindset/check-in/reflect', (route) => {
    expect(route.request().postDataJSON().reflection).toBe('Help me reset after yesterday');
    return route.fulfill({json:{text:'Take one setup at a time.'}});
  });
  await page.goto(`${origin}/mindset`);
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  await page.getByRole('button',{name:'Ask Aura'}).click();
  const dialog = page.getByRole('dialog',{name:'Aura',exact:true});
  await expect(dialog).toHaveCSS('background-color','rgb(40, 43, 46)');
  await expect(dialog.getByRole('heading',{name:'Prime your execution for the session.'})).toBeVisible();
  await expect(dialog.getByText(/Yesterday was a red day/)).toBeVisible();
  await dialog.getByRole('button',{name:'Help me reset after yesterday'}).click();
  await expect(dialog.getByRole('log')).toContainText('Take one setup at a time.');
});
