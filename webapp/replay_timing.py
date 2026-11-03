"""Temporary, opt-in local replay timing. Never records prices or credentials."""
from contextlib import contextmanager
from functools import wraps
import os,time
SAMPLES=[]
def enabled():return os.getenv('PRIMUS_REPLAY_PROFILE')=='1'
@contextmanager
def span(name):
    start=time.perf_counter()
    try:yield
    finally:
        if enabled():
            SAMPLES.append((name,(time.perf_counter()-start)*1000))
            del SAMPLES[:-3000]
def timed(name):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*a,**kw):
            with span(name):return fn(*a,**kw)
        return wrapped
    return decorate
