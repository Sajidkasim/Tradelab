import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from core import charts, metrics, risk
from core.charts import pal, theme
from ui import components as c
from ui import state
from ui.style import theme_mode

df_all, df = state.page_setup("Risk Manager")
mode = theme_mode()
tz = state.tz()
acct = state.account()
db = state.get_db()
p = pal(mode)
CFG = {"displayModeBar": False}

c.page_header("Risk Manager", "Position size, prop-firm limits, and what your numbers say about ruin",
              f"{acct.name} · DLL {c.fmt_money(acct.daily_loss_limit, sign=False)} · MLL {c.fmt_money(acct.max_trailing_drawdown, sign=False)}")

rdf = state.risk_df(df_all)
live_daily = metrics.daily_pnl(rdf) if rdf is not None and not rdf.empty else pd.Series(dtype=float)
stats = metrics.summary_stats(rdf, acct.starting_balance) if rdf is not None and not rdf.empty else None
td = risk.trailing_drawdown_from_daily(live_daily, acct.starting_balance, acct.max_trailing_drawdown) if len(live_daily) else None

tab_today, tab_size, tab_edge, tab_sim, tab_log = st.tabs(["Today", "Position size", "Your edge", "Simulate", "Breach log"])

# ---- today ---------------------------------------------------------------------------------------
with tab_today:
    today = state.today_slice(rdf)
    realised = float(today["net_pnl"].sum()) if today is not None and not today.empty else 0.0
    ds = risk.daily_status(realised, acct.daily_loss_limit, len(today) if today is not None else 0, acct.max_trades_per_day)
    k1, k2, k3 = st.columns(3)
    with k1:
        st.markdown(f'<div class="tl-card"><div style="display:flex;justify-content:space-between;align-items:center">'
                    f'<div><div class="tl-big-label">Realised today</div>'
                    f'<div class="tl-big {"tl-pos" if realised > 0 else ("tl-neg" if realised < 0 else "")}">{c.fmt_money(realised)}</div></div>'
                    f'{c.pill(ds["state"], ds["state"].upper())}</div>'
                    f'<div class="tl-note" style="margin-top:8px">{c.fmt_pct(realised / acct.starting_balance, 2) if acct.starting_balance else "—"} of the account · '
                    f'{ds["trades_today"]}/{acct.max_trades_per_day} trades</div></div>', unsafe_allow_html=True)
        c.progress(ds["used_pct"], ds["state"], "Daily loss limit used",
                   f"{c.fmt_money(ds['remaining'], sign=False)} of {c.fmt_money(acct.daily_loss_limit, sign=False)} left")
    if td is not None:
        last = td.iloc[-1]; buf = float(last["buffer"])
        tone = "bad" if buf < acct.max_trailing_drawdown * 0.25 else ("warn" if buf < acct.max_trailing_drawdown * 0.5 else "good")
        with k2:
            c.big_number("Trailing drawdown buffer", c.fmt_money(buf, sign=False),
                         f"balance {c.fmt_money(last['balance'], sign=False)} · limit {c.fmt_money(last['threshold'], sign=False)}", tone)
            c.progress(100 * (1 - buf / acct.max_trailing_drawdown), {"good": "green", "warn": "amber", "bad": "red"}[tone],
                       "Drawdown allowance used", f"high-water {c.fmt_money(last['high_water'], sign=False)}")
        cons = risk.consistency(live_daily, acct.consistency_target_pct)
        with k3:
            if cons["best_day_pct"] is None:
                c.big_number("Consistency", "—", "no profit yet to measure against")
            else:
                ok = cons["compliant"]
                c.big_number("Consistency (best day)", f"{cons['best_day_pct']:.0f}%",
                             (f"under the {acct.consistency_target_pct:.0f}% target" if ok else
                              f"needs {c.fmt_money(cons['needed_profit'], sign=False)} more on other days"), "good" if ok else "warn")
                c.progress(min(100, cons["best_day_pct"] / acct.consistency_target_pct * 100), "green" if ok else "amber",
                           f"Best day vs {acct.consistency_target_pct:.0f}% target")
        c.section("Balance against the limit", "The red line is where the account ends; the dotted line is the high-water mark")
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=td.index, y=td["balance"], mode="lines", name="Balance", line=dict(color=p["series"][0], width=2),
                                 hovertemplate="%{x|%d %b}<br>Balance $%{y:,.0f}<extra></extra>"))
        fig.add_trace(go.Scatter(x=td.index, y=td["threshold"], mode="lines", name="Drawdown limit", line=dict(color=p["critical"], width=1.5),
                                 hovertemplate="Limit $%{y:,.0f}<extra></extra>"))
        fig.add_trace(go.Scatter(x=td.index, y=td["high_water"], mode="lines", name="High-water mark",
                                 line=dict(color=p["muted"], width=1, dash="dot"), hoverinfo="skip"))
        fig.update_yaxes(title_text="$")
        st.plotly_chart(theme(fig, mode, 300), use_container_width=True, config=CFG)
    else:
        with k2:
            c.big_number("Trailing drawdown buffer", c.fmt_money(acct.max_trailing_drawdown, sign=False), "no closed trades yet")
        with k3:
            c.big_number("Consistency", "—", "no trades yet")


