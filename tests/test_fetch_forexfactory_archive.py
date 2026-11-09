import pytest
from tools.fetch_forexfactory_archive import sanity_gate,stage

def test_gate_requires_correct_new_york_release_time():
    row={'DateTime':'2024-05-15T08:30:00-04:00','Currency':'USD','Impact':'High','Event':'Core CPI m/m'}
    _,events=stage([row]);sanity_gate(events)
    _,bad=stage([{**row,'DateTime':'2024-05-15T00:00:00+04:30'}])
    with pytest.raises(ValueError,match='missing|08:30'):sanity_gate(bad)
    with pytest.raises(ValueError,match='missing'):sanity_gate([])

def test_naive_and_aware_utc_cpi_convert_to_new_york():
    for stamp in ('2024-05-15T12:30:00Z','2024-05-15T12:30:00'):
        _,events=stage([{'DateTime':stamp,'Currency':'USD','Impact':'High','Event':'Core CPI m/m'}])
        sanity_gate(events)
        assert events[0][2]=='08:30'

def test_week_parser_requires_confirmed_timezone_and_handles_inherited_time():
    from datetime import date
    from tools.fetch_forexfactory_archive import parse_week
    html='''<p>Calendar Time Zone: America/New_York</p><table>
    <tr class="calendar__row"><td class="calendar__date">Wed May 15</td><td class="calendar__time">8:30am</td><td class="calendar__currency">USD</td><td class="calendar__impact"><span title="High Impact Expected"></span></td><td class="calendar__event">Core CPI m/m</td><td class="calendar__actual">0.3%</td></tr>
    <tr class="calendar__row"><td class="calendar__currency">USD</td><td class="calendar__impact"><span title="Med Impact Expected"></span></td><td class="calendar__event">Other release</td></tr></table>'''
    rows=parse_week(html,date(2024,5,12))
    _,events=stage(rows)
    sanity_gate(events)
    assert len(events)==2
    assert events[1][2]=='08:30'
    with pytest.raises(ValueError,match='timezone'):
        parse_week(html.replace('America/New_York','Europe/Amsterdam'),date(2024,5,12))
    with pytest.raises(ValueError,match='challenge'):
        parse_week('<title>Just a moment...</title>',date(2024,5,12))
