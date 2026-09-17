import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import streamlit as st

from core import importers, metrics
from core.fills_to_trades import pair_fills, reconcile_with_broker, legs_df
from core.models import Direction, InstrumentType, Source, Trade
from ui import components as c
from ui import state

df_all, df = state.page_setup("Import")
tz = state.tz()
acct = state.account()
db = state.get_db()

c.page_header("Import", "Every way trades get in. Nothing is written until you confirm.",
              f"{db.count_trades()} trades stored")

TARGETS = ["symbol", "direction", "qty", "entry_time", "exit_time", "entry_price", "exit_price", "stop_price",
           "target_price", "fees", "multiplier", "setup_name", "timeframe", "session", "trade_name", "pnl", "r_multiple",
           "risk_amount", "notes", "tags", "mistake_tags", "confidence", "rules_followed", "external_id",
           "price", "timestamp"]
SOURCE_LABELS = {"csv": "Live trades (CSV / broker export)", "excel": "Live trades (my Excel journal)",
                 "fxreplay": "FX Replay backtest", "backtest": "Other backtest", "manual": "Live trade (manual)"}


def _preview_and_confirm(trades: list[Trade], errors: list[dict], key: str, extra: pd.DataFrame | None = None) -> None:
    """Shared confirm screen: status per row, errors, then one button that writes."""
    existing = db.existing_external_ids()
    pv = importers.preview(trades, existing)
    n_new = int((pv["status"] == "new").sum()) if not pv.empty else 0
    n_dup = int((pv["status"] == "duplicate").sum()) if not pv.empty else 0
    n_open = int((pv["status"] == "open").sum()) if not pv.empty else 0
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
        c.show_df(pv, tz, height=min(400, 38 + 35 * len(pv)))
    if n_new + n_open == 0:
        st.info("Nothing new to import.")
        return
    if st.button(f"Import {n_new + n_open} trade(s)", type="primary", key=f"confirm_{key}"):
        res = db.insert_trades(trades)
        state.bump()
        st.success(f"Imported {res['inserted']} trade(s); {res['skipped']} duplicate(s) skipped.")
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
    with st.expander("Column mapping", expanded=(profile == "(auto-detect)")):
        st.caption("Left: what PrimusLab needs. Right: the column in your file. Leave blank for anything you don't have.")
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
            db.save_mapping(name.strip(), {"map": mapping, "source": source}); st.success("Saved."); st.rerun()
    return mapping, source, profile


def _run_mapped_import(raw: pd.DataFrame, key: str, default_source: str = "csv") -> None:
    st.caption(f"{len(raw)} rows · {len(raw.columns)} columns")
    st.dataframe(raw.head(8), use_container_width=True, hide_index=True, height=min(320, 38 + 35 * min(len(raw), 8)))
    mapping, source, _ = _mapping_ui(list(raw.columns), key, default_source)
    shape = importers.detect_shape(mapping)
    dayfirst = st.toggle("Dates are day-first (UK style 31/12/2026)", value=True, key=f"df_{key}")
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


from core.registry import IMPORT_SOURCES, LOAD_ERRORS, load_extensions
load_extensions("extensions")
extra = list(IMPORT_SOURCES)
tabs = st.tabs(["Manual", "CSV / Excel", "FX Replay", "Clipboard", "JSON", "Live API", "Inbox", "Backup", *extra])
if LOAD_ERRORS:
    st.warning("Some extensions failed to load: " + "; ".join(f"{k}: {v}" for k, v in LOAD_ERRORS.items()), icon=":material/extension_off:")

