import pandas as pd
import streamlit as st

from core import charts, metrics
from ui import components as c
from ui import state
from ui.coach_panel import coach_panel
from ui.style import theme_mode

df_all, df = state.page_setup("Performance")
mode = theme_mode()
tz = state.tz()
acct = state.account()
f = state.filters()
CFG = {"displayModeBar": False}

c.page_header("Performance", "Where the edge is, and where it leaks",
              f"{f['scope']} · {f['preset'].lower()} · {len(df)} trades")

if df.empty:
    c.empty_state("Nothing in this view", "Import trades or widen the filters in the sidebar.")
    c.scope_hint(df_all)
    st.stop()

s = metrics.summary_stats(df, acct.starting_balance)
lo, hi = s["win_rate_ci"]
if s["small_sample"]:
    st.info(f"Only {s['trades']} closed trades in view. Treat every number here as a rough estimate until you have 30+.",
            icon=":material/info:")

# ---- headline: P&L and percentage first ----------------------------------------------------
c.kpi_row([
    {"label": "Net P&L", "value": c.fmt_money(s["net_pnl"]), "tone": c.tone_for(s["net_pnl"]),
     "caption": f"{c.fmt_pct(s['return_pct'], 2) if s['return_pct'] is not None else '—'} of the account"},
    {"label": "Win rate", "value": c.fmt_pct(s["win_rate"]), "caption": f"95% CI {lo:.0%}–{hi:.0%}"},
    {"label": "Expectancy", "value": c.fmt_r(s["expectancy_r"]), "tone": c.tone_for(s["expectancy_r"]), "caption": f"{c.fmt_money(s['expectancy'])} per trade"},
    {"label": "Profit factor", "value": c.fmt_ratio(s["profit_factor"]), "caption": f"payoff {c.fmt_ratio(s['payoff_ratio'])}"},
    {"label": "Max drawdown", "value": c.fmt_money(-s["max_drawdown"]) if s["max_drawdown"] else "$0.00", "caption": f"{c.fmt_pct(s['max_drawdown_pct'])} of peak"},
    {"label": "Loss streak", "value": str(s["longest_loss_streak"]), "caption": f"current {s['current_streak']:+d}"},
])

tab_ess, tab_break, tab_mist, tab_coach, tab_deep = st.tabs(["Essentials", "Breakdowns", "Mistakes & rules", "Coach", "Deep dive"])

# ---- essentials --------------------------------------------------------------------------
with tab_ess:
    left, right = st.columns(2)
    with left:
        c.section("R-multiple distribution", "How your results are spread; the line is the average")
        st.plotly_chart(charts.r_histogram(df, mode, title=""), use_container_width=True, config=CFG)
    with right:
        c.section("Rolling edge", "Average R over the last 20 trades — watch for it going cold")
        st.plotly_chart(charts.rolling_line(metrics.rolling_expectancy(df, 20), mode, 20, title=""), use_container_width=True, config=CFG)
    c.section("All the numbers", "Computed by the same code the backtester uses")
    rows = [
        ("Closed trades", f"{s['trades']}  ({s['wins']} W · {s['losses']} L · {s['scratches']} scratch)"),
        ("Return on account", c.fmt_pct(s["return_pct"], 2) if s["return_pct"] is not None else "—"),
        ("Net / gross P&L", f"{c.fmt_money(s['net_pnl'])} / {c.fmt_money(s['gross_pnl'])}"),
        ("Fees paid", c.fmt_money(s["fees"], sign=False)),
        ("Average win / loss", f"{c.fmt_money(s['avg_win'])} / {c.fmt_money(-s['avg_loss']) if s['avg_loss'] else '—'}"),
        ("Best / worst trade", f"{c.fmt_money(s['best_trade'])} / {c.fmt_money(s['worst_trade'])}"),
        ("Sharpe / Sortino (daily, annualised)", f"{c.fmt_ratio(s['sharpe'])} / {c.fmt_ratio(s['sortino'])}"),
        ("Longest win / loss streak", f"{s['longest_win_streak']} / {s['longest_loss_streak']}"),
        ("Trading days · average day", f"{s['trading_days']} · {c.fmt_money(s['avg_daily_pnl'])}"),
        ("Best / worst day", f"{c.fmt_money(s['best_day'])} / {c.fmt_money(s['worst_day'])}"),
        ("Average hold", f"{s['avg_hold_minutes']:.0f} min" if s["avg_hold_minutes"] else "—"),
        ("Average R", c.fmt_r(s["avg_r"])),
    ]
    c.stat_table(rows, cols=2)

