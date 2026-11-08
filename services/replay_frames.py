"""Lossless columnar replay snapshots. Values and fill calculations are unchanged."""
from array import array
from copy import deepcopy
import sys
class CompactFrames:
    def __init__(self,start):
        self.start=start;self.numbers={k:array('d') for k in ('balance','equity','unrealized')}
        self.ids={k:array('I') for k in ('position','order','ticket')};self.states={k:[None] for k in self.ids}
    def append(self,frame):
        for key,values in self.numbers.items():values.append(frame[key])
        for key,ids in self.ids.items():
            states=self.states[key];value=frame[key]
            if states[-1]!=value:states.append(deepcopy(value))
            ids.append(len(states)-1)
    def extend(self,frames):
        """Store a completed sequential batch without per-minute persistence."""
        for key,values in self.numbers.items():values.extend(frame[key] for frame in frames)
        for key,ids in self.ids.items():
            states=self.states[key];batch=[]
            for frame in frames:
                value=frame[key]
                if states[-1]!=value:states.append(deepcopy(value))
                batch.append(len(states)-1)
            ids.extend(batch)
    def __sizeof__(self):
        # Include column buffers and interned states in the bounded plan cache.
        seen=set()
        def size(value):
            if id(value) in seen:return 0
            seen.add(id(value));n=sys.getsizeof(value)
            if isinstance(value,dict):n+=sum(size(k)+size(v) for k,v in value.items())
            elif isinstance(value,(list,tuple)):n+=sum(size(v) for v in value)
            return n
        return object.__sizeof__(self)+size(self.numbers)+size(self.ids)+size(self.states)
    def __len__(self):return len(self.numbers['balance'])
    def __getitem__(self,index):
        if isinstance(index,slice):return [self[i] for i in range(*index.indices(len(self))) ]
        if index<0:index+=len(self)
        if not 0<=index<len(self):raise IndexError(index)
        return {'cursor':self.start+index,**{k:v[index] for k,v in self.numbers.items()},**{k:deepcopy(self.states[k][ids[index]]) for k,ids in self.ids.items()}}
    def __iter__(self):
        for i in range(len(self)):yield self[i]
    def wire(self):return {'encoding':'columns-v1','start':self.start,'length':len(self),'numbers':{k:list(v) for k,v in self.numbers.items()},'ids':{k:list(v) for k,v in self.ids.items()},'states':self.states}
