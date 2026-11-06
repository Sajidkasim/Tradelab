from tests.test_daily_journal import draft


def test_learn_risk_matrix_uses_whole_contracts_and_validates_inputs(draft):
    client, _, _ = draft
    url = "/api/learn/risk-matrix"
    inputs = {"balance": 50_000, "risk_percent": 0.5, "stop_ticks": 80}
    response = client.post(url, json=inputs)
    assert response.status_code == 200
    result = response.json()
    assert result["NQ"]["contracts"] == 0
    assert result["MNQ"]["contracts"] == 6
    assert result["MNQ"]["risk_budget"] == 250
    for invalid in ({"stop_ticks": 0}, {"balance": -1}, {"risk_percent": 101}):
        assert client.post(url, json={**inputs, **invalid}).status_code == 422
