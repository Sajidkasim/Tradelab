from tools import refresh_matrix
import pytest


def test_fred_refresh_calculates_yield_change_and_preserves_existing_rows(monkeypatch):
    def observations(series):
        if series != "DGS10":
            raise ValueError("unavailable")
        return [("2026-11-06", 4.25), ("2026-11-05", 4.20), ("2026-11-04", 4.17),
                ("2026-11-03", 4.14), ("2026-11-02", 4.12), ("2026-10-30", 4.10)]

    monkeypatch.setattr(refresh_matrix, "observations", observations)
    snapshot = {"swing": {"metrics": [{"id": "cot", "value": "12%"}]}}
    assert refresh_matrix.refresh_fred(snapshot)
    assert snapshot["tickers"][0]["change"] == "+5 bp"
    assert snapshot["intraday"]["metrics"][0]["value"] == "+15 bp"
    assert snapshot["swing"]["metrics"][0]["value"] == "12%"

def test_cot_uses_nasdaq_and_rejects_an_unrelated_market(monkeypatch):
    row={'cftc_contract_market_code':'209742','market_and_exchange_names':'NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE',
         'asset_mgr_positions_long':'80','asset_mgr_positions_short':'20','open_interest_all':'200','report_date_as_yyyy_mm_dd':'2026-11-03T00:00:00'}
    class Response:
        ok=True
        def json(self):return [row]
    def get(url,params,timeout):
        assert params['cftc_contract_market_code']=='209742'
        return Response()
    monkeypatch.setattr(refresh_matrix.requests,'get',get)
    assert refresh_matrix.cftc_position()['value']=='+30.0%'
    row['market_and_exchange_names']='CANADIAN DOLLAR'
    with pytest.raises(ValueError,match='Nasdaq'):refresh_matrix.cftc_position()
