"""The coach brief is pure and factual; provider calls are exercised against a fake transport."""
import json

import pytest

from core import coach
from core.db import Database
from core.demo import seed_demo_trades
from core.models import Account


class FakeResp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, json.dumps(body)

    def json(self):
        return self._body


class FakeHTTP:
    def __init__(self, status=200, body=None):
        self.status, self.body, self.calls = status, body, []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return FakeResp(self.status, self.body)


@pytest.fixture
def data():
    db = Database(":memory:"); db.init()
    acct = Account("50K", 50_000, 1_000, 2_000, id=1)
    db.insert_trades(seed_demo_trades(80, account_id=1))
    return db, acct, db.trades_df()


def test_brief_is_factual_and_compact(data):
    db, acct, df = data
    b = coach.build_brief(df, acct, "Europe/London", scope="Demo")
    assert "## Headline" in b and "## By model / setup" in b and "## Risk state" in b and "## Last 12 closed trades" in b
    assert "80 closed trades" in b and "Trailing drawdown buffer" in b and "Chance of a 6-loss run" in b
    assert "ORB" in b and "VWAP reclaim" in b
    assert len(b) < 6000                           # small enough to be cheap
    assert coach.build_brief(df.iloc[0:0], acct) == "No trades in view."
    assert coach.brief_hash(b, "m1") != coach.brief_hash(b, "m2")


def test_anthropic_call_shape(data):
    db, acct, df = data
    http = FakeHTTP(200, {"content": [{"type": "text", "text": "### What's working\n- x"}]})
    out = coach.ask("anthropic", "sk-test", "claude-sonnet-5", "brief here", session=http, extra="sized down")
    assert out.startswith("### What's working")
    call = http.calls[0]
    assert call["url"].endswith("/v1/messages") and call["headers"]["x-api-key"] == "sk-test"
    assert call["json"]["model"] == "claude-sonnet-5" and call["json"]["system"] == coach.SYSTEM_PROMPT
    assert "Trader's note: sized down" in call["json"]["messages"][0]["content"]


def test_openai_call_shape_and_error():
    http = FakeHTTP(200, {"choices": [{"message": {"content": "### What's working\n- y"}}]})
    out = coach.ask("openai", "sk-o", "gpt-5.6-terra", "brief", session=http)
    assert "### What's working" in out and http.calls[0]["headers"]["Authorization"] == "Bearer sk-o"
    bad = FakeHTTP(429, {"error": "rate limited"})
    with pytest.raises(coach.CoachError, match="429"):
        coach.ask("openai", "sk-o", "gpt-5.6-terra", "brief", session=bad)


def test_review_caches_by_brief_and_handles_missing_key(data):
    db, acct, df = data
    no_key = coach.review(df, acct, "UTC", db=db, cfg={"provider": "anthropic", "model": "m", "key": None})
    assert no_key["review"] is None and "No API key" in no_key["error"] and no_key["brief"].startswith("# Trading brief")
    http = FakeHTTP(200, {"content": [{"type": "text", "text": "### What's working\n- cached me"}]})
    cfg = {"provider": "anthropic", "model": "m", "key": "k"}
    first = coach.review(df, acct, "UTC", db=db, cfg=cfg, session=http)
    second = coach.review(df, acct, "UTC", db=db, cfg=cfg, session=http)
    assert first["cached"] is False and second["cached"] is True and len(http.calls) == 1
    forced = coach.review(df, acct, "UTC", db=db, cfg=cfg, session=http, force=True)
    assert forced["cached"] is False and len(http.calls) == 2


def test_get_config_defaults(monkeypatch):
    for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "COACH_PROVIDER", "COACH_MODEL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr("core.coach.os.getenv", lambda k, d=None: {"OPENAI_API_KEY": "o"}.get(k, d))
    cfg = coach.get_config()
    assert cfg["provider"] == "openai" and cfg["model"] == "gpt-5.6-terra" and cfg["key"] == "o"
