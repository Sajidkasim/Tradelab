import json
from datetime import time

import pandas as pd
import streamlit as st

from core.models import Account, Instrument, InstrumentType
from ui import components as c
from ui import state

df_all, df = state.page_setup("Settings")
tz = state.tz()
db = state.get_db()

c.page_header("Settings", "Accounts, instruments, sessions, timezone and connections",
              "sqlite (local file)" if db.is_sqlite else "postgres (hosted)")

tabs = st.tabs(["Accounts", "Instruments", "Sessions & timezone", "Connections", "Data"])

# ---------------------------------------------------------------- accounts
with tabs[0]:
    c.section("Accounts", "Every limit on the Risk pages comes from here. Works for any prop firm or a personal account.")
    accts = db.accounts()
    if accts:
        c.show_df(pd.DataFrame([{"id": a.id, "name": a.name, "starting_balance": a.starting_balance,
                                 "daily_loss_limit": a.daily_loss_limit, "max_trailing_drawdown": a.max_trailing_drawdown,
                                 "max_contracts": a.max_contracts, "risk_per_trade_pct": a.risk_per_trade_pct,
                                 "consistency_target_pct": a.consistency_target_pct, "max_trades_per_day": a.max_trades_per_day}
                                for a in accts]), tz,
                  labels={"starting_balance": "Start $", "daily_loss_limit": "Daily loss limit", "max_trailing_drawdown": "Trailing DD",
                          "risk_per_trade_pct": "Risk %/trade", "consistency_target_pct": "Consistency %", "max_trades_per_day": "Max trades/day"})
    names = ["+ New account"] + [a.name for a in accts]
    which = st.selectbox("Edit", names)
    cur = next((a for a in accts if a.name == which), None)
    presets = {"Custom": None, "Topstep $50K": (50_000, 1_000, 2_000), "Topstep $100K": (100_000, 2_000, 3_000),
               "Topstep $150K": (150_000, 3_000, 4_500)}
    preset = st.selectbox("Preset", list(presets), index=0, help="Fills the three limits; edit anything after")
    pv = presets[preset]
    with st.form("acct_form"):
        a1, a2 = st.columns([2, 1])
        name = a1.text_input("Name", value=cur.name if cur else ("" if not pv else preset))
        start = a2.number_input("Starting balance", value=float(pv[0] if pv else (cur.starting_balance if cur else 50_000)), step=1000.0)
        b1, b2, b3 = st.columns(3)
        dll = b1.number_input("Daily loss limit", value=float(pv[1] if pv else (cur.daily_loss_limit if cur else 1000)), step=100.0)
        mll = b2.number_input("Max trailing drawdown", value=float(pv[2] if pv else (cur.max_trailing_drawdown if cur else 2000)), step=100.0)
        cons = b3.number_input("Consistency target %", value=float(cur.consistency_target_pct if cur else 50.0), step=5.0,
                               help="Best day may be at most this % of total profit (Topstep: 50)")
        d1, d2, d3 = st.columns(3)
        maxc = d1.number_input("Max contracts", value=int(cur.max_contracts if cur else 5), step=1, min_value=1)
        rpt = d2.number_input("Risk per trade %", value=float(cur.risk_per_trade_pct if cur else 0.5), step=0.05, min_value=0.01)
        mtd = d3.number_input("Max trades per day", value=int(cur.max_trades_per_day if cur else 10), step=1, min_value=1)
        if st.form_submit_button("Save account", type="primary"):
            if not name.strip():
                st.error("Name the account.")
            else:
                db.upsert_account(Account(name=name.strip(), starting_balance=start, daily_loss_limit=dll, max_trailing_drawdown=mll,
                                          max_contracts=maxc, risk_per_trade_pct=rpt, consistency_target_pct=cons,
                                          max_trades_per_day=mtd, id=cur.id if cur else None))
                st.success("Saved."); st.rerun()
    if cur and len(accts) > 1 and st.button(f"Delete '{cur.name}'"):
        db.delete_account(cur.id); st.rerun()

