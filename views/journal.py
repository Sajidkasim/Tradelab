import io
from datetime import timedelta
from pathlib import Path

import pandas as pd
import streamlit as st

from core import metrics
from ui import components as c
from ui import state
from ui.log_trade import log_trade_form
from ui.style import theme_mode

df_all, df = state.page_setup("Trades")
mode = theme_mode()
tz = state.tz()
acct = state.account()
db = state.get_db()
f = state.filters()

MISTAKES = ["chased entry", "moved stop", "oversized", "no setup", "revenge trade", "early exit", "late entry",
            "held past target", "ignored session rule", "news"]

# ---- header with the Log trade popover -------------------------------------------------
h1, h2 = st.columns([5, 1.2])
with h1:
    c.page_header("Trades", "Every trade in dollars and as a share of the account. Click a row for its detail.",
                  f"{f['scope']} · {f['preset'].lower()} · {len(df)} in view")
with h2:
    st.markdown('<div style="height:14px"></div>', unsafe_allow_html=True)
    with st.popover("Log trade", use_container_width=True, icon=":material/add:"):
        log_trade_form("log")

if df.empty:
    c.empty_state("No trades in view", "Log one with the button above, import a file, or widen the filters.")
    c.scope_hint(df_all)
    st.stop()

# ---- summary strip ---------------------------------------------------------------------------
s = metrics.summary_stats(df, acct.starting_balance)
c.kpi_row([
    {"label": "Net P&L", "value": c.fmt_money(s["net_pnl"]), "tone": c.tone_for(s["net_pnl"]),
     "caption": f"{c.fmt_pct(s['return_pct'], 2) if s['return_pct'] is not None else '—'} of the account"},
    {"label": "Win rate", "value": c.fmt_pct(s["win_rate"]), "caption": f"{s['wins']} W · {s['losses']} L"},
    {"label": "Average R", "value": c.fmt_r(s["avg_r"]), "tone": c.tone_for(s["avg_r"])},
    {"label": "Best / worst", "value": c.fmt_money(s["best_trade"]), "caption": f"worst {c.fmt_money(s['worst_trade'])}"},
])

# ---- the list ---------------------------------------------------------------------------------
c.section("All trades", "Newest first · sort by clicking a column header")
closed_first = df.sort_values("entry_time", ascending=False)
lst = c.with_pct(closed_first, acct.starting_balance)
lst["exit_time"] = lst["exit_time"].where(lst["exit_time"].notna(), lst["entry_time"])
view = lst[["id"] + c.TRADE_LIST_COLS].copy()
view["exit_time"] = c.to_local(view["exit_time"], tz).dt.tz_localize(None)
view["setup_name"] = view["setup_name"].replace("", "—")
cfg = c.column_config(view.drop(columns=["id"]), tz, c.TRADE_LIST_LABELS)
cfg["exit_time"] = st.column_config.DatetimeColumn("Closed", format="D MMM YYYY · HH:mm")
cfg["id"] = None
sel = st.dataframe(view, use_container_width=True, hide_index=True, height=min(560, 38 + 35 * len(view)),
                   column_config=cfg, on_select="rerun", selection_mode="single-row", key="trade_list")
rows = sel.selection.rows if sel and sel.selection else []
selected_id = int(view.iloc[rows[0]]["id"]) if rows else None

# ---- detail -----------------------------------------------------------------------------------
if selected_id is None:
    st.markdown('<div class="tl-hint">Select a trade to see and edit its detail.</div>', unsafe_allow_html=True)
