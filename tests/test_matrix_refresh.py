from tools import refresh_matrix


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
