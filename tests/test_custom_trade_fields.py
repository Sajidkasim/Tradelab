from datetime import datetime

from sqlalchemy.dialects import postgresql, sqlite

from core.db import trades_t
from tests.test_webapp import local, trade_payload


def test_custom_metadata_types():
    column = trades_t.c.custom_metadata
    assert column.type.compile(dialect=postgresql.dialect()) == "JSONB"
    assert column.type.compile(dialect=sqlite.dialect()) == "JSON"


def test_trade_fields_save_filter_and_clear(local):
    client, app = local
    response = client.post('/api/lab-settings/custom-fields', json={
        'name': 'Market Regime', 'type': 'dropdown', 'options': ['Trending', 'Ranging'],
    })
    assert response.status_code == 201, response.text
    field = response.json()
    field_id = field['id']
    assert client.get('/api/metadata').json()['custom_trade_fields'] == [field]

    choices = {field_id: ['Trending']}
    payload = {**trade_payload(), 'custom_fields': choices}
    response = client.post('/api/trades', json=payload)
    assert response.status_code == 200, response.text
    trade = client.get('/api/trades/page').json()['items'][0]
    assert trade['custom_fields'] == trade['custom_metadata'] == choices
    filters = {'scope': 'All', 'combined': True, 'window': 'All sessions', 'custom_fields': choices}
    assert client.post('/api/results', json=filters).json()['stats']['trades'] == 1

    review = {key: payload[key] for key in ('strategy', 'labels', 'confirmed', 'notes')}
    response = client.patch(f"/api/trades/{trade['id']}", json={**review, 'custom_fields': {field_id: []}})
    assert response.status_code == 200, response.text
    assert response.json()['custom_fields'] == {}
    assert client.post('/api/results', json=filters).json()['stats']['trades'] == 0


def test_existing_trade_gets_nullable_metadata_column(tmp_path):
    from core.db import Database

    database = Database(tmp_path / 'existing.db')
    database.init()
    with database.engine.begin() as connection:
        connection.execute(trades_t.insert().values(
            symbol='NQ', direction='long', qty=1, entry_time=datetime(2026, 7, 1),
            entry_price=100, tags='["SMT"]',
        ))
        connection.exec_driver_sql('ALTER TABLE trades DROP COLUMN custom_metadata')
    assert database.migrate() == ['trades.custom_metadata']
    trade = database.get_trade(1)
    assert trade.custom_metadata is None
    assert trade.tags == ['SMT']
