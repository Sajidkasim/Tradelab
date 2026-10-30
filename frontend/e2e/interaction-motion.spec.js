import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
test('workspace previews respond to hover and keyboard focus, with reduced-motion alternatives',async({page},info)=>{
  await page.route('https://s3.tradingview.com/**',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto(origin);
  const journal=page.locator('.pt-tool-journal'),lab=page.locator('.pt-tool-lab');
  await journal.hover();
  await expect.poll(()=>journal.locator('.pt-paper-line>span').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(150);
  await page.screenshot({path:info.outputPath('journal-hover.png')});
  await lab.hover();
  await expect.poll(()=>lab.locator('.pt-preview-trace').evaluate(el=>parseFloat(getComputedStyle(el).strokeDashoffset))).toBe(0);
  await expect(lab.locator('.pt-preview-tags')).toContainText('Confirmation');
  await page.screenshot({path:info.outputPath('lab-hover.png')});
  // Keyboard focus triggers the same preview without hijacking link navigation.
  await lab.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(journal).toBeFocused();
  await expect.poll(()=>journal.locator('.pt-paper-line>span').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(150);
  await page.emulateMedia({reducedMotion:'reduce'});
  await lab.hover();
  for(const selector of ['.pt-preview-trace','.pt-preview-candle','.pt-preview-signal']){
    expect(await lab.locator(selector).first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  }
  expect(await lab.locator('.pt-preview-trace').evaluate(el=>Number(getComputedStyle(el).opacity))).toBeGreaterThan(.5);
});
