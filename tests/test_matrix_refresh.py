from tools import refresh_matrix
import pytest

from tests.test_daily_journal import draft, login


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


def test_net_liquidity_multi_asset_scores_and_sizing_gate(monkeypatch):
    def fake_obs(series, limit=30):
        data = {
            "DGS10": [("2026-11-10", 4.10), ("2026-11-09", 4.12), ("2026-11-06", 4.15), ("2026-11-05", 4.18), ("2026-11-04", 4.20), ("2026-11-03", 4.24)],
            "DFII10": [("2026-11-10", 1.85), ("2026-11-09", 1.88), ("2026-11-06", 1.90), ("2026-11-05", 1.91), ("2026-11-04", 1.92), ("2026-11-03", 1.95)],
            "WALCL": [("2026-11-10", 6_800_000), ("2026-11-03", 6_780_000), ("2026-10-27", 6_760_000), ("2026-10-20", 6_750_000), ("2026-10-13", 6_720_000)],
            "WTREGEN": [("2026-11-10", 600_000), ("2026-11-03", 620_000), ("2026-10-27", 630_000), ("2026-10-20", 640_000), ("2026-10-13", 650_000)],
            "RRPONTSYD": [("2026-11-10", 100.0), ("2026-11-03", 120.0), ("2026-10-27", 130.0), ("2026-10-20", 140.0), ("2026-10-13", 150.0)],
            "BAMLH0A0HYM2": [("2026-11-10", 3.10), ("2026-11-09", 3.15)],
            "VIXCLS": [("2026-11-10", 16.0), ("2026-11-09", 16.4), ("2026-11-06", 16.8), ("2026-11-05", 17.0)],
            "VXVCLS": [("2026-11-10", 18.2), ("2026-11-09", 18.3)],
            "T10YIE": [("2026-11-10", 2.25), ("2026-11-09", 2.27)],
        }
        if series not in data:
            raise ValueError("unavailable")
        return data[series]

    monkeypatch.setattr(refresh_matrix, "observations", fake_obs)
    snapshot = {
        "markets": {
            "nq": {"price": 24000.0, "displayPrice": "24,000.00", "change": "+0.80%", "direction": "up", "trend": "bullish", "spark": [23500, 24000]},
            "dxy": {"price": 101.2, "displayPrice": "101.20", "change": "-0.30%", "direction": "down", "trend": "bearish", "spark": [102.0, 101.2]},
        },
        "cotBoard": [
            {"id": "nq", "symbol": "NQ", "name": "Nasdaq", "group": "Asset Managers", "longPct": 70.0, "shortPct": 30.0, "netPct": 18.0, "wowContracts": 3200, "wowPct": 1.5, "percentile52w": 75, "spark": [14, 18]},
            {"id": "dxy", "symbol": "DXY", "name": "USD", "group": "Asset Managers", "longPct": 40.0, "shortPct": 60.0, "netPct": -9.0, "wowContracts": -1500, "wowPct": -1.2, "percentile52w": 20, "spark": [-5, -9]},
        ],
        "mag7": {"greenCount": 6, "total": 7, "avgChangePct": 0.9},
        "seasonality": {"month": "November", "assets": {"nq": {"month": "November", "winRate": 80, "avgReturn": 4.1}}},
    }
    assert refresh_matrix.refresh_fred(snapshot)
    refresh_matrix.recompute_scores(snapshot)

    # True Fed Net Liquidity = (6.8M - 0.6M - 0.1M) / 1M = $6.10T
    fed_metric = next(m for m in snapshot["swing"]["metrics"] if m["id"] == "fed")
    assert fed_metric["value"] == "$6.10T"

    # All 6 markets scored with 6 transparent pillars each
    assert [a["id"] for a in snapshot["assets"]] == ["nq", "es", "xau", "dxy", "eurusd", "gbpusd"]
    nq = snapshot["assets"][0]
    dxy = next(a for a in snapshot["assets"] if a["id"] == "dxy")
    assert len(nq["pillars"]) == 6
    assert nq["score"] >= 70 and nq["bias"] == "Strong Bullish"
    assert dxy["score"] <= 35
    assert snapshot["swing"]["score"] == nq["score"]

    # Standard sizing when clean + implied NQ daily move
    assert snapshot["intraday"]["sizing"] == "standard"
    assert snapshot["intraday"]["impliedMove"]["nqPoints"] > 200

    # Tier-1 CPI release today shifts sizing to paused
    today = refresh_matrix.datetime.now(refresh_matrix.NY).date().isoformat()
    snapshot["calendar"] = [{"date": f"{today}T08:30:00-05:00", "event": "US Core CPI YoY"}]
    refresh_matrix.recompute_scores(snapshot)
    assert snapshot["intraday"]["sizing"] == "paused"


def test_calendar_surprise_and_nq_impact_tagging():
    hot_cpi = refresh_matrix._tag_calendar_event({"date": "2026-11-12", "event": "US Core CPI YoY", "actual": "3.1%", "estimate": "2.8%"})
    assert hot_cpi["tier1"] is True
    assert hot_cpi["surprise"] == "beat"
    assert hot_cpi["nqImpact"] == "bearish"

    cool_cpi = refresh_matrix._tag_calendar_event({"date": "2026-11-12", "event": "US Core CPI YoY", "actual": "2.6%", "estimate": "2.9%"})
    assert cool_cpi["surprise"] == "miss"
    assert cool_cpi["nqImpact"] == "bullish"


def test_matrix_refresh_api_owner_only_and_rate_limit(draft, monkeypatch, tmp_path):
    client, _, state = draft
    monkeypatch.setattr(refresh_matrix, "refresh_snapshot", lambda snap, source="all": (snap.update({"asOf": "2026-11-22T12:00:00+00:00", "assets": []}) or True))

    # Non-owner gets 403
    login(client, state, "friend@example.com", "friend-sub")
    assert client.post("/api/matrix/refresh").status_code == 403

    # Owner succeeds and hits 429 on immediate retry
    login(client, state)
    snap_file = tmp_path / "matrix-test.json"
    import webapp.app as webapp_mod
    real_path = webapp_mod.Path
    class _PatchedPath(type(real_path())):
        def __truediv__(self, other):
            if other == "data/private/matrix-verified-snapshot.json":
                return snap_file
            return super().__truediv__(other)
    monkeypatch.setattr(webapp_mod, "Path", _PatchedPath)
    first = client.post("/api/matrix/refresh")
    assert first.status_code == 200
    assert first.json()["refreshed"] is True
    assert snap_file.is_file()
    second = client.post("/api/matrix/refresh")
    assert second.status_code == 429

