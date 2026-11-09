/** Read-only startup audit. Usage: node tools/audit_frontend.mjs [origin] [report.json] */
import {chromium} from '../frontend/node_modules/playwright-core/index.mjs';
import {writeFile} from 'node:fs/promises';
const origin=process.argv[2]||'http://127.0.0.1:8133';
const browser=await chromium.launch({headless:true});const results=[];
try{
 for(const path of ['/','/journal','/backtesting','/matrix']){
  const context=await browser.newContext();const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.__auditLongTasks=[];try{new PerformanceObserver(list=>window.__auditLongTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true})}catch{}});
  const response=await page.goto(origin+path,{waitUntil:'domcontentloaded'});await page.waitForTimeout(2500);
  const metrics=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');return {domReadyMs:Math.round(n.domContentLoadedEventEnd),loadMs:Math.round(n.loadEventEnd),resourceCount:r.length,encodedBytes:r.reduce((s,x)=>s+x.encodedBodySize,0),longTasks:window.__auditLongTasks,js:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).map(x=>new URL(x.name).pathname)}});
  results.push({path,status:response.status(),...metrics,errors});await context.close();
 }
 const report={origin,at:new Date().toISOString(),note:'Single cold-context startup samples; not chart-ready timing or a network-throttled field benchmark.',results};
 if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}
