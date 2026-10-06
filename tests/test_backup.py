"""A downloaded journal backup must be safe to restore and portable."""

import json

import pytest

from core import edge
from core.db import Database
from core.models import Account, Source


def test_backup_roundtrip_keeps_trade_labels_and_risk(tmp_path):
    original = Database(tmp_path / "original.db")
    original.init()
    account = original.upsert_account(Account("Trading", 50000, 1000, 2000))
    original.set_setting("edge_playbook", {"strategies": ["NY setup"]})
    trade = edge.build_trade(
        symbol="MNQ", direction="long", source=Source.BACKTEST,
        strategy="NY setup", account_id=account,
        entry_time="2026-09-01T13:35:00Z", exit_time="2026-09-01T13:40:00Z",
        instruments=original.instruments(), tags=["SMT", "key-level:FVG"],
        notes="My trade", net_pnl=100, risk_amount=50,
    )
    original.insert_trades([trade])

    backup = original.export_json()
    restored = Database(tmp_path / "restored.db")
    restored.init()
    restored.import_json(backup, replace=True)

    assert json.loads(restored.export_json()) == json.loads(backup)


def test_replace_rejects_non_backup_before_deleting_existing_data(tmp_path):
    db = Database(tmp_path / "journal.db")
    db.init()
    db.set_setting("edge_playbook", {"strategies": ["Keep me"]})

    with pytest.raises(ValueError, match="backup"):
        db.import_json("{}", replace=True)

    assert db.get_setting("edge_playbook") == {"strategies": ["Keep me"]}


def test_merge_skips_existing_instruments_and_keeps_importing(tmp_path):
    original = Database(tmp_path / "original.db")
    original.init()
    original.set_setting("edge_playbook", {"strategies": ["Imported"]})
    backup = original.export_json()

    target = Database(tmp_path / "target.db")
    target.init()  # Default instruments already exist in this journal.
    counts = target.import_json(backup)

    assert counts["instruments"] == 0
    assert target.get_setting("edge_playbook") == {"strategies": ["Imported"]}
