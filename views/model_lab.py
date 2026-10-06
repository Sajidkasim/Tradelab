import pandas as pd
import streamlit as st

from core import charts, metrics
from core.models import Setup, SetupStatus
from ui import components as c
from ui import state
from ui.style import theme_mode

df_all, df = state.page_setup("Strategy Models")
mode = theme_mode()
tz = state.tz()
acct = state.account()
db = state.get_db()
f = state.filters()

c.page_header("Strategy Models", "Define your strategies, keep their rules together and compare their results.",
              f"{f['scope']} · {f['preset'].lower()}")

setups = db.setups()
names_in_data = sorted(s for s in df["setup_name"].dropna().unique() if s) if not df.empty else []
setup_names = [s.name for s in setups]
# models = defined setups ∪ names seen in the data (so imported strategies show up without setup records)
all_models = list(dict.fromkeys(setup_names + names_in_data))

tab_score, tab_compare, tab_manage = st.tabs(["Scorecards", "Compare", "Manage strategies"])

# ---------------------------------------------------------------- scorecards
with tab_score:
    if not all_models:
        c.empty_state("No models yet", "Add one under 'Manage models', or import trades that carry a setup/strategy name.")
    else:
        pick = st.selectbox("Strategy", all_models)
        sdef = next((s for s in setups if s.name == pick), None)
        sub = df[df["setup_name"] == pick] if not df.empty else df
        s = metrics.summary_stats(sub, acct.starting_balance)
        lo, hi = s["win_rate_ci"]
        status = sdef.status.value if sdef else "testing"
        head = st.columns([3, 1])
        with head[0]:
            st.markdown(f'{c.pill("info" if status == "live" else ("neutral" if status == "testing" else "amber"), status.upper())} '
                        f'<span class="tl-note" style="margin-left:8px">{(sdef.description if sdef and sdef.description else "")}</span>',
                        unsafe_allow_html=True)
        ready = s["trades"] >= 30 and (s["expectancy_r"] or 0) > 0 and lo > 0.35
        c.kpi_row([
            {"label": "Trades", "value": str(s["trades"]), "badge": "small sample" if s["small_sample"] else "",
             "caption": f"{s['wins']} W · {s['losses']} L"},
            {"label": "Win rate", "value": c.fmt_pct(s["win_rate"]), "caption": f"95% CI {lo:.0%}–{hi:.0%}"},
            {"label": "Expectancy", "value": c.fmt_r(s["expectancy_r"]), "tone": c.tone_for(s["expectancy_r"]),
             "caption": f"{c.fmt_money(s['expectancy'])} per trade"},
            {"label": "Profit factor", "value": c.fmt_ratio(s["profit_factor"])},
            {"label": "Net P&L", "value": c.fmt_money(s["net_pnl"]), "tone": c.tone_for(s["net_pnl"])},
            {"label": "Max drawdown", "value": c.fmt_money(-s["max_drawdown"]) if s["max_drawdown"] else "$0.00"},
        ])
        if sdef:
            tgt = f" · target {sdef.target_r:g}R, expected WR {sdef.expected_win_rate:.0%}" if sdef.target_r else ""
            c.note(f"<b>Promotion check:</b> {'ready to trade live' if ready else 'keep testing'} — needs 30+ trades, positive expectancy "
                   f"and a win-rate lower bound above 35%. Currently {s['trades']} trades, {c.fmt_r(s['expectancy_r'])}, lower bound {lo:.0%}{tgt}.")
        if sub.empty:
            c.empty_state("No trades for this model in view", "Widen the period or change the Data scope.")
        else:
            g1, g2 = st.columns(2)
            with g1:
                c.section("Equity", "This model alone")
                st.plotly_chart(charts.equity_chart(metrics.equity_curve(sub, 0.0), mode, title=""),
                                use_container_width=True, config={"displayModeBar": False})
            with g2:
                c.section("Edge over time", "Rolling 20-trade average R")
                st.plotly_chart(charts.rolling_line(metrics.rolling_expectancy(sub, 20), mode, 20, title=""),
                                use_container_width=True, config={"displayModeBar": False})
            b1, b2 = st.columns(2)
            with b1:
                c.section("By session", "Where this model works best")
                sess = metrics.breakdown(sub.assign(session=sub["session"].replace("", "—")), "session")
                st.plotly_chart(charts.breakdown_bar(sess, "session", "expectancy", mode, title=""),
                                use_container_width=True, config={"displayModeBar": False})
            with b2:
                c.section("By symbol", "")
                sym = metrics.breakdown(sub, "symbol")
                st.plotly_chart(charts.breakdown_bar(sym, "symbol", "net_pnl", mode, title=""),
                                use_container_width=True, config={"displayModeBar": False})
            ra = metrics.rule_adherence(sub).set_index("rules")
            if ra.loc["followed", "trades"] + ra.loc["broke", "trades"] > 0:
                c.section("Rule adherence for this model", "")
                fo, br = ra.loc["followed"], ra.loc["broke"]
                c.kpi_row([
                    {"label": "Followed", "value": c.fmt_r(fo["avg_r"]), "tone": c.tone_for(fo["avg_r"]),
                     "caption": f"{int(fo['trades'])} trades · {c.fmt_money(fo['net_pnl'])}"},
                    {"label": "Broke", "value": c.fmt_r(br["avg_r"]) if br["trades"] else "—", "tone": c.tone_for(br["avg_r"]) if br["trades"] else "",
                     "caption": f"{int(br['trades'])} trades · {c.fmt_money(br['net_pnl'])}"},
                ])
            if sdef and sdef.rules:
                c.section("Checklist", "The rules you defined for this model")
                st.markdown("\n".join(f"- {r}" for r in sdef.rules))

