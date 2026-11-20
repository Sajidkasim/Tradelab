import pytest
from types import SimpleNamespace

import pandas as pd

from core.registry import COACH_PROVIDERS
from extensions import ai_coach
from tests.test_daily_journal import draft, login, picture


@pytest.fixture(autouse=True)
def legacy_provider(monkeypatch):
    monkeypatch.setenv("COACH_PROVIDER", "gemini")


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


def test_aura_logs_gemini_status_without_private_error_body(monkeypatch, capsys):
    monkeypatch.setattr(ai_coach, "load_dotenv", lambda: None)
    monkeypatch.setenv("COACH_API_KEY", "test-secret")
    monkeypatch.delenv("COACH_GEMINI_MODEL", raising=False)

    def post(url, **kwargs):
        assert url.endswith("/gemini-2.5-flash:generateContent")
        response = ai_coach.requests.Response()
        response.status_code = 503
        response._content = b'{"error":{"status":"UNAVAILABLE","message":"private note and test-secret"}}'
        return response

    monkeypatch.setattr(ai_coach.requests, "post", post)
    result = ai_coach.aura_coach({"database": None, "account": None, "trader_name": "Trader"}, model="ignored")
    assert result == "Gemini is temporarily unavailable. Try again shortly."
    assert capsys.readouterr().out == "Gemini API Error: HTTP 503 UNAVAILABLE\n"


def test_aura_passes_a_private_question_to_the_provider(draft, monkeypatch):
    client, app, state = draft
    monkeypatch.setattr("webapp.app.load_extensions", lambda folder: {})
    monkeypatch.setitem(COACH_PROVIDERS, ai_coach.NAME, lambda brief: brief["question"])
    url = "/api/journal/coach?day=2026-11-05"
    assert client.post(url, json={"question": "Why?"}).status_code == 401
    login(client, state)
    assert client.post(url, json={"question": "Why?"}, headers={"X-Primus-CSRF": ""}).status_code == 403
    assert client.post(url, json={"question": "a" * 1001}).status_code == 422
    response = client.post(url, json={"question": "  Why did my entry matter?  "})
    assert response.json() == {"markdown": "Why did my entry matter?"}


def test_aura_answers_greeting_without_gemini(monkeypatch):
    monkeypatch.setattr(ai_coach, "load_dotenv", lambda: pytest.fail("Greeting should stay local"))
    assert ai_coach.aura_coach({"question": "Hello!"}).startswith("Hey!")


def test_cloudflare_aura_sends_bounded_follow_up_without_images(monkeypatch):
    monkeypatch.setenv("COACH_PROVIDER", "cloudflare")
    monkeypatch.setenv("COACH_CLOUDFLARE_ACCOUNT_ID", "a" * 32)
    monkeypatch.setenv("COACH_CLOUDFLARE_API_TOKEN", "test-token")

    def post(url, *, headers, json, timeout, allow_redirects):
        assert allow_redirects is False
        assert url.endswith("/ai/run/@cf/meta/llama-3.1-8b-instruct")
        assert json["max_tokens"] == 320
        assert [message["role"] for message in json["messages"]] == [
            "system", "user", "assistant", "user"
        ]
        assert len(json["messages"][1]["content"]) == 400
        assert "Waited for a retest" in json["messages"][-1]["content"]
        assert "image-id" not in str(json)
        response = ai_coach.requests.Response()
        response.status_code = 200
        response._content = b'{"success":true,"result":{"response":"Give the retest time."}}'
        return response

    monkeypatch.setattr(ai_coach.requests, "post", post)
    assert ai_coach.aura_coach({
        "database": None, "account": None, "trader_name": "Trader",
        "notes": "Waited for a retest", "question": "What would you change?",
        "history": [{"question": "x" * 900, "answer": "Earlier reply"}],
        "image_ids": ["image-id"],
    }) == "Give the retest time."
