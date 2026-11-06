import {expect,test} from '@playwright/test';

test('private Bullpen joins, shares presence and chat, and disposes the video on leave',async({page})=>{
  const token='e30.eyJleHAiOjQxMDI0NDQ4MDB9.fake';
  await page.route('**/api/session',route=>route.fulfill({json:{
    authenticated:true,auth_mode:'google',csrf:'test-csrf',
  }}));
  await page.route('**/api/bullpen*',route=>{
    const join=new URL(route.request().url()).searchParams.has('join');
    expect(route.request().headers()['x-primus-csrf']).toBe('test-csrf');
    return route.fulfill({json:{
      name:'Sajid',configured:true,topic:'primus:bullpen:v1',
      url:'https://primus-test.supabase.co',publishableKey:'test-key',token,
      ...(join?{meeting:{domain:'meet.primus-test.example',jwt:'room-token'}}:{}),
    }});
  });
  await page.route('https://meet.primus-test.example/external_api.js',route=>route.fulfill({
    contentType:'text/javascript',
    body:`window.JitsiMeetExternalAPI=class {
      constructor(domain, options){
        window.testRoom=options.roomName;
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
  await page.goto('http://127.0.0.1:8119/learn');
  await page.getByRole('button',{name:'Join Live Trading Floor'}).click();
  await expect(page.getByTitle('Test video room')).toBeVisible();
  expect(await page.evaluate(()=>window.testRoom)).toBe('PrimusLab-Live-Trading-Floor');
  await expect(page.getByRole('navigation',{name:'Primus navigation'}).getByText('LIVE')).toBeVisible();
  const divider=page.getByRole('separator',{name:'Resize video and sidebar'});
  await divider.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow','68');
  await page.getByRole('textbox',{name:'Team message'}).fill('Watching the open.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('log')).toContainText('Watching the open.');
  await page.getByRole('button',{name:'Trade Feed'}).click();
  await expect(page.getByLabel('Trade feed',{exact:true})).toContainText('No trade feed');
  await page.getByRole('button',{name:'Leave Call'}).click();
  await expect(page.getByRole('heading',{name:'Learn',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.testDisposed)).toBe(true);
  await expect(page.getByRole('navigation',{name:'Primus navigation'}).getByText('LIVE')).toHaveCount(0);
});
