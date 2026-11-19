from tests.test_daily_journal import draft,login,picture
from webapp import learning


def test_only_owner_and_approved_publishers_can_change_public_resources(draft):
    client,app,state=draft
    assert client.get('/api/resources').json()['items']==[]
    payload={'section':'learn','kind':'article','title':'My authored guide','category':'My topic','content':'My own words','tags':['Practice']}
    assert client.put('/api/resources/new',json=payload).status_code==401
    login(client,state)
    saved=client.put('/api/resources/new',json=payload)
    assert saved.status_code==200,saved.text
    resource=saved.json();assert resource['title']==payload['title']
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/resources').json()['items'][0]['id']==resource['id']
    assert client.put('/api/resources/new',json=payload).status_code==403
    assert client.get('/api/publishers').status_code==403
    assert client.get('/api/resources/permissions').json()['can_publish'] is False
    login(client,state)
    friend=next(p for p in client.get('/api/publishers').json() if p['email']=='friend@example.com')
    assert client.put('/api/publishers/'+friend['id'],json={'allowed':True}).status_code==200
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/resources/permissions').json()['can_publish'] is True
    assert client.put('/api/resources/'+resource['id'],json={**payload,'title':'Updated title'}).status_code==200
    login(client,state)
    assert client.put('/api/publishers/'+friend['id'],json={'allowed':False}).status_code==200
    login(client,state,'friend@example.com','friend-sub')
    assert client.delete('/api/resources/'+resource['id']).status_code==403
    login(client,state)
    assert client.delete('/api/resources/'+resource['id']).status_code==200
    assert client.get('/api/resources').json()['items']==[]


def test_resource_validation_and_youtube_allowlist(draft):
    client,app,state=draft;login(client,state)
    base={'kind':'video','title':'My video','category':'Chart basics','url':'https://www.youtube.com/watch?v=abcdefghijk'}
    result=client.put('/api/resources/new',json=base)
    assert result.status_code==200,result.text
    assert result.json()['video_id']=='abcdefghijk'
    for patch in ({'url':'https://evil.test/watch?v=abcdefghijk'},{'url':'javascript:alert(1)'},{'title':' '},{'thumbnail':'http://images.test/image.png'},{'feature':'https://evil.test'}):
        assert client.put('/api/resources/new',json={**base,**patch}).status_code==422
    assert client.put('/api/resources/new',json={'kind':'article','title':'Empty','category':'Test'}).status_code==422
    assert client.put('/api/resources/new',json={**base,'section':'mindset'}).status_code==200
    assert len(client.get('/api/resources?section=mindset').json()['items'])==1


def test_private_vision_board_notes_images_and_deletion(draft):
    client,app,state=draft;login(client,state)
    value=client.put('/api/vision-board/new',json={'title':'My reason','notes':'Only mine','image_url':''}).json()
    goal=value['id']
    assert client.post('/api/vision-board/'+goal+'/image',files={'file':('chart.png',picture(),'image/png')}).status_code==200
    image=client.get('/api/vision-board/'+goal+'/image')
    assert image.status_code==200 and image.headers['content-type']=='image/webp'
    assert 'no-store' in image.headers['cache-control']
    old_image=client.get('/api/vision-board').json()[0]['image_id']
    old_path=app.state.image_storage.local_path('owner',learning.IMAGE_DAY,old_image)
    assert old_path.exists()
    assert client.post('/api/vision-board/'+goal+'/image',files={'file':('replacement.png',picture(),'image/png')}).status_code==200
    assert not old_path.exists()
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/vision-board').json()==[]
    assert client.get('/api/vision-board/'+goal+'/image').status_code==404
    assert client.put('/api/vision-board/'+goal,json={'title':'Changed'}).status_code==404
    assert client.delete('/api/vision-board/'+goal).status_code==404
    login(client,state)
    assert client.get('/api/vision-board').json()[0]['notes']=='Only mine'
    assert client.put('/api/vision-board/'+goal,json={'title':'Updated','notes':'Still private'}).status_code==200
    assert client.get('/api/trades').json()==[]
    assert client.delete('/api/vision-board/'+goal).status_code==200
    assert client.get('/api/vision-board/'+goal+'/image').status_code==404
    assert client.get('/api/vision-board').json()==[]
    assert client.put('/api/vision-board/new',json={'title':'','image_url':'https://a.test'}).status_code==422
    assert client.put('/api/vision-board/new',json={'title':'A','image_url':'data:image/png,abc'}).status_code==422
    client.headers.pop('X-Primus-CSRF')
    assert client.put('/api/vision-board/new',json={'title':'Blocked'}).status_code==403


def test_new_site_routes_and_signin_returns(draft):
    client,app,state=draft
    for page in ('/learn','/mindset','/matrix'):
        result=client.get(page)
        assert result.status_code==200
        assert 'primus-site-preview' in result.text
    from tests.test_google_access import csrf
    csrf(client)
    for page in ('/learn','/mindset','/matrix'):
        assert client.post('/api/login/google?return_to='+page).status_code==200


def test_learning_progress_is_private_validated_and_survives_requests(draft):
    client,app,state=draft
    assert client.get('/api/learning-progress').status_code==401
    login(client,state)
    assert client.put('/api/learning-progress',json={'last':'risk','completed':['chart']}).status_code==200
    assert client.get('/api/learning-progress').json()=={'last':'risk','completed':['chart']}
    assert client.put('/api/learning-progress',json={'last':'bad','completed':[]}).status_code==422
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/learning-progress').json()=={'last':'chart','completed':[]}
    assert client.put('/api/learning-progress',json={'last':'test','completed':['test','test']}).json()['completed']==['test']
    login(client,state)
    assert client.get('/api/learning-progress').json()=={'last':'risk','completed':['chart']}
