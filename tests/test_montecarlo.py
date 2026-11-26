"""Unit and HTTP tests for the Monte Carlo edge stress test."""
from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from core.montecarlo import MIN_TRADES, stress_test
from webapp.app import create_app
from webapp.config import Settings


def test_determinism_and_band_monotonicity():
    rng = np.random.default_rng(7)
    r_values = np.where(rng.random(80) < 0.45, 2.0, -1.0)
    first = stress_test(r_values, horizon=100, drawdown_r=10.0, method="block", n_sims=1000)
    second = stress_test(r_values, horizon=100, drawdown_r=10.0, method="block", n_sims=1000)
    assert first == second

    bands = first["projection"]["bands"]
    for i in range(len(first["projection"]["steps"])):
        assert bands["5"][i] <= bands["25"][i] <= bands["50"][i] <= bands["75"][i] <= bands["95"][i]

    ladder = first["drawdown"]["ladder"]
    probs = [row["prob"] for row in ladder]
    assert probs == sorted(probs, reverse=True)


def test_verdicts_across_regimes():
    rng = np.random.default_rng(11)
    strong = np.where(rng.random(180) < 0.48, 2.0, -1.0)
    res_strong = stress_test(strong, horizon=100, n_sims=1000)
    assert res_strong["edge"]["verdict"] == "strong"
    assert res_strong["edge"]["p_value"] < 0.01
    assert res_strong["edge"]["ci95"][0] > 0
    assert res_strong["projection"]["prob_profit"] > 0.9

    negative = np.where(rng.random(120) < 0.22, 2.0, -1.0)
    res_neg = stress_test(negative, horizon=100, n_sims=1000)
    assert res_neg["edge"]["verdict"] == "negative"
    assert res_neg["edge"]["ci95"][1] <= 0

    zero_edge = np.tile([2.0, -1.0, -1.0], 40)
    res_zero = stress_test(zero_edge, horizon=100, n_sims=1000)
    assert res_zero["edge"]["verdict"] in ("none", "luck")


def test_insufficient_empty_nan_and_constant_samples():
    assert stress_test([], horizon=100)["edge"]["verdict"] == "insufficient"
    assert stress_test([1.0], horizon=100)["edge"]["verdict"] == "insufficient"
    assert stress_test([2.0, -1.0] * 5, horizon=100, n_sims=500)["edge"]["verdict"] == "insufficient"

    dirty = stress_test([None, float("nan"), float("inf"), 2.0, -1.0], horizon=50, n_sims=300)
    assert dirty["sample"]["trades"] == 2
    assert dirty["edge"]["verdict"] == "insufficient"

    constant = stress_test([1.5] * (MIN_TRADES + 5), horizon=50, n_sims=300)
    assert constant["sample"]["constant_r"] is True
    assert constant["projection"] is None


def test_custom_drawdown_r_rounding_matches_ladder():
    r_values = [2.0, -1.0, -1.0, 2.5, -1.0] * 10
    res = stress_test(r_values, horizon=100, drawdown_r=7.256, n_sims=800)
    assert res["drawdown"]["target"]["r"] == 7.26
    ladder_rs = [row["r"] for row in res["drawdown"]["ladder"]]
    assert 7.26 in ladder_rs


def test_block_bootstrap_captures_loss_clustering_stronger_than_iid():
    # Strongly clustered losses (6 wins, 6 losses repeating)
    clustered = ([1.4] * 6 + [-1.0] * 6) * 10
    block = stress_test(clustered, horizon=100, drawdown_r=8.0, method="block", n_sims=1500)
    iid = stress_test(clustered, horizon=100, drawdown_r=8.0, method="iid", n_sims=1500)
    assert block["drawdown"]["max_dd"]["95"] > iid["drawdown"]["max_dd"]["95"]
    assert block["drawdown"]["losing_streak"]["p95"] >= iid["drawdown"]["losing_streak"]["p95"]


def test_history_permutation_distinguishes_lucky_and_unlucky_order():
    # Exact alternating wins and losses -> max DD is only 1R, unusually lucky order
    lucky = [1.5, -1.0] * 30
    res_lucky = stress_test(lucky, horizon=50, n_sims=1000)
    assert res_lucky["history"]["actual_max_dd"] == pytest.approx(1.0)
    assert res_lucky["history"]["worse_share"] > 0.95

    # All losses front-loaded -> max DD is 30R, worst possible order
    unlucky = [-1.0] * 30 + [1.5] * 30
    res_unlucky = stress_test(unlucky, horizon=50, n_sims=1000)
    assert res_unlucky["history"]["actual_max_dd"] == pytest.approx(30.0)
    assert res_unlucky["history"]["worse_share"] == 0.0
    assert res_unlucky["history"]["permutations"] > 0


@pytest.fixture
def api_client(tmp_path):
    config = Settings(
        str(tmp_path / "mc.db"),
        "owner@example.com",
        "test-session-secret-with-enough-characters",
        "http://127.0.0.1:8100",
        local=True,
    )
    app = create_app(config)
    with TestClient(app, base_url=config.public_url, client=("127.0.0.1", 12345)) as client:
        identity = client.get("/api/session").json()
        client.headers.update({"X-Primus-CSRF": identity["csrf"], "Origin": config.public_url})
        yield client, app


