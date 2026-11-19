"""Shared team-published resources and strictly private personal vision boards."""
from datetime import datetime, timezone
from uuid import uuid4
from urllib.parse import urlsplit, parse_qs
import re
from typing import Literal, get_args
from pydantic import Field, field_validator, model_validator
from fastapi import Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from .schemas import StrictModel
from .daily_journal import compress, MAX_UPLOAD

CONTENT='primus_resources_v1'
PUBLISHERS='primus_publishers_v1'
BOARD='primus_vision_v1'
PROGRESS='primus_learning_progress_v1'
GUIDES=Literal['chart','risk','test','review']

class LearningProgress(StrictModel):
    last:GUIDES='chart'
    completed:list[GUIDES]=Field(default_factory=list,max_length=4)

IMAGE_DAY='2000-01-01'  # Reuses the existing private object store, never Journal entries.
CATEGORIES={'learn':['Chart basics','Strategy rules','Risk management','Backtesting','Journaling'], 'mindset':['Patience','Fear of missing out','Loss aversion','Following a plan']}

def safe_url(value):
    if not value:return ''
    parts=urlsplit(value)
    if parts.scheme!='https' or not parts.hostname or parts.username or parts.password:
        raise ValueError('Use a complete HTTPS link.')
    return value

def youtube_id(url):
    p=urlsplit(url);host=(p.hostname or '').lower();video=''
    if host in ('youtube.com','www.youtube.com','m.youtube.com'):
        video=parse_qs(p.query).get('v',[''])[0] if p.path=='/watch' else p.path.split('/')[-1] if p.path.startswith(('/embed/','/shorts/')) else ''
    elif host=='youtu.be':video=p.path.strip('/')
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}',video):raise ValueError('Choose a YouTube video link.')
    return video

class Resource(StrictModel):
    section:Literal['learn','mindset']='learn'
    kind:Literal['video','article','guide']='article'
    title:str=Field(min_length=1,max_length=120)
    description:str=Field(default='',max_length=1000)
    category:str=Field(min_length=1,max_length=80)
    thumbnail:str=Field(default='',max_length=1000)
    url:str=Field(default='',max_length=1000)
    content:str=Field(default='',max_length=20000)
    tags:list[str]=Field(default_factory=list,max_length=12)
    exercise:str=Field(default='',max_length=1000)
    feature:Literal['','/backtesting','/lab','/journal','/mindset']=''
    @field_validator('title','category')
    @classmethod
    def required(cls,v):
        if not v.strip():raise ValueError('Enter a title and category.')
        return v.strip()
    @field_validator('url','thumbnail')
    @classmethod
    def links(cls,v):return safe_url(v.strip())
    @field_validator('tags')
    @classmethod
    def clean_tags(cls,v):
        if any(not t.strip() or len(t)>60 for t in v):raise ValueError('Use short, nonempty tags.')
        return list(dict.fromkeys(t.strip() for t in v))
    @model_validator(mode='after')
    def body(self):
        if self.kind=='video':youtube_id(self.url)
        elif not self.url and not self.content.strip():raise ValueError('Add written content or a resource link.')
        return self

class Publisher(StrictModel):
    allowed:bool=Field(strict=True)

class Goal(StrictModel):
    pinned: bool | None = Field(default=None, strict=True)
    title:str=Field(min_length=1,max_length=120)
    notes:str=Field(default='',max_length=4000)
    image_url:str=Field(default='',max_length=1000)
    @field_validator('title')
    @classmethod
    def nonempty(cls,v):
        if not v.strip():raise ValueError('Give your goal a title.')
        return v.strip()
    @field_validator('image_url')
    @classmethod
    def image_link(cls,v):return safe_url(v.strip())

