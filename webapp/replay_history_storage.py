"""Private, immutable replay bundles. No public object URL or client credentials."""
import hashlib,json,re
from pathlib import Path

class HistoryStorage:
    MAX_BYTES=12*1024*1024
    def __init__(self,root,client=None,bucket=''):
        self.root=Path(root);self.client=client;self.bucket=bucket
    def put(self,content):
        if len(content)>self.MAX_BYTES:raise ValueError('Split history into smaller bundles.')
        digest=hashlib.sha256(content).hexdigest();key=f'primus-replay/v1/{digest}.json'
        if self.client:self.client.put_object(Bucket=self.bucket,Key=key,Body=content,ContentType='application/json',CacheControl='private, max-age=31536000, immutable')
        else:
            self.root.mkdir(parents=True,exist_ok=True);path=self.root/(digest+'.json');temp=path.with_suffix('.tmp');temp.write_bytes(content);temp.replace(path)
        return digest
    def read(self,digest):
        if not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('Invalid bundle reference.')
        if self.client:
            body=self.client.get_object(Bucket=self.bucket,Key=f'primus-replay/v1/{digest}.json')['Body']
            try:content=body.read(self.MAX_BYTES+1)
            finally:body.close()
        else:content=(self.root/(digest+'.json')).read_bytes()
        if len(content)>self.MAX_BYTES or hashlib.sha256(content).hexdigest()!=digest:raise ValueError('History integrity check failed.')
        return json.loads(content)
