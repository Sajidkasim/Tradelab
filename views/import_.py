import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import streamlit as st

from core import importers, metrics
from core.fills_to_trades import pair_fills, reconcile_with_broker, legs_df
from core.models import Direction, InstrumentType, Source, Trade
from ui import components as c
from ui import state, access
from services import import_flow
from ui.import_labels import map_export_labels
import hashlib

df_all, df = state.page_setup("Import")
tz = state.tz()
acct = state.account()
db = state.get_db()

if st.button("Back to trades", icon=":material/arrow_back:"):
    st.session_state["trade_action"] = "review"
    st.switch_page("views/journal.py")

c.page_header("Import FX Replay", "Upload your file. Check your trades. Confirm when ready.",
              f"{db.count_trades()} trades stored")

TARGETS = ["symbol", "direction", "qty", "entry_time", "exit_time", "entry_price", "exit_price", "stop_price",
           "target_price", "fees", "multiplier", "setup_name", "timeframe", "session", "trade_name", "pnl", "r_multiple",
           "risk_amount", "notes", "tags", "mistake_tags", "confidence", "rules_followed", "external_id",
           "price", "timestamp"]
SOURCE_LABELS = {"csv": "Live trades (CSV / broker export)", "excel": "Live trades (my Excel journal)",
                 "fxreplay": "FX Replay backtest", "backtest": "Other backtest", "manual": "Live trade (manual)"}


def _preview_and_confirm(trades: list[Trade], errors: list[dict], key: str, extra: pd.DataFrame | None = None) -> None:
    """Shared confirm screen: status per row, errors, then one button that writes."""
    trades = map_export_labels(trades, key)
    existing = db.existing_external_ids()
    pv = importers.preview(trades, existing)
    counts = import_flow.preview_counts(pv, errors)
    n_new, n_dup, n_open = counts["new"], counts["duplicates"], 0
    c.kpi_row([
        {"label": "Will be added", "value": str(n_new + n_open), "tone": "good" if n_new else "",
         "caption": f"{n_open} still open" if n_open else ""},
        {"label": "Duplicates skipped", "value": str(n_dup), "caption": "matched on external id"},
        {"label": "Rows with errors", "value": str(len(errors)), "tone": "bad" if errors else "", "caption": "not imported"},
    ])
    if errors:
        with st.expander(f"{len(errors)} row(s) could not be read"):
            c.show_df(pd.DataFrame(errors), tz)
    if extra is not None and not extra.empty:
        with st.expander("Reconciliation against broker P&L", expanded=bool((extra["difference"].abs() > 0.01).any())):
            c.show_df(extra, tz)
            if (extra["difference"].abs() > 0.01).any():
                st.warning("Our P&L differs from the broker's for at least one symbol. That almost always means an instrument "
                           "multiplier is wrong — check Settings → Instruments before trusting the statistics.", icon=":material/warning:")
            else:
                st.success("Matches the broker to the cent.", icon=":material/check:")
    if not pv.empty:
        result_only = ["pnl-only" in trade.tags for trade in trades]
        pv.loc[result_only, ["entry_price", "exit_price"]] = None
        c.show_df(pv, tz, height=min(400, 38 + 35 * len(pv)))
    if n_new + n_open == 0:
        st.info("Nothing new to import.")
        return
    c.step_label("03", "Confirm import", "The preview above is what will be saved to your account.")
    if st.button(f"Import {n_new + n_open} trade(s)", type="primary", key=f"confirm_{key}"):
        res = db.insert_trades(trades)
        state.bump()
        st.session_state["import_flash"] = f"Imported {res['inserted']} trade(s); {res['skipped']} duplicate(s) skipped."
        st.rerun()


