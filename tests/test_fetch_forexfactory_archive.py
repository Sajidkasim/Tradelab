import pytest
from tools.fetch_forexfactory_archive import sanity_gate,stage

def test_gate_requires_correct_new_york_release_time():
    row={'DateTime':'2024-05-15T08:30:00-04:00','Currency':'USD','Impact':'High','Event':'Core CPI m/m'}
    _,events=stage([row]);sanity_gate(events)
    _,bad=stage([{**row,'DateTime':'2024-05-15T00:00:00+04:30'}])
    with pytest.raises(ValueError,match='missing|08:30'):sanity_gate(bad)
    with pytest.raises(ValueError,match='missing'):sanity_gate([])
