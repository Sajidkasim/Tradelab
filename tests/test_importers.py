import pandas as pd
import pytest

from core.importers import auto_map, detect_shape, normalise, read_clipboard_text, preview
from core.models import Source


def test_auto_map_recognises_journal_and_broker_columns():
    cols = ["Date", "Symbol", "Strategy", "Direction", "Contracts", "Entry Price", "Exit Price",
            "Stop", "Target", "Fees", "Notes", "Rules Followed", "Confidence"]
    m = auto_map(cols)
    assert m["entry_time"] == "Date" and m["symbol"] == "Symbol" and m["setup_name"] == "Strategy"
    assert m["qty"] == "Contracts" and m["entry_price"] == "Entry Price" and m["exit_price"] == "Exit Price"
    assert m["stop_price"] == "Stop" and m["target_price"] == "Target" and m["fees"] == "Fees"
    assert m["rules_followed"] == "Rules Followed" and m["confidence"] == "Confidence"
    assert detect_shape(m) == "trades"
    fills = auto_map(["id", "contractName", "creationTimestamp", "side", "size", "price", "fees"])
    assert fills["symbol"] == "contractName" and fills["direction"] == "side" and fills["qty"] == "size"
    assert fills["price"] == "price" and fills["timestamp"] == "creationTimestamp"
    assert detect_shape(fills) == "fills"


def test_normalise_computes_pnl_and_reports_row_errors():
    df = pd.DataFrame({
        "Date": ["01/09/2026 14:30", "02/09/2026 15:00", "03/09/2026 09:00"],
        "Symbol": ["MESZ26", "MNQ", "MES"],
        "Direction": ["Long", "Sell", "Long"],
        "Contracts": [2, 1, 1],
        "Entry Price": [5000, 19000, ""],           # third row: no entry -> error
        "Exit Price": [5004, 18990, 5001],
        "Stop": [4996, 19010, 4998],
        "Fees": ["$2.00", "(1.00)", 0],
        "Strategy": ["ORB", "VWAP", "ORB"],
        "Mistakes": ["chased; moved stop", "", ""],
        "Rules Followed": ["Y", "N", "Y"],
        "P&L": [38.0, 19.0, 0],
    })
    m = auto_map(list(df.columns))
    trades, errors = normalise(df, m, source=Source.EXCEL, dayfirst=True)
    assert len(trades) == 2 and len(errors) == 1 and errors[0]["row"] == 3
    a, b = trades
    assert a.symbol == "MES" and a.multiplier == 5 and a.net_pnl == pytest.approx(38.0)      # (4*2*5) - 2
    assert a.r_multiple == pytest.approx(38 / 40) and a.mistake_tags == ["chased", "moved stop"]
    assert a.rules_followed is True and a.entry_time.month == 9 and a.entry_time.day == 1
    assert b.direction.value == "short" and b.net_pnl == pytest.approx(19.0) and b.rules_followed is False
    assert "pnl-mismatch" not in a.tags and "pnl-mismatch" not in b.tags


def test_pnl_mismatch_is_flagged_not_silently_trusted():
    df = pd.DataFrame({"Date": ["2026-09-01"], "Symbol": ["MES"], "Direction": ["Long"], "Contracts": [1],
                       "Entry Price": [5000], "Exit Price": [5002], "P&L": [500.0]})
    trades, _ = normalise(df, auto_map(list(df.columns)))
    assert trades[0].net_pnl == 10.0 and "pnl-mismatch" in trades[0].tags


def test_unknown_instrument_without_multiplier_errors():
    df = pd.DataFrame({"Date": ["2026-09-01"], "Symbol": ["ZZZ"], "Direction": ["Long"],
                       "Entry Price": [1], "Exit Price": [2]})
    trades, errors = normalise(df, auto_map(list(df.columns)))
    assert trades == [] and "unknown instrument" in errors[0]["error"]
    df["Multiplier"] = 10
    trades, errors = normalise(df, auto_map(list(df.columns)))
    assert trades[0].net_pnl == 10.0 and errors == []


def test_clipboard_and_preview():
    df = read_clipboard_text("Date\tSymbol\tDirection\tEntry Price\tExit Price\n2026-09-01\tMES\tLong\t5000\t5001\n")
    trades, _ = normalise(df, auto_map(list(df.columns)))
    trades[0].external_id = "x1"
    pv = preview(trades, {"x1"})
    assert pv.loc[0, "status"] == "duplicate" and pv.loc[0, "net_pnl"] == 5.0


def test_rows_without_ids_get_a_stable_fingerprint():
    df = pd.DataFrame({"Date": ["2026-09-01 14:30"], "Symbol": ["MES"], "Direction": ["Long"], "Entry Price": [5000], "Exit Price": [5001]})
    a, _ = normalise(df, auto_map(list(df.columns)))
    b, _ = normalise(df, auto_map(list(df.columns)))
    assert a[0].external_id.startswith("fp-") and a[0].external_id == b[0].external_id
    df2 = df.assign(**{"Exit Price": [5002]})
    c2, _ = normalise(df2, auto_map(list(df2.columns)))
    assert c2[0].external_id != a[0].external_id