# ---------------------------------------------------------------- compare
with tab_compare:
    if len(all_models) < 2:
        c.empty_state("Need at least two models to compare", "")
    else:
        chosen = st.multiselect("Models", all_models, default=all_models[:min(3, len(all_models))], max_selections=6)
        if chosen and not df.empty:
            rows, curves = [], {}
            for m in chosen:
                sub = df[df["setup_name"] == m]
                s = metrics.summary_stats(sub, acct.starting_balance)
                rows.append({"model": m, "trades": s["trades"], "win_rate": s["win_rate"], "expectancy": s["expectancy"],
                             "avg_r": s["avg_r"], "profit_factor": s["profit_factor"], "net_pnl": s["net_pnl"],
                             "max_drawdown": s["max_drawdown"], "longest_loss_streak": s["longest_loss_streak"]})
                cl = metrics.closed(sub).sort_values("exit_time")
                if not cl.empty and cl["r_multiple"].notna().any():
                    curves[m] = pd.DataFrame({"time": cl["exit_time"], "equity": cl["r_multiple"].fillna(0).cumsum()})
            c.section("Side by side", "")
            c.show_df(pd.DataFrame(rows), tz)
            c.section("Cumulative R", "Normalised so models with different sizes can be compared")
            st.plotly_chart(charts.compare_equity(curves, mode, title=""), use_container_width=True,
                            config={"displayModeBar": False})

# ---------------------------------------------------------------- manage
with tab_manage:
    c.section("Models", "Define a setup once; trades carrying its name roll up to it automatically")
    if setups:
        c.show_df(pd.DataFrame([{"name": s.name, "status": s.status.value, "timeframe": s.timeframe,
                                 "instruments": ", ".join(s.instruments), "rules": len(s.rules),
                                 "target_r": s.target_r, "expected_win_rate": s.expected_win_rate} for s in setups]), tz,
                  labels={"target_r": "Target R", "expected_win_rate": "Expected WR"})
    edit_names = ["+ New model"] + setup_names
    which = st.selectbox("Edit", edit_names)
    cur = next((s for s in setups if s.name == which), None)
    with st.form("setup_form", clear_on_submit=False):
        n1, n2, n3 = st.columns([2, 1, 1])
        name = n1.text_input("Name", value=cur.name if cur else "")
        status = n2.selectbox("Status", [s.value for s in SetupStatus],
                              index=[s.value for s in SetupStatus].index(cur.status.value) if cur else 0)
        timeframe = n3.text_input("Timeframe", value=cur.timeframe if cur else "")
        desc = st.text_area("Description", value=cur.description if cur else "", height=70)
        inst_opts = sorted(db.instruments())
        instruments = st.multiselect("Instruments", inst_opts, default=[i for i in (cur.instruments if cur else []) if i in inst_opts])
        r1, r2 = st.columns(2)
        target_r = r1.number_input("Target R", value=float(cur.target_r) if cur else 2.0, step=0.5)
        exp_wr = r2.number_input("Expected win rate", value=float(cur.expected_win_rate) if cur else 0.5, min_value=0.0, max_value=1.0, step=0.05)
        rules = st.text_area("Rules — one per line", value="\n".join(cur.rules) if cur else "", height=140,
                             placeholder="Range formed in first 15 min\nClose outside the range\nStop at opposite side")
        sub1, sub2 = st.columns([1, 5])
        save = sub1.form_submit_button("Save", type="primary", use_container_width=True)
        if save:
            if not name.strip():
                st.error("Give the model a name.")
            else:
                setup = Setup(name=name.strip(), description=desc.strip(), instruments=instruments, timeframe=timeframe.strip(),
                              rules=[r.strip() for r in rules.splitlines() if r.strip()], target_r=target_r,
                              expected_win_rate=exp_wr, status=SetupStatus(status), id=cur.id if cur else None)
                db.upsert_setup(setup)
                st.success(f"Saved '{setup.name}'.")
                st.rerun()
    if cur:
        if st.button(f"Delete '{cur.name}'", type="secondary"):
            db.delete_setup(cur.id)
            st.rerun()
