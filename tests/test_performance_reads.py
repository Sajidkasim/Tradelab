"""Request-local caching must reduce queries without retaining revoked access."""
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from ui import access, state
from services.team import Identity
from tests.test_team import claims


def test_identity_checked_once_per_run_and_revocation_checked_on_fragment(monkeypatch):
    session = {}
    ctx = SimpleNamespace(cursors={})
    user = SimpleNamespace(is_logged_in=True)
    class User(dict):
        is_logged_in = True
    calls = []
    def join(value):
        calls.append(value)
        if len(calls) > 1:
            raise PermissionError('revoked')
        return Identity('member', 'Trader')
    monkeypatch.setattr(access.st, 'session_state', session)
    monkeypatch.setattr(access.st, 'user', User(sub='subject', email='a@example.com'))
    monkeypatch.setattr(access, 'is_local', lambda: False)
    monkeypatch.setattr(access, 'auth_configured', lambda: True)
    monkeypatch.setattr(access, 'directory', lambda: SimpleNamespace(join=join))
    monkeypatch.setattr('streamlit.runtime.scriptrunner.get_script_run_ctx', lambda **kw: ctx)
    access.begin_run()
    assert access.current_identity() == access.current_identity()
    assert len(calls) == 1
    ctx.cursors = {}  # Streamlit resets cursors on full and fragment reruns.
    with pytest.raises(PermissionError, match='revoked'):
        access.current_identity()


def test_small_reads_refresh_after_write_and_do_not_cross_workspaces(monkeypatch):
    session = {}
    calls = []
    db = SimpleNamespace(accounts=lambda: calls.append(1) or ['account'])
    monkeypatch.setattr(access.st, 'session_state', session)
    monkeypatch.setattr('streamlit.runtime.scriptrunner.get_script_run_ctx', lambda **kw: None)
    monkeypatch.setattr(state, 'get_db', lambda: db)
    access.begin_run()
    assert state.accounts() == state.accounts() == ['account']
    assert len(calls) == 1
    state.bump()
    assert state.accounts() == ['account']
    assert len(calls) == 2
    other = SimpleNamespace(accounts=lambda: ['other'])
    monkeypatch.setattr(state, 'get_db', lambda: other)
    assert state.accounts() == ['other']


def test_repeat_google_login_does_not_write_unchanged_profile(tmp_path):
    from core.db import Database
    from services.team import Team
    root = Database(tmp_path / 'team.db'); root.init()
    team = Team(root, 'owner@example.com')
    value = claims('owner@example.com', 'owner-sub')
    team.join(value)
    writes = []
    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('UPDATE'):
            writes.append(statement)
    sa.event.listen(root.engine, 'before_cursor_execute', record)
    try:
        assert team.join(value).owner
        assert writes == []
        team.join({**value, 'name': 'Updated name'})
        assert len(writes) == 1
    finally:
        sa.event.remove(root.engine, 'before_cursor_execute', record)


def test_journal_does_not_load_hidden_reviews_and_exports(monkeypatch):
    from pathlib import Path
    from streamlit.testing.v1 import AppTest
    from core import edge
    from core.db import Database
    from core.models import Account, Source
    db = Database(':memory:'); db.init()
    db.upsert_account(Account('Test', 50000, 1000, 2000))
    db.insert_trades([edge.build_trade(symbol='MNQ', direction='long', source=Source.BACKTEST,
        strategy='Test', account_id=db.accounts()[0].id, entry_time='2026-09-01T13:35:00Z',
        exit_time='2026-09-01T13:40:00Z', instruments=db.instruments(), tags=[], net_pnl=100, risk_amount=50)])
    monkeypatch.setattr(state, 'get_db', lambda: db)
    monkeypatch.setattr(state, 'trades', db.trades_df)
    calls = []
    original = db.settings_with_prefix
    monkeypatch.setattr(db, 'settings_with_prefix', lambda prefix: calls.append(prefix) or original(prefix))
    app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'app.py'), default_timeout=20).run()
    app.switch_page('views/journal.py').run()
    assert not app.exception
    assert calls == []
    assert not app.tabs
    app.toggle(key='journal_advanced').set_value(True).run()
    assert not app.exception
    assert calls == ['daily_review_']
    assert len(app.tabs) == 4
