import json
from datetime import datetime, time, timedelta, timezone

import numpy as np
import pandas as pd
import streamlit as st

from core import charts, metrics, risk
from core.backtest import (BacktestConfig, build_rule_strategy, load_strategies, plateau_check, run_backtest, sweep,
                           walk_forward)
from core.charts import pal, theme
from core.importers import auto_map
from ui import components as c
from ui import state
from ui.style import theme_mode

df_all, df = state.page_setup("Backtest")
mode = theme_mode()
tz = state.tz()
acct = state.account()
db = state.get_db()
p = pal(mode)

c.page_header("Backtest", "Event-driven, no look-ahead, slippage and commission charged. Only out-of-sample results deserve belief.",
              "")

# ---------------------------------------------------------------- data
c.section("1 · Bars", "Cached sets are stored in the database; download from TopstepX or upload a CSV of OHLCV")
cached = db.cached_bar_sets()
src_tab, dl_tab, up_tab = st.tabs(["Cached", "Download (TopstepX)", "Upload CSV"])
bars = None
label = ""
with src_tab:
    if cached.empty:
        c.empty_state("No bars cached yet", "Download or upload some.")
    else:
        c.show_df(cached, tz)
        pick = st.selectbox("Use", cached.to_dict("records"), format_func=lambda r: f"{r['symbol']} {r['timeframe']} · {r['bars']} bars")
        bars = db.load_bars(pick["symbol"], pick["timeframe"])
        label = f"{pick['symbol']} {pick['timeframe']}"
with dl_tab:
    from core.projectx_api import ProjectXClient, ProjectXError, Unit
    try:
        client = ProjectXClient.from_env()
        d1, d2, d3, d4 = st.columns([2, 1, 1, 1])
        search = d1.text_input("Contract search", value="MES")
        unit = d2.selectbox("Unit", ["minute", "hour", "day"])
        n = d3.number_input("Per bar", value=1, min_value=1, step=1)
        days = d4.number_input("Days back", value=30, min_value=1, step=1)
        if st.button("Find contracts"):
            st.session_state["bt_contracts"] = client.contracts(search).to_dict("records")
        for con in st.session_state.get("bt_contracts", []):
            if st.button(f"Download {con['name']} · tick {con.get('tickSize')} · {con.get('description', '')}", key=f"dl_{con['id']}"):
                end = datetime.now(timezone.utc); start = end - timedelta(days=int(days))
                with st.spinner("Downloading bars…"):
                    got = client.bars(str(con["id"]), start, end, {"minute": Unit.MINUTE, "hour": Unit.HOUR, "day": Unit.DAY}[unit], int(n))
                from core.fills_to_trades import root_symbol
                tf = f"{int(n)}{unit[0]}"
                db.cache_bars(root_symbol(con["name"]), tf, got)
                st.success(f"Cached {len(got)} bars as {root_symbol(con['name'])} {tf}."); st.rerun()
    except ProjectXError as e:
        st.info(f"{e} — add your ProjectX credentials to download bars, or upload a CSV instead.", icon=":material/key_off:")
with up_tab:
    up = st.file_uploader("OHLCV CSV (time, open, high, low, close, volume)", type=["csv"], key="bars_up")
    u1, u2 = st.columns(2)
    usym = u1.text_input("Symbol", value="MES", key="bars_sym"); utf = u2.text_input("Timeframe label", value="1m", key="bars_tf")
    if up is not None:
        raw = pd.read_csv(up)
        cols = {c_.lower().strip(): c_ for c_ in raw.columns}
        def pickcol(*names):
            for nme in names:
                if nme in cols: return cols[nme]
            return None
        m = {"t": pickcol("t", "time", "date", "datetime", "timestamp"), "o": pickcol("o", "open"), "h": pickcol("h", "high"),
             "l": pickcol("l", "low"), "c": pickcol("c", "close"), "v": pickcol("v", "volume", "vol")}
        if not all(m[k] for k in "tohlc"):
            st.error(f"Need time/open/high/low/close columns. Found: {list(raw.columns)}")
        else:
            bdf = pd.DataFrame({k: raw[v] for k, v in m.items() if v}); bdf["t"] = pd.to_datetime(bdf["t"], utc=True)
            if "v" not in bdf: bdf["v"] = 0.0
            st.dataframe(bdf.head(), use_container_width=True, hide_index=True)
            if st.button("Cache these bars", type="primary"):
                db.cache_bars(usym.upper(), utf, bdf); st.success(f"Cached {len(bdf)} bars."); st.rerun()

