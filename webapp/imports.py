"""Replay/file previews and confirmation without storing unconfirmed records."""
import hashlib
import json
from io import BytesIO

import pandas as pd

from core import importers
from core.models import Source
from core.fills_to_trades import pair_fills, root_symbol
from services import import_flow, trade_labels
from .workspaces import records

MAX_UPLOAD = 5 * 1024 * 1024
EXTENSIONS = (".csv", ".tsv", ".txt", ".xlsx", ".xlsm", ".json")


def parse(content, filename, db, account_id, source, timezone, dayfirst, mapping):
    if len(content) > MAX_UPLOAD:
        raise ValueError("Choose a file smaller than 5 MB.")
    if not filename.lower().endswith(EXTENSIONS):
        raise ValueError("Choose CSV, TSV, TXT, Excel or JSON.")
    if account_id not in {a.id for a in db.accounts()}:
        raise ValueError("Choose an account in your workspace.")
    if timezone not in ("UTC", "America/New_York", "Europe/London"):
        raise ValueError("Choose a supported export time zone.")
    if source not in ("fxreplay", "backtest", "csv", "excel"):
        raise ValueError("Choose backtesting or forward testing.")
    raw = import_flow.read_upload(content, filename)
    if len(raw) > 20000:
        raise ValueError("Import up to 20,000 rows at a time.")
    native = import_flow.is_fx_analytics(raw)
    used_mapping = mapping or importers.auto_map(list(raw.columns))
    instruments = db.instruments()
    if native:
        trades, errors = import_flow.fx_analytics(raw, instruments, account_id, timezone)
    else:
        if not isinstance(used_mapping, dict) or any(v and v not in raw.columns for v in used_mapping.values()):
            raise ValueError("Mapped columns must exist in the uploaded file.")
        if importers.detect_shape(used_mapping) == "fills":
            required = ["symbol", "direction", "qty"]
            if not all(used_mapping.get(k) for k in required) or not (used_mapping.get("timestamp") or used_mapping.get("entry_time")):
                raise ValueError("Map market, side, size and time before importing fills.")
            price = used_mapping.get("price") or used_mapping.get("entry_price")
            if not price:
                raise ValueError("Map the fill price.")
            stamps = pd.to_datetime(raw[used_mapping.get("timestamp") or used_mapping.get("entry_time")], dayfirst=dayfirst)
            if stamps.dt.tz is None:
                stamps = stamps.dt.tz_localize(timezone, ambiguous="raise", nonexistent="raise")
            fills = pd.DataFrame({"fill_id": raw[used_mapping["external_id"]] if used_mapping.get("external_id") else range(len(raw)),
                                  "symbol": raw[used_mapping["symbol"]].map(root_symbol),
                                  "side": raw[used_mapping["direction"]], "timestamp": stamps.dt.tz_convert("UTC"),
                                  "size": pd.to_numeric(raw[used_mapping["qty"]]), "price": pd.to_numeric(raw[price]),
                                  "fees": pd.to_numeric(raw[used_mapping["fees"]]).fillna(0) if used_mapping.get("fees") else 0})
            unknown = set(fills['symbol']) - set(instruments)
            if unknown:
                raise ValueError('Configure these instruments before importing fills: ' + ', '.join(sorted(unknown)))
            trades, _ = pair_fills(fills, {s: i.multiplier for s, i in instruments.items()})
            for trade in trades:
                trade.source, trade.account_id = Source(source), account_id
            errors = []
        else:
            # Interpret naive export times explicitly before passing to the unchanged importer.
            for target in ("entry_time", "exit_time"):
                column = used_mapping.get(target)
                if column:
                    def utc(value):
                        try:
                            stamp = pd.to_datetime(value, dayfirst=dayfirst)
                            if pd.isna(stamp):
                                return None
                            if stamp.tzinfo is None:
                                stamp = stamp.tz_localize(timezone, ambiguous="raise", nonexistent="raise")
                            return stamp.tz_convert("UTC").isoformat()
                        except (ValueError, TypeError):
                            return "invalid date"
                    raw[column] = raw[column].map(utc)
            trades, errors = importers.normalise(raw, used_mapping, instruments, source=Source(source), account_id=account_id, dayfirst=False)
    mappings = db.get_setting(trade_labels.MAPPING_KEY, {})
    issues = []
    for trade in trades:
        fields, warnings = trade_labels.mapped_fields(trade.tags, mappings, trade.setup_name)
        trade.tags, trade.setup_name = fields["tags"], fields["setup_name"]
        issues.extend(warnings)
    preview = importers.preview(trades, db.existing_external_ids())
    seen = set(db.existing_external_ids())
    for index, trade in enumerate(trades):
        if trade.external_id and trade.external_id in seen:
            preview.loc[index, "status"] = "duplicate"
        elif trade.external_id:
            seen.add(trade.external_id)
        if "pnl-only" in trade.tags:
            preview.loc[index, ["entry_price", "exit_price"]] = None
    return trades, {"native": native, "source": "fxreplay" if native else source,
                    "columns": list(raw.columns), "mapping": used_mapping,
                    "counts": import_flow.preview_counts(preview, errors),
                    "rows": records(preview.head(200)), "total_rows": len(preview), "errors": errors,
                    "issues": list(dict.fromkeys(issues)),
                    "tags": sorted({t for trade in trades for t in trade.tags if not t.startswith("edge:") and t != "pnl-only"})}


def digest(content, filename, account_id, source, timezone, dayfirst, mapping):
    options = json.dumps([filename, account_id, source, timezone, dayfirst, mapping], sort_keys=True).encode()
    return hashlib.sha256(content + options).hexdigest()
