from dataclasses import replace
from io import BytesIO

from botocore.exceptions import ClientError
import pytest

from tests.test_daily_journal import draft, login, picture, journal_card
from webapp.image_storage import ImageStorage


class PrivateBucket:
    def __init__(self):
        self.objects={};self.reads=[];self.fail=False
    def put_object(self,**args):
        if self.fail:raise ClientError({'Error':{'Code':'AccessDenied','Message':'private-provider-message'}},'PutObject')
        self.objects[(args['Bucket'],args['Key'])]=args['Body']
        assert args['ContentType']=='image/webp' and args['CacheControl']=='private, no-store'
    def get_object(self,**args):
        self.reads.append(args['Key'])
        return {'Body':BytesIO(self.objects[(args['Bucket'],args['Key'])])}
    def delete_object(self,**args):self.objects.pop((args['Bucket'],args['Key']),None)
    def close(self):pass


def test_private_r2_proxy_delete_restore_and_member_isolation(draft):
    client,app,state=draft;bucket=PrivateBucket()
    app.state.image_storage.client=bucket
    app.state.image_storage.config=replace(app.state.config,r2_bucket='primuslab-images')
    login(client,state)
    assert client.get('/api/session').json()['images_enabled'] is True
    day='2026-10-18';record=journal_card()
    client.put(f'/api/journal/{day}',json={'plan':'Private plan','trades':[record]})
    response=client.post(f'/api/journal/{day}/images?trade_id={record["id"]}',files={'file':('chart.png',picture(),'image/png')})
    assert response.status_code==200,response.text
    image=response.json()['images'][0];url=f'/api/journal/{day}/images/{image["id"]}'
    assert len(bucket.objects)==1 and next(iter(bucket.objects))[1].startswith(f'primus-journal/v1/owner/{day}/')
    assert client.get(url).content.startswith(b'RIFF') and 'no-store' in client.get(url).headers['cache-control']
    removed=client.delete(f'/api/journal/{day}').json();archive=removed['archive_id']
    assert client.get('/api/journal').json()==[] and client.get(url).status_code==404
    assert len(bucket.objects)==1  # Restore keeps private files, without exposing URLs.
    assert client.get('/api/journal/trash').json()[0]['id']==archive
    client.post('/api/logout');login(client,state,'stranger@example.com','stranger')
    reads=len(bucket.reads)
    assert client.get(url).status_code==404 and len(bucket.reads)==reads
    assert client.get('/api/journal/trash').json()==[]
    assert client.post(f'/api/journal/trash/{archive}/restore').status_code==422
    client.post('/api/logout');login(client,state)
    restored=client.post(f'/api/journal/trash/{archive}/restore').json()
    assert restored['plan']=='Private plan' and restored['images'][0]['id']==image['id']
    assert client.get(url).status_code==200
    assert client.get('/api/journal/trash').json()==[]
    bucket.fail=True
    error=client.post(f'/api/journal/{day}/images',files={'file':('chart.png',picture(),'image/png')})
    assert error.status_code==503 and 'private-provider-message' not in error.text
    assert len(client.get('/api/journal').json()[0]['images'])==1
    client.headers['X-Primus-CSRF']='bad'
    assert client.delete(f'/api/journal/{day}').status_code==403


def test_restore_does_not_overwrite_a_new_entry_and_lab_trades_survive(draft):
    from tests.test_webapp import trade_payload
    client,app,state=draft;login(client,state)
    client.post('/api/trades',json=trade_payload())
    before=client.get('/api/trades').json();day='2026-10-11'
    client.put(f'/api/journal/{day}',json={'notes':'Original'})
    first=client.delete(f'/api/journal/{day}').json()['archive_id']
    client.put(f'/api/journal/{day}',json={'notes':'Newer'})
    assert client.post(f'/api/journal/trash/{first}/restore').status_code==422
    assert client.get('/api/journal').json()[0]['notes']=='Newer'
    second=client.delete(f'/api/journal/{day}').json()['archive_id']
    assert len(client.get('/api/journal/trash').json())==2
    assert client.post(f'/api/journal/trash/{first}/restore').json()['notes']=='Original'
    assert client.get('/api/trades').json()==before
    assert len(client.get('/api/journal/trash').json())==1


def test_r2_client_uses_only_validated_endpoint_and_explicit_credentials(draft,monkeypatch):
    _,app,_=draft
    calls=[];bucket=PrivateBucket()
    def factory(service,**args):calls.append((service,args));return bucket
    monkeypatch.setattr('boto3.client',factory)
    config=replace(app.state.config,r2_account_id='a'*32,r2_bucket='primuslab-images',
        r2_access_key_id='synthetic-access-key',r2_secret_access_key='synthetic-secret-key')
    config.validate();storage=ImageStorage(config)
    assert calls[0][1]['endpoint_url']=='https://'+'a'*32+'.r2.cloudflarestorage.com'
    assert calls[0][1]['region_name']=='auto'
    assert calls[0][1]['config'].signature_version=='s3v4'
    assert 'synthetic-secret-key' not in repr(config)
    with pytest.raises(ValueError):replace(config,r2_account_id='https://another-site.invalid').validate()
    with pytest.raises(ValueError):replace(config,r2_secret_access_key='').validate()
    with pytest.raises(ValueError):storage.key('../another-user','2026-10-30','b'*32)