# ---------------------------------------------------------------- instruments
with tabs[1]:
    c.section("Instruments", "Multiplier = $ per 1.0 point per contract. Get this wrong and every P&L is wrong — the live import reconciles against the broker to catch it.")
    inst = db.instruments()
    table = pd.DataFrame([{"symbol": i.symbol, "name": i.name, "multiplier": i.multiplier, "tick_size": i.tick_size,
                           "tick_value": i.tick_value, "commission_per_contract": i.commission_per_contract,
                           "instrument_type": i.instrument_type.value, "exchange": i.exchange} for i in inst.values()]).sort_values("symbol")
    edited = st.data_editor(table, use_container_width=True, hide_index=True, num_rows="dynamic", key="inst_editor",
                            column_config={"symbol": st.column_config.TextColumn("Symbol", required=True),
                                           "name": st.column_config.TextColumn("Name"),
                                           "multiplier": st.column_config.NumberColumn("Multiplier $/pt", format="%.4f", required=True),
                                           "tick_size": st.column_config.NumberColumn("Tick size", format="%.5f", required=True),
                                           "tick_value": st.column_config.NumberColumn("Tick value $", format="%.4f", disabled=True),
                                           "commission_per_contract": st.column_config.NumberColumn("Commission RT", format="%.2f"),
                                           "instrument_type": st.column_config.SelectboxColumn("Type", options=[t.value for t in InstrumentType]),
                                           "exchange": st.column_config.TextColumn("Exchange")})
    if st.button("Save instruments", type="primary"):
        items = [Instrument(symbol=str(r.symbol).upper().strip(), name=str(r.name or ""), multiplier=float(r.multiplier),
                            tick_size=float(r.tick_size), instrument_type=InstrumentType(r.instrument_type or "future"),
                            commission_per_contract=float(r.commission_per_contract or 0), exchange=str(r.exchange or ""))
                 for r in edited.itertuples() if str(r.symbol).strip()]
        db.upsert_instruments(items)
        for sym in set(inst) - {i.symbol for i in items}:
            db.delete_instrument(sym)
        st.success(f"Saved {len(items)} instruments."); st.rerun()

# ---------------------------------------------------------------- sessions & tz
with tabs[2]:
    c.section("Timezone", "All times are stored in UTC and shown in this zone")
    zones = ["Europe/London", "America/New_York", "America/Chicago", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "UTC"]
    cur_tz = db.get_setting("tz", state.DEFAULT_TZ)
    new_tz = st.selectbox("Timezone", zones + ([cur_tz] if cur_tz not in zones else []), index=(zones + ([cur_tz] if cur_tz not in zones else [])).index(cur_tz))
    if new_tz != cur_tz:
        db.set_setting("tz", new_tz); st.session_state["tz"] = new_tz; st.rerun()
    c.section("Sessions", "Label each trade by the time of day it was entered (in your timezone). Used by the breakdowns and Model Lab.")
    sessions = db.get_setting("sessions", state.DEFAULT_SESSIONS)
    sed = st.data_editor(pd.DataFrame(sessions), use_container_width=True, hide_index=True, num_rows="dynamic", key="sess_editor",
                         column_config={"label": st.column_config.TextColumn("Label", required=True),
                                        "start": st.column_config.TextColumn("Start (HH:MM)", required=True),
                                        "end": st.column_config.TextColumn("End (HH:MM)", required=True)})
    s1, s2 = st.columns([1, 2])
    if s1.button("Save sessions", type="primary"):
        rows = [r for r in sed.to_dict("records") if str(r.get("label", "")).strip()]
        try:
            for r in rows:
                time.fromisoformat(str(r["start"])); time.fromisoformat(str(r["end"]))
        except ValueError:
            st.error("Times must be HH:MM.")
        else:
            db.set_setting("sessions", rows); st.success("Saved.")
    if s2.button("Re-label every trade's session with these"):
        from core import metrics
        parsed = {r["label"]: (time.fromisoformat(r["start"]), time.fromisoformat(r["end"])) for r in sessions}
        all_df = db.trades_df()
        n = 0
        for r in all_df.itertuples():
            lbl = metrics.session_of(r.entry_time, new_tz, parsed)
            if lbl != r.session:
                db.update_trade(int(r.id), session=lbl); n += 1
        state.bump(); st.success(f"Updated {n} trades.")

