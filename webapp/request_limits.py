"""Bound actual request bytes before JSON/multipart parsing, including chunked bodies."""
from tempfile import SpooledTemporaryFile
from starlette.responses import JSONResponse


class RequestLimits:
    def __init__(self,app):
        self.app=app

    async def __call__(self,scope,receive,send):
        if scope['type']!='http' or scope['method'] not in ('POST','PUT','PATCH','DELETE'):
            return await self.app(scope,receive,send)
        limit=8192 if scope['path']=='/api/unlock' else 9*1024*1024
        headers=dict(scope.get('headers',[]))
        try:
            declared=int(headers.get(b'content-length',b'0'))
            if declared<0:raise ValueError()
        except ValueError:
            return await JSONResponse({'detail':'Invalid request length.'},status_code=400)(scope,receive,send)
        if declared>limit:
            return await JSONResponse({'detail':'Request body is too large.'},status_code=413)(scope,receive,send)
        with SpooledTemporaryFile(max_size=1024*1024) as body:
            total=0
            while True:
                message=await receive()
                if message['type']=='http.disconnect':return
                chunk=message.get('body',b'');total+=len(chunk)
                if total>limit:
                    return await JSONResponse({'detail':'Request body is too large.'},status_code=413)(scope,receive,send)
                body.write(chunk)
                if not message.get('more_body',False):break
            body.seek(0)
            remaining=total
            finished=False
            async def replay():
                nonlocal remaining,finished
                if finished:return await receive()
                if remaining:
                    chunk=body.read(min(65536,remaining));remaining-=len(chunk)
                    finished=remaining==0
                    return {'type':'http.request','body':chunk,'more_body':remaining>0}
                finished=True
                return {'type':'http.request','body':b'','more_body':False}
            await self.app(scope,replay,send)
