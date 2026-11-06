from datetime import datetime

from services.replay_chart_history import NY
from webapp.replay_pivots import daily_segments


def stamp(day, hour=18):
    return int(datetime(2023, 3, day, hour, tzinfo=NY).timestamp() * 1000)


def test_daily_pivots_roll_at_new_york_open_and_exclude_forming_prices():
    rows = [
        (stamp(8), 90, 110, 90, 100, 1, stamp(9, 17)),
        (stamp(9), 100, 120, 100, 110, 1, stamp(10, 17)),
        (stamp(12), 500, 600, 400, 500, 1, stamp(13, 17)),
    ]
    prior, active = daily_segments(rows, stamp(12))
    assert (prior["start"], prior["end"]) == (stamp(9), stamp(10, 17))
    assert (active["start"], active["end"]) == (stamp(12), stamp(13))
    assert active["levels"]["P"] == 110
    assert active["levels"]["R1"] == 120
    assert active["levels"]["S1"] == 100


def test_daily_pivots_require_completed_source_history():
    assert daily_segments([], stamp(12)) == []
    assert daily_segments([(stamp(11), 1, 2, 1, 2, 1, stamp(13))], stamp(12)) == []
