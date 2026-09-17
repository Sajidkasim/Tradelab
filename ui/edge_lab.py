"""Focused research controls and rapid logging. All trade maths stays in core."""
from __future__ import annotations

from datetime import time
from pathlib import Path
from uuid import uuid4

import pandas as pd
import streamlit as st

from core import edge
from core.models import Source
from ui import components as c, state

SCOPE_LABELS = {"Backtests": "Backtesting", "Live": "Forward / live", "Demo": "Demo samples"}


def research_sidebar(df_all):
    f = state.filters()
    scopes = list(SCOPE_LABELS)
    if f["scope"] not in scopes:
        f["scope"] = "Backtests"
    st.caption("YOUR RESEARCH SAMPLE")
    f["scope"] = st.radio("Data source", scopes, index=scopes.index(f["scope"]),
                           format_func=SCOPE_LABELS.get, key="edge_scope")
    st.caption("Backtests and forward trades are always separate here.")
    accts = state.get_db().accounts()
    names = {a.id: a.name for a in accts}
    opts = [None] + list(names)
    f["account_id"] = st.selectbox("Account", opts,
                                    index=opts.index(f["account_id"]) if f["account_id"] in opts else 0,
                                    format_func=lambda v: names.get(v, "All accounts"), key="edge_account")
    f["preset"] = st.selectbox("Research period", state.PRESETS, index=state.PRESETS.index(f["preset"]), key="edge_period") or "All time"
    if f["preset"] == "Custom":
        f["start"] = st.date_input("From", value=f["start"] or state.local_today(), key="edge_start")
        f["end"] = st.date_input("To", value=f["end"] or state.local_today(), key="edge_end")
    else:
        f["start"], f["end"] = state._preset_range(f["preset"], state.local_today())
    # This page exposes these controls in its main canvas, never as hidden filters.
    f.update(symbols=[], setups=[], direction="Both", sessions=[], tags=[])
    st.divider()
    c.note("<b>Your starting point</b><br>Buy or sell → key level → confirmation → result.")
    st.caption("New York windows use New York local time, including daylight saving.")


def playbook():
    """The user's editable strategy and key-level lists (defaults until they change them)."""
    return edge.playbook(state.get_db().get_setting(edge.PLAYBOOK_KEY))


def label_fields(key, defaults=None, lists=None):
    defaults = defaults or edge.read_labels([])
    lists = lists or playbook()
    cols = st.columns([1.6, 1, 1])
    def pick(col, title, values, field, help=None):
        options = [edge.UNKNOWN] + list(values)
        current = defaults.get(field, edge.UNKNOWN)
        if current not in options:
            options.append(current)   # a label removed from the list stays on trades that already use it
        return col.selectbox(title, options, index=options.index(current), key=f"{key}_{field}", help=help)
    level = pick(cols[0], "Key level / PDA", lists["levels"], "level")
    timeframe = pick(cols[1], "Level timeframe", edge.TIMEFRAMES, "timeframe", help="The chart the key level was drawn on.")
    entry_timeframe = pick(cols[2], "Entry timeframe", edge.TIMEFRAMES, "entry_timeframe", help="The chart the entry was taken on.")
    st.caption("Entry confirmations · check everything you actually saw")
    boxes = st.columns(4)
    confirmations = [value for i, value in enumerate(edge.CONFIRMATIONS)
                     if boxes[i % 4].checkbox(value, value=value in defaults.get("confirmations", []), key=f"{key}_confirm_{value}")]
    cols = st.columns(2)
    condition = pick(cols[0], "Market condition", edge.CONDITIONS, "condition")
    news = pick(cols[1], "News that day", edge.NEWS, "news")
    return dict(level=level, timeframe=timeframe, entry_timeframe=entry_timeframe,
                confirmations=confirmations, condition=condition, news=news)


