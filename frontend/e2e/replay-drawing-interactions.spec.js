import {test, expect} from '@playwright/test';

test('rectangle midpoint resizes, interior moves, and the axis takes priority', async ({page}) => {
  const origin='http://127.0.0.1:8119';
  await page.goto(origin+'/backtesting');
  await page.getByRole('button',{name:'New session',exact:true}).click();
  await page.getByRole('button',{name:'Open session',exact:true}).click();
  await expect(page.getByRole('status',{name:'Chart status',exact:true})).toHaveText('Chart ready');
  await page.getByRole('button',{name:'Drawing favorites',exact:true}).click();
  const favorites=page.getByRole('dialog',{name:'Favorite tools'});
  await favorites.getByLabel('Rectangle',{exact:true}).check();
  await favorites.getByRole('button',{name:'Close',exact:true}).click();
  const tool=page.getByRole('toolbar',{name:'Favorite drawing tools'}).getByRole('button',{name:'Rectangle'});
  await tool.click();
  const chart=page.locator('.replay-chart');
  const bounds=await chart.boundingBox();
  const click=(x,y)=>page.mouse.click(bounds.x+x,bounds.y+y);
  const drag=async(x,y,dx,dy)=>{
    await page.mouse.move(bounds.x+x,bounds.y+y);
    await page.mouse.down();
    await page.mouse.move(bounds.x+x+dx,bounds.y+y+dy,{steps:8});
    await page.mouse.up();
  };
  await click(300,200);
  await click(560,360);
  await click(690,380);
  await click(810,460);
  await click(430,275);
  await expect(page.getByRole('dialog',{name:'Rectangle',exact:true})).toHaveCount(0);
  await expect(page.locator('.vela-dpop:visible')).toHaveCount(0);

  await chart.click({button:'right',position:{x:430,y:275}});
  const menu=page.getByRole('menu',{name:'Drawing actions',exact:true});
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Settings','Templates','Copy⌘C','Clone⌘D','Visual order','Visibility on intervals','DeleteDelete','Hide','Lock',
  ]);
  await menu.getByRole('menuitem',{name:'Settings'}).click();
  const editor=page.getByRole('dialog',{name:'Rectangle',exact:true});
  await expect(editor.getByRole('tab')).toHaveText(['Style','Text','Coordinates','Visibility']);
  await editor.getByRole('button',{name:'Cancel'}).click();
  await chart.click({button:'right',position:{x:750,y:180}});
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Escape');
  const footer=page.locator('.bt-clock-footer');
  await expect(footer).not.toContainText(/dataset|bars|Saved/i);
  await footer.getByRole('button',{name:'Percentage scale'}).click();
  await expect(footer.getByRole('button',{name:'Percentage scale'})).toHaveAttribute('aria-pressed','true');
  await footer.getByRole('button',{name:'Percentage scale'}).click();

  const id=new URL(page.url()).searchParams.get('session');
  const layouts=async()=>await (await page.request.get(origin+'/api/backtesting/sessions/'+id+'/layouts')).json();
  const snapshot=async()=>{
    await page.getByRole('button',{name:'Save session',exact:true}).click();
    return (await layouts()).layout;
  };
  const rectangle=layout=>Object.values(layout.drawings).flatMap(doc=>doc.drawings).find(item=>item.type==='box');
  const saved=await snapshot();
  expect(Object.values(saved.drawings).flatMap(doc=>doc.drawings)).toHaveLength(1);
  const before=rectangle(saved);
  await drag(430,200,0,-35);
  const resized=rectangle(await snapshot());
  expect(resized.anchors.map(point=>point.time)).toEqual(before.anchors.map(point=>point.time));
  expect(resized.anchors[0].price).not.toBe(before.anchors[0].price);
  expect(resized.anchors[1]).toEqual(before.anchors[1]);
  await drag(430,270,35,25);
  const moved=rectangle(await snapshot());
  expect(moved.anchors.every((point,index)=>point.time!==resized.anchors[index].time)).toBe(true);

  await tool.click();
  await drag(bounds.width-10,250,0,55);
  const afterAxis=await snapshot();
  expect(rectangle(afterAxis).anchors).toEqual(moved.anchors);
  expect(afterAxis.priceScale).toBeTruthy();
});