# ---- position size (fragment: recalculates without re-rendering the page) ----------------------
@st.fragment
def position_sizer():
    inst = db.instruments(); syms = sorted(inst)
    p1, p2, p3, p4, p5 = st.columns(5)
    sym = p1.selectbox("Instrument", syms, index=syms.index("MES") if "MES" in syms else 0, key="ps_sym")
    ins = inst[sym]
    entry = p2.number_input("Entry", value=5000.0, step=ins.tick_size, format="%.2f", key="ps_entry")
    stop = p3.number_input("Stop", value=float(entry - 16 * ins.tick_size), step=ins.tick_size, format="%.2f", key="ps_stop")
    risk_mode = p4.selectbox("Risk as", ["% of account", "$ amount"], key="ps_mode")
    if risk_mode == "% of account":
        rp = p5.number_input("Risk %", value=float(acct.risk_per_trade_pct), min_value=0.05, max_value=5.0, step=0.05, key="ps_pct")
        ps = risk.position_size(entry, stop, ins.multiplier, ins.tick_size, acct.starting_balance, risk_pct=rp,
                                max_contracts=acct.max_contracts, commission_per_contract=ins.commission_per_contract)
    else:
        rd = p5.number_input("Risk $", value=float(acct.starting_balance * acct.risk_per_trade_pct / 100), min_value=1.0, step=10.0, key="ps_usd")
        ps = risk.position_size(entry, stop, ins.multiplier, ins.tick_size, acct.starting_balance, risk_dollars=rd,
                                max_contracts=acct.max_contracts, commission_per_contract=ins.commission_per_contract)
    c.kpi_row([
        {"label": "Contracts", "value": str(ps["contracts"]), "tone": "warn" if ps["capped_by_max_contracts"] else "",
         "caption": "capped by max contracts" if ps["capped_by_max_contracts"] else f"max {acct.max_contracts}"},
        {"label": "Stop distance", "value": f"{ps['stop_ticks']:.0f} ticks", "caption": f"{abs(entry - stop):g} pts · tick {c.fmt_money(ins.tick_value, sign=False)}"},
        {"label": "Risk per contract", "value": c.fmt_money(ps["risk_per_contract"], sign=False), "caption": "incl. commission"},
        {"label": "Total risk", "value": c.fmt_money(ps["total_risk"], sign=False),
         "caption": f"{ps['risk_pct_of_account']:.2f}% of account · budget {c.fmt_money(ps['risk_budget'], sign=False)}"},
    ])
    rv_n = st.slider("…or check a size you have in mind", 1, max(acct.max_contracts, 10), min(max(ps["contracts"], 1), 10), key="ps_slider")
    rv = risk.risk_for_contracts(rv_n, entry, stop, ins.multiplier, acct.starting_balance, ins.commission_per_contract)
    share = round(rv["total_risk"] / acct.daily_loss_limit * 100) if acct.daily_loss_limit else None
    c.note(f"{rv_n} contract{'s' if rv_n != 1 else ''} at this stop risks <b>{c.fmt_money(rv['total_risk'], sign=False)}</b> "
           f"({rv['risk_pct_of_account']:.2f}% of the account)" + (f" — {share}% of your daily loss limit in one trade." if share is not None else "."))


