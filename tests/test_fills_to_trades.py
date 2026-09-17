"""FIFO pairing cases with hand-computed answers. MES multiplier $5."""
import pandas as pd
import pytest

from core.fills_to_trades import (fills_from_projectx, pair_fills, reconcile_with_broker,
                                  root_symbol, legs_df)

M = {"MES": 5.0}


def F(fid, side, size, price, minute, fees=0.0, symbol="MES"):
    return {"fill_id": fid, "symbol": symbol, "timestamp": f"2026-09-01T13:{minute:02d}:00Z",
            "side": side, "size": size, "price": price, "fees": fees}


def test_simple_round_turn():
    trades, legs = pair_fills(pd.DataFrame([F("1", "buy", 1, 5000, 1, 1.0),
                                            F("2", "sell", 1, 5004, 5, 1.0)]), M)
    assert len(trades) == 1 and len(legs) == 1
    t = trades[0]
    assert t.direction.value == "long" and t.qty == 1
    assert t.entry_price == 5000 and t.exit_price == 5004
    assert t.gross_pnl == pytest.approx(20.0)
    assert t.fees == pytest.approx(2.0) and t.net_pnl == pytest.approx(18.0)
    assert t.external_id == "MES:1" and t.exit_time.minute == 5


def test_scale_in_two_then_three_exited_at_once():
    fills = pd.DataFrame([F("1", "buy", 2, 5000, 1, 2.0), F("2", "buy", 3, 5002, 3, 3.0),
                          F("3", "sell", 5, 5005, 8, 5.0)])
    trades, legs = pair_fills(fills, M)
    assert len(trades) == 1
    t = trades[0]
    assert t.qty == 5
    assert t.entry_price == pytest.approx((2 * 5000 + 3 * 5002) / 5)     # 5001.2
    assert t.exit_price == 5005
    # legs: 2 @ +5 pts and 3 @ +3 pts = (10 + 9) * $5 = $95
    assert t.gross_pnl == pytest.approx(95.0)
    assert (5005 - t.entry_price) * 5 * 5 == pytest.approx(95.0)       # avg-price formula agrees
    assert t.fees == pytest.approx(10.0)
    assert "scale-in" in t.tags and len(legs) == 2


def test_partial_exit_leaving_runner_then_close():
    fills = pd.DataFrame([F("1", "buy", 3, 5000, 1, 3.0), F("2", "sell", 1, 5004, 5, 1.0),
                          F("3", "sell", 2, 5010, 9, 2.0)])
    trades, legs = pair_fills(fills, M)
    assert len(trades) == 1
    t = trades[0]
    assert t.qty == 3 and "partial-exit" in t.tags
    assert t.exit_price == pytest.approx((1 * 5004 + 2 * 5010) / 3)
    assert t.gross_pnl == pytest.approx((4 + 10 + 10) * 5)              # $120
    assert t.exit_time.minute == 9


def test_flip_long_two_to_short_one_in_single_fill():
    fills = pd.DataFrame([F("1", "buy", 2, 5000, 1, 2.0), F("2", "sell", 3, 5006, 4, 3.0),
                          F("3", "buy", 1, 5001, 9, 1.0)])
    trades, legs = pair_fills(fills, M)
    assert len(trades) == 2
    long_t, short_t = trades
    assert long_t.direction.value == "long" and long_t.qty == 2
    assert long_t.gross_pnl == pytest.approx(60.0)                       # 6 pts * 2 * $5
    assert long_t.fees == pytest.approx(2.0 + 2.0)                       # 2/3 of the $3 sell fee
    assert short_t.direction.value == "short" and short_t.qty == 1
    assert short_t.entry_price == 5006 and short_t.exit_price == 5001
    assert short_t.gross_pnl == pytest.approx(25.0)
    assert short_t.fees == pytest.approx(1.0 + 1.0)                      # 1/3 of the sell fee + buy fee
    assert short_t.entry_time.minute == 4 and short_t.external_id == "MES:2"


def test_position_left_open_at_end():
    fills = pd.DataFrame([F("1", "buy", 2, 5000, 1, 2.0), F("2", "sell", 1, 5004, 5, 1.0)])
    trades, legs = pair_fills(fills, M)
    assert len(trades) == 1
    t = trades[0]
    assert t.is_open and t.exit_price is None and "open" in t.tags
    assert "1 of 2 closed" in t.notes and "19.00" in t.notes             # realised leg $20 - $1 exit fee
    assert t.net_pnl is None
    trades2, _ = pair_fills(fills, M, include_open=False)
    assert trades2 == []


def test_symbols_and_accounts_are_kept_separate():
    fills = pd.DataFrame([F("1", "buy", 1, 5000, 1), F("2", "buy", 1, 19000, 2, symbol="MNQ"),
                          F("3", "sell", 1, 5002, 3), F("4", "sell", 1, 19010, 4, symbol="MNQ")])
    trades, _ = pair_fills(fills, {"MES": 5.0, "MNQ": 2.0})
    by = {t.symbol: t for t in trades}
    assert by["MES"].gross_pnl == pytest.approx(10.0)
    assert by["MNQ"].gross_pnl == pytest.approx(20.0)


def test_out_of_order_input_is_sorted_by_time():
    fills = pd.DataFrame([F("2", "sell", 1, 5004, 5), F("1", "buy", 1, 5000, 1)])
    trades, _ = pair_fills(fills, M)
    assert trades[0].direction.value == "long" and trades[0].gross_pnl == pytest.approx(20.0)


def test_projectx_adapter_and_reconciliation():
    raw = [
        {"id": 11, "accountId": 7, "contractId": "CON.F.US.MES.Z26", "creationTimestamp": "2026-09-01T13:31:00+00:00",
         "price": 5000.0, "profitAndLoss": None, "fees": 1.0, "side": 0, "size": 1, "voided": False, "orderId": 90},
        {"id": 12, "accountId": 7, "contractId": "CON.F.US.MES.Z26", "creationTimestamp": "2026-09-01T13:40:00+00:00",
         "price": 5003.0, "profitAndLoss": 15.0, "fees": 1.0, "side": 1, "size": 1, "voided": False, "orderId": 91},
        {"id": 13, "accountId": 7, "contractId": "CON.F.US.MES.Z26", "creationTimestamp": "2026-09-01T13:41:00+00:00",
         "price": 5003.0, "profitAndLoss": None, "fees": 1.0, "side": 1, "size": 1, "voided": True, "orderId": 92},
    ]
    fills = fills_from_projectx(raw, {"CON.F.US.MES.Z26": "MES"})
    assert len(fills) == 2                                # voided dropped
    assert list(fills["side"]) == ["buy", "sell"]
    trades, _ = pair_fills(fills, M)
    assert trades[0].gross_pnl == pytest.approx(15.0)
    rec = reconcile_with_broker(fills, trades)
    assert rec.loc[0, "difference"] == 0.0


def test_root_symbol():
    assert root_symbol("CON.F.US.MES.Z26") == "MES"
    assert root_symbol("MESZ26") == "MES"
    assert root_symbol("ESH6") == "ES"
    assert root_symbol("MNQ") == "MNQ"


def test_legs_df_shape():
    fills = pd.DataFrame([F("1", "buy", 2, 5000, 1), F("2", "sell", 2, 5001, 2)])
    _, legs = pair_fills(fills, M)
    df = legs_df(legs)
    assert list(df["points"]) == [1.0] and df["qty"].sum() == 2
