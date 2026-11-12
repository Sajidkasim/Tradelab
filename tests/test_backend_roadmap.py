from concurrent.futures import ThreadPoolExecutor

from cryptography.fernet import Fernet, InvalidToken
import pytest

from core.db import Database
from tests.test_webapp import local, trade_payload
from tools.workspace_backup import create_archive, verify_archive
from webapp.rate_counters import RateCounters


def test_trade_pages_filter_before_slicing_and_link_to_full_detail(local):
    client, _ = local
    for index in range(12):
        body = trade_payload(source='manual' if index % 2 else 'backtest', clock=f'09:{index:02}')
        body['confirmed'] = index % 3 == 0
        assert client.post('/api/trades', json=body).status_code == 200
    full = client.get('/api/trades').json()
    assert len(full) == 12
    assert client.get('/api/metadata').json()['trade_count'] == 12
    for scope, expected in [('All', full), ('Backtesting', [row for row in full if row['source'] == 'backtest'])]:
        for pending in (False, True):
            matching = [row for row in expected if not pending or row['needs_review']]
            first = client.get('/api/trades/page', params={'scope':scope, 'pending':pending, 'size':2}).json()
            second = client.get('/api/trades/page', params={'scope':scope, 'pending':pending, 'size':2, 'page':1}).json()
            assert first['items'] == matching[:2]
            assert second['items'] == matching[2:4]
            assert first['total'] == len(matching)
            assert first['pending_count'] == sum(row['needs_review'] for row in expected)
    linked = client.get(f"/api/trades/{full[-1]['id']}").json()
    assert linked['id'] == full[-1]['id'] and linked['notes'] == full[-1]['notes']
    assert client.get('/api/trades/page?size=101').status_code == 422


def test_counters_persist_and_reserve_attempts_atomically(tmp_path):
    path = tmp_path / 'limits.db'
    now = [100.0]
    first = RateCounters(Database(path), clock=lambda: now[0])
    second = RateCounters(Database(path), clock=lambda: now[0])
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda i: (first if i % 2 else second).consume('scope', limit=5), range(9)))
    assert results.count(None) == 5
    assert results.count(60) == 4
    assert second.consume('different-scope', limit=5) is None
    now[0] += 60
    assert second.consume('scope', limit=5) is None


def test_encrypted_workspace_backup_rehearses_restore(local):
    client, app = local
    assert client.post('/api/trades', json=trade_payload()).status_code == 200
    source = app.state.workspaces.root
    source.set_setting('journal-test', {'notes':'private note'})
    cipher = Fernet(Fernet.generate_key())
    content = create_archive(source, cipher)
    assert b'private note' not in content
    assert verify_archive(content, cipher) == 1
    with pytest.raises(InvalidToken):
        verify_archive(content, Fernet(Fernet.generate_key()))
    assert source.get_setting('journal-test') == {'notes':'private note'}


def test_private_workspace_locks_do_not_queue_unrelated_work(local):
    from threading import Event

    _, app = local
    workspaces = app.state.workspaces
    same = Event()
    other = Event()

    def enter(key, signal):
        with workspaces.workspace_lock(key):
            signal.set()

    with ThreadPoolExecutor(2) as pool:
        with workspaces.workspace_lock('owner'):
            pool.submit(enter, 'owner', same)
            pool.submit(enter, 'other', other)
            assert other.wait(2)
            assert not same.is_set()
        assert same.wait(2)