# ---- breakdowns ---------------------------------------------------------------------------
with tab_break:
    c.section("Which of my trades actually pay?", "Pick a dimension and a measure")
    feat = metrics.add_time_features(df, tz)
    feat["rules"] = feat["rules_followed"].map({True: "followed", False: "broke"}).fillna("not recorded")
    feat["confidence_lbl"] = feat["confidence"].map(lambda v: f"{int(v)}/5" if pd.notna(v) else "not rated")
    dims = {"Model / setup": "setup_name", "Symbol": "symbol", "Direction": "direction", "Weekday": "weekday",
            "Hour of day": "hour", "Session": "session", "Holding time": "hold_bucket", "Confidence": "confidence_lbl",
            "Rules followed": "rules"}
    b1, b2 = st.columns([1, 1])
    dim = b1.selectbox("Break down by", list(dims), index=0)
    val = b2.selectbox("Measure", ["net_pnl", "expectancy", "win_rate", "avg_r"], index=0,
                       format_func=lambda v: {"net_pnl": "Net P&L", "expectancy": "Expectancy $", "win_rate": "Win rate", "avg_r": "Average R"}[v])
    col = dims[dim]
    work = feat.copy()
    if col == "hold_bucket":
        work[col] = work[col].astype(str)
    work[col] = work[col].fillna("—").replace("", "—")
    table = metrics.breakdown(work, col)
    t1, t2 = st.columns([1.2, 1])
    with t1:
        st.plotly_chart(charts.breakdown_bar(table, col, val, mode, title=""), use_container_width=True, config=CFG)
    with t2:
        tbl = table[[col, "trades", "win_rate", "expectancy", "avg_r", "net_pnl"]].copy()
        tbl["pct"] = tbl["net_pnl"] / acct.starting_balance if acct.starting_balance else 0.0
        c.show_df(tbl.rename(columns={col: dim}), tz, labels={"pct": "P&L %"})
    c.section("Time of day × weekday", "Average P&L per trade by entry hour, in your timezone")
    st.plotly_chart(charts.diverging_heatmap(metrics.hour_weekday_heatmap(df, tz), mode, title=""), use_container_width=True, config=CFG)

