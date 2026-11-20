import io
from datetime import timedelta
from pathlib import Path

import pandas as pd
import streamlit as st

from core import metrics
from ui import components as c
from ui import state, access
from ui.style import theme_mode

c.page_header("Trades", "Add, import and review your trades.")
df_all, df = state.page_setup("Trade Journal")
mode = theme_mode()
tz = state.tz()
acct = state.account()
db = state.get_db()
f = state.filters()

MISTAKES = ["chased entry", "moved stop", "oversized", "no setup", "revenge trade", "early exit", "late entry",
            "held past target", "ignored session rule", "news"]

from ui.edge_lab import quick_log, playbook_editor

actions = st.columns(2)
if actions[0].button("Add trade", use_container_width=True, icon=":material/add:", type="primary"):
    st.session_state["trade_action"] = "add"
    st.rerun()
if actions[1].button("Import FX Replay", use_container_width=True, icon=":material/upload:"):
    st.switch_page("views/import_.py")

if st.session_state.get("trade_action") == "add":
    if st.button("Back to trades", icon=":material/arrow_back:"):
        st.session_state["trade_action"] = "review"
        st.rerun()
    if "edge_flash" in st.session_state:
        st.success(st.session_state.pop("edge_flash"))
    quick_log()
    with st.expander("Edit strategies & key levels"):
        playbook_editor()
    st.stop()

# The same editor is used after import and when amending any existing trade.
from ui.trade_review import review_queue
review_queue(df, pending_default=False)

with st.expander("Edit strategies & key levels"):
    playbook_editor()

if df.empty:
    st.stop()

