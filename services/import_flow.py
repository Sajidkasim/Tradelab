"""File adapters feeding the existing, tested trade importer."""
from io import BytesIO
import json
import re

import pandas as pd

from core import importers
from core.models import Source
from core.instruments import instrument_map


def read_upload(content: bytes, filename: str) -> pd.DataFrame:
    if not content:
        raise ValueError("The file is empty. Export it again from your platform.")
    buffer = BytesIO(content)
    buffer.name = filename
    if filename.lower().endswith(".json"):
        data = json.loads(content)
        if isinstance(data, dict) and "accounts" in data:
            raise ValueError("This is a backup. Open More options → Backup and restore.")
        return pd.DataFrame(data if isinstance(data, list) else data.get("trades", []))
    frame = importers.read_any(buffer)
    if frame.empty:
        raise ValueError("The file has column headings but no trade rows.")
    return frame


def is_fx_analytics(frame: pd.DataFrame) -> bool:
    return {"dateStart", "pair", "rPnL", "side"}.issubset(frame.columns)


def fx_analytics(frame: pd.DataFrame, instruments, account_id, timezone="UTC"):
    """Keep FX Replay's realised result, not its unrealised P&L or point-value amount.

    Its amount is not reliably a futures contract count. Use the existing P&L-only
    import path; preserve the original price/size fields in notes for reference.
    Never infer realised R from maxRiskReward or idealTP (planned targets).
    """
    raw = frame.copy()
    mapping = {"symbol": "pair", "direction": "side", "entry_time": "dateStart",
               "exit_time": "dateEnd", "pnl": "rPnL", "external_id": "id",
               "tags": "tags", "notes": "import_notes"}
    known = instruments or instrument_map()
    def market(value):
        if pd.isna(value) or not str(value).strip():
            return None
        symbol = str(value).split(":")[-1].upper()
        continuous = re.fullmatch(r"([A-Z]+)[12]!?", symbol)
        return continuous[1] if continuous and continuous[1] in known else symbol
    raw["pair"] = raw["pair"].map(market)
    # Explicitly interpret unzoned export timestamps in the user's chosen export timezone.
    for column in ("dateStart", "dateEnd"):
        if column in raw:
            def parse(value):
                if pd.isna(value) or not str(value).strip():
                    return None
                try:
                    stamp = pd.Timestamp(value)
                    if stamp.tzinfo is None:
                        stamp = stamp.tz_localize(timezone, ambiguous="raise", nonexistent="raise")
                    return stamp.tz_convert("UTC").isoformat()
                except (ValueError, TypeError):
                    return "invalid date"
            raw[column] = raw[column].map(parse)
    audit_fields = [c for c in ("entryPrice", "avgClosePrice", "initialSL", "amount", "avgRiskReward") if c in frame]
    raw["import_notes"] = ["FX Replay export · " + "; ".join(f"{c}={row[c]}" for c in audit_fields if pd.notna(row[c]))
                           for row in frame.to_dict("records")]
    if "status" in raw:
        # Partial/unclosed positions do not become closed results by accident.
        bad = ~raw["status"].astype(str).str.lower().isin(["closed", "close"])
    else:
        bad = pd.Series(False, index=raw.index)
    errors = []
    trades = []
    for index, (_, row) in enumerate(raw.iterrows(), start=1):
        if pd.isna(row.get("pair")):
            errors.append({"row": index, "error": "Missing market symbol."})
            continue
        if bad.iloc[index - 1]:
            errors.append({"row": index, "error": "Position is not closed; export it after closing."})
            continue
        if pd.isna(row.get("rPnL")) or pd.isna(row.get("dateEnd")) or not row.get("dateEnd") or row.get("dateEnd") == "invalid date":
            errors.append({"row": index, "error": "Missing realised P&L or readable close time."})
            continue
        found, issues = importers.normalise(pd.DataFrame([row]), mapping, instruments,
                                           source=Source.FXREPLAY, account_id=account_id, dayfirst=False)
        trades.extend(found)
        errors.extend({**issue, "row": index} for issue in issues)
    return trades, errors


def preview_counts(preview, errors):
    statuses = preview["status"] if not preview.empty else pd.Series(dtype=str)
    return {"new": int(statuses.isin(["new", "open"]).sum()),
            "duplicates": int(statuses.eq("duplicate").sum()), "errors": len(errors)}
