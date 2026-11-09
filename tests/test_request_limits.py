import asyncio
from webapp.request_limits import RequestLimits

def test_chunked_body_cannot_bypass_limit_or_reach_parser():
    async def run():
        reached=[];sent=[]
        async def app(*args):reached.append(True)
        messages=iter([{'type':'http.request','body':b'a'*5000,'more_body':True},{'type':'http.request','body':b'b'*5000,'more_body':False}])
        async def receive():return next(messages)
        async def send(m):sent.append(m)
        await RequestLimits(app)({'type':'http','method':'POST','path':'/api/unlock','headers':[]},receive,send)
        assert not reached and sent[0]['status']==413
    asyncio.run(run())

def test_valid_stream_is_replayed_without_changes():
    async def run():
        seen=[]
        async def app(scope,receive,send):
            while True:
                msg=await receive();seen.append(msg['body'])
                if not msg['more_body']:break
        messages=iter([{'type':'http.request','body':b'abc','more_body':True},{'type':'http.request','body':b'def','more_body':False}])
        async def receive():return next(messages)
        await RequestLimits(app)({'type':'http','method':'POST','path':'/api/import/preview','headers':[]},receive,None)
        assert b''.join(seen)==b'abcdef'
    asyncio.run(run())