def _mapping_ui(columns: list[str], key: str, default_source: str = "csv") -> tuple[dict, str, str]:
    """Column-mapping editor with saved profiles. Returns (mapping, source, profile name)."""
    saved = db.mappings()
    top = st.columns([2, 2, 1])
    profile = top[0].selectbox("Saved mapping", ["(auto-detect)"] + sorted(saved), key=f"prof_{key}")
    source = top[1].selectbox("These trades are…", list(SOURCE_LABELS), index=list(SOURCE_LABELS).index(default_source),
                              format_func=lambda k: SOURCE_LABELS[k], key=f"src_{key}",
                              help="Backtests are kept apart from live trades in every statistic.")
    base = importers.auto_map(columns) if profile == "(auto-detect)" else {**{t: None for t in TARGETS}, **saved[profile].get("map", saved[profile])}
    with st.expander("Column mapping", expanded=False):
        st.caption("Only change this if the preview is missing something. Left: what PrimusLab needs. Right: the column in your file. Leave blank for anything you don't have.")
        cols = st.columns(3)
        mapping = {}
        options = ["—"] + list(columns)
        for i, t in enumerate(TARGETS):
            cur = base.get(t)
            mapping[t] = cols[i % 3].selectbox(t, options, index=options.index(cur) if cur in options else 0, key=f"map_{key}_{t}")
            if mapping[t] == "—":
                mapping[t] = None
        n1, n2 = st.columns([2, 1])
        name = n1.text_input("Save this mapping as", value=profile if profile != "(auto-detect)" else "", key=f"name_{key}",
                             placeholder="e.g. TopstepX export, FX Replay")
        if n2.button("Save mapping", key=f"save_{key}") and name.strip():
            db.save_mapping(name.strip(), {"map": mapping, "source": source}); state.bump(); st.success("Saved."); st.rerun()
    return mapping, source, profile


def _run_mapped_import(raw: pd.DataFrame, key: str, default_source: str = "csv") -> None:
    st.caption(f"{len(raw)} rows · {len(raw.columns)} columns")
    with st.expander("See original file"):
        st.dataframe(raw.head(8), use_container_width=True, hide_index=True)
    mapping, source, _ = _mapping_ui(list(raw.columns), key, default_source)
    shape = importers.detect_shape(mapping)
    dayfirst = st.toggle("Dates are day-first (UK style 31/12/2026)", value=True, key=f"df_{key}")
    if not mapping.get("symbol") or not mapping.get("direction") or not (mapping.get("entry_time") or mapping.get("timestamp")):
        st.info("Open Column mapping and choose the market, buy/sell and entry date columns to continue.")
        return
    if shape == "fills":
        st.info("This file looks like individual fills (one execution per row). They'll be paired FIFO into round-turn trades.",
                icon=":material/info:")
        fills = pd.DataFrame({
            "fill_id": raw[mapping["external_id"]] if mapping.get("external_id") else range(len(raw)),
            "symbol": raw[mapping["symbol"]].astype(str).map(lambda s: importers.root_symbol(s) if hasattr(importers, "root_symbol") else s),
            "timestamp": pd.to_datetime(raw[mapping.get("timestamp") or mapping.get("entry_time")], dayfirst=dayfirst, utc=True),
            "side": raw[mapping["direction"]], "size": pd.to_numeric(raw[mapping["qty"]], errors="coerce"),
            "price": pd.to_numeric(raw[mapping.get("price") or mapping.get("entry_price")], errors="coerce"),
            "fees": pd.to_numeric(raw[mapping["fees"]], errors="coerce").fillna(0) if mapping.get("fees") else 0.0,
        })
        from core.fills_to_trades import root_symbol
        fills["symbol"] = fills["symbol"].map(root_symbol)
        mult = {s: i.multiplier for s, i in db.instruments().items()}
        trades, legs = pair_fills(fills, mult)
        for t in trades:
            t.source = Source(source); t.account_id = acct.id
        _preview_and_confirm(trades, [], key)
        with st.expander("FIFO legs (audit)"):
            c.show_df(legs_df(legs), tz)
    else:
        trades, errors = importers.normalise(raw, mapping, db.instruments(), source=Source(source), account_id=acct.id, dayfirst=dayfirst)
        _preview_and_confirm(trades, errors, key)


if "import_flash" in st.session_state:
    st.success(st.session_state["import_flash"])
    if st.button("Review & tag trades", type="primary"):
        state.filters().update(scope="All", account_id=None, preset="All time", start=None, end=None, symbols=[], setups=[], direction="Both", sessions=[], tags=[])
        st.session_state["edge_pending"] = True
        st.session_state["trade_action"] = "review"
        st.switch_page("views/journal.py")

