import json
import sys
from types import ModuleType, SimpleNamespace

import pandas as pd

from core.registry import COACH_PROVIDERS
from extensions import ai_coach
from tests.test_daily_journal import draft, login


def test_missing_key_is_safe(monkeypatch):
    monkeypatch.setattr(ai_coach, "load_dotenv", lambda: None)
    monkeypatch.delenv("COACH_API_KEY", raising=False)
    assert "unavailable" in COACH_PROVIDERS[ai_coach.NAME]({"notes": "Review today"})


def test_aura_uses_recent_live_results_and_includes_breach_quote(monkeypatch):
    monkeypatch.setattr(ai_coach, "load_dotenv", lambda: None)
    monkeypatch.setenv("COACH_API_KEY", "fake-test-key")
    monkeypatch.delenv("COACH_GEMINI_MODEL", raising=False)
    account = SimpleNamespace(id=12, starting_balance=10000, daily_loss_limit=500,
                              max_trailing_drawdown=1000)
    now = pd.Timestamp.now(tz="UTC")

    def trades_df(*, account_id, sources):
        assert account_id == 12
        assert sources == ai_coach.LIVE_SOURCES
        return pd.DataFrame({"exit_time": [now, now - pd.Timedelta(days=31), None]})


    def stats(trades):
        assert list(trades.index) == [0]
        return {"trades": 1, "win_rate": 0.0, "avg_r": -2.0}

    monkeypatch.setattr(ai_coach.metrics, "summary_stats", stats)
    monkeypatch.setattr(ai_coach.metrics, "daily_pnl", lambda trades: pd.Series(
        [-1100.0], index=pd.DatetimeIndex([now.normalize()]),
    ))

    def generate(prompt, *, request_options):
        data = json.loads(prompt)
        assert data["active_trader"] == "Sajid"
        assert data["daily_limit_breaches"] == data["trailing_drawdown_breaches"] == 1
        assert data["current_briefing_notes"] == "Review my exits."
        assert "fake-test-key" not in prompt
        return SimpleNamespace(text="### Risk check\nReview your exits.")

    def model(name, *, system_instruction):
        assert name == "gemini-1.5-flash"
        assert ai_coach.RISK_QUOTE in system_instruction
        return SimpleNamespace(generate_content=generate)

    google = ModuleType("google")
    genai = ModuleType("google.generativeai")
    google.generativeai = genai
    genai.configure = lambda *, api_key: None
    genai.GenerativeModel = model
    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.generativeai", genai)
    assert ai_coach.RISK_QUOTE in ai_coach.aura_coach({
        "notes": "Review my exits.", "database": SimpleNamespace(trades_df=trades_df),
        "account": account, "trader_name": "Sajid Khan",
    })



def test_journal_coach_checks_csrf_and_reads_only_the_signed_in_workspace(draft, monkeypatch):
    client, app, state = draft
    calls = []

    def provider(brief):
        calls.append(brief["notes"])
        return "### Review"

    monkeypatch.setitem(COACH_PROVIDERS, ai_coach.NAME, provider)
    monkeypatch.setattr("webapp.app.load_extensions", lambda folder: {})
    day = "2026-11-05"
    url = f"/api/journal/coach?day={day}"
    assert client.get(url).status_code == 401

    login(client, state)
    assert client.put(f"/api/journal/{day}", json={"notes": "Owner private note"}).status_code == 200
    assert client.get(url, headers={"X-Primus-CSRF": ""}).status_code == 403
    assert client.get(url, headers={"Origin": "https://other.example"}).status_code == 403
    assert client.get(url + "&account_id=999999").status_code == 404
    client.headers.pop("Origin")
    response = client.get(url)
    assert response.json() == {"markdown": "### Review"}
    assert response.headers["Cache-Control"] == "no-store"
    assert "Owner private note" in calls[0]

    login(client, state, "friend@example.com", "friend-sub")
    assert client.get(url).status_code == 200
    assert "Owner private note" not in calls[1]