if bars is None or bars.empty:
    st.stop()

# ---------------------------------------------------------------- strategy
c.section("2 · Strategy", f"Running on {label} · {len(bars):,} bars from {bars['t'].min():%d %b %Y} to {bars['t'].max():%d %b %Y}")
plugins = load_strategies("strategies")
kind = st.radio("Define it with", ["A strategy file", "The rule builder"], horizontal=True)
strategy_fn, params, ranges, strat_name = None, {}, {}, ""
if kind == "A strategy file":
    good = {k: v for k, v in plugins.items() if "fn" in v}
    if not good:
        c.empty_state("No strategies found", "Drop a .py file with generate_signals(bars, params) into the strategies/ folder.")
        st.stop()
    strat_name = st.selectbox("Strategy", list(good))
    plug = good[strat_name]
    if plug["doc"]:
        st.caption(plug["doc"].splitlines()[0])
    cols = st.columns(max(1, min(4, len(plug["params"]))))
    for i, (k, v) in enumerate(plug["params"].items()):
        col = cols[i % len(cols)]
        if isinstance(v, bool):
            params[k] = col.checkbox(k, value=v)
        elif isinstance(v, (int, float)):
            params[k] = col.number_input(k, value=v)
        else:
            params[k] = col.text_input(k, value=str(v))
    strategy_fn = plug["fn"]; ranges = plug["ranges"]
else:
    strat_name = "rule builder"
    st.caption("Signals fire when every rule agrees (AND) or any rule does (OR). A time window is a filter.")
    n_rules = st.number_input("Rules", value=1, min_value=1, max_value=4, step=1)
    logic = st.radio("Combine with", ["and", "or"], horizontal=True)
    rules = []
    for i in range(int(n_rules)):
        r1, r2, r3, r4 = st.columns([1.2, 1, 1, 1])
        rtype = r1.selectbox("Rule", ["ma_cross", "rsi", "prior_day_break", "vwap_cross", "time_window"], key=f"rt{i}")
        rule = {"type": rtype}
        if rtype == "ma_cross":
            rule["fast"] = r2.number_input("fast EMA", value=9, key=f"rf{i}"); rule["slow"] = r3.number_input("slow EMA", value=21, key=f"rs{i}")
        elif rtype == "rsi":
            rule["n"] = r2.number_input("period", value=14, key=f"rn{i}"); rule["buy_below"] = r3.number_input("buy below", value=30, key=f"rb{i}")
            rule["sell_above"] = r4.number_input("sell above", value=70, key=f"ra{i}")
        elif rtype == "time_window":
            rule["start"] = r2.text_input("start HH:MM", value="09:30", key=f"ws{i}"); rule["end"] = r3.text_input("end HH:MM", value="11:00", key=f"we{i}")
        rules.append(rule)
    strategy_fn = build_rule_strategy(rules, logic)
    params = {"rules": rules, "logic": logic}

# ---------------------------------------------------------------- config
c.section("3 · Execution", "Costs and exits. Sizes come from your account's risk settings if you choose risk-based.")
inst = db.instruments(); syms = sorted(inst)
sym_guess = label.split()[0] if label and label.split()[0] in inst else ("MES" if "MES" in inst else syms[0])
e1, e2, e3, e4, e5 = st.columns(5)
sym = e1.selectbox("Instrument", syms, index=syms.index(sym_guess))
ins = inst[sym]
slip = e2.number_input("Slippage (ticks/side)", value=1.0, step=0.5, min_value=0.0)
comm = e3.number_input("Commission RT/contract", value=float(ins.commission_per_contract), step=0.25)
sizing = e4.selectbox("Sizing", ["Fixed contracts", "Risk $ per trade"])
if sizing == "Fixed contracts":
    contracts = int(e5.number_input("Contracts", value=1, min_value=1, step=1)); risk_d = None
