"""The API client against a fake transport: auth, retry, 401 refresh, chunking, no order endpoints."""
from datetime import datetime, timezone

import pandas as pd
import pytest

from core.projectx_api import ProjectXClient, ProjectXError, Unit, MAX_BARS_PER_REQUEST


class FakeResp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, script):
        self.script = list(script)       # list of (status, body) or callables
        self.calls = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        item = self.script.pop(0) if self.script else (200, {"success": True})
        if callable(item):
            item = item(json)
        return FakeResp(*item)


AUTH = (200, {"token": "tok1", "success": True, "errorCode": 0, "errorMessage": None})


def client(script):
    return ProjectXClient("sajid", "secret", session=FakeSession(script))


def test_auth_then_bearer_header():
    c = client([AUTH, (200, {"success": True, "accounts": [{"id": 1, "name": "50K", "balance": 50000, "canTrade": True}]})])
    df = c.accounts()
    calls = c.session.calls
    assert calls[0]["url"].endswith("/api/Auth/loginKey")
    assert calls[0]["json"] == {"userName": "sajid", "apiKey": "secret"}
    assert calls[1]["headers"]["Authorization"] == "Bearer tok1"
    assert df.loc[0, "name"] == "50K"


def test_401_triggers_single_reauth():
    c = client([AUTH, (401, {}), (200, {"token": "tok2", "success": True}),
                (200, {"success": True, "accounts": []})])
    c.accounts()
    assert c.session.calls[-1]["headers"]["Authorization"] == "Bearer tok2"


def test_retry_on_429_then_success(monkeypatch):
    monkeypatch.setattr("core.projectx_api.time.sleep", lambda s: None)
    c = client([AUTH, (429, {}), (503, {}), (200, {"success": True, "accounts": []})])
    assert c.accounts().empty
    assert len(c.session.calls) == 4


def test_api_error_surfaces_message():
    c = client([AUTH, (200, {"success": False, "errorCode": 3, "errorMessage": "bad account"})])
    with pytest.raises(ProjectXError, match="bad account"):
        c.accounts()


def test_fills_chunking_and_dedupe():
    def trades(body):
        return (200, {"success": True, "trades": [
            {"id": 1, "accountId": 5, "contractId": "CON.F.US.MES.Z26", "creationTimestamp": body["startTimestamp"],
             "price": 5000, "profitAndLoss": None, "fees": 1, "side": 0, "size": 1, "voided": False, "orderId": 1}]})
    c = client([AUTH, trades, trades, trades])
    df = c.fills(5, datetime(2026, 7, 1, tzinfo=timezone.utc), datetime(2026, 9, 1, tzinfo=timezone.utc))
    posted = [x for x in c.session.calls if x["url"].endswith("/api/Trade/search")]
    assert len(posted) == 3                                   # 62 days in 30-day chunks
    assert posted[0]["json"]["accountId"] == 5 and posted[0]["json"]["startTimestamp"].endswith("Z")
    assert len(df) == 1                                       # same id three times -> one fill
    assert df.loc[0, "symbol"] == "MES" and df.loc[0, "side"] == "buy"


def test_bars_chunked_under_20k_and_sorted():
    def bars(body):
        return (200, {"success": True, "bars": [
            {"t": body["startTime"], "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]})
    c = client([AUTH, bars, bars, bars])
    start, end = datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 1, 31, tzinfo=timezone.utc)
    df = c.bars("CON.F.US.MES.Z26", start, end, Unit.MINUTE, 1)
    posted = [x for x in c.session.calls if x["url"].endswith("/api/History/retrieveBars")]
    assert len(posted) == 3                                   # 43,200 minutes / 20,000 per call
    assert all(x["json"]["limit"] == MAX_BARS_PER_REQUEST and x["json"]["unit"] == 2 for x in posted)
    assert list(df.columns) == ["t", "o", "h", "l", "c", "v"] and df["t"].is_monotonic_increasing


def test_no_order_endpoints_exist():
    import inspect
    from core import projectx_api
    src = inspect.getsource(projectx_api)
    assert "/api/Order/place" not in src and "/api/Order/cancel" not in src and "/api/Order/modify" not in src


def test_from_env_requires_credentials(monkeypatch):
    monkeypatch.delenv("PROJECTX_USERNAME", raising=False)
    monkeypatch.delenv("PROJECTX_API_KEY", raising=False)
    monkeypatch.setattr("core.projectx_api.os.getenv", lambda k, d=None: None)
    with pytest.raises(ProjectXError):
        ProjectXClient.from_env()