with tab_size:
    c.section("Position size", "How many contracts a stop-out at this distance lets you trade")
    position_sizer()

# ---- your edge ----------------------------------------------------------------------------------
with tab_edge:
    c.section("What your edge implies", "Kelly, risk of ruin and losing streaks from your actual results")
    if stats is None or stats["trades"] < 5 or stats["win_rate"] is None or not stats["payoff_ratio"]:
        c.empty_state("Need at least a handful of closed trades", "Import or log trades and these fill in automatically.")
    else:
        wr, pay = stats["win_rate"], stats["payoff_ratio"]
        kel = risk.kelly_fraction(wr, pay)
        pnl = metrics.closed(rdf)["net_pnl"].astype(float)
        buffer_now = float(td.iloc[-1]["buffer"]) if td is not None else acct.max_trailing_drawdown
        ror_a = risk.risk_of_ruin_approx(float(pnl.mean()), float(pnl.std(ddof=1)) if len(pnl) > 1 else 0.0, buffer_now)
        mc = risk.monte_carlo(pnl.values, n_trades=100, n_sims=2000, starting_balance=acct.starting_balance, max_drawdown=acct.max_trailing_drawdown)
        e1, e2 = st.columns([1, 1])
        with e1:
            c.kpi_row([
                {"label": "Kelly (full)", "value": c.fmt_pct(kel["full"]) if kel["full"] is not None else "—",
                 "tone": "bad" if (kel["full"] or 0) <= 0 else "", "caption": "too aggressive"},
                {"label": "Half Kelly", "value": c.fmt_pct(kel["half"]) if kel["half"] is not None else "—", "caption": "practical ceiling"},
                {"label": "Quarter Kelly", "value": c.fmt_pct(kel["quarter"]) if kel["quarter"] is not None else "—", "caption": f"you risk {acct.risk_per_trade_pct:.2f}%"},
            ])
            c.note("Full Kelly maximises long-run growth on paper, but a drawdown-limited prop account is ended long before "
                   "the long run arrives. Stay at or below quarter Kelly, and never above your fixed risk-per-trade.")
            c.kpi_row([
                {"label": "Risk of ruin (approx.)", "value": c.fmt_pct(ror_a) if ror_a is not None else "—",
                 "tone": "bad" if (ror_a or 0) > 0.2 else ("warn" if (ror_a or 0) > 0.05 else "good"),
                 "caption": f"of losing your {c.fmt_money(buffer_now, sign=False)} buffer"},
                {"label": "Breach chance (100 trades)", "value": c.fmt_pct(mc["prob_breach"]) if mc["prob_breach"] is not None else "—",
                 "tone": "bad" if (mc["prob_breach"] or 0) > 0.2 else ("warn" if (mc["prob_breach"] or 0) > 0.05 else "good"),
                 "caption": "Monte Carlo, the better estimate"},
                {"label": "Chance of profit", "value": c.fmt_pct(mc["prob_profit"]), "caption": "after 100 more trades"},
            ])
        with e2:
            st.plotly_chart(charts.monte_carlo_fan(mc["paths"], mode, acct.starting_balance, acct.starting_balance - acct.max_trailing_drawdown, title=""),
                            use_container_width=True, config=CFG)
        c.section("Losing streaks", f"At a {wr:.0%} win rate, how likely is a run of N losses in your next 100 trades, and what it costs")
        risk_per_trade = acct.starting_balance * acct.risk_per_trade_pct / 100
        rows = []
        for n in range(3, 11):
            pr = risk.losing_streak_probability(wr, n, 100)
            cost = n * (stats["avg_loss"] or risk_per_trade)
            rows.append({"streak": n, "probability": pr, "cost_at_avg_loss": -cost, "pct_of_drawdown_limit": cost / acct.max_trailing_drawdown * 100})
        ls = pd.DataFrame(rows)
        l1, l2 = st.columns([1, 1])
        with l1:
            c.show_df(ls, tz, labels={"streak": "Losses in a row", "probability": "Chance in 100 trades",
                                      "cost_at_avg_loss": "Cost at your avg loss", "pct_of_drawdown_limit": "% of drawdown limit"})
        with l2:
            exp_run = risk.expected_longest_losing_streak(wr, 100)
            c.big_number("Expected longest losing run", f"{exp_run:.0f} trades",
                         f"over 100 trades at a {wr:.0%} win rate — plan sizing so this is survivable, not merely unlikely")
            worst = ls[ls["probability"] >= 0.5]["streak"].max()
            if pd.notna(worst):
                c.note(f"A run of <b>{int(worst)}</b> losses is more likely than not in your next 100 trades. "
                       f"At your average loss that is <b>{c.fmt_money(-worst * (stats['avg_loss'] or risk_per_trade))}</b>.")