else:
    contracts = 1; risk_d = float(e5.number_input("Risk $", value=float(acct.starting_balance * acct.risk_per_trade_pct / 100), step=25.0))
x1, x2, x3, x4, x5, x6 = st.columns(6)
stop_pts = x1.number_input("Stop (pts, 0=off)", value=0.0, step=ins.tick_size)
tgt_pts = x2.number_input("Target (pts, 0=off)", value=0.0, step=ins.tick_size)
trail_pts = x3.number_input("Trailing (pts, 0=off)", value=0.0, step=ins.tick_size)
max_bars = int(x4.number_input("Max bars (0=off)", value=0, step=1, min_value=0))
sess_on = x5.checkbox("Session only", value=True)
one_per_day = x6.checkbox("One trade/day", value=False)
ss, se = None, None
if sess_on:
    t1, t2 = st.columns(2)
    ss = time.fromisoformat(t1.text_input("Session start (bar clock, HH:MM)", value="09:30"))
    se = time.fromisoformat(t2.text_input("Session end", value="16:00"))
cfg = BacktestConfig(symbol=sym, multiplier=ins.multiplier, tick_size=ins.tick_size, commission_per_contract=comm,
                     slippage_ticks=slip, starting_balance=acct.starting_balance, contracts=contracts, risk_dollars=risk_d,
                     max_contracts=acct.max_contracts, stop_points=stop_pts or None, target_points=tgt_pts or None,
                     trailing_points=trail_pts or None, max_bars_in_trade=max_bars or None, session_start=ss, session_end=se,
                     flat_at_session_end=sess_on, one_trade_per_day=one_per_day)

# ---------------------------------------------------------------- run
run_tab, sweep_tab, wf_tab, mc_tab, saved_tab = st.tabs(["Run", "Parameter sweep", "Walk-forward", "Monte Carlo", "Saved runs"])
with run_tab:
    if st.button("Run backtest", type="primary"):
        with st.spinner("Running…"):
            st.session_state["bt_result"] = run_backtest(bars, strategy_fn, params, cfg, strat_name)
    res = st.session_state.get("bt_result")
    if res is not None:
        s = res.stats
        lo, hi = s["win_rate_ci"]
        c.kpi_row([
            {"label": "Trades", "value": str(s["trades"]), "badge": "small sample" if s["small_sample"] else ""},
            {"label": "Win rate", "value": c.fmt_pct(s["win_rate"]), "caption": f"CI {lo:.0%}–{hi:.0%}"},
            {"label": "Expectancy", "value": c.fmt_r(s["expectancy_r"]), "tone": c.tone_for(s["expectancy_r"]), "caption": c.fmt_money(s["expectancy"])},
            {"label": "Profit factor", "value": c.fmt_ratio(s["profit_factor"])},
            {"label": "Net P&L", "value": c.fmt_money(s["net_pnl"]), "tone": c.tone_for(s["net_pnl"])},
            {"label": "Max drawdown", "value": c.fmt_money(-s["max_drawdown"]) if s["max_drawdown"] else "$0.00"},
        ])
        fig = charts.equity_chart(metrics.equity_curve(res.trades, cfg.starting_balance), mode, title="", starting_balance=cfg.starting_balance)
        st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
        r1, r2 = st.columns([2, 1])
        with r1:
            if not res.trades.empty:
                c.show_df(res.trades[["entry_time", "exit_time", "direction", "qty", "entry_price", "exit_price", "net_pnl", "r_multiple", "tags"]], "UTC")
        with r2:
            c.section("Exits", "")
            c.show_df(pd.DataFrame([{"reason": k, "trades": v} for k, v in s["exit_reasons"].items()]), tz)
            nm = st.text_input("Save as", value=f"{strat_name} {label} {datetime.now():%d %b %H:%M}")
            if st.button("Save run"):
                db.save_backtest(nm, strat_name, sym, label, {**params, "config": res.config}, {k: v for k, v in s.items() if k != "exit_reasons"},
                                 list(res.equity["equity"].values))
                st.success("Saved.")
            if st.button("Add these trades to the Backtests scope"):
                objs = res.trade_objects()
                for i, t in enumerate(objs):
                    t.external_id = f"bt-{nm}-{i}"; t.account_id = acct.id; t.setup_name = strat_name
                out = db.insert_trades(objs); state.bump(); st.success(f"Added {out['inserted']} trades.")