# ---------------------------------------------------------------- manual
with tabs[0]:
    c.section("Log a trade", "P&L and R update as you type")
    inst = db.instruments(); syms = sorted(inst)
    quick = st.toggle("Quick add (essentials only)", value=False)
    m1, m2, m3, m4 = st.columns(4)
    sym = m1.selectbox("Symbol", syms, index=syms.index("MES") if "MES" in syms else 0, key="man_sym")
    direction = m2.selectbox("Direction", ["long", "short"], key="man_dir")
    qty = m3.number_input("Contracts", value=1, min_value=1, step=1, key="man_qty")
    ins = inst[sym]
    fees = m4.number_input("Fees (total)", value=float(ins.commission_per_contract * qty), step=0.5, key="man_fees")
    p1, p2, p3, p4 = st.columns(4)
    entry = p1.number_input("Entry price", value=0.0, step=ins.tick_size, format="%.2f", key="man_entry")
    exit_ = p2.number_input("Exit price (blank = open)", value=0.0, step=ins.tick_size, format="%.2f", key="man_exit")
    stop = p3.number_input("Stop", value=0.0, step=ins.tick_size, format="%.2f", key="man_stop")
    target = p4.number_input("Target", value=0.0, step=ins.tick_size, format="%.2f", key="man_target")
    t1, t2, t3, t4 = st.columns(4)
    now_local = pd.Timestamp.now(tz=tz)
    e_date = t1.date_input("Entry date", value=now_local.date(), key="man_edate")
    e_time = t2.time_input("Entry time", value=now_local.time().replace(second=0, microsecond=0), key="man_etime")
    x_date = t3.date_input("Exit date", value=now_local.date(), key="man_xdate")
    x_time = t4.time_input("Exit time", value=now_local.time().replace(second=0, microsecond=0), key="man_xtime")
    setups = [s.name for s in db.setups()]
    s1, s2, s3 = st.columns([2, 1, 1])
    setup = s1.selectbox("Model / setup", ["—"] + setups + ["(type below)"], key="man_setup")
    setup_free = s1.text_input("…or a new model name", key="man_setup_free") if setup == "(type below)" else ""
    rules = s2.selectbox("Rules followed", ["not recorded", "yes", "no"], key="man_rules")
    conf = s3.selectbox("Confidence", [None, 1, 2, 3, 4, 5], format_func=lambda v: "—" if v is None else f"{v}/5", key="man_conf")
    mistakes, tags, notes = [], "", ""
    if not quick:
        mistakes = st.multiselect("Mistakes", ["chased entry", "moved stop", "oversized", "no setup", "revenge trade", "early exit",
                                               "late entry", "held past target", "ignored session rule", "news"], key="man_mist")
        tags = st.text_input("Tags (comma separated)", key="man_tags")
        notes = st.text_area("Notes", height=90, key="man_notes")

    def _dt(d, t):
        return pd.Timestamp.combine(d, t).tz_localize(tz).tz_convert("UTC").tz_localize(None).to_pydatetime()

    if entry > 0:
        tmp = Trade(symbol=sym, direction=Direction(direction), qty=qty, entry_time=_dt(e_date, e_time), entry_price=entry,
                    exit_time=_dt(x_date, x_time) if exit_ > 0 else None, exit_price=exit_ if exit_ > 0 else None,
                    stop_price=stop if stop > 0 else None, target_price=target if target > 0 else None,
                    multiplier=ins.multiplier, fees=fees, instrument_type=ins.instrument_type, source=Source.MANUAL,
                    account_id=acct.id, setup_name=(setup_free or ("" if setup in ("—", "(type below)") else setup)),
                    rules_followed={"not recorded": None, "yes": True, "no": False}[rules], mistake_tags=mistakes,
                    tags=[x.strip() for x in tags.split(",") if x.strip()], confidence=conf, notes=notes)
        metrics.compute_trade_fields(tmp)
        tmp.session = metrics.session_of(tmp.entry_time, tz, db.get_setting("sessions_parsed") or None)
        c.kpi_row([
            {"label": "Net P&L", "value": c.fmt_money(tmp.net_pnl) if tmp.net_pnl is not None else "open", "tone": c.tone_for(tmp.net_pnl)},
            {"label": "R multiple", "value": c.fmt_r(tmp.r_multiple)},
            {"label": "Risk", "value": c.fmt_money(tmp.initial_risk, sign=False) if tmp.initial_risk else "no stop"},
            {"label": "Session", "value": tmp.session},
        ])
        if st.button("Save trade", type="primary", key="man_save"):
            tmp.external_id = f"manual-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
            db.insert_trades([tmp]); state.bump(); st.success("Saved."); st.rerun()
    else:
        st.caption("Enter a price to see the live P&L preview.")

# ---------------------------------------------------------------- csv / excel
with tabs[1]:
    c.section("CSV or Excel", "TopstepX / Tradovate / NinjaTrader exports, your own journal, anything with a header row")
    up = st.file_uploader("Drop a .csv, .tsv or .xlsx", type=["csv", "tsv", "txt", "xlsx", "xlsm"], key="csv_up")
    if up is not None:
        try:
            raw = importers.read_any(up)
        except Exception as e:  # noqa: BLE001
            st.error(f"Could not read the file: {e}"); raw = None
        if raw is not None and not raw.empty:
            _run_mapped_import(raw, "csv", "excel" if up.name.lower().endswith(("xlsx", "xlsm")) else "csv")

