import sys
from types import SimpleNamespace

import pandas as pd
import pytest

import nightly
from core.projectx_api import ProjectXError


@pytest.mark.parametrize(
    ("outcome", "exit_code", "message"),
    [
        ("fills", 0, "Topstep pull succeeded; review saved."),
        ("empty", 0, "Topstep pull succeeded with no fills; review saved."),
        ("fallback", 4, "Topstep unavailable; review saved from stored data."),
        ("failure", 1, "Nightly job failed."),
    ],
)
def test_safe_nightly_logs_status_without_private_details(monkeypatch, tmp_path, capsys, outcome, exit_code, message):
    private = "private strategy, P&L and credentials"
    saved = {}
    inserted = []
    account = SimpleNamespace(id=123456, name=private)

    def initialise():
        if outcome == "failure":
            raise RuntimeError(private)

    def fills(*args):
        if outcome == "fallback":
            raise ProjectXError(private)
        return pd.DataFrame([{"fill": 1}] if outcome == "fills" else [])

    def insert(trades):
        inserted.extend(trades)
        return {"inserted": len(trades), "skipped": 0}

    db = SimpleNamespace(init=initialise, accounts=lambda: [account], instruments=dict,
                         get_setting=lambda key, default: default, set_setting=saved.__setitem__,
                         insert_trades=insert)
    broker = SimpleNamespace(accounts=lambda: pd.DataFrame([{"id": account.id}]), fills=fills)
    monkeypatch.setattr(nightly.Database, "from_env", lambda: db)
    monkeypatch.setattr(nightly.ProjectXClient, "from_env", lambda: broker)
    monkeypatch.setattr(nightly, "pair_fills", lambda *args: ([SimpleNamespace()], None))
    monkeypatch.setattr(nightly, "reconcile_with_broker", lambda *args: pd.DataFrame({"difference": [98765.43]}))
    monkeypatch.setattr(nightly, "build_review", lambda *args, **kwargs: private)
    monkeypatch.setattr(sys, "argv", ["nightly.py", "--safe-output", "--date", "2026-11-20"])
    monkeypatch.chdir(tmp_path)

    assert nightly.main() == exit_code
    streams = capsys.readouterr()
    output = streams.out + streams.err
    assert message in output
    for sensitive in (private, str(account.id), "98765.43", "Traceback"):
        assert sensitive not in output
    assert len(inserted) == (outcome == "fills")
    review = tmp_path / "data/reviews/2026-11-20.md"
    if outcome == "failure":
        assert not saved and not review.exists()
    else:
        assert saved["daily_review_2026-11-20"] == review.read_text() == private