def mount(app,config,workspace):
    def root():return app.state.workspaces.root
    def can_publish(member):return member['key']=='owner' or member['key'] in root().get_setting(PUBLISHERS,[])
    def editor(member):
        if not can_publish(member):raise HTTPException(403,'Only approved Primus publishers can change resources.')
    def personal(member):return app.state.workspaces.database(member['key'])
    def resources():
        rows = root().get_setting(CONTENT, [])
        supported = get_args(Resource.model_fields['feature'].annotation)
        return [row if row.get('feature', '') in supported else {**row, 'feature': ''} for row in rows]
    def find(rows,item_id):
        item=next((r for r in rows if r['id']==item_id),None)
        if not item:raise HTTPException(404,'This item is no longer available.')
        return item
    @app.get('/api/resources')
    def list_resources(section:Literal['learn','mindset']='learn'):
        with app.state.workspaces.lock:return {'items':[r for r in resources() if r['section']==section], 'categories':CATEGORIES[section]}
    @app.get('/api/resources/permissions')
    def permissions(member=Depends(workspace)):return {'can_publish':can_publish(member),'owner':member['key']=='owner'}
    @app.put('/api/resources/{item_id}')
    def put_resource(item_id:str,payload:Resource,member=Depends(workspace)):
        with app.state.workspaces.lock:
            editor(member);rows=resources()
            if item_id!='new':find(rows,item_id)
            elif len(rows)>=200:raise HTTPException(422,'Keep up to 200 resources in this first release.')
            value={**payload.model_dump(exclude_none=True),'id':uuid4().hex if item_id=='new' else item_id,'updated_at':datetime.now(timezone.utc).isoformat()}
            if payload.kind=='video':value['video_id']=youtube_id(payload.url)
            root().set_setting(CONTENT,[value,*[r for r in rows if r['id']!=value['id']]])
            return value
    @app.delete('/api/resources/{item_id}')
    def remove_resource(item_id:str,member=Depends(workspace)):
        with app.state.workspaces.lock:
            editor(member);rows=resources();find(rows,item_id);root().set_setting(CONTENT,[r for r in rows if r['id']!=item_id])
        return {'removed':True}
    @app.get('/api/publishers')
    def publishers(member=Depends(workspace)):
        if member['key']!='owner':raise HTTPException(403,'Only the owner can manage publishers.')
        allowed=root().get_setting(PUBLISHERS,[])
        people=app.state.workspaces.google.people() if config.google_required else []
        return [{'id':p['id'],'email':p['email'],'publisher':p['id']=='owner' or p['id'] in allowed} for p in people]
    @app.put('/api/publishers/{account_id}')
    def publisher(account_id:str,payload:Publisher,member=Depends(workspace)):
        if member['key']!='owner' or not config.google_required:raise HTTPException(403,'Only the owner can approve signed-in publishers.')
        with app.state.workspaces.lock:
            people=app.state.workspaces.google.people()
            if account_id=='owner' or not any(p['id']==account_id for p in people):raise HTTPException(422,'Choose an existing teammate account.')
            allowed=set(root().get_setting(PUBLISHERS,[]));allowed.add(account_id) if payload.allowed else allowed.discard(account_id)
            root().set_setting(PUBLISHERS,sorted(allowed))
        return {'saved':True}
    @app.get('/api/learning-progress')
    def get_progress(member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):return personal(member).get_setting(PROGRESS,{'last':'chart','completed':[]})
    @app.put('/api/learning-progress')
    def save_progress(payload:LearningProgress,member=Depends(workspace)):
        value={**payload.model_dump(),'completed':list(dict.fromkeys(payload.completed))}
        with app.state.workspaces.workspace_lock(member['key']):
            personal(member).set_setting(PROGRESS,value);app.state.workspaces.bump(member['key'])
        return value
    @app.get('/api/vision-board')
    def board(member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):return personal(member).get_setting(BOARD,[])
    @app.put('/api/vision-board/{item_id}')
    def save_goal(item_id:str,payload:Goal,member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            db=personal(member);rows=db.get_setting(BOARD,[])
            previous={} if item_id=='new' else find(rows,item_id)
            if item_id=='new' and len(rows)>=50:raise HTTPException(422,'Keep up to 50 goals on your board.')
            value={**previous,**payload.model_dump(exclude_none=True),'id':uuid4().hex if item_id=='new' else item_id}
            others = [r for r in rows if r['id'] != value['id']]
            if value.get('pinned'):
                others = [{**row, 'pinned': False} if row.get('pinned') else row for row in others]
            db.set_setting(BOARD, [value, *others])
            app.state.workspaces.bump(member['key'])
            return value
    @app.delete('/api/vision-board/{item_id}')
    def remove_goal(item_id:str,member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):
            db=personal(member);rows=db.get_setting(BOARD,[]);old=find(rows,item_id);db.set_setting(BOARD,[r for r in rows if r['id']!=item_id]);app.state.workspaces.bump(member['key'])
        if old.get('image_id'):app.state.image_storage.discard_unreferenced(member['key'],IMAGE_DAY,old['image_id'])
        return {'removed':True}
    @app.post('/api/vision-board/{item_id}/image')
    async def upload_goal_image(item_id:str,file:UploadFile=File(...),member=Depends(workspace)):
        content=await file.read(MAX_UPLOAD+1)
        if len(content)>MAX_UPLOAD:raise HTTPException(413,'Choose an image under 8 MB.')
        from starlette.concurrency import run_in_threadpool
        def operation():
            data,width,height=compress(content)
            with app.state.workspaces.workspace_lock(member['key']):
                db=personal(member);rows=db.get_setting(BOARD,[]);item=find(rows,item_id);image_id=uuid4().hex
                app.state.image_storage.put(member['key'],IMAGE_DAY,image_id,data)
                value={**item,'image_id':image_id}
                try:db.set_setting(BOARD,[value if r['id']==item_id else r for r in rows])
                except Exception:
                    app.state.image_storage.discard_unreferenced(member['key'],IMAGE_DAY,image_id);raise
                app.state.workspaces.bump(member['key'])
                if item.get('image_id'):app.state.image_storage.discard_unreferenced(member['key'],IMAGE_DAY,item['image_id'])
                return value
        return await run_in_threadpool(operation)
    @app.get('/api/vision-board/{item_id}/image')
    def goal_image(item_id:str,member=Depends(workspace)):
        with app.state.workspaces.workspace_lock(member['key']):item=find(personal(member).get_setting(BOARD,[]),item_id)
        if not item.get('image_id'):raise HTTPException(404)
        data=app.state.image_storage.read(member['key'],IMAGE_DAY,item['image_id'])
        if data is None:raise HTTPException(404)
        return Response(data,media_type='image/webp',headers={'Cache-Control':'private, no-store'})