# ---------------------------------------------------------------- fx replay
with tabs[2]:
    c.section("FX Replay", "Export from FX Replay → Analytics → Export CSV, then drop it here")
    st.markdown('<div class="tl-note">FX Replay trades are imported as <b>backtests</b>. They show up under the Backtests data '
                'scope and never mix into your live win rate. The first time, check the column mapping and save it as '
                '"FX Replay" — after that it\'s one click.</div>', unsafe_allow_html=True)
    up = st.file_uploader("FX Replay CSV", type=["csv", "xlsx"], key="fx_up")
    if up is not None:
        raw = importers.read_any(up)
        if not raw.empty:
            _run_mapped_import(raw, "fx", "fxreplay")

# ---------------------------------------------------------------- clipboard
with tabs[3]:
    c.section("Paste rows", "Copy cells from a spreadsheet (with the header row) and paste")
    txt = st.text_area("Paste here", height=160, key="clip_txt", placeholder="Date\tSymbol\tDirection\tEntry Price\tExit Price\n...")
    if txt.strip():
        try:
            raw = importers.read_clipboard_text(txt)
            _run_mapped_import(raw, "clip")
        except Exception as e:  # noqa: BLE001
            st.error(f"Could not parse that: {e}")

# ---------------------------------------------------------------- json
with tabs[4]:
    c.section("JSON", "A list of trade objects, or a PrimusLab export")
    up = st.file_uploader("JSON file", type=["json"], key="json_up")
    if up is not None:
        data = json.load(up)
        if isinstance(data, dict) and "trades" in data and "accounts" in data:
            st.info("This is a PrimusLab backup — use the Backup tab to restore it.")
        else:
            raw = pd.DataFrame(data if isinstance(data, list) else data.get("trades", []))
            if not raw.empty:
                _run_mapped_import(raw, "json")

# ---------------------------------------------------------------- live api
with tabs[5]:
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

# ---------------------------------------------------------------- inbox
with tabs[6]:
    c.section("Inbox folder", "Drop CSVs into data/inbox on the machine running the app; they appear here")
    inbox = Path("data/inbox"); inbox.mkdir(parents=True, exist_ok=True)
    files = sorted(inbox.glob("*.csv")) + sorted(inbox.glob("*.xlsx"))
    done = set(db.get_setting("inbox_done", []))
    pending = [f for f in files if f.name not in done]
    if not pending:
        c.empty_state("Inbox is empty", f"{len(done)} file(s) already imported.")
    else:
        pick = st.selectbox("File", pending, format_func=lambda p: p.name)
        raw = importers.read_any(str(pick))
        _run_mapped_import(raw, f"inbox_{pick.stem}")
        if st.button("Mark as done", key="inbox_done"):
            db.set_setting("inbox_done", sorted(done | {pick.name})); st.rerun()

# ---------------------------------------------------------------- backup
with tabs[7]:
    c.section("Backup and restore", "A full JSON export of everything except cached bars. Do this often if you're on a free host.")
    b1, b2 = st.columns(2)
    with b1:
        st.download_button("Download backup (.json)", db.export_json().encode(),
                           f"primuslab_backup_{datetime.now():%Y%m%d}.json", "application/json", type="primary", use_container_width=True)
    with b2:
        up = st.file_uploader("Restore from backup", type=["json"], key="restore_up")
        replace = st.checkbox("Replace everything (otherwise merge, skipping duplicates)")
        if up is not None and st.button("Restore", type="secondary"):
            counts = db.import_json(up.read().decode(), replace=replace); state.bump()
            st.success(f"Restored: {counts}"); st.rerun()
    c.section("Danger zone", "")
    d1, d2 = st.columns(2)
    if d1.button("Delete all demo trades"):
        n = db.delete_trades_by_source("demo"); state.bump(); st.success(f"Deleted {n} demo trades."); st.rerun()
    if d2.button("Delete all backtest imports (fxreplay + backtest)"):
        n = db.delete_trades_by_source("fxreplay") + db.delete_trades_by_source("backtest"); state.bump()
        st.success(f"Deleted {n} trades."); st.rerun()


# ---------------------------------------------------------------- registered extension sources
for i, name in enumerate(extra):
    src = IMPORT_SOURCES[name]
    with tabs[8 + i]:
        c.section(name, src.help or "Registered by an extension in extensions/")
        up = st.file_uploader(f"{name} file", type=src.file_types, key=f"ext_{name}")
        if up is not None:
            try:
                raw = src.read_fn(up)
            except Exception as e:  # noqa: BLE001
                st.error(f"{name} reader failed: {e}"); raw = None
            if raw is not None and not raw.empty:
                _run_mapped_import(raw, f"ext_{name}", src.source)