c.step_label("01", "Upload your trades", "FX Replay, CSV, Excel or JSON — one place for your files.")
accounts = state.accounts()
account_id = st.selectbox("Save into account", [a.id for a in accounts],
                          index=[a.id for a in accounts].index(acct.id),
                          format_func=lambda v: next(a.name for a in accounts if a.id == v))
acct = next(a for a in accounts if a.id == account_id)
up = st.file_uploader("Choose a trade export", type=["csv", "tsv", "txt", "xlsx", "xlsm", "json"], key="trade_upload",
                      on_change=lambda: st.session_state.pop("import_flash", None))
if up is not None:
    content = up.getvalue()
    key = hashlib.sha256(content).hexdigest()[:12]
    if st.session_state.get("import_file") != key:
        st.session_state.pop("import_flash", None)
        st.session_state["import_file"] = key
    try:
        raw = import_flow.read_upload(content, up.name)
        c.step_label("02", "Check the preview", "Nothing is saved until you confirm.")
        if import_flow.is_fx_analytics(raw):
            st.caption("Recognised FX Replay Analytics · saved to Backtesting")
            with st.expander("File details & time zone"):
                export_tz = st.selectbox("Time zone used in this export", ["UTC", "America/New_York", "Europe/London"], key=f"fx_tz_{key}")
                st.caption("Check the entry times below. Change this if FX Replay exported times in another zone.")
                st.dataframe(raw.head(8), hide_index=True, use_container_width=True)
            st.caption("Your realised P&L is kept exactly. Original prices and size stay in trade notes. Planned targets are not treated as realised R.")
            parsed, errors = import_flow.fx_analytics(raw, db.instruments(), acct.id, export_tz)
            _preview_and_confirm(parsed, errors, key)
        else:
            _run_mapped_import(raw, key, "fxreplay" if "replay" in up.name.lower() else "csv")
    except (ValueError, TypeError, KeyError, UnicodeError, pd.errors.ParserError) as exc:
        st.error(f"We couldn't read this export: {exc}")
        st.caption("Try exporting a fresh CSV with its column headings included.")
else:
    c.note("<b>Using FX Replay?</b> Export your trade history from Analytics, then upload the CSV here.")