# ---------------------------------------------------------------- connections
with tabs[3]:
    c.section("TopstepX / ProjectX", "Credentials are read from the environment — never stored in the app or shown here")
    from core.projectx_api import ProjectXClient, ProjectXError
    try:
        client = ProjectXClient.from_env()
        chk = client.check()
        if chk["ok"]:
            st.success(f"Connected as {chk['user']} · {chk['accounts']} account(s) visible", icon=":material/check:")
        else:
            st.error(f"Credentials found but the connection failed: {chk['error']}")
    except ProjectXError as e:
        st.info(str(e), icon=":material/key_off:")
        st.markdown("""**Locally** — create a file named `.env` next to `app.py`:
```
PROJECTX_USERNAME=your_topstepx_username
PROJECTX_API_KEY=your_key
```
**On Streamlit Community Cloud** — App → Settings → Secrets:
```toml
PROJECTX_USERNAME = "your_topstepx_username"
PROJECTX_API_KEY = "your_key"
TRADELAB_DB_URL = "postgresql://..."
```
The key is generated in TopstepX under Settings → API and needs the ProjectX API subscription.""")
    c.section("AI coach", "Optional. Reads aggregated stats and short trade lines only — never your keys or broker login.")
    from core import coach
    ccfg = coach.get_config()
    if ccfg.get("key"):
        st.success(f"Coach ready · {ccfg['provider']} · {ccfg['model']}", icon=":material/check:")
    else:
        st.info("Not configured. Add ANTHROPIC_API_KEY (or OPENAI_API_KEY) to .env / Streamlit secrets. "
                "Optional: COACH_PROVIDER=anthropic|openai, COACH_MODEL=<model id>. A review costs well under a cent.",
                icon=":material/smart_toy:")
    st.markdown("""```toml
# Streamlit Cloud → Settings → Secrets  (or your local .env)
ANTHROPIC_API_KEY = "sk-ant-..."     # or OPENAI_API_KEY = "sk-..."
COACH_MODEL = "claude-sonnet-5"      # optional; openai default is gpt-5.6-terra
```""")
    c.section("Appearance", "")
    st.markdown('<div class="tl-note">Light and dark are both built in. Switch with the <b>☰ menu → Settings → Theme</b> '
                '(top right); "Use system setting" follows your phone or computer.</div>', unsafe_allow_html=True)
    c.section("Database", "")
    st.code(db.url.split("@")[-1] if "@" in db.url else db.url, language="text")
    st.caption("A hosted app should point TRADELAB_DB_URL at a Postgres database (e.g. Supabase free tier) so your journal survives restarts.")

# ---------------------------------------------------------------- data
with tabs[4]:
    c.section("Data", "")
    counts = db.trades_df().groupby("source").size().to_dict() if db.count_trades() else {}
    c.kpi_row([{"label": k, "value": str(v)} for k, v in counts.items()] or [{"label": "trades", "value": "0"}])
    d1, d2, d3 = st.columns(3)
    if d1.button("Load demo data"):
        from core.demo import seed_demo_trades
        res = db.insert_trades(seed_demo_trades(200, account_id=state.account().id)); state.bump()
        state.filters()["scope"] = "Demo"
        st.success(f"Added {res['inserted']} demo trades."); st.rerun()
    if d2.button("Delete demo data"):
        n = db.delete_trades_by_source("demo"); state.bump(); st.success(f"Deleted {n}."); st.rerun()
    if d3.button("Clear caches"):
        state.bump(); st.cache_data.clear(); st.success("Cleared.")
    st.caption("Backups live under Import → Backup.")
