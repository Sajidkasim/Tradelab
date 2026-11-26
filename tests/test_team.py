import json

import pytest

from core import edge
from core.db import Database
from core.models import Source
from services.team import Team, MemberDatabase, verified_google


def claims(email, subject):
    return dict(iss="https://accounts.google.com", email=email, email_verified=True, sub=subject, name="Trader")


@pytest.fixture
def team(tmp_path):
    root = Database(tmp_path / "owner.db")
    root.init()
    return Team(root, "owner@example.com")


def add_trade(db, pnl=100):
    trade = edge.build_trade(symbol="MNQ", direction="long", source=Source.BACKTEST,
                             strategy="My strategy", account_id=db.accounts()[0].id,
                             entry_time="2026-09-01T13:35:00Z", exit_time="2026-09-01T13:40:00Z",
                             instruments=db.instruments(), tags=["private tag"], notes="Private journal",
                             net_pnl=pnl, risk_amount=50)
    return db.insert_trades([trade])


@pytest.mark.parametrize("change", [{"email_verified": False}, {"iss": "https://evil.example"}, {"sub": ""}, {"email": "bad"}])
def test_google_claims_fail_closed(change):
    with pytest.raises(PermissionError):
        verified_google({**claims("owner@example.com", "owner-sub"), **change})


def test_only_invited_verified_accounts_can_join_and_subject_cannot_change(team):
    with pytest.raises(PermissionError):
        team.join(claims("stranger@example.com", "stranger"))
    key = team.invite("owner", "trader@example.com", "A trader")
    assert team.join(claims("trader@example.com", "sub-a")).key == key
    with pytest.raises(PermissionError):
        team.join(claims("trader@example.com", "sub-b"))


def test_owner_keeps_data_and_member_storage_exports_and_edits_are_isolated(team):
    owner = team.database("owner")
    add_trade(owner)
    key = team.invite("owner", "a@example.com", "A")
    other = team.database(key)
    assert other.count_trades() == 0
    add_trade(other, -50)
    assert owner.get_trade(1).net_pnl == 100
    assert other.get_trade(1).net_pnl == -50
    owner.set_setting("edge_playbook", {"strategies": ["Owner strategy"]})
    other.set_setting("edge_playbook", {"strategies": ["Other strategy"]})
    assert owner.get_setting("edge_playbook")["strategies"] == ["Owner strategy"]
    assert json.loads(other.export_json())["trades"][0]["net_pnl"] == -50
    other.delete_trade(1)
    assert owner.count_trades() == 1
    assert other.count_trades() == 0


def test_sharing_requires_opt_in_and_excludes_private_fields_and_can_be_revoked(team):
    key = team.invite("owner", "a@example.com", "A")
    add_trade(team.database(key))
    with pytest.raises(PermissionError):
        team.shared_results("owner", key)
    team.set_sharing(key, True)
    frame = team.shared_results("owner", key)
    assert len(frame) == 1
    assert not {"notes", "screenshot_path", "tags", "account_id", "external_id"} & set(frame.columns)
    team.set_sharing(key, False)
    with pytest.raises(PermissionError):
        team.shared_results("owner", key)


def test_member_cannot_invite_or_manage_owner_and_revocation_takes_effect(team):
    key = team.invite("owner", "a@example.com", "A")
    with pytest.raises(PermissionError):
        team.invite(key, "b@example.com", "B")
    with pytest.raises(PermissionError):
        team.set_active(key, "owner", False)
    team.set_active("owner", key, False)
    with pytest.raises(PermissionError):
        team.database(key)
    with pytest.raises(PermissionError):
        team.join(claims("a@example.com", "a"))
    with pytest.raises(PermissionError):
        team.shared_results(key, "owner")


def test_four_teammate_limit_and_no_email_leak_in_member_roster(team):
    keys = [team.invite("owner", f"a{i}@example.com", f"A{i}") for i in range(4)]
    with pytest.raises(ValueError):
        team.invite("owner", "extra@example.com", "Extra")
    assert "email" not in team.roster(keys[0])[0]
    assert "email" in team.roster("owner")[0]


def test_storage_key_cannot_escape_and_owner_cannot_be_silently_reassigned(team):
    with pytest.raises(ValueError):
        MemberDatabase(team.root, "../../owner")
    with pytest.raises(ValueError):
        Team(team.root, "someoneelse@example.com")


def test_repeat_google_login_does_not_write_unchanged_profile(tmp_path):
    import sqlalchemy as sa
    root = Database(tmp_path / "team.db")
    root.init()
    team = Team(root, "owner@example.com")
    value = claims("owner@example.com", "owner-sub")
    team.join(value)
    writes = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("UPDATE"):
            writes.append(statement)

    sa.event.listen(root.engine, "before_cursor_execute", record)
    try:
        assert team.join(value).owner
        assert writes == []
        team.join({**value, "name": "Updated name"})
        assert len(writes) == 1
    finally:
        sa.event.remove(root.engine, "before_cursor_execute", record)
