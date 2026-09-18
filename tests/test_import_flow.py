import pandas as pd
import pytest

from core import importers
from core.db import Database
from services import import_flow


def export():
    return pd.DataFrame({"id": [123, 124], "dateStart": ["2026/03/19 14:01:14", "2026/03/19 15:01:14"],
                         "dateEnd": ["2026/03/19 14:19:36", "2026/03/19 16:14:29"],
                         "pair": ["CME_MINI:NQ1", "CME_MINI:NQ1"], "uPnL": [0, 0], "rPnL": [-100, 250],
                         "side": ["sell", "buy"], "entryPrice": [18000, 18100], "avgClosePrice": [18005, 18125],
                         "amount": [20, 10], "status": ["closed", "closed"], "maxRiskReward": [3, 5]})


def test_fx_native_export_detected_previewed_saved_and_deduplicated():
    db = Database(":memory:"); db.init()
    raw = import_flow.read_upload(export().to_csv(index=False).encode(), "backtesting-analytics.csv")
    assert import_flow.is_fx_analytics(raw)
    trades, errors = import_flow.fx_analytics(raw, db.instruments(), None)
    assert not errors and len(trades) == 2
    assert [t.net_pnl for t in trades] == [-100, 250]  # never uPnL, never amount × futures multiplier
    assert all(t.r_multiple is None for t in trades)  # planned RR is not a realised result
    assert all(t.symbol == "NQ" and t.source.value == "fxreplay" for t in trades)
    assert all("entryPrice=" in t.notes for t in trades)
    assert trades[0].entry_time.month == 3 and trades[0].entry_time.day == 19
    assert db.insert_trades(trades)["inserted"] == 2
    preview = importers.preview(trades, db.existing_external_ids())
    assert import_flow.preview_counts(preview, errors) == {"new": 0, "duplicates": 2, "errors": 0}
    assert db.insert_trades(trades)["skipped"] == 2
    assert list(db.trades_df()["net_pnl"]) == [-100, 250]


def test_fx_export_timezone_and_unclosed_rows_are_explicit():
    raw = export()
    raw.loc[1, "status"] = "open"
    trades, errors = import_flow.fx_analytics(raw, {}, None, "America/New_York")
    assert trades[0].entry_time.hour == 18
    assert len(errors) == 1 and errors[0]["row"] == 2


@pytest.mark.parametrize("value", [None, "invalid date"])
def test_bad_close_time_not_silently_recorded_as_entry_time(value):
    raw = export(); raw.loc[0, "dateEnd"] = value
    trades, errors = import_flow.fx_analytics(raw, {}, None)
    assert len(trades) == 1 and errors[0]["row"] == 1


def test_empty_upload_gets_useful_message():
    with pytest.raises(ValueError, match="empty"):
        import_flow.read_upload(b"", "empty.csv")


def test_market_names_with_digits_are_not_mangled_and_blank_market_is_reported():
    raw = export(); raw.loc[0, "pair"] = "INDEX:US100"; raw.loc[1, "pair"] = None
    trades, errors = import_flow.fx_analytics(raw, {}, None)
    assert len(trades) == 1 and trades[0].symbol == "US100"
    assert errors[0]["row"] == 2