def playbook_editor():
    """Add, rename or remove strategies and key levels. Saved trades keep the labels they were given."""
    db = state.get_db()
    lists = playbook()
    epoch = st.session_state.get("edge_playbook_epoch", 0)
    c.section("Strategies & key levels", "These lists are offered when you log, review or filter a trade. "
              "Add a row to create one, clear a row to remove it. Trades keep the labels they already have.")
    if st.session_state.pop("edge_playbook_saved", False):
        st.success("Lists saved. They apply everywhere a strategy or key level is chosen.")
    cols = st.columns(2)
    edited = {}
    for col, key, title in zip(cols, ("strategies", "levels"), ("Strategy", "Key level / PDA")):
        with col:
            edited[key] = st.data_editor(pd.DataFrame({title: lists[key]}, dtype=str), hide_index=True, num_rows="dynamic",
                                         use_container_width=True, key=f"edge_playbook_{key}_{epoch}",
                                         column_config={title: st.column_config.TextColumn(title, required=True)})
    if st.button("Save lists", type="primary", key="edge_playbook_save"):
        db.set_setting(edge.PLAYBOOK_KEY, edge.playbook({key: frame.iloc[:, 0].tolist() for key, frame in edited.items()}))
        state.bump()
        st.session_state["edge_playbook_epoch"] = epoch + 1
        st.session_state["edge_playbook_saved"] = True
        st.rerun()


