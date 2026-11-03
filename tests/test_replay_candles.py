from datetime import datetime
from services.replay_candles import aggregate_ny_four_hours,ny_four_hour_open

def stamp(value):return int(datetime.fromisoformat(value).timestamp()*1000)
def test_new_york_anchor_ohlcv_winter_summer_and_no_source_mutation():
    for date,offset in [('2026-01-05','-05:00'),('2026-07-06','-04:00')]:
        first=stamp(date+'T18:00:00'+offset)
        rows=[[first,100,105,99,103,10],[first+60000,103,108,98,104,20]]
        assert aggregate_ny_four_hours(rows)==[[first,100,108,98,104,30]]
        assert rows[0][4]==103
        for hour in (2,6,10,14,18,22):
            t=stamp(f'{date}T{hour:02}:00:00{offset}')
            assert ny_four_hour_open(t)==t

def test_sunday_open_and_dst_weekend_do_not_create_closed_period_bars():
    assert ny_four_hour_open(stamp('2026-03-06T18:00:00-05:00')) is None
    assert ny_four_hour_open(stamp('2026-03-07T14:00:00-05:00')) is None
    assert ny_four_hour_open(stamp('2026-03-08T17:59:00-04:00')) is None
    opened=stamp('2026-03-08T18:00:00-04:00')
    assert ny_four_hour_open(opened)==opened
    assert ny_four_hour_open(stamp('2026-11-01T18:00:00-05:00'))==stamp('2026-11-01T18:00:00-05:00')
    assert ny_four_hour_open(stamp('2026-07-07T00:30:00-04:00'))==stamp('2026-07-06T22:00:00-04:00')