def _add_trade(client, *, source="backtest", day_idx=0, strategy="ORB", pnl=100.0, risk=50.0):
    day = 1 + (day_idx % 28)
    month = 1 + (day_idx // 28)
    payload = {
        "symbol": "NQ",
        "direction": "long",
        "account_id": 1,
        "source": source,
        "strategy": strategy,
        "labels": {"level": "FVG", "timeframe": "4H", "entry_timeframe": "1m", "confirmations": ["SMT"]},
        "confirmed": True,
        "entry_time": f"2026-{month:02d}-{day:02d}T13:30:00Z",
        "exit_time": f"2026-{month:02d}-{day:02d}T14:00:00Z",
        "net_pnl": pnl,
        "notes": "",
    }
    if risk is not None:
        payload["risk_amount"] = risk
    else:
        payload["risk_unavailable"] = True
    response = client.post("/api/trades", json=payload)
    assert response.status_code == 200, response.text


def test_monte_carlo_endpoint_respects_filters_missing_risk_and_never_pools_sources(api_client):
    from datetime import datetime
    from core.models import Direction, Source, Trade

    client, app = api_client
    # 24 backtest trades with risk (+2R / -1R alternating)
    for i in range(24):
        _add_trade(client, source="backtest", day_idx=i, strategy="ORB", pnl=100.0 if i % 2 == 0 else -50.0, risk=50.0)
    # 2 closed backtest trades without recorded risk (e.g. imported without stop)
    db = app.state.workspaces.database("owner")
    db.insert_trades([
        Trade(
            symbol="NQ", direction=Direction.LONG, qty=1.0,
            entry_time=datetime(2026, 2, 1 + i, 13, 30), exit_time=datetime(2026, 2, 1 + i, 14, 0),
            entry_price=20000.0, exit_price=20005.0, multiplier=20.0,
            source=Source.BACKTEST, setup_name="ORB", account_id=1,
            net_pnl=75.0, gross_pnl=75.0, initial_risk=None, r_multiple=None,
            tags=["edge:reviewed"],
        )
        for i in range(2)
    ])
    app.state.workspaces.bump("owner")
    # 10 live (manual) trades under a different strategy
    for i in range(10):
        _add_trade(client, source="manual", day_idx=i, strategy="Fade", pnl=-50.0, risk=50.0)

    # Even if client passes scope="All" + combined=True, endpoint must NOT pool Backtesting and Forward testing.
    res = client.post(
        "/api/lab/monte-carlo",
        json={
            "filters": {"scope": "All", "sample": "Backtesting", "combined": True, "window": "All sessions"},
            "horizon": 100,
            "drawdown_r": 10,
            "method": "block",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["scope"] == "Backtesting"
    assert body["sample"]["trades"] == 24
    assert body["closed_trades"] == 26
    assert body["missing_risk"] == 2
    assert body["projection"] is not None
    assert body["edge"]["resamples"] > 0

    # Forward testing stays separate (only 10 trades -> insufficient)
    live = client.post(
        "/api/lab/monte-carlo",
        json={
            "filters": {"scope": "Forward testing", "sample": "Forward testing", "window": "All sessions"},
            "horizon": 50,
            "drawdown_r": 5,
            "method": "iid",
        },
    )
    assert live.status_code == 200
    assert live.json()["scope"] == "Forward testing"
    assert live.json()["sample"]["trades"] == 10
    assert live.json()["edge"]["verdict"] == "insufficient"

    # Strategy filter narrows sample cleanly
    filtered = client.post(
        "/api/lab/monte-carlo",
        json={
            "filters": {"scope": "Backtesting", "strategy": "Fade", "window": "All sessions"},
            "horizon": 100,
            "drawdown_r": 10,
            "method": "block",
        },
    )
    assert filtered.status_code == 200
    assert filtered.json()["sample"]["trades"] == 0

    # Strict validation rejects bad inputs
    assert client.post("/api/lab/monte-carlo", json={"filters": {}, "horizon": 999}).status_code == 422
    assert client.post("/api/lab/monte-carlo", json={"filters": {}, "drawdown_r": 0}).status_code == 422
    assert client.post("/api/lab/monte-carlo", json={"filters": {}, "extra": 1}).status_code == 422


def test_monte_carlo_endpoint_requires_authentication(tmp_path):
    from webapp.personal_access import hash_password

    config = Settings(
        str(tmp_path / "auth.db"),
        "owner@example.com",
        "test-session-secret-with-enough-characters",
        "http://127.0.0.1:8100",
        local=True,
        password_hash=hash_password("secret-passphrase-123"),
    )
    app = create_app(config)
    with TestClient(app, base_url=config.public_url, client=("127.0.0.1", 12345)) as client:
        session = client.get("/api/session").json()
        res = client.post(
            "/api/lab/monte-carlo",
            headers={"X-Primus-CSRF": session["csrf"], "Origin": config.public_url},
            json={"filters": {}},
        )
        assert res.status_code == 401
