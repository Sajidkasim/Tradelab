from types import SimpleNamespace

import pandas as pd

from core.registry import COACH_PROVIDERS
from extensions import ai_coach
from tests.test_daily_journal import draft, login, picture


def test_missing_key_is_safe(monkeypatch):
    monkeypatch.setattr(ai_coach, "load_dotenv", lambda: None)
    monkeypatch.delenv("COACH_API_KEY", raising=False)
    assert "unavailable" in COACH_PROVIDERS[ai_coach.NAME]({"notes": "Review today"})


def test_aura_uses_bounded_tools_and_private_screenshot_bytes(monkeypatch):
    monkeypatch.setattr(ai_coach, "load_dotenv", lambda: None)
    monkeypatch.setenv("COACH_API_KEY", "fake-test-key")
    monkeypatch.setenv("COACH_GEMINI_MODEL", "gemini-test")
    account = SimpleNamespace(id=12, starting_balance=10000, daily_loss_limit=500,
                              max_trailing_drawdown=1000)
    now = pd.Timestamp.now(tz="UTC") - pd.Timedelta(minutes=1)
    reads = []

    def trades_df(*, account_id, include_open, sources):
        assert (account_id, include_open, sources) == (12, False, ai_coach.LIVE_SOURCES)
        reads.append(account_id)
        return pd.DataFrame({"exit_time": [now, now - pd.Timedelta(days=31), None],
                             "net_pnl": [-1100.0, 0.0, 0.0]})

    def stats(trades):
        assert list(trades.index) == [0]
        return {"trades": 1, "win_rate": 0.0, "avg_r": -2.0}

    monkeypatch.setattr(ai_coach.metrics, "summary_stats", stats)
    model_turn = {"role": "model", "parts": [
        {"thoughtSignature": "sample", "functionCall": {
            "id": "a", "name": "get_summary_stats", "args": {"days": 7}}},
        {"functionCall": {"name": "check_risk_limit_breaches", "args": {"days": 14}}},
        {"functionCall": {"name": "get_summary_stats", "args": {"days": 100}}},
    ]}

    def post(url, *, json, headers, **options):
        assert url.endswith("/gemini-test:generateContent")
        assert headers["x-goog-api-key"] == "fake-test-key"
        assert "fake-test-key" not in str(json)
        assert ai_coach.RISK_QUOTE in json["systemInstruction"]["parts"][0]["text"]
        parts = json["contents"][0]["parts"]
        assert "Review my exits." in parts[0]["text"] and "Sajid" in parts[0]["text"]
        assert parts[1]["inlineData"] == {"mimeType": "image/webp", "data": "Y2hhcnQ="}
        assert set(decl["name"] for decl in json["tools"][0]["functionDeclarations"]) == {
            "get_summary_stats", "check_risk_limit_breaches",
        }
        if len(json["contents"]) == 1:
            assert not reads
            turn = model_turn
        else:
            assert json["contents"][1] == model_turn
            first, risk, invalid = [part["functionResponse"] for part in json["contents"][2]["parts"]]
            assert first["id"] == "a"
            assert first["response"]["closed_live_trades"] == 1
            assert risk["response"]["daily_limit_breaches"] == risk["response"]["trailing_drawdown_breaches"] == 1
            assert "error" in invalid["response"]
            turn = {"role": "model", "parts": [{"text": "### Risk check"}]}
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"candidates": [{"content": turn}]})

    monkeypatch.setattr(ai_coach.requests, "post", post)
    review = ai_coach.aura_coach({
        "notes": "Review my exits.", "database": SimpleNamespace(trades_df=trades_df),
        "account": account, "trader_name": "Sajid", "image_ids": ["chart", "missing"],
        "read_image": lambda image_id: b"chart" if image_id == "chart" else None,
    })
    assert reads == [12]
    assert ai_coach.RISK_QUOTE in review
    assert "1 saved screenshot" in review


def test_journal_coach_checks_csrf_and_reads_only_the_signed_in_workspace(draft, monkeypatch):
    client, app, state = draft
    calls = []
    monkeypatch.setenv("COACH_SAJID_EMAIL", " Owner@Example.com ")

    def provider(brief):
        calls.append((brief["trader_name"], brief["notes"], [brief["read_image"](key) for key in brief["image_ids"]]))
        return "### Review"

    monkeypatch.setitem(COACH_PROVIDERS, ai_coach.NAME, provider)
    monkeypatch.setattr("webapp.app.load_extensions", lambda folder: {})
    day = "2026-11-05"
    url = f"/api/journal/coach?day={day}"
    assert client.get(url).status_code == 401

    login(client, state)
    assert client.put(f"/api/journal/{day}", json={"notes": "Owner private note"}).status_code == 200
    upload = client.post(f"/api/journal/{day}/images", files={"file": ("chart.png", picture(), "image/png")})
    assert upload.status_code == 200
    assert client.get(url, headers={"X-Primus-CSRF": ""}).status_code == 403
    assert client.get(url, headers={"Origin": "https://other.example"}).status_code == 403
    assert client.get(url + "&account_id=999999").status_code == 404
    client.headers.pop("Origin")
    response = client.get(url)
    assert response.json() == {"markdown": "### Review"}
    assert response.headers["Cache-Control"] == "no-store"
    assert calls[0][0] == "Sajid"
    assert "Owner private note" in calls[0][1]
    assert calls[0][2][0].startswith(b"RIFF")

    login(client, state, "friend@example.com", "friend-sub")
    assert client.get(url).status_code == 200
    assert calls[1][0] == "Trader"
    assert "Owner private note" not in calls[1][1]
    assert calls[1][2] == []
