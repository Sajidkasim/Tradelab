"""Schema auto-migration and the extension registry."""
import sqlalchemy as sa

from core import db as dbmod
from core.db import Database
from core.registry import IMPORT_SOURCES, load_extensions, register_import_source


def test_migrate_adds_new_columns_on_both_dialects(tmp_path):
    db = Database(str(tmp_path / "old.db")); db.init()
    # simulate an older database missing a column the schema now has
    with db.engine.begin() as conn:
        conn.execute(sa.text("ALTER TABLE trades DROP COLUMN emotion"))
    cols = {c["name"] for c in sa.inspect(db.engine).get_columns("trades")}
    assert "emotion" not in cols
    added = db.migrate()
    assert "trades.emotion" in added
    cols = {c["name"] for c in sa.inspect(db.engine).get_columns("trades")}
    assert "emotion" in cols
    assert db.migrate() == []                     # idempotent


def test_migrate_creates_missing_table(tmp_path):
    db = Database(str(tmp_path / "t.db")); db.init()
    with db.engine.begin() as conn:
        conn.execute(sa.text("DROP TABLE rule_breaches"))
    added = db.migrate()
    assert "rule_breaches.*" in added and sa.inspect(db.engine).has_table("rule_breaches")


def test_registry_and_extension_loading(tmp_path):
    (tmp_path / "good.py").write_text(
        "import pandas as pd\nfrom core.registry import register_import_source\n"
        "register_import_source('Good', lambda f: pd.DataFrame({'a':[1]}), source='csv', help='h')\n")
    (tmp_path / "bad.py").write_text("raise RuntimeError('nope')\n")
    (tmp_path / "_skip.py").write_text("raise RuntimeError('should not load')\n")
    import core.registry as reg
    reg._loaded = False
    errors = load_extensions(tmp_path)
    assert "Good" in IMPORT_SOURCES and IMPORT_SOURCES["Good"].help == "h"
    assert "bad" in errors and "nope" in errors["bad"] and "_skip" not in errors
    assert not IMPORT_SOURCES["Good"].read_fn(None).empty
