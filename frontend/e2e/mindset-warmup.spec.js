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
  // The browser clock advances in this test while the server clock stays real.
  await page.route('**/api/mindset/breathwork/finish', route => route.fulfill({json:{completed:true}}));
  await page.goto(`${origin}/mindset`);
  await expect(page.getByRole('button',{name:'Ask Primax'})).toHaveCount(0);
  const progress = page.getByRole('progressbar',{name:'Pre-session checklist progress'});
  await expect(progress).toHaveAttribute('aria-valuenow','0');
  for (const [index, name] of ['HTF levels marked','News checked','Give to charity'].entries()) {
    await page.getByRole('checkbox',{name:new RegExp(name)}).check();
    await expect(progress).toHaveAttribute('aria-valuenow',String(index + 1));
  }
  await expect(page.getByText('Session Ready',{exact:true})).toBeVisible();
  await expect(page.getByRole('region', {name:'Pre-Session Checklist'}).locator('.mw-check-finish')).toHaveClass(/is-celebrating/);
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
  await expect(page.getByRole('region', {name:'Pre-Session Checklist'}).locator('.mw-check-finish')).not.toHaveClass(/is-celebrating/);
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
  await expect(page.getByRole('button',{name:'Ask Primax'})).toHaveCount(0);
});

test('Pattern Match works at 390px in dark mode with reduced motion',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.install();
  // The browser clock advances in this test while the server clock stays real.
  await page.route('**/api/mindset/breathwork/finish', route => route.fulfill({json:{completed:true}}));
  await stubDrill(page, [{round:0,cells:memoryRound.cells}]);
  await page.goto(`${origin}/mindset`);
  await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const dialog = await warmup(page);
  expect(await dialog.locator('.mw-breath-ring').evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.clock.fastForward(120100);
  await dialog.getByRole('button',{name:'Next: Focus Games'}).click();
  const focusGame = dialog.getByRole('group',{name:'Focus game'});
  await expect(focusGame.locator('.sliding-selection-highlight')).toHaveCSS('transition-duration','0s');
  expect(await dialog.getByRole('list',{name:'Warm-up steps'}).evaluate(el=>getComputedStyle(el,'::before').transitionDuration)).toBe('0s');
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
  await technique.selectOption({label:'Sharpen focus & attention (Box)'});
  await expect(technique).toHaveAccessibleDescription(/steady point of focus/);
  await expect(dialog.locator('.mw-breath-counts').getByText('Exhale 4s')).toBeVisible();
  await technique.selectOption({label:'Kill FOMO & lower heart rate'});
  await expect(technique).toHaveAccessibleDescription(/with no holds/);
  await expect(dialog.locator('.mw-breath-counts').getByText('Exhale 6s')).toBeVisible();
  await technique.selectOption({label:'Find your center'});
  await expect(technique).toHaveAccessibleDescription(/during a slow market/);
  await dialog.getByRole('button',{name:'Skip to Focus Games'}).click();
  await dialog.getByRole('button',{name:'Skip to Affirmation'}).click();
  await dialog.getByRole('button',{name:'Skip affirmation & finish'}).click();
  await expect(page.getByText('Warm-Up Complete',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Warm-Up Complete',{exact:true})).toBeVisible();
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

test('floating Primax bubble stays on Journal only and stays hidden on other workspaces', async ({page}) => {
  for (const path of ['/mindset', '/learn', '/matrix']) {
    await page.goto(`${origin}${path}`);
    await expect(page.getByRole('button', {name: 'Ask Primax'})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Primax - Trading Assistant'})).toHaveCount(0);
  }
  await page.goto(`${origin}/journal`);
  await expect(page.getByRole('button', {name: 'Primax - Trading Assistant'})).toBeVisible();
});

test('Readiness tilt guard, 60s Tilt Reset, Morning Brief and starter habits work cleanly', async ({page}) => {
  await page.goto(`${origin}/mindset`);
  await expect(page.getByRole('region', {name: 'Pre-market', exact: true})).toBeVisible();
  await page.getByText(/^Check in/).click();

  // Selecting Emotional triggers the Tilt Guard banner and launches 60s Tilt Reset
  const headspace = page.getByRole('group', {name: 'Current headspace'});
  const calm = headspace.getByRole('button', {name: 'Calm', exact: true});
  if (await calm.getAttribute('aria-pressed') !== 'true') await calm.click();
  const highlight = headspace.locator('.sliding-selection-highlight');
  await expect(highlight).toBeVisible();
  const startX = (await highlight.boundingBox()).x;
  const emotional = headspace.getByRole('button', {name: 'Emotional', exact: true});
  await emotional.click();
  await expect(emotional).toHaveAttribute('aria-pressed','true');
  await expect.poll(async () => (await highlight.boundingBox()).x).toBeGreaterThan(startX);
  await expect(page.getByText(/Elevated tilt risk/)).toBeVisible();
  await page.getByRole('button', {name: '60s Reset', exact: true}).click();
  const resetDialog = page.getByRole('dialog', {name: '60s Tilt Reset'});
  await expect(resetDialog.getByRole('heading', {name: '60s Tilt Reset', exact: true})).toBeVisible();
  await resetDialog.getByRole('button', {name: 'Done early', exact: true}).click();
  await expect(resetDialog).toHaveCount(0);

  // Morning Primax Brief generates a 3-point plan
  await page.getByLabel('Pre-market check-in note').fill('Need to stay patient for 9:45 NY open.');
  await page.getByRole('button', {name: 'Generate brief', exact: true}).click();
  await expect(page.locator('.mw-brief-result li')).toHaveCount(3);

  await page.setViewportSize({width: 390, height: 844});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Pre-market resumes an exercise and keeps prep performance details tucked away', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.route('**/api/mindset/warmup', async route => {
    const response = await route.fetch();
    await route.fulfill({response, json: {...await response.json(), completed: false}});
  });
  await page.route('**/api/mindset/mirror', route => route.fulfill({json: {
    total_journal_days: 3,
    prepped: {days: 2, plan_pct: 100, plan_tagged: 1, pnl_days: 1, net_pnl: 500, recent_days: ['2026-11-12']},
    unprepped: {days: 1, plan_pct: 0, plan_tagged: 1, pnl_days: 1, net_pnl: -300, recent_days: ['2026-11-11']},
    calm: {days: 1, net_pnl: 500},
    tilted: {days: 1, net_pnl: -300},
  }}));
  await page.goto(`${origin}/mindset`);
  await page.setViewportSize({width: 320, height: 700});
  const audio = page.getByLabel('Focus audio');
  await audio.click();
  const audioBounds = await page.getByRole('group', {name: 'Focus soundscape'}).boundingBox();
  expect(audioBounds.x).toBeGreaterThanOrEqual(0);
  expect(audioBounds.x + audioBounds.width).toBeLessThanOrEqual(320);
  await page.getByRole('button', {name: 'Audio off', exact: true}).click();
  await expect(audio).toBeFocused();
  await page.getByRole('button', {name: 'Start Warm-Up', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Pre-Market Warm-Up'});
  await dialog.getByRole('button', {name: 'Skip to Focus Games'}).click();
  await dialog.getByRole('button', {name: 'Close', exact: true}).click();
  await page.getByRole('button', {name: 'Resume Warm-Up', exact: true}).click();
  await expect(dialog.getByRole('heading', {name: 'Pattern Match'})).toBeVisible();
  await dialog.getByRole('button', {name: 'Close', exact: true}).click();

  const performance = page.getByRole('region', {name: 'Prep performance'});
  await expect(performance.getByText('On-plan · 1 rated · 2 sessions')).toBeVisible();
  const entry = performance.getByRole('link', {name: '2026-11-12'});
  await expect(entry).toBeHidden();
  await performance.getByText('View breakdown').click();
  await expect(entry).toHaveAttribute('href', '/journal?day=2026-11-12');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Neural Radar hard drill locks, tracks with surge/decoys, acquires targets, and scores cleanly', async ({page}, info) => {
  await page.clock.install();
  const radarOrbs = [
    {x: 18, y: 24, vx: 45, vy: 22}, {x: 38, y: 24, vx: -36, vy: 30},
    {x: 60, y: 24, vx: 32, vy: 40}, {x: 80, y: 24, vx: -44, vy: 26},
    {x: 18, y: 50, vx: 40, vy: -30}, {x: 38, y: 50, vx: -35, vy: -35},
    {x: 60, y: 50, vx: 38, vy: 34}, {x: 80, y: 50, vx: -42, vy: -28},
    {x: 18, y: 76, vx: 46, vy: -24}, {x: 38, y: 76, vx: -32, vy: -42},
    {x: 60, y: 76, vx: 36, vy: -32}, {x: 80, y: 76, vx: -40, vy: -36},
  ];
  const radarRound = {
    orb_count: 12,
    targets: [0, 3, 7, 10],
    decoys: [{orb: 1, at_ms: 1400}, {orb: 5, at_ms: 2800}],
    lock_ms: 1600,
    track_ms: 4800,
    speed_surge: true,
    orbs: radarOrbs,
  };
  const attemptId = 'c'.repeat(32);
  await page.route('**/api/mindset/drill', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({mode: 'radar', difficulty: 'hard'});
    return route.fulfill({json: {attempt_id: attemptId, duration: 60, rounds: Array(6).fill(radarRound)}});
  });
  await page.route('**/api/mindset/score', (route) => {
    expect(route.request().postDataJSON()).toEqual({attempt_id: attemptId, responses: [{round: 0, cells: [0, 3, 7, 10]}]});
    return route.fulfill({json: {score: 10, max_score: 60}});
  });

  await page.goto(`${origin}/mindset`);
  await page.getByRole('group', {name: 'Open a warm-up step'}).getByRole('button', {name: 'Neural Radar'}).click();
  const dialog = page.getByRole('dialog', {name: 'Pre-Market Warm-Up'});
  await expect(dialog.getByRole('heading', {name: 'Neural Radar'})).toBeVisible();

  const hardSwitch = dialog.getByRole('switch', {name: 'Hard difficulty for Neural Radar'});
  await expect(hardSwitch).not.toBeChecked();
  await hardSwitch.press('Space');
  await expect(hardSwitch).toBeChecked();
  await expect(dialog).toContainText('12 orbs · 4 targets');

  await dialog.getByRole('button', {name: 'Start 60-second drill'}).click();
  const arena = dialog.getByRole('group', {name: 'Neural Radar arena'});
  await expect(arena.getByRole('button')).toHaveCount(12);
  await expect(dialog).toContainText('PHASE 1 · LOCK TARGETS');
  await expect(arena.getByRole('button', {name: 'Orb 1', exact: true})).toBeDisabled();
  await expect(arena.getByRole('button', {name: 'Orb 1', exact: true})).toHaveAttribute('aria-pressed', 'true');

  // Advance into mid-flight Track phase (speed surge active)
  await page.clock.fastForward(3900);
  await expect(dialog).toContainText('PHASE 2 · TRACK IN MOTION');
  await expect(dialog).toContainText('SURGE');

  // Advance into Acquire phase (1600 + 4800 = 6400ms)
  await page.clock.fastForward(2800);
  await expect(dialog).toContainText('PHASE 3 · ACQUIRE TARGETS');
  const orb1 = arena.getByRole('button', {name: 'Orb 1', exact: true});
  await expect(orb1).toBeEnabled();

  for (const idx of radarRound.targets) {
    await arena.getByRole('button', {name: `Orb ${idx + 1}`, exact: true}).click();
  }
  await expect(dialog.getByRole('status')).toHaveText('All targets acquired (+10).');
  await expect(dialog).toContainText('10 pts');

  // Mobile 390px bounds check
  await page.setViewportSize({width: 390, height: 844});
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({path: info.outputPath('mindset-neural-radar-mobile.png')});

  await page.clock.fastForward(54000);
  await expect(dialog.getByText('Your score: 10 / 60')).toBeVisible();
  await dialog.getByRole('button', {name: 'Submit Score & Continue'}).click();
  await expect(dialog.getByRole('heading', {name: 'Affirmation & Lock-In'})).toBeVisible();
});