with sweep_tab:
    if not ranges and kind == "A strategy file":
        st.info("This strategy file has no RANGES dict, so there is nothing to sweep. Add `RANGES = {\"param\": [..]}` to it.")
    elif kind != "A strategy file":
        st.info("Sweeps need a strategy file with a RANGES dict (the rule builder has fixed parameters).")
    else:
        keys = list(ranges)
        s1, s2 = st.columns(2)
        px = s1.selectbox("X parameter", keys, index=0); py = s2.selectbox("Y parameter", keys, index=min(1, len(keys) - 1))
        if st.button("Run sweep", type="primary"):
            grid = {px: ranges[px], py: ranges[py]} if px != py else {px: ranges[px]}
            with st.spinner(f"Running {np.prod([len(v) for v in grid.values()])} backtests…"):
                st.session_state["bt_sweep"] = sweep(bars, strategy_fn, grid, cfg, params)
        res = st.session_state.get("bt_sweep")
        if res is not None:
            metric = st.selectbox("Colour by", ["expectancy_r", "expectancy", "profit_factor", "net_pnl", "win_rate"], index=0)
            if px != py:
                pc = plateau_check(res, px, py, metric)
                verdict = pc.get("verdict", "")
                tone = "good" if verdict.startswith("plateau") else ("bad" if ("island" in verdict or "no positive" in verdict) else "warn")
                st.markdown(f'{c.pill({"good": "green", "bad": "breached", "warn": "amber"}[tone], verdict)}', unsafe_allow_html=True)
                piv = res.pivot_table(index=py, columns=px, values=metric)
                st.plotly_chart(charts.diverging_heatmap(piv, mode, title="", value_fmt=""), use_container_width=True, config={"displayModeBar": False})
            c.show_df(res.sort_values(metric, ascending=False), tz)

with wf_tab:
    if not ranges or kind != "A strategy file":
        st.info("Walk-forward optimises over a strategy file's RANGES, then tests on data it never saw.")
    else:
        w1, w2, w3 = st.columns(3)
        nwin = int(w1.number_input("Windows", value=4, min_value=2, max_value=12, step=1))
        isf = w2.slider("In-sample share", 0.5, 0.9, 0.7, 0.05)
        obj = w3.selectbox("Optimise for", ["expectancy_r", "profit_factor", "net_pnl"])
        if st.button("Run walk-forward", type="primary"):
            with st.spinner("Optimising each window…"):
                st.session_state["bt_wf"] = walk_forward(bars, strategy_fn, ranges, cfg, nwin, isf, obj, params, min_trades=5)
        wf = st.session_state.get("bt_wf")
        if wf is not None:
            s = wf["oos_stats"]; lo, hi = s["win_rate_ci"]
            c.kpi_row([
                {"label": "OOS trades", "value": str(s["trades"])},
                {"label": "OOS win rate", "value": c.fmt_pct(s["win_rate"]), "caption": f"CI {lo:.0%}–{hi:.0%}"},
                {"label": "OOS expectancy", "value": c.fmt_r(s["expectancy_r"]), "tone": c.tone_for(s["expectancy_r"])},
                {"label": "OOS net P&L", "value": c.fmt_money(s["net_pnl"]), "tone": c.tone_for(s["net_pnl"])},
            ])
            c.note("The in-sample numbers are what the optimiser saw; <b>only the out-of-sample column is evidence</b>.")
            wtab = wf["windows"].copy()
            if not wtab.empty:
                wtab["best_params"] = wtab["best_params"].apply(json.dumps)
                c.show_df(wtab, "UTC")
            if not wf["oos_equity"].empty:
                st.plotly_chart(charts.equity_chart(wf["oos_equity"], mode, title="", starting_balance=cfg.starting_balance),
                                use_container_width=True, config={"displayModeBar": False})

