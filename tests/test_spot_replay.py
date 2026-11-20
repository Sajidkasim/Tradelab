
from tests.test_webapp import local
from tools.import_dukascopy_replay import import_files
from webapp import replay_sessions, spot_replay


def test_spot_import_and_session(local, tmp_path, monkeypatch):
    client, _ = local
    monkeypatch.setattr(replay_sessions, 'ROOT', tmp_path)
    file = tmp_path / 'export.csv'
    lines = ['Etc/UTC,Open,High,Low,Close,Volume']
    for day in (4, 5):
        for minute in range(30, 40):
            lines.append(f'2010-01-{day:02}T13:{minute}:00+00:00,1.42,1.43,1.41,1.42,10')
    file.write_text('\n'.join(lines))
    database = tmp_path / spot_replay.FILENAME
    for symbol in spot_replay.SYMBOLS:
        import_files(database, symbol, [file])
    import_files(database, 'EURUSD', [file])
    history = client.get('/api/backtesting/sessions').json()['history']
    assert {i['symbol'] for i in history['instruments']} == {'NQ', 'MNQ', 'ES', *spot_replay.SYMBOLS}
    response = client.post('/api/backtesting/sessions', json={
        'instrument': 'EURUSD', 'name': 'FX fixture', 'day': '2010-01-04', 'start_time': '13:35',
    })
    assert response.status_code == 200, response.text
    data = response.json()
    session = data['session']
    assert list(data['sample']['markets']) == ['EURUSD']
    root = f"/api/backtesting/sessions/{session['id']}"
    for tf in ('1', '5', '1D'):
        response = client.get(root + '/chart-history', params={'root': 'EURUSD', 'timeframe': tf, 'cursor': session['cursor']})
        assert response.status_code == 200, response.text
        assert response.json()['bars']
        assert all(bar['time'] < session['clock'] for bar in response.json()['bars'])
    # Include both precomputed SQLite tuples and the forming candle.
    response = client.get(root + '/chart-history', params={
        'root': 'EURUSD', 'timeframe': '5', 'cursor': 7,
    })
    assert response.status_code == 200, response.text
    assert len(response.json()['bars']) == 2
    assert client.get(root).status_code == 200
    response = client.post(root + '/continue', json={'version': 0, 'cursor': session['cursor']})
    assert response.status_code == 200, response.text
    assert response.json()['session']['last_cursor'] == 19


def test_private_spot_archive_verifies_download(tmp_path, monkeypatch):
    import gzip
    import hashlib
    import io
    import json
    from types import SimpleNamespace

    import pytest
    from webapp import spot_archive

    content = b'private spot candle fixture'
    manifest = tmp_path / 'manifest.json'
    monkeypatch.setattr(spot_archive, 'MANIFEST', manifest)
    monkeypatch.setattr(spot_archive.tempfile, 'gettempdir', lambda: str(tmp_path))
    digest = hashlib.sha256(content).hexdigest()
    manifest.write_text(json.dumps({'sha256': digest, 'size': len(content)}))
    storage = SimpleNamespace(get_object=lambda **_: {'Body': io.BytesIO(gzip.compress(content))})
    path = spot_archive.restore(storage, 'private')
    assert path.read_bytes() == content
    path.unlink()
    storage = SimpleNamespace(get_object=lambda **_: {'Body': io.BytesIO(gzip.compress(b'invalid'))})
    with pytest.raises(ValueError, match='integrity'):
        spot_archive.restore(storage, 'private')
    assert not path.exists()