else:
    t = db.get_trade(selected_id)
    if t:
        pct = (t.net_pnl / acct.starting_balance) if (t.net_pnl is not None and acct.starting_balance) else None
        opened = c.to_local(pd.Series([t.entry_time]), tz).iloc[0]
        closed = c.to_local(pd.Series([t.exit_time]), tz).iloc[0] if t.exit_time is not None else None
        c.section(f"{t.symbol} {t.direction.value} · {opened:%A %d %B, %H:%M}",
                  f"{t.setup_name or 'no model'} · {t.session or 'no session'} · {t.source.value}")
        d1, d2 = st.columns([1.05, 1])
        with d1:
            c.kpi_row([
                {"label": "P&L", "value": c.fmt_money(t.net_pnl) if t.net_pnl is not None else "open", "tone": c.tone_for(t.net_pnl)},
                {"label": "% of account", "value": c.fmt_pct(pct, 2) if pct is not None else "—", "tone": c.tone_for(pct)},
                {"label": "R", "value": c.fmt_r(t.r_multiple), "caption": f"risk {c.fmt_money(t.initial_risk, sign=False)}" if t.initial_risk else "no stop recorded"},
            ])
            c.stat_table([
                ("Size", f"{t.qty:g} × {t.symbol} (×{t.multiplier:g})"),
                ("Entry", f"{t.entry_price:.2f}  ·  {opened:%d %b %H:%M}"),
                ("Exit", f"{t.exit_price:.2f}  ·  {closed:%d %b %H:%M}" if t.exit_price is not None else "open"),
                ("Stop / target", f"{t.stop_price if t.stop_price is not None else '—'} / {t.target_price if t.target_price is not None else '—'}"),
                ("Held", f"{(t.exit_time - t.entry_time).total_seconds() / 60:.0f} min" if t.exit_time else "—"),
                ("Fees", c.fmt_money(t.fees, sign=False)),
                ("Reference", t.external_id or "—"),
            ], cols=1)
            shots = Path("data/screenshots"); shots.mkdir(parents=True, exist_ok=True)
            if t.screenshot_path and Path(t.screenshot_path).exists():
                st.image(t.screenshot_path, use_container_width=True)
            up = st.file_uploader("Attach a chart screenshot", type=["png", "jpg", "jpeg"], key=f"shot_{t.id}", label_visibility="collapsed")
            if up is not None:
                dest = shots / f"trade_{t.id}_{up.name}"
                dest.write_bytes(up.getbuffer())
                db.update_trade(t.id, screenshot_path=str(dest)); state.bump(); st.rerun()
        with d2:
            with st.form(f"detail_{t.id}", border=False):
                setups = [s_.name for s_ in db.setups()]
                opts = sorted(set(setups) | ({t.setup_name} if t.setup_name else set()))
                setup_name = st.selectbox("Model", ["—"] + opts, index=(opts.index(t.setup_name) + 1) if t.setup_name in opts else 0)
                e1, e2 = st.columns(2)
                rules = e1.selectbox("Rules", ["not recorded", "followed", "broke"], index={None: 0, True: 1, False: 2}[t.rules_followed])
                conf = e2.selectbox("Confidence", [None, 1, 2, 3, 4, 5], index=[None, 1, 2, 3, 4, 5].index(t.confidence),
                                    format_func=lambda v: "—" if v is None else f"{v} / 5")
                mistakes = st.multiselect("Mistakes", sorted(set(MISTAKES) | set(t.mistake_tags)), default=t.mistake_tags)
                tags = st.text_input("Tags", value=", ".join(t.tags), placeholder="comma separated")
                notes = st.text_area("Notes", value=t.notes, height=120)
                s1, s2 = st.columns(2)
                stop = s1.number_input("Stop (for R)", value=float(t.stop_price) if t.stop_price is not None else 0.0, format="%.2f")
                exitp = s2.number_input("Exit price", value=float(t.exit_price) if t.exit_price is not None else 0.0, format="%.2f",
                                        help="Set this to close an open trade")
                b1, b2 = st.columns([1, 1])
                if b1.form_submit_button("Save", type="primary", use_container_width=True):
                    fields = dict(setup_name="" if setup_name == "—" else setup_name,
                                  rules_followed={"not recorded": None, "followed": True, "broke": False}[rules],
                                  confidence=conf, mistake_tags=mistakes, tags=[x.strip() for x in tags.split(",") if x.strip()],
                                  notes=notes, stop_price=(stop if stop else None))
                    if exitp and t.exit_price is None:
                        fields.update(exit_price=exitp, exit_time=pd.Timestamp.now(tz="UTC").tz_localize(None).to_pydatetime())
                    elif exitp and abs(exitp - (t.exit_price or 0)) > 1e-9:
                        fields["exit_price"] = exitp
                    db.update_trade(t.id, **fields); state.bump(); st.toast("Saved", icon="✅"); st.rerun()
                if b2.form_submit_button("Delete", use_container_width=True):
                    db.delete_trade(t.id); state.bump(); st.toast("Deleted"); st.rerun()

# ---- more --------------------------------------------------------------------------------------
tab_week, tab_daily, tab_bulk, tab_export = st.tabs(["Weekly review", "Daily reviews", "Bulk edit", "Export"])

with tab_week:
    src = df_all[df_all["source"].isin(state.SCOPES[f["scope"]])] if not df_all.empty else df_all
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
                    obs.append(f"<b>{r.setup_name or 'untagged'}</b>: {r.trades} trades, {c.fmt_pct(r.win_rate)} win rate, {c.fmt_money(r.net_pnl)}.")
            ra = metrics.rule_adherence(w).set_index("rules")
            if ra.loc["broke", "trades"] > 0:
                obs.append(f"Rules broken on <b>{int(ra.loc['broke', 'trades'])}</b> trade(s): {c.fmt_money(ra.loc['broke', 'net_pnl'])}.")
            tags_ = metrics.pnl_by_tag(w)
            if not tags_.empty:
                worst = tags_.iloc[0]
                obs.append(f"Most costly mistake: <b>{worst['tag']}</b> ({int(worst['trades'])}×, {c.fmt_money(worst['net_pnl'])}).")
            for r in metrics.breakdown(metrics.add_time_features(w, tz), "weekday").itertuples():
                if r.trades >= 3 and (r.expectancy or 0) < 0:
                    obs.append(f"<b>{r.weekday}</b> was negative across {r.trades} trades ({c.fmt_money(r.net_pnl)}).")
            if obs:
                c.section("Observations", "Only where there are enough trades to mean something")
                for o in obs[:6]:
                    c.note("• " + o)
            c.section("Coach on this week", "")
            from ui.coach_panel import coach_panel
            coach_panel(w, acct, tz, key=f"week_{wk.isoformat()}", compact=True)
            review_key = f"review_{wk.isoformat()}"
            txt = st.text_area("Your review", value=db.get_setting(review_key, ""), height=140,
                               placeholder="What worked, what didn't, one thing to change next week…")
            if st.button("Save review"):
                db.set_setting(review_key, txt); st.toast("Saved", icon="✅")

with tab_daily:
    reviews = db.settings_with_prefix("daily_review_")
    last_run = db.get_setting("last_nightly_run")
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
                       "setup_name": "Model", "session": "Session", "rules_followed": st.column_config.CheckboxColumn("Rules"),
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
    e1.download_button("Download CSV", out.to_csv(index=False).encode(), "tradelab_trades.csv", "text/csv", use_container_width=True)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        out.to_excel(xw, index=False, sheet_name="Trades")
    e2.download_button("Download Excel", buf.getvalue(), "tradelab_trades.xlsx",
                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", use_container_width=True)
