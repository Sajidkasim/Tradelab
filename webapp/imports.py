"""Replay/file previews and confirmation without storing unconfirmed records."""
import hashlib
import json
from io import BytesIO

import pandas as pd

from core import importers
from core.models import Source
from core.fills_to_trades import pair_fills, root_symbol
from services import import_flow, trade_labels, fixed_rr, tag_cleanup
from .workspaces import records
from . import lab_settings
from core import edge

MAX_UPLOAD = 5 * 1024 * 1024
EXTENSIONS = (".csv", ".tsv", ".txt", ".xlsx", ".xlsm", ".json")


def parse(content, filename, db, account_id, source, timezone, dayfirst, mapping, include_breakeven=True):
    if len(content) > MAX_UPLOAD:
        raise ValueError("Choose a file smaller than 5 MB.")
    if not filename.lower().endswith(EXTENSIONS):
        raise ValueError("Choose CSV, TSV, TXT, Excel or JSON.")
    if account_id not in {a.id for a in db.accounts()}:
        raise ValueError("Choose an account in your workspace.")
    if timezone not in ("UTC", "Etc/GMT+4", "America/New_York", "Europe/London"):
        raise ValueError("Choose a supported export time zone.")
    if source not in ("fxreplay", "backtest", "csv", "excel"):
        raise ValueError("Choose backtesting or forward testing.")
    raw = import_flow.read_upload(content, filename)
    if len(raw) > 20000:
        raise ValueError("Import up to 20,000 rows at a time.")
    native = import_flow.is_fx_analytics(raw)
    used_mapping = mapping or importers.auto_map(list(raw.columns))
    instruments = db.instruments()
    original_notes = {}
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
    # Only exclude closed, exactly-zero realised results. Missing P&L and
    # open positions are not break-even; small profits/losses stay untouched.
    excluded_breakeven = 0
    if not include_breakeven:
        kept = [trade for trade in trades if not (trade.exit_price is not None and trade.net_pnl == 0)]
        excluded_breakeven = len(trades) - len(kept)
        trades = kept
    # Preserve journal fields when supplied by a richer native export.
    note_column = importers.auto_map(list(raw.columns)).get('notes')
    strategy_column = importers.auto_map(list(raw.columns)).get('setup_name')
    source_rows = {str(row.get('id', '')):row for row in raw.to_dict('records')} if native else {}
    for trade in trades:
        if native:
            row = source_rows.get(trade.external_id, {})
            note = row.get(note_column) if note_column else None
            if note is not None and pd.notna(note) and str(note).strip():
                original_notes[trade.external_id] = str(note).strip()
                trade.notes = str(note).strip() + '\n\n' + trade.notes
            strategy = row.get(strategy_column) if strategy_column else None
            if strategy is not None and pd.notna(strategy):
                trade.setup_name = str(strategy).strip()
        elif trade.notes.strip():
            original_notes[trade.external_id] = trade.notes
    mappings = db.get_setting(trade_labels.MAPPING_KEY, {})
    aliases = db.get_setting(tag_cleanup.KEY, {})
    issues = []
    lab_timezone = lab_settings.read(db)['timezone']
    for trade in trades:
        fields, warnings = trade_labels.mapped_fields(trade.tags, mappings, trade.setup_name)
        trade.tags, trade.setup_name = fields["tags"], fields["setup_name"]
        canonical = tag_cleanup.trade_fields(trade, aliases)
        trade.tags, trade.setup_name = canonical['tags'], canonical['setup_name']
        issues.extend(warnings)
        issues.extend(trade_labels.weekday_warnings(trade.tags, mappings, trade.entry_time, lab_timezone))
    source_tags = sorted({trade_labels.original_tag(tag) for trade in trades for tag in trade.tags
                          if not tag.startswith(("edge:", "lab:")) and not fixed_rr.is_internal(tag) and tag != "pnl-only"})
    if any(tag.strip().upper() == '15M' and tag not in mappings for tag in source_tags):
        issues.append('15M appears in both of your FX Replay timeframe groups. Use Level TF: 15M and Entry TF: 15M to keep them separate; bare 15M remains unassigned.')
    preview = importers.preview(trades, db.existing_external_ids())
    seen = set(db.existing_external_ids())
    for index, trade in enumerate(trades):
        if trade.external_id and trade.external_id in seen:
            preview.loc[index, "status"] = "duplicate"
        elif trade.external_id:
            seen.add(trade.external_id)
        if "pnl-only" in trade.tags:
            preview.loc[index, ["entry_price", "exit_price"]] = None
    rows = records(preview.head(200))
    for row, trade in zip(rows, trades):
        row['setup_name'] = trade.setup_name
        row['labels'] = edge.read_labels(trade.tags)
        row.update(fixed_rr.read(trade.tags))
        row['has_note'] = bool(original_notes.get(trade.external_id))
    labels = [edge.read_labels(trade.tags) for trade in trades]
    coverage = {'strategies':sum(bool(t.setup_name.strip()) for t in trades),
                'confirmations':sum(bool(label['confirmations']) for label in labels),
                'notes':len(original_notes), 'total':len(trades)}
    return trades, {"native": native, "source": "fxreplay" if native else source,
                    "excluded_breakeven": excluded_breakeven,
                    "columns": list(raw.columns), "mapping": used_mapping,
                    "counts": import_flow.preview_counts(preview, errors),
                    "rows": rows, "coverage": coverage, "_notes": original_notes, "total_rows": len(preview), "errors": errors,
                    "issues": list(dict.fromkeys(issues)),
                    "suggestions": tag_cleanup.mapping_values({tag: trade_labels.suggested_mapping(tag) for tag in source_tags}, aliases),
                    "tags": source_tags}


def digest(content, filename, account_id, source, timezone, dayfirst, mapping, include_breakeven=True):
    options = json.dumps([filename, account_id, source, timezone, dayfirst, mapping, include_breakeven], sort_keys=True).encode()
    return hashlib.sha256(content + options).hexdigest()