with st.expander("More options"):
    from core.registry import IMPORT_SOURCES, LOAD_ERRORS, load_extensions
    load_extensions("extensions")
    methods = ["Choose another method", "Paste rows", "Backup and restore", "Add a trade manually"]
    if access.can_use_broker():
        methods.append("Connect TopstepX")
    if access.is_local():
        methods.append("Inbox folder")
    methods.extend(IMPORT_SOURCES)
    method = st.selectbox("Import method", methods, key="other_import_method")
    if method == "Add a trade manually":
        if st.button("Open Add Trade"):
            st.session_state["trade_action"] = "add"
            st.switch_page("views/journal.py")
    if method == "Paste rows":
        c.section("Paste rows", "Copy cells from a spreadsheet (with the header row) and paste")
        txt = st.text_area("Paste here", height=160, key="clip_txt", placeholder="Date\tSymbol\tDirection\tEntry Price\tExit Price\n...")
        if txt.strip():
            try:
                raw = importers.read_clipboard_text(txt)
                _run_mapped_import(raw, "clip")
            except Exception as e:  # noqa: BLE001
                st.error(f"Could not parse that: {e}")

    if method == "Connect TopstepX" and access.can_use_broker():
        c.section("TopstepX live pull", "Fills are fetched, paired FIFO into trades, and reconciled against the broker's own P&L")
        from core.projectx_api import ProjectXClient, ProjectXError
        try:
            client = ProjectXClient.from_env()
            have_key = True
        except ProjectXError as e:
            have_key = False
            st.warning(f"{e}. Locally: put them in a .env file. On Streamlit Cloud: add them under Settings → Secrets.",
                       icon=":material/key_off:")
        if have_key:
            chk = client.check()
            if not chk["ok"]:
                st.error(f"Could not connect: {chk['error']}")
            else:
                st.success(f"Connected as {chk['user']} · {chk['accounts']} account(s)", icon=":material/check:")
                accts = client.accounts()
                a1, a2, a3 = st.columns([2, 1, 1])
                acc_row = a1.selectbox("Broker account", accts.to_dict("records"),
                                       format_func=lambda r: f"{r['name']} · balance {r.get('balance', 0):,.2f}")
                start = a2.date_input("From", value=(pd.Timestamp.now(tz=tz) - timedelta(days=30)).date())
                end = a3.date_input("To", value=pd.Timestamp.now(tz=tz).date())
                if st.button("Fetch fills", type="primary"):
                    with st.spinner("Pulling fills…"):
                        fills = client.fills(int(acc_row["id"]), datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
                                             datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc))
                    st.session_state["api_fills"] = fills
                fills = st.session_state.get("api_fills")
                if fills is not None:
                    if fills.empty:
                        st.info("No fills in that range.")
                    else:
                        mult = {s: i.multiplier for s, i in db.instruments().items()}
                        unknown = sorted(set(fills["symbol"]) - set(mult))
                        if unknown:
                            st.warning(f"Unknown instrument(s) {', '.join(unknown)} — add them in Settings first or their P&L will use multiplier 1.")
                        trades, legs = pair_fills(fills, mult)
                        for t in trades:
                            t.account_id = acct.id
                        rec = reconcile_with_broker(fills, trades)
                        st.caption(f"{len(fills)} fills → {len(trades)} trades")
                        _preview_and_confirm(trades, [], "api", extra=rec)
                        with st.expander("FIFO legs (audit)"):
                            c.show_df(legs_df(legs), tz)

    if method == "Inbox folder" and access.is_local():
        c.section("Inbox folder", "Drop CSVs into data/inbox on the machine running the app; they appear here")
        inbox = Path("data/inbox"); inbox.mkdir(parents=True, exist_ok=True)
        files = sorted(inbox.glob("*.csv")) + sorted(inbox.glob("*.xlsx"))
        done = set(state.setting("inbox_done", []))
        pending = [f for f in files if f.name not in done]
        if not pending:
            c.empty_state("Inbox is empty", f"{len(done)} file(s) already imported.")
        else:
            pick = st.selectbox("File", pending, format_func=lambda p: p.name)
            raw = importers.read_any(str(pick))
            _run_mapped_import(raw, f"inbox_{pick.stem}")
            if st.button("Mark as done", key="inbox_done"):
                db.set_setting("inbox_done", sorted(done | {pick.name})); state.bump(); st.rerun()

    if method == "Backup and restore":
        c.section("Backup and restore", "Your journal data in one JSON file. Save regular copies outside the website.")
        st.caption("This file includes your trades, labels, notes and settings. Chart images and team invitations need separate backups.")
        b1, b2 = st.columns(2)
        with b1:
            st.download_button("Download backup (.json)", db.export_json().encode(),
                               f"primuslab_backup_{datetime.now():%Y%m%d}.json", "application/json", type="primary", use_container_width=True)
        with b2:
            up = st.file_uploader("Restore from backup", type=["json"], key="restore_up")
            replace = st.checkbox("Replace this workspace with the backup",
                                  help="Use this for a clean recovery. Merging can duplicate manually added trades that have no external ID.")
            if up is not None and st.button("Restore", type="secondary"):
                try:
                    counts = db.import_json(up.read().decode("utf-8"), replace=replace)
                except (ValueError, UnicodeError) as exc:
                    st.error(f"Restore failed: {exc}")
                else:
                    state.bump()
                    st.success(f"Restored: {counts}"); st.rerun()
    if method in IMPORT_SOURCES:
        src = IMPORT_SOURCES[method]
        upload = st.file_uploader(f"{method} file", type=src.file_types, key=f"ext_{method}")
        if upload is not None:
            try:
                _run_mapped_import(src.read_fn(upload), f"ext_{method}", src.source)
            except Exception:
                st.error("This import extension could not read the file. Try a CSV export instead.")
