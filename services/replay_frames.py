"""Lossless columnar replay snapshots. Values and fill calculations are unchanged."""
from array import array
from copy import deepcopy
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
    def __len__(self):return len(self.numbers['balance'])
    def __getitem__(self,index):
        if isinstance(index,slice):return [self[i] for i in range(*index.indices(len(self))) ]
        if index<0:index+=len(self)
        if not 0<=index<len(self):raise IndexError(index)
        return {'cursor':self.start+index,**{k:v[index] for k,v in self.numbers.items()},**{k:deepcopy(self.states[k][ids[index]]) for k,ids in self.ids.items()}}
    def __iter__(self):
        for i in range(len(self)):yield self[i]
    def wire(self):return {'encoding':'columns-v1','start':self.start,'length':len(self),'numbers':{k:list(v) for k,v in self.numbers.items()},'ids':{k:list(v) for k,v in self.ids.items()},'states':self.states}
