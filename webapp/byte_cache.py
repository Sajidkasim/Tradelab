"""Bound retained Python object bytes, not just cache entry count."""
from collections import OrderedDict
from functools import wraps
import sys,threading

def size(value,seen=None):
    seen=set() if seen is None else seen
    if id(value) in seen:return 0
    seen.add(id(value));n=sys.getsizeof(value)
    if isinstance(value,dict):n+=sum(size(k,seen)+size(v,seen) for k,v in value.items())
    elif isinstance(value,(list,tuple,set,frozenset)):n+=sum(size(v,seen) for v in value)
    return n
class ByteCache:
    def __init__(self,budget,entries=16):self.budget=budget;self.entries=entries;self.values=OrderedDict();self.bytes=0;self.lock=threading.RLock()
    def get(self,key):
        with self.lock:
            if key not in self.values:return None
            self.values.move_to_end(key);return self.values[key][0]
    def put(self,key,value):
        weight=size(value)
        with self.lock:
            if key in self.values:self.bytes-=self.values.pop(key)[1]
            if weight>self.budget:return
            while self.values and (self.bytes+weight>self.budget or len(self.values)>=self.entries):self.bytes-=self.values.popitem(last=False)[1][1]
            self.values[key]=(value,weight);self.bytes+=weight

def byte_cache(budget,entries=16):
    def decorate(fn):
        cache=ByteCache(budget,entries)
        @wraps(fn)
        def wrapped(*args,**kwargs):
            key=(args,tuple(sorted(kwargs.items())));value=cache.get(key)
            if value is not None:return value
            value=fn(*args,**kwargs);cache.put(key,value);return value
        wrapped.memory_cache=cache
        return wrapped
    return decorate
