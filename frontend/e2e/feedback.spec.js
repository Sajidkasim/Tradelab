import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:8119';
test('Journal announces this release once and Backtesting delivers feedback to the owner inbox',async({page})=>{
 await page.goto(`${origin}/journal`);
 const metadata=await (await page.request.get(`${origin}/api/metadata`)).json();
 const notes=page.getByRole('dialog',{name:'What’s new in PrimusTrader',exact:true});
 if(!metadata.release_notes.seen){await expect(notes).toContainText('Backtesting is still in beta');await notes.getByRole('button',{name:'Got it',exact:true}).click()}
 await page.reload();await expect(notes).toHaveCount(0);
 await page.goto(`${origin}/backtesting`);await page.getByRole('button',{name:'New session',exact:true}).click();await page.getByRole('button',{name:'Open session',exact:true}).click();await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready',{timeout:15000});
 await page.getByRole('button',{name:'Give feedback',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Backtesting feedback',exact:true});await dialog.getByLabel('Your feedback',{exact:true}).fill('Browser test: make the replay button clearer.');await dialog.getByRole('button',{name:'Send feedback',exact:true}).click();await expect(dialog).toContainText('Feedback sent to Sajid');await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:'Feedback inbox',exact:true}).click();await expect(page.getByRole('dialog',{name:'Feedback inbox',exact:true})).toContainText('Browser test: make the replay button clearer.');
});
