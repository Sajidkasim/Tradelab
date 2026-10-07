"""The one-line 'Log trade' form, as a fragment so typing never re-renders the page around it."""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import streamlit as st

from core import metrics
from core.models import Direction, Source, Trade
from ui import components as c
from ui import state


@st.fragment
def log_trade_form(key: str = "log") -> None:
    db = state.get_db()
    acct = state.account()
    tz = state.tz()
    inst = db.instruments(); syms = sorted(inst)
    default_sym = st.session_state.get("last_symbol", "MES" if "MES" in syms else syms[0])
    r1 = st.columns([1.1, 0.9, 0.7, 1, 1, 1])
    sym = r1[0].selectbox("Symbol", syms, index=syms.index(default_sym) if default_sym in syms else 0, key=f"{key}_sym")
    ins = inst[sym]
    side = r1[1].selectbox("Side", ["long", "short"], key=f"{key}_side")
    qty = int(r1[2].number_input("Qty", value=1, min_value=1, step=1, key=f"{key}_qty"))
    entry = r1[3].number_input("Entry", value=0.0, step=ins.tick_size, format="%.2f", key=f"{key}_entry")
    exit_ = r1[4].number_input("Exit", value=0.0, step=ins.tick_size, format="%.2f", key=f"{key}_exit", help="Leave 0 for an open trade")
    stop = r1[5].number_input("Stop", value=0.0, step=ins.tick_size, format="%.2f", key=f"{key}_stop")
    r2 = st.columns([1.2, 1, 1, 1, 1])
    setups = [s.name for s in state.setups()]
    model = r2[0].selectbox("Strategy", ["—"] + setups, key=f"{key}_model")
    rules = r2[1].selectbox("Rules", ["not recorded", "followed", "broke"], key=f"{key}_rules")
    now_local = pd.Timestamp.now(tz=tz)
    when_d = r2[2].date_input("Date", value=now_local.date(), key=f"{key}_date")
    when_t = r2[3].time_input("Time", value=now_local.time().replace(second=0, microsecond=0), key=f"{key}_time")
    fees = r2[4].number_input("Fees", value=float(ins.commission_per_contract * qty), step=0.5, key=f"{key}_fees")
    notes = st.text_input("Note", key=f"{key}_note", placeholder="one line — what you saw, why you took it")

    if entry <= 0:
        st.markdown('<div class="tl-hint">Enter a price and the P&L, % and R appear here before you save.</div>', unsafe_allow_html=True)
        return
    when = pd.Timestamp.combine(when_d, when_t).tz_localize(tz).tz_convert("UTC").tz_localize(None).to_pydatetime()
    t = Trade(symbol=sym, direction=Direction(side), qty=qty, entry_time=when, entry_price=entry,
              exit_time=when if exit_ > 0 else None, exit_price=exit_ if exit_ > 0 else None,
              stop_price=stop if stop > 0 else None, multiplier=ins.multiplier, fees=fees,
              instrument_type=ins.instrument_type, source=Source.MANUAL, account_id=acct.id,
              setup_name="" if model == "—" else model,
              rules_followed={"not recorded": None, "followed": True, "broke": False}[rules], notes=notes)
    metrics.compute_trade_fields(t)
    t.session = metrics.session_of(t.entry_time, tz, state.sessions_parsed())
    pct = (t.net_pnl / acct.starting_balance) if (t.net_pnl is not None and acct.starting_balance) else None
    c.kpi_row([
        {"label": "P&L", "value": c.fmt_money(t.net_pnl) if t.net_pnl is not None else "open", "tone": c.tone_for(t.net_pnl)},
        {"label": "% of account", "value": c.fmt_pct(pct, 2) if pct is not None else "—", "tone": c.tone_for(pct)},
        {"label": "R", "value": c.fmt_r(t.r_multiple), "caption": "needs a stop" if t.stop_price is None else f"risk {c.fmt_money(t.initial_risk, sign=False)}"},
        {"label": "Session", "value": t.session or "—"},
    ])
    if st.button("Save trade", type="primary", key=f"{key}_save"):
        t.external_id = f"manual-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
        db.insert_trades([t])
        st.session_state["last_symbol"] = sym
        state.bump()
        st.toast(f"Saved {sym} {side} · {c.fmt_money(t.net_pnl) if t.net_pnl is not None else 'open'}", icon="✅")
        st.rerun(scope="app")