with mc_tab:
    res = st.session_state.get("bt_result")
    if res is None or res.trades.empty:
        st.info("Run a backtest first.")
    else:
        pnl = metrics.closed(res.trades)["net_pnl"].astype(float).values
        m1, m2 = st.columns(2)
        n_ahead = int(m1.slider("Trades ahead", 20, 500, min(200, max(20, len(pnl) * 2)), 10))
        n_sims = int(m2.selectbox("Simulations", [500, 1000, 2000, 5000], index=2))
        mc = risk.monte_carlo(pnl, n_ahead, n_sims, cfg.starting_balance, acct.max_trailing_drawdown)
        c.kpi_row([
            {"label": "Breach chance", "value": c.fmt_pct(mc["prob_breach"]), "tone": "bad" if mc["prob_breach"] > 0.2 else ("warn" if mc["prob_breach"] > 0.05 else "good"),
             "caption": f"trailing DD {c.fmt_money(acct.max_trailing_drawdown, sign=False)}"},
            {"label": "Chance of profit", "value": c.fmt_pct(mc["prob_profit"])},
            {"label": "Median P&L", "value": c.fmt_money(mc["final_pnl_pct"][50]), "tone": c.tone_for(mc["final_pnl_pct"][50])},
            {"label": "5th pct P&L", "value": c.fmt_money(mc["final_pnl_pct"][5]), "tone": c.tone_for(mc["final_pnl_pct"][5])},
            {"label": "95th pct drawdown", "value": c.fmt_money(-mc["worst_5pct_drawdown"]), "caption": "a bad run's drawdown"},
        ])
        st.plotly_chart(charts.monte_carlo_fan(mc["paths"], mode, cfg.starting_balance, cfg.starting_balance - acct.max_trailing_drawdown, title=""),
                        use_container_width=True, config={"displayModeBar": False})

with saved_tab:
    runs = db.backtests()
    if runs.empty:
        c.empty_state("No saved runs", "Save one from the Run tab.")
    else:
        show = runs[["id", "name", "strategy", "symbol", "timeframe", "created_at"]].copy()
        show["trades"] = runs["stats"].apply(lambda s: (s or {}).get("trades"))
        show["expectancy_r"] = runs["stats"].apply(lambda s: (s or {}).get("expectancy_r"))
        show["net_pnl"] = runs["stats"].apply(lambda s: (s or {}).get("net_pnl"))
        c.show_df(show, tz)
        pick = st.multiselect("Compare equity", runs["id"].tolist(), default=runs["id"].tolist()[:3],
                              format_func=lambda i: runs.set_index("id").loc[i, "name"])
        if pick:
            curves = {}
            for i in pick:
                eqv = runs.set_index("id").loc[i, "equity"] or []
                curves[runs.set_index("id").loc[i, "name"]] = pd.DataFrame({"time": range(len(eqv)), "equity": eqv})
            st.plotly_chart(charts.compare_equity(curves, mode, title=""), use_container_width=True, config={"displayModeBar": False})
        dele = st.selectbox("Delete run", [None] + runs["id"].tolist(), format_func=lambda i: "—" if i is None else runs.set_index("id").loc[i, "name"])
        if dele is not None and st.button("Delete"):
            db.delete_backtest(int(dele)); st.rerun()
