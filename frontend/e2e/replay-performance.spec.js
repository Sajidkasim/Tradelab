import {test,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
test.skip(!existsSync(new URL('../../data/private/backtesting-preview.json',import.meta.url)),'Local replay archive required');
test('replay performance baseline: open switch play across sessions save and resume',async({page},info)=>{
 const soak=Math.max(25000,Number(process.env.REPLAY_SOAK_MS)||25000);
 test.setTimeout(soak+90000);
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async r=>{if(r.url().includes('/api/backtesting/')){try{const req=r.request(),t=req.timing();requests.push({route:new URL(r.url()).pathname.split('/').at(-1),status:r.status(),ms:Math.round(t.responseStart-t.requestStart)})}catch{}}});
 await page.addInitScript(()=>{localStorage.setItem('primus-replay-profile','1');window.__frames=[];let last;function frame(t){if(last&&window.__frames.length<20000)window.__frames.push(t-last);last=t;requestAnimationFrame(frame)}requestAnimationFrame(frame)});
 await page.goto('http://127.0.0.1:8119/backtesting');
 await page.getByRole('button',{name:'New session',exact:true}).click();
 await page.getByLabel('Trading date',{exact:true}).fill('2023-09-12');
 const started=Date.now();await page.getByRole('button',{name:'Open session',exact:true}).click();
 const ready=page.getByRole('status',{name:'Chart status',exact:true});await expect(ready).toHaveText('Chart ready',{timeout:30000});
 const openMs=Date.now()-started;
 for(const tf of ['5m','1m']){await page.getByRole('group',{name:'Chart timeframe'}).getByRole('button',{name:tf,exact:true}).click();await expect(ready).toHaveText('Chart ready',{timeout:15000})}
 await page.mouse.move(650,350);await page.mouse.wheel(0,1000);await page.mouse.wheel(-1200,0);await page.waitForTimeout(700);
 const heapBefore=await page.evaluate(()=>performance.memory?.usedJSHeapSize??null);
 await page.getByLabel('Replay speed',{exact:true}).focus();await page.keyboard.press('End');
 await page.getByRole('button',{name:'Play replay',exact:true}).click();
 const initial=await page.getByLabel('Replay time',{exact:true}).textContent();
 const heapSamples=[];
 for(let remaining=soak;remaining>0;remaining-=5000){
  await page.waitForTimeout(Math.min(5000,remaining));
  heapSamples.push(await page.evaluate(()=>performance.memory?.usedJSHeapSize??null));
 }
 await page.getByRole('button',{name:'Pause replay',exact:true}).click();
 await expect(page.getByLabel('Replay time',{exact:true})).not.toHaveText(initial);
 await page.getByRole('button',{name:'Save session',exact:true}).click();await expect(page.locator('.bt-save-status')).toHaveText('Saved',{timeout:15000});
 const clock=await page.getByLabel('Replay time',{exact:true}).textContent();
 const metrics=await page.evaluate(()=>({heapAfter:performance.memory?.usedJSHeapSize??null,frameIntervals:window.__frames,timings:window.__primusReplayTimings||[]}));
 const frames=metrics.frameIntervals.sort((a,b)=>a-b);delete metrics.frameIntervals;
 const report={openMs,soakMs:soak,heapSamples,heapBefore,...metrics,frameP95:frames[Math.floor(frames.length*.95)],frameMax:Math.max(...frames),requests,errors};
 writeFileSync(info.outputPath('replay-performance.json'),JSON.stringify(report,null,2));
 await info.attach('replay-performance.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
 await page.reload();await expect(ready).toHaveText('Chart ready',{timeout:30000});await expect(page.getByLabel('Replay time',{exact:true})).toHaveText(clock);
 expect(errors).toEqual([]);expect(requests.filter(r=>r.status>=500)).toEqual([]);
});
