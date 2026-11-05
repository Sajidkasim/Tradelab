import {test, expect} from '@playwright/test';

test('magnet drawing keeps anchors across intervals and templates change only appearance', async ({page}, testInfo) => {
  const logs = [];
  page.on('console', message => {
    const match = message.text().match(/^\[replay drawings\] (before|after) (\S+) (\[.*\]) (\[.*\])$/);
    if (match) logs.push({phase:match[1], timeframe:match[2], drawings:JSON.parse(match[3]), recent:JSON.parse(match[4])});
  });
  const origin = 'http://127.0.0.1:8119';
  await page.goto(origin + '/backtesting?drawingDebug=1');
  await page.getByRole('button',{name:'New session',exact:true}).click();
  await page.getByRole('button',{name:'Open session',exact:true}).click();
  const status = page.getByRole('status',{name:'Chart status',exact:true});
  await expect(status).toHaveText('Chart ready',{timeout:15000});
  const chart = page.locator('.replay-chart');
  const timeframes = page.getByRole('group',{name:'Chart timeframe'});
  async function switchInterval(label, timeframe) {
    const previous = logs.length;
    await timeframes.getByRole('button',{name:label,exact:true}).click();
    await expect.poll(() => logs.slice(previous).find(event => event.phase === 'after')?.timeframe).toBe(timeframe);
    await expect(status).toHaveText('Chart ready');
    return logs.slice(previous).find(event => event.phase === 'after').drawings;
  }

  await switchInterval('1D', '1D');
  const magnet = page.getByRole('button',{name:'Magnet snap — more',exact:true});
  await page.getByRole('button',{name:'Magnet snap',exact:true}).hover();
  await magnet.press('Enter');
  await page.getByText('Strong',{exact:true}).click();
  await page.getByRole('button',{name:'Lines',exact:true}).click();
  const toolbarWidth = 44;
  const recent = logs.at(-1).recent;
  await chart.click({position:{x:recent.at(-2).x + toolbarWidth,y:310}});
  await chart.click({position:{x:recent.at(-1).x + toolbarWidth,y:310}});
  const anchorValues = drawings => drawings.map(drawing => drawing.anchors.map(({time,price}) => ({time,price})));
  const fourHours = await switchInterval('4h', '240');
  const original = anchorValues(fourHours);
  expect(original).toHaveLength(1);
  expect(original[0]).toHaveLength(2);
  expect(original[0].every(anchor => Number.isInteger(anchor.time))).toBe(true);
  expect(anchorValues(await switchInterval('1h','60'))).toEqual(original);
  expect(anchorValues(await switchInterval('15m','15'))).toEqual(original);
  const daily = await switchInterval('1D','1D');
  expect(anchorValues(daily)).toEqual(original);

  const hours = await switchInterval('1h','60');
  const anchor = hours[0].anchors[0];
  const bounds = await chart.boundingBox();
  expect(anchor.x).toBeGreaterThan(45);
  expect(anchor.x).toBeLessThan(bounds.width - 60);
  expect(anchor.y).toBeGreaterThan(0);
  expect(anchor.y).toBeLessThan(bounds.height - 50);
  await page.mouse.move(bounds.x + toolbarWidth + anchor.x, bounds.y + anchor.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + toolbarWidth + anchor.x + 26, bounds.y + anchor.y + 9, {steps:8});
  await page.mouse.up();
  const changed = await switchInterval('1D','1D');
  expect(anchorValues(changed)).not.toEqual(original);
  const dailyProjection = changed[0].anchors[0];
  expect(dailyProjection.barOpen).toBe(original[0][0].time);
  expect(dailyProjection.time).toBeGreaterThan(dailyProjection.barOpen);
  expect(dailyProjection.legacyX).not.toBe(dailyProjection.x);
  if (process.env.PRIMUS_DRAWING_TRACE === '1') {
    console.log('DAILY_ANCHOR_TRACE', JSON.stringify({original:original[0][0], afterHourlyEdit:dailyProjection}));
  }
  expect(anchorValues(await switchInterval('1h','60'))).toEqual(anchorValues(changed));
  const point = logs.at(-1).drawings[0].anchors[0];
  await chart.click({position:{x:point.x + toolbarWidth,y:point.y}});
  const actions = page.getByRole('toolbar',{name:'Selected drawing actions'});
  await actions.getByRole('button',{name:'Template',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Drawing template & text'});
  await dialog.getByLabel('Label',{exact:true}).fill('Previous day high');
  await dialog.getByLabel('Template name').fill('PDH');
  await dialog.getByRole('button',{name:'Save as template'}).click();
  await expect(dialog.getByRole('button',{name:'Use PDH'})).toBeVisible();
  await dialog.getByRole('button',{name:'Apply to drawing'}).click();
  expect(anchorValues(await switchInterval('1D','1D'))).toEqual(anchorValues(changed));
  const stay = page.getByRole('checkbox',{name:'Stay in drawing mode'});
  await stay.check();
  await page.reload();
  await expect(stay).toBeChecked();
  await stay.uncheck();
  await page.reload();
  await expect(stay).not.toBeChecked();
  await testInfo.attach('drawing-timeframe-trace.json',{body:JSON.stringify(logs,null,2),contentType:'application/json'});
});
