from tests.test_webapp import local
from tests.test_google_access import google
from webapp import release_notes

def test_notes_acknowledgement_persists_and_settings_do_not_reset_it(local):
    client,app=local
    before=client.get('/api/trades').json()
    assert client.get('/api/metadata').json()['release_notes']['seen'] is False
    assert client.post('/api/release-notes/seen').status_code==200
    assert client.get('/api/metadata').json()['release_notes']['seen'] is True
    client.put('/api/journal-preferences',json={'timezone':'Europe/London'})
    assert client.get('/api/metadata').json()['release_notes']['seen'] is True
    assert client.get('/api/trades').json()==before

def test_feedback_is_owner_only_and_rate_limited(google):
    from tests.test_google_access import login
    client,app,state=google
    login(client,state)
    login(client,state,'friend@example.com','friend-sub')
    assert client.get('/api/feedback').status_code==403
    assert client.post('/api/feedback',json={'message':'   '}).status_code==422
    assert client.post('/api/feedback',json={'message':'The chart needs a clearer button.'}).status_code==200
    for _ in range(4):assert client.post('/api/feedback',json={'message':'Another suggestion'}).status_code==200
    assert client.post('/api/feedback',json={'message':'Too many'}).status_code==429
    login(client,state)
    inbox=client.get('/api/feedback').json()
    assert len(inbox)==5
    assert any(row['message']=='The chart needs a clearer button.' for row in inbox)
    assert client.post('/api/feedback',json={'message':'Test','sender':'owner'}).status_code==422


def test_new_members_also_receive_current_notice(google):
    from tests.test_google_access import login
    client,app,state=google
    login(client,state,'new@example.com','brand-new-sub')
    notes=client.get('/api/metadata').json()['release_notes']
    assert notes['seen'] is False
    assert any('beta' in item['text'] for item in notes['items'])