# ---- more --------------------------------------------------------------------------------------
with st.expander("Reviews, advanced editing & export"):
    if st.toggle("Open reviews & exports", key="journal_advanced"):
        if f["scope"] == "All":
            state.statistics_sample(df)
        tab_week, tab_daily, tab_bulk, tab_export = st.tabs(["Weekly review", "Daily reviews", "Advanced edit", "Export"])

        with tab_week:
            review_scope = st.session_state.get("results_source", "Backtests") if f["scope"] == "All" else f["scope"]
            src = df_all[df_all["source"].isin(state.SCOPES[review_scope])] if not df_all.empty else df_all
            if f.get("account_id") is not None and not src.empty:
                src = src[src["account_id"] == f["account_id"]]
            if src.empty:
                c.empty_state("No trades to review", "")
            else:
                local_dates = c.to_local(src["entry_time"], tz).dt.date
                weeks = sorted({d - timedelta(days=d.weekday()) for d in local_dates}, reverse=True)
                wk = st.selectbox("Week starting", weeks, format_func=lambda d: f"{d:%d %b %Y}")
                mask = (local_dates >= wk) & (local_dates < wk + timedelta(days=7))
                w = src[mask.values]
                sw = metrics.summary_stats(w, acct.starting_balance)
                c.kpi_row([
                    {"label": "Net P&L", "value": c.fmt_money(sw["net_pnl"]), "tone": c.tone_for(sw["net_pnl"]),
                     "caption": f"{c.fmt_pct(sw['return_pct'], 2) if sw['return_pct'] is not None else '—'} of the account"},
                    {"label": "Win rate", "value": c.fmt_pct(sw["win_rate"]), "caption": f"{sw['trades']} trades · {sw['trading_days']} days"},
                    {"label": "Expectancy", "value": c.fmt_r(sw["expectancy_r"]), "tone": c.tone_for(sw["expectancy_r"])},
                    {"label": "Best day", "value": c.fmt_money(sw["best_day"]), "caption": f"worst {c.fmt_money(sw['worst_day'])}"},
                ])
                if sw["trades"]:
                    obs = []
                    for r in metrics.breakdown(w, "setup_name").itertuples():
                        if r.trades >= 3:
                            obs.append(f"<b>{c.esc(r.setup_name or 'untagged')}</b>: {r.trades} trades, {c.fmt_pct(r.win_rate)} win rate, {c.fmt_money(r.net_pnl)}.")
                    ra = metrics.rule_adherence(w).set_index("rules")
                    if ra.loc["broke", "trades"] > 0:
                        obs.append(f"Rules broken on <b>{int(ra.loc['broke', 'trades'])}</b> trade(s): {c.fmt_money(ra.loc['broke', 'net_pnl'])}.")
                    tags_ = metrics.pnl_by_tag(w)
                    if not tags_.empty:
                        worst = tags_.iloc[0]
                        obs.append(f"Most costly mistake: <b>{c.esc(worst['tag'])}</b> ({int(worst['trades'])}×, {c.fmt_money(worst['net_pnl'])}).")
                    for r in metrics.breakdown(metrics.add_time_features(w, tz), "weekday").itertuples():
                        if r.trades >= 3 and (r.expectancy or 0) < 0:
                            obs.append(f"<b>{c.esc(r.weekday)}</b> was negative across {r.trades} trades ({c.fmt_money(r.net_pnl)}).")
                    if obs:
                        c.section("Observations", "Only where there are enough trades to mean something")
                        for o in obs[:6]:
                            c.note("• " + o)
                    review_key = f"review_{wk.isoformat()}"
                    txt = st.text_area("Your review", value=state.setting(review_key, ""), height=140,
                                       placeholder="What worked, what didn't, one thing to change next week…")
                    if st.button("Save review"):
                        db.set_setting(review_key, txt); state.bump(); st.toast("Saved", icon="✅")

        with tab_daily:
            reviews = db.settings_with_prefix("daily_review_")
            last_run = state.setting("last_nightly_run")
            c.section("Daily reviews", f"Written by the nightly auto-journal · last run {last_run[:16].replace('T', ' ') + ' UTC' if last_run else 'never'}")
            if not reviews:
                c.empty_state("No reviews yet", "Run `python nightly.py` (or enable the GitHub Action) and each session gets a review here.")
            else:
                keys = sorted(reviews, reverse=True)
                pick = st.selectbox("Day", keys, format_func=lambda k: k.replace("daily_review_", ""))
                st.markdown(reviews[pick])

        with tab_bulk:
            c.section("Bulk edit", "Model, rules, confidence, mistakes, tags and notes for many trades at once")
            cols = ["id", "entry_time", "symbol", "direction", "net_pnl", "setup_name", "session", "rules_followed", "confidence",
                    "mistake_tags", "tags", "notes"]
            bview = df[cols].sort_values("entry_time", ascending=False).copy()
            bview["entry_time"] = c.to_local(bview["entry_time"], tz).dt.tz_localize(None)
            bview["mistake_tags"] = bview["mistake_tags"].apply(lambda l: ", ".join(l or []))
            bview["tags"] = bview["tags"].apply(lambda l: ", ".join(l or []))
            edited = st.data_editor(
                bview, use_container_width=True, hide_index=True, height=min(520, 60 + 35 * len(bview)), num_rows="fixed",
                disabled=["id", "entry_time", "symbol", "direction", "net_pnl"],
                column_config={"id": None, "entry_time": st.column_config.DatetimeColumn("Opened", format="D MMM HH:mm"),
                               "symbol": "Symbol", "direction": "Side", "net_pnl": st.column_config.NumberColumn("P&L", format="dollar"),
                               "setup_name": "Strategy", "session": "Session", "rules_followed": st.column_config.CheckboxColumn("Rules"),
                               "confidence": st.column_config.NumberColumn("Conf", min_value=1, max_value=5, step=1, format="%d"),
                               "mistake_tags": st.column_config.TextColumn("Mistakes", help="comma separated"),
                               "tags": st.column_config.TextColumn("Tags", help="comma separated"),
                               "notes": st.column_config.TextColumn("Notes", width="large")}, key="bulk_editor")
            if st.button("Save changes", type="primary", key="bulk_save"):
                changed = 0
                orig = bview.set_index("id"); new = edited.set_index("id")
                for tid in new.index:
                    diff = {}
                    for col in ("setup_name", "session", "rules_followed", "confidence", "mistake_tags", "tags", "notes"):
                        a, b = orig.at[tid, col], new.at[tid, col]
                        if (pd.isna(a) and pd.isna(b)) or a == b:
                            continue
                        if col in ("mistake_tags", "tags"):
                            b = [x.strip() for x in str(b or "").split(",") if x.strip()]
                        elif col == "confidence":
                            b = None if pd.isna(b) else int(b)
                        elif col == "rules_followed":
                            b = None if pd.isna(b) else bool(b)
                        diff[col] = b
                    if diff:
                        db.update_trade(int(tid), **diff); changed += 1
                state.bump(); st.toast(f"Saved {changed} trade(s)", icon="✅"); st.rerun()

        with tab_export:
            c.section("Export", "The trades currently in view")
            out = c.with_pct(df, acct.starting_balance).drop(columns=["created_at", "updated_at"], errors="ignore").copy()
            for tc in ("entry_time", "exit_time"):
                out[tc] = c.to_local(out[tc], tz).dt.tz_localize(None)
            out["mistake_tags"] = out["mistake_tags"].apply(lambda l: "; ".join(l or []))
            out["tags"] = out["tags"].apply(lambda l: "; ".join(l or []))
            e1, e2 = st.columns(2)
            e1.download_button("Download CSV", out.to_csv(index=False).encode(), "primuslab_trades.csv", "text/csv", use_container_width=True)
            buf = io.BytesIO()
            with pd.ExcelWriter(buf, engine="openpyxl") as xw:
                out.to_excel(xw, index=False, sheet_name="Trades")
            e2.download_button("Download Excel", buf.getvalue(), "primuslab_trades.xlsx",
                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", use_container_width=True)
