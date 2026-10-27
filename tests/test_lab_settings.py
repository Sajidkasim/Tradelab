from copy import deepcopy
import pandas as pd
import pytest
from webapp import lab_settings


@pytest.mark.parametrize('clock, expected', [
    ('00:00:00','Asia'),('05:59:59.999999','Asia'),('06:00:00','London'),
    ('10:59:59','London'),('11:00:00','New York pre-market'),('13:30:00','New York open'),
    ('16:00:00','Lunch'),('17:30:00','Afternoon'),('20:00:00','Outside configured sessions'),
    ('23:59:59','Outside configured sessions'),
])
def test_requested_fixed_utc4_session_boundaries(clock, expected):
    assert lab_settings.session_of(pd.Timestamp(f'2013-01-25T{clock}Z'), lab_settings.DEFAULTS) == expected


def test_new_york_clock_and_fixed_offset_are_distinct_in_winter():
    ny = {**deepcopy(lab_settings.DEFAULTS),'timezone':'America/New_York'}
    winter=pd.Timestamp('2013-01-25T13:30:00Z')
    summer=pd.Timestamp('2013-07-25T13:30:00Z')
    assert lab_settings.session_of(winter,lab_settings.DEFAULTS) == 'New York open'
    assert lab_settings.session_of(winter,ny) == 'New York pre-market'
    assert lab_settings.session_of(summer,ny) == 'New York open'
    assert lab_settings.session_of(pd.NaT,ny) == 'Not recorded'


def test_settings_reject_overlaps_duplicates_invalid_times_and_unknown_zone():
    for patch in [
        {'timezone':'Not/a/timezone'},
        {'sessions':[{'name':'A','start':'20:00','end':'02:00'},{'name':'B','start':'01:00','end':'03:00'}]},
        {'sessions':[{'name':'A','start':'20:00','end':'20:00'}]},
        {'sessions':[{'name':'A','start':'25:00','end':'02:00'}]},
        {'sessions':[{'name':'All sessions','start':'20:00','end':'02:00'}]},
        {'news':[]}, {'conditions':['Not recorded']},
    ]:
        with pytest.raises(ValueError): lab_settings.validate({**deepcopy(lab_settings.DEFAULTS),**patch})