# ---- simulate (fragment) -----------------------------------------------------------------------
@st.fragment
def what_if_sim():
    w1, w2, w3, w4 = st.columns(4)
    wr_s = w1.slider("Win rate", 0.20, 0.80, float(stats["win_rate"]) if stats and stats["win_rate"] else 0.45, 0.01, key="wi_wr")
    aw_s = w2.number_input("Average win $", value=float(stats["avg_win"]) if stats and stats["avg_win"] else 150.0, step=10.0, key="wi_aw")
    al_s = w3.number_input("Average loss $", value=float(stats["avg_loss"]) if stats and stats["avg_loss"] else 100.0, step=10.0, key="wi_al")
    n_s = w4.slider("Trades ahead", 20, 300, 100, 10, key="wi_n")
    wi = risk.what_if(wr_s, aw_s, al_s, n_s, acct.starting_balance, acct.max_trailing_drawdown, n_sims=2000)
    s1, s2 = st.columns([1, 2])
    with s1:
        exp_r = wr_s * aw_s - (1 - wr_s) * al_s
        c.kpi_row([
            {"label": "Expectancy", "value": c.fmt_money(exp_r), "tone": c.tone_for(exp_r), "caption": "per trade"},
            {"label": "Breach chance", "value": c.fmt_pct(wi["prob_breach"]), "tone": "bad" if wi["prob_breach"] > 0.2 else ("warn" if wi["prob_breach"] > 0.05 else "good")},
            {"label": "Median outcome", "value": c.fmt_money(wi["final_pnl_pct"][50]), "tone": c.tone_for(wi["final_pnl_pct"][50]),
             "caption": f"{c.fmt_pct(wi['final_pnl_pct'][50] / acct.starting_balance, 2)} of account"},
            {"label": "5th percentile", "value": c.fmt_money(wi["final_pnl_pct"][5]), "tone": c.tone_for(wi["final_pnl_pct"][5]), "caption": "a bad but plausible run"},
        ])
    with s2:
        st.plotly_chart(charts.monte_carlo_fan(wi["paths"], mode, acct.starting_balance, acct.starting_balance - acct.max_trailing_drawdown, title=""),
                        use_container_width=True, config=CFG)


with tab_sim:
    c.section("What-if simulator", "Move the sliders; the fan shows where 2,000 simulated futures land")
    what_if_sim()

# ---- breach log ------------------------------------------------------------------------------------
with tab_log:
    c.section("Breach log", "Days that broke a limit, from history and from anything logged by the nightly script")
    hist = risk.find_breaches(live_daily, acct.starting_balance, acct.daily_loss_limit, acct.max_trailing_drawdown) if len(live_daily) else pd.DataFrame()
    logged = db.breaches()
    if hist.empty and logged.empty:
        c.empty_state("No breaches", "Nothing in your history has crossed a limit.")
    else:
        if not hist.empty:
            h = hist.copy(); h["date"] = pd.to_datetime(h["date"]).dt.date
            c.show_df(h, tz)
        if not logged.empty:
            st.caption("Logged by nightly.py")
            c.show_df(logged.drop(columns=["id"]).rename(columns={"limit_value": "limit"}), tz)