@st.fragment
def quick_log():
    """The Add Trade form. A fragment, so committing a field re-renders only the form, never the page around it.

    The live checks (entry method, exit-time toggle, the R preview and the save button's enabled state) need a
    rerun per field, which is why this is a fragment rather than an st.form. Saving calls st.rerun() with the
    default app scope so the flash message and sample count outside the form refresh.
    """
    db = state.get_db()
    accts = db.accounts()
    epoch = st.session_state.get("edge_log_epoch", 0)
    key = f"edge_log_{epoch}"
    remembered = st.session_state.get("edge_last_entry", {})
    st.caption("Save & log next keeps the setup, account and entry method. Result fields start fresh.")
    with st.container(border=True, key="edge_log_panel"):
        c.step_label("01", "The idea", "Choose a sample and a strategy")
        row = st.columns([1, 1, 1.5])
        default_source = remembered.get("source", "manual" if state.filters()["scope"] == "Live" else "backtest")
        source = row[0].selectbox("Save to", ["backtest", "manual"],
                                  index=1 if default_source == "manual" else 0,
                                  format_func=lambda v: "Backtesting" if v == "backtest" else "Forward / live", key=f"{key}_source")
        account_id = row[1].selectbox("Trading account", [a.id for a in accts],
                                      index=[a.id for a in accts].index(remembered.get("account_id")) if remembered.get("account_id") in [a.id for a in accts] else [a.id for a in accts].index(state.account().id),
                                      format_func=lambda v: next(a.name for a in accts if a.id == v), key=f"{key}_account")
        lists = playbook()
        strategies = sorted(set(lists["strategies"] + [s.name for s in db.setups()] +
                                [s for s in state.trades().get("setup_name", []) if s] +
                                [remembered.get("strategy") or ""]) - {""})
        preferred = remembered.get("strategy") or (lists["strategies"][0] if lists["strategies"] else None)
        strategy = row[2].selectbox("Strategy", strategies,
                                    index=strategies.index(preferred) if preferred in strategies else None,
                                    accept_new_options=True, key=f"{key}_strategy", placeholder="Pick or type a strategy",
                                    help="Select a strategy or type your own. Edit the list under Edit strategies & key levels.")
        direction = st.radio("Direction", ["long", "short"], index=1 if remembered.get("direction") == "short" else 0,
                             horizontal=True, format_func=lambda v: "Buy / Long" if v == "long" else "Sell / Short", key=f"{key}_side")
        c.step_label("02", "The evidence", "Location first. Confirmation second.")
        labels = label_fields(key, remembered.get("labels"), lists)
        c.step_label("03", "The result", "A win, loss or break-even belongs in the sample")
        entry_mode = st.radio("Entry method", ["Quick result", "Entry / stop / exit"], horizontal=True,
                              index=1 if remembered.get("method") == "Entry / stop / exit" else 0,
                              key=f"{key}_method", help="Quick result records net dollars and original dollar risk. Full prices calculate them for you.")
        instruments = db.instruments()
        syms = sorted(instruments, key=lambda x: (x not in ("MNQ", "NQ", "MES", "ES"), x))
        row = st.columns(4)
        sym = row[0].selectbox("Market", syms, index=syms.index(remembered.get("symbol", "MNQ")) if remembered.get("symbol", "MNQ") in syms else 0, key=f"{key}_symbol")
        if sym not in instruments:
            st.info("Choose a market to continue.")
            return
        day = row[1].date_input("Trade date", value=remembered.get("day", state.local_today()), key=f"{key}_date")
        clock = row[2].time_input("Entry time · New York", value=time(9, 30), key=f"{key}_time")
        status = row[3].selectbox("Rules followed", ["Not recorded", "Yes", "No"], key=f"{key}_rules")
        payload = {}
        if entry_mode == "Quick result":
            row = st.columns(2)
            payload["net_pnl"] = row[0].number_input("Net result ($)", value=None, step=10.0, key=f"{key}_pnl",
                                                    placeholder="e.g. 500 or -250", help="After all fees. Enter 0 for break-even.")
            payload["risk_amount"] = row[1].number_input("Original risk ($)", min_value=0.01, value=None,
                                                        step=25.0, key=f"{key}_risk", placeholder="Actual risk, e.g. 250")
            st.caption("Use the risk planned at entry, before moving your stop. R = net result divided by that risk.")
        else:
            row = st.columns(4)
            for col, name, label in zip(row[:3], ["entry_price", "stop_price", "exit_price"], ["Entry price", "Original stop", "Exit price"]):
                payload[name] = col.number_input(label, min_value=0.0, value=None, step=instruments[sym].tick_size,
                                                format="%.2f", key=f"{key}_{name}")
            payload["qty"] = row[3].number_input("Contracts", min_value=1, value=1, step=1, key=f"{key}_qty")
        with st.expander("Timing, notes & screenshot"):
            end_day, end_clock = day, clock
            if st.checkbox("Record a separate exit time", key=f"{key}_has_exit_time"):
                row = st.columns(2)
                end_day = row[0].date_input("Exit date", value=day, key=f"{key}_exit_date")
                end_clock = row[1].time_input("Exit time · New York", value=clock, key=f"{key}_exit_time")
            else:
                st.caption("Exit is recorded at entry time unless you add it here. Hold time will be zero.")
            if entry_mode != "Quick result":
                row = st.columns(2)
                payload["fees"] = row[0].number_input("Total fees ($)", min_value=0.0, value=0.0, step=0.5, key=f"{key}_fees")
                payload["target_price"] = row[1].number_input("Planned target (optional)", min_value=0.0, value=0.0,
                                                             step=instruments[sym].tick_size, key=f"{key}_target")
            notes = st.text_area("One useful observation", key=f"{key}_notes", placeholder="What made this trade worth taking?")
            screenshot = st.file_uploader("Chart screenshot", type=["png", "jpg", "jpeg"], key=f"{key}_shot")
        ready = payload.get("net_pnl") is not None if entry_mode == "Quick result" else all(payload.get(k) for k in ("entry_price", "stop_price", "exit_price"))
        trade = None
        if ready:
            try:
                if account_id is None:
                    raise ValueError("Choose a trading account before saving.")
                start = pd.Timestamp.combine(day, clock).tz_localize("America/New_York", ambiguous="raise", nonexistent="raise")
                end = pd.Timestamp.combine(end_day, end_clock).tz_localize("America/New_York", ambiguous="raise", nonexistent="raise")
                trade = edge.build_trade(symbol=sym, direction=direction, account_id=account_id, source=Source(source),
                                         strategy=strategy, entry_time=start, exit_time=end, instruments=instruments,
                                         tags=edge.write_labels(**labels), notes=notes,
                                         rules_followed={"Not recorded": None, "Yes": True, "No": False}.get(status), **payload)
                c.kpi_row([{"label": "Net result", "value": c.fmt_money(trade.net_pnl), "tone": c.tone_for(trade.net_pnl)},
                           {"label": "Realised R", "value": c.fmt_r(trade.r_multiple), "tone": c.tone_for(trade.r_multiple)},
                           {"label": "Original risk", "value": c.fmt_money(trade.initial_risk, sign=False)}])
                if trade.initial_risk > 250:
                    st.warning("This trade exceeds your $250 risk benchmark. Record it honestly so it stays visible in your review.")
            except (ValueError, TypeError) as exc:
                st.warning(str(exc))
        if st.button("Save & log next", type="primary", disabled=trade is None, use_container_width=True, key=f"{key}_save"):
            if trade.external_id in db.existing_external_ids():
                st.warning("This exact trade is already saved. Change its entry time if this is a different trade.")
                return
            if screenshot is not None:
                folder = Path("data/screenshots")
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / f"edge_{uuid4().hex}{Path(screenshot.name).suffix.lower()}"
                path.write_bytes(screenshot.getbuffer())
                trade.screenshot_path = str(path)
            result = db.insert_trades([trade])
            state.bump()
            if result["skipped"]:
                st.warning("This exact trade is already saved. Change its entry time if this is a different trade.")
            else:
                st.session_state["edge_last_entry"] = dict(strategy=strategy, direction=direction, symbol=sym, day=day,
                                                           labels=labels, source=source, account_id=account_id, method=entry_mode)
                st.session_state["edge_log_epoch"] = epoch + 1
                st.session_state["edge_flash"] = f"Saved {sym} · {c.fmt_money(trade.net_pnl)} · {c.fmt_r(trade.r_multiple)}. Ready for the next trade."
                st.rerun()