# ---- mistakes & rules ------------------------------------------------------------------------
with tab_mist:
    c.section("Mistakes", "What each tag has cost, and what the record looks like without it")
    tags = metrics.pnl_by_tag(df)
    if tags.empty:
        c.empty_state("No mistake tags yet", "Tag trades on the Trades page (chased entry, moved stop, oversized…) and this fills in.")
    else:
        m1, m2 = st.columns([1, 1])
        with m1:
            st.plotly_chart(charts.breakdown_bar(tags.rename(columns={"tag": "mistake"}).assign(win_rate=tags["win_rate"]),
                                                 "mistake", "net_pnl", mode, title=""), use_container_width=True, config=CFG)
        with m2:
            pick = st.selectbox("What if I had never taken trades tagged…", list(tags["tag"]))
            wi = metrics.what_if_without_tag(df, pick, starting_balance=acct.starting_balance)
            w, wo = wi["with"], wi["without"]
            c.kpi_row([
                {"label": "Net P&L now", "value": c.fmt_money(w["net_pnl"]), "tone": c.tone_for(w["net_pnl"]),
                 "caption": f"{c.fmt_pct(w['return_pct'], 2) if w['return_pct'] is not None else '—'} of account"},
                {"label": f"Without '{pick}'", "value": c.fmt_money(wo["net_pnl"]), "tone": c.tone_for(wo["net_pnl"]),
                 "caption": f"{c.fmt_pct(wo['return_pct'], 2) if wo['return_pct'] is not None else '—'} · {wi['removed_trades']} removed"},
                {"label": "Win rate without", "value": c.fmt_pct(wo["win_rate"]), "caption": f"was {c.fmt_pct(w['win_rate'])}"},
                {"label": "Expectancy without", "value": c.fmt_r(wo["expectancy_r"]), "caption": f"was {c.fmt_r(w['expectancy_r'])}"},
            ])
            c.note(f"Those {wi['removed_trades']} trades cost <b>{c.fmt_money(wi['removed_pnl'])}</b> in total.")
    ra = metrics.rule_adherence(df)
    if not ra.empty:
        r = ra.set_index("rules")
        fo, br = r.loc["followed"], r.loc["broke"]
        if fo["trades"] + br["trades"] > 0:
            c.section("Rule adherence", "Trades where you followed your plan versus where you didn't")
            c.kpi_row([
                {"label": "Followed rules", "value": c.fmt_money(fo["net_pnl"]), "tone": c.tone_for(fo["net_pnl"]),
                 "caption": f"{int(fo['trades'])} trades · WR {c.fmt_pct(fo['win_rate'])} · {c.fmt_r(fo['avg_r'])}"},
                {"label": "Broke rules", "value": c.fmt_money(br["net_pnl"]), "tone": c.tone_for(br["net_pnl"]),
                 "caption": f"{int(br['trades'])} trades · WR {c.fmt_pct(br['win_rate'])} · {c.fmt_r(br['avg_r'])}"},
            ])
            if br["trades"] > 0:
                c.note(f"Breaking your rules cost you <b>{c.fmt_money(br['net_pnl'])}</b> across {int(br['trades'])} trades."
                       if br["net_pnl"] < 0 else
                       f"Rule-breaking trades made <b>{c.fmt_money(br['net_pnl'])}</b> — with a {c.fmt_pct(br['win_rate'])} win rate that is luck, not edge.")

# ---- coach ---------------------------------------------------------------------------------------
with tab_coach:
    c.section("Coach", "A plain-English review of exactly the trades in view — change the filters and ask again")
    coach_panel(df, acct, tz, key="performance")

# ---- deep dive -----------------------------------------------------------------------------------
with tab_deep:
    c.section("Best and worst", "Top and bottom ten by R")
    closed = c.with_pct(metrics.closed(df), acct.starting_balance)
    cols = ["exit_time", "symbol", "direction", "qty", "net_pnl", "pct", "r_multiple", "setup_name", "session", "mistake_tags"]
    bw1, bw2 = st.columns(2)
    with bw1:
        st.caption("Best"); c.show_df(closed.sort_values("r_multiple", ascending=False).head(10)[cols], tz, labels=c.TRADE_LIST_LABELS)
    with bw2:
        st.caption("Worst"); c.show_df(closed.sort_values("r_multiple", ascending=True).head(10)[cols], tz, labels=c.TRADE_LIST_LABELS)
    st_ = metrics.streaks(df)
    c.section("Streaks", "")
    c.kpi_row([
        {"label": "Current streak", "value": f"{st_['current']:+d}" if st_["current"] else "0",
         "tone": "good" if st_["current"] > 0 else ("bad" if st_["current"] < 0 else ""), "caption": "positive = wins in a row"},
        {"label": "Longest win run", "value": str(st_["longest_win"]), "caption": f"{len(st_['win_streaks'])} win runs"},
        {"label": "Longest loss run", "value": str(st_["longest_loss"]), "caption": f"{len(st_['loss_streaks'])} loss runs"},
        {"label": "Avg loss run", "value": f"{(sum(st_['loss_streaks']) / len(st_['loss_streaks'])):.1f}" if st_["loss_streaks"] else "—",
         "caption": "trades per losing run"},
    ])
    if {"mae", "mfe"} <= set(df.columns) and df["mae"].notna().any():
        c.section("Excursion", "Are your stops too tight and targets too near?")
        st.plotly_chart(charts.scatter_mae_mfe(df, mode), use_container_width=True, config=CFG)
