from tests.test_webapp import local
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
