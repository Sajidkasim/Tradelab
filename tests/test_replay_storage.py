from io import BytesIO
import pytest
from webapp.replay_history_storage import HistoryStorage

def test_local_and_private_object_bundles_check_integrity(tmp_path):
    class Client:
        def put_object(self,**kw):self.body=kw['Body'];self.key=kw['Key'];assert kw['CacheControl'].startswith('private')
        def get_object(self,**kw):assert kw['Key']==self.key;return {'Body':BytesIO(self.body)}
    for storage in (HistoryStorage(tmp_path),HistoryStorage(tmp_path,Client(),'private')):
        digest=storage.put(b'{"test":1}')
        assert storage.read(digest)=={'test':1}
        with pytest.raises(ValueError):storage.read('../private')
    (tmp_path/(digest+'.json')).write_bytes(b'corrupt')
    with pytest.raises(ValueError):HistoryStorage(tmp_path).read(digest)
