import {expect,test} from '@playwright/test';

for (const desktopMode of [false,true]) {
test(`private Bullpen works with ${desktopMode?'desktop-site tablet':'Android'} browser settings`,async({page},info)=>{
  const token='e30.eyJleHAiOjQxMDI0NDQ4MDB9.fake';
  await page.route('**/api/session',route=>route.fulfill({json:{
    authenticated:true,auth_mode:'google',csrf:'test-csrf',
  }}));
  await page.route('**/api/bullpen**',route=>{
    if(new URL(route.request().url()).pathname.endsWith('/macro-feed'))return route.fulfill({json:{items:[],stale:false}});
    const join=new URL(route.request().url()).searchParams.has('join');
    expect(route.request().headers()['x-primus-csrf']).toBe('test-csrf');
    return route.fulfill({json:{
      name:'Sajid',configured:true,topic:'primus:bullpen:v1',
      url:'https://primus-test.supabase.co',publishableKey:'test-key',token,
      ...(join?{meeting:{appId:'vpaas-magic-cookie-test',jwt:'test-meeting-token',roomName:'PrimusLab-Bullpen-Live-synthetic'}}:{}),
    }});
  });
  await page.route('https://8x8.vc/**/external_api.js',route=>route.fulfill({
    contentType:'text/javascript',
    body:`window.JitsiMeetExternalAPI=class {
      constructor(domain, options){
        window.testRoom=options.roomName;
        window.testAudioConfig=options.configOverwrite;
        this.handlers={};
        this.frame=document.createElement('iframe');
        this.frame.title='Test video room';
        options.parentNode.append(this.frame);
        setTimeout(()=>this.handlers.videoConferenceJoined?.(),0);
      }
      on(name,fn){this.addListener(name,fn)}
      addListener(name,fn){this.handlers[name]=fn}
      removeListener(name){delete this.handlers[name]}
      dispose(){window.testDisposed=true;this.frame.remove()}
    };`,
  }));
  await page.routeWebSocket(/primus-test\.supabase\.co/,socket=>{
    socket.onMessage(message=>{
      if(Buffer.isBuffer(message)){
        expect(message[0]).toBe(3);
        let offset=7;
        const read=length=>{
          const text=message.subarray(offset,offset+length).toString();
          offset+=length;
          return text;
        };
        const [joinRef,ref,topic,event]=[...message.subarray(1,5)].map(read);
        read(message[5]);
        const payload=JSON.parse(message.subarray(offset).toString());
        socket.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{}}]));
        socket.send(JSON.stringify([joinRef,null,topic,'broadcast',{event,payload}]));
        return;
      }
      const packet=JSON.parse(message);
      const array=Array.isArray(packet);
      const [joinRef,ref,topic,event,payload]=array?packet:
        [packet.join_ref,packet.ref,packet.topic,packet.event,packet.payload];
      const reply=(kind,data,responseRef=null)=>socket.send(JSON.stringify(array?
        [joinRef,responseRef,topic,kind,data]:{join_ref:joinRef,ref:responseRef,topic,event:kind,payload:data}));
      if(ref)reply('phx_reply',{status:'ok',response:{}},ref);
      if(event==='presence')reply('presence_state',payload.event==='track'?
        {member:{metas:[{phx_ref:'member',name:'Sajid'}]}}:{});
      if(event==='broadcast')reply('broadcast',payload);
    });
  });
  await page.addInitScript(desktop=>{
    Object.defineProperty(navigator,'userAgent',{get:()=>desktop?'Mozilla/5.0 (X11; Linux x86_64) Chrome/130':'Android test browser'});
    Object.defineProperty(navigator,'userAgentData',{get:()=>undefined});
  },desktopMode);
  await page.goto('http://127.0.0.1:8119/learn');
  if(desktopMode) await page.getByText('Android screen sharing',{exact:true}).click();
  await expect(page.getByRole('link',{name:'Install Jitsi Meet',exact:true})).toHaveAttribute('href','https://play.google.com/store/apps/details?id=org.jitsi.meet');
  await page.getByRole('button',{name:'Prepare screen sharing'}).click();
  await expect(page.getByRole('link',{name:'Open Jitsi Meet'})).toHaveAttribute('href',/^intent:\/\/8x8\.vc\/vpaas-magic-cookie-test\/PrimusLab-Bullpen-Live-synthetic#jwt=test-meeting-token#Intent;scheme=org\.jitsi\.meet;package=org\.jitsi\.meet;/);
  await expect(page.getByTitle('Test video room')).toHaveCount(0);
  await page.getByRole('button',{name:'Join Live Trading Floor'}).click();
  await expect(page.getByTitle('Test video room')).toBeVisible();
  expect(await page.evaluate(()=>window.testAudioConfig)).toMatchObject({enableOpusRed:true,enableNoAudioDetection:true,startWithAudioMuted:true});
  expect(await page.evaluate(()=>window.testRoom)).toBe('vpaas-magic-cookie-test/PrimusLab-Bullpen-Live-synthetic');
  await expect(page.getByRole('navigation',{name:'Primus navigation'}).getByText('LIVE')).toBeVisible();
  const divider=page.getByRole('separator',{name:'Resize stage and sidebar'});
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow','72');
  await page.getByRole('textbox',{name:'Team message'}).fill('Watching the open.');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByRole('log')).toContainText('Watching the open.');
  await page.getByRole('button',{name:'News'}).click();
  await expect(page.getByLabel('Desk macro, calendar, and live squawk',{exact:true})).toBeVisible();
  await page.getByTitle('Test video room').evaluate(frame=>{window.originalBullpenFrame=frame});
  await page.getByRole('button',{name:'Minimise',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Learn',exact:true})).toBeVisible();
  await expect(page.locator('.bullpen-room.is-minimised')).toBeVisible();
  expect(await page.getByTitle('Test video room').evaluate(frame=>frame===window.originalBullpenFrame)).toBe(true);
  expect(await page.evaluate(()=>window.testDisposed)).not.toBe(true);
  await page.setViewportSize({width:390,height:844});
  const bounds=await page.locator('.bullpen-room.is-minimised').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:info.outputPath('bullpen-minimised.png')});
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})).toBe(true);
  await page.getByRole('navigation',{name:'Primus navigation'}).getByRole('link',{name:'Journal',exact:true}).click();
  await expect(page).toHaveURL('http://127.0.0.1:8119/journal');
  await expect(page.locator('.bullpen-room.is-minimised')).toBeVisible();
  expect(await page.getByTitle('Test video room').evaluate(frame=>frame===window.originalBullpenFrame)).toBe(true);
  expect(await page.evaluate(()=>window.testDisposed)).not.toBe(true);
  await page.getByRole('button',{name:'Restore',exact:true}).click();
  await expect(page.locator('.bullpen-room.is-minimised')).toHaveCount(0);
  expect(await page.getByTitle('Test video room').evaluate(frame=>frame===window.originalBullpenFrame)).toBe(true);
  await page.getByRole('button',{name:'Leave',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Pause. Put it on paper.',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.testDisposed)).toBe(true);
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})).toBe(false);
  await expect(page.getByRole('navigation',{name:'Primus navigation'}).getByText('LIVE')).toHaveCount(0);
});
}
