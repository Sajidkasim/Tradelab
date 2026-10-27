import pandas as pd
import pytest
from core import edge
from services import weekdays, trade_labels


@pytest.mark.parametrize('stamp,zone,day', [
    ('2026-07-07T03:59:59Z', 'Etc/GMT+4', 'Monday'),
    ('2026-07-07T04:00:00Z', 'Etc/GMT+4', 'Tuesday'),
    ('2013-01-25T04:30:00Z', 'Etc/GMT+4', 'Friday'),
    ('2013-01-25T04:30:00Z', 'America/New_York', 'Thursday'),
    ('2026-07-10T23:45:00-04:00', 'Etc/GMT+4', 'Friday'),
    ('2026-07-11T04:00:00', 'Etc/GMT+4', 'Saturday'),
    (pd.NaT, 'Etc/GMT+4', edge.UNKNOWN),
])
def test_entry_weekday_uses_original_timestamp_and_configured_clock(stamp, zone, day):
    assert weekdays.entry_day(stamp, zone) == day


def test_day_tags_are_validated_preserved_and_never_override_core_labels():
    mappings = {'MONDAY': {'field': 'weekday', 'value': 'Monday'},
                'FRIDAY': {'field': 'weekday', 'value': 'Friday'}}
    assert trade_labels.validate_mappings(mappings) == mappings
    assert trade_labels.suggested_mapping('friday') == mappings['FRIDAY']
    assert trade_labels.suggested_mapping('Day: Monday') == mappings['MONDAY']
    with pytest.raises(ValueError):
        trade_labels.validate_mappings({'DAY': {'field': 'weekday', 'value': 'Funday'}})
    tags = edge.write_labels(['FRIDAY'], level='FVG', confirmations=['SMT'])
    fields, issues = trade_labels.mapped_fields(tags, mappings)
    assert not issues and 'FRIDAY' in fields['tags']
    assert edge.read_labels(fields['tags']) == edge.read_labels(tags)
    assert not trade_labels.weekday_warnings(fields['tags'], mappings, '2013-01-25T17:00Z', 'Etc/GMT+4')
    warnings = trade_labels.weekday_warnings(['MONDAY'], mappings, '2013-01-25T17:00Z', 'Etc/GMT+4')
    assert 'Monday' in warnings[0] and 'Friday' in warnings[0] and 'UTC−4' in warnings[0]
    _, conflicts = trade_labels.mapped_fields(['MONDAY', 'FRIDAY'], mappings)
    assert 'Conflicting day tags' in conflicts[0]