def review_imports(df):
    c.section("Import first. Add the context.", "Keep the prices and results from your platform. Tag the evidence you saw on the chart.")
    st.page_link("views/import_.py", label="Import FX Replay, CSV or Excel", icon=":material/upload_file:")
    st.caption("The Import page previews and maps your columns before saving. Return here to tag your trades.")
    if df.empty:
        c.empty_state("Your review queue starts here", "Import your first replay export, or use Add Trade.")
        return
    only_pending = st.toggle("Only trades awaiting labels", value=True, key="edge_pending")
    queue = df[~df["edge_reviewed"].astype(bool)] if only_pending else df
    queue = queue.sort_values("entry_time", ascending=False)
    if queue.empty:
        c.empty_state("You're up to date", "Every trade in this sample has been reviewed. Turn off the switch to edit labels.")
        return
    st.caption(f"{len(queue):,} trades in this queue")
    records = {int(row.id): row for row in queue.itertuples()}
    tid = st.selectbox("Trade to review", list(records), key="edge_review_trade",
                       format_func=lambda v: f"{records[v].entry_time:%d %b %Y %H:%M} UTC · {records[v].symbol} · {records[v].direction} · {c.fmt_money(records[v].net_pnl)} · #{v}")
    trade = state.get_db().get_trade(tid)
    c.kpi_row([{"label": "Net result", "value": c.fmt_money(trade.net_pnl)},
               {"label": "Realised R", "value": c.fmt_r(trade.r_multiple)},
               {"label": "Source", "value": trade.source.value}])
    if trade.screenshot_path and Path(trade.screenshot_path).is_file():
        st.image(trade.screenshot_path, use_container_width=True)
    with st.form(f"edge_review_{tid}"):
        strategy = st.text_input("Strategy name", value=trade.setup_name, placeholder="e.g. Turtle Soup")
        labels = label_fields(f"review_{tid}", edge.read_labels(trade.tags))
        notes = st.text_area("Trade notes", value=trade.notes)
        if st.form_submit_button("Save labels & next", type="primary", use_container_width=True):
            state.get_db().update_trade(tid, setup_name=strategy.strip(), tags=edge.write_labels(trade.tags, **labels), notes=notes)
            state.bump()
            st.session_state["edge_flash"] = "Labels saved. Your edge statistics are updated."
            st.rerun()
