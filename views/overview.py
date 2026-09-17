import pandas as pd
import streamlit as st

from core import charts, metrics, risk
from ui import components as c
from ui import state
from ui.style import theme_mode

df_all, df = state.page_setup("Dashboard")
mode = theme_mode()
tz = state.tz()
acct = state.account()
f = state.filters()

c.page_header("Dashboard", f"Your account at a glance · {f['scope']} trades · {f['preset'].lower()}",
              f"{acct.name} · start {c.fmt_money(acct.starting_balance, sign=False)}")

if df_all.empty:
    c.empty_state("No trades yet", "Load demo data to explore, or open Import to bring in your own trades.")
    col1, col2, _ = st.columns([1, 1, 3])
    if col1.button("Load demo data", type="primary", use_container_width=True):
        from core.demo import seed_demo_trades
        state.get_db().insert_trades(seed_demo_trades(200, account_id=acct.id))
        state.filters()["scope"] = "Demo"
        state.bump(); st.rerun()
    if col2.button("Go to Import", use_container_width=True):
        st.switch_page("views/import_.py")
    st.stop()

if df.empty:
    c.empty_state("Nothing in this view", "No trades match the current filters. Try 'All time' or change the Data scope.")
    c.scope_hint(df_all)
    st.stop()

# ---- hero ----------------------------------------------------------------------------
s = metrics.summary_stats(df, acct.starting_balance)
lo, hi = s["win_rate_ci"]
streak = s["current_streak"]
tone = "pos" if s["net_pnl"] > 0 else ("neg" if s["net_pnl"] < 0 else "")
a = 0.28 if mode == "dark" else 0.14
glow = {"pos": f"rgba(12,163,12,{a})", "neg": f"rgba(208,59,59,{a})"}.get(tone, None)
streak_txt = (f"{abs(streak)} {'win' if streak > 0 else 'loss'}{'' if abs(streak) == 1 else ('s' if streak > 0 else 'es')} running"
              if streak else "no streak")
line = (f"<b>{s['trades']}</b> closed trades over <b>{s['trading_days']}</b> days · "
        f"{c.fmt_pct(s['return_pct']) if s['return_pct'] is not None else '—'} on the starting balance · {streak_txt}"
        + (" · <b>small sample</b> — treat every number as rough" if s["small_sample"] else ""))
c.hero(
    eyebrow=f"Net P&L · {f['scope'].lower()} · {f['preset'].lower()}",
    number=c.fmt_money(s["net_pnl"]), line_html=line, tone=tone, glow=glow,
    facts=[
        {"k": "Win rate", "v": f"{c.fmt_pct(s['win_rate'])}  ·  CI {lo:.0%}–{hi:.0%}"},
        {"k": "Expectancy", "v": c.fmt_r(s["expectancy_r"]), "tone": "pos" if (s["expectancy_r"] or 0) > 0 else ("neg" if (s["expectancy_r"] or 0) < 0 else "")},
        {"k": "Profit factor", "v": c.fmt_ratio(s["profit_factor"])},
        {"k": "Max drawdown", "v": c.fmt_money(-s["max_drawdown"]) if s["max_drawdown"] else "$0.00", "tone": "neg" if s["max_drawdown"] > acct.max_trailing_drawdown * 0.5 else ""},
        {"k": "Avg hold", "v": f"{s['avg_hold_minutes']:.0f} min" if s["avg_hold_minutes"] else "—"},
    ],
)

# ---- today strip ------------------------------------------------------------------------
rdf = state.risk_df(df_all)
today = state.today_slice(rdf)
realised = float(today["net_pnl"].sum()) if today is not None and not today.empty else 0.0
ds = risk.daily_status(realised, acct.daily_loss_limit, len(today) if today is not None else 0, acct.max_trades_per_day)
live_daily = metrics.daily_pnl(rdf) if rdf is not None and not rdf.empty else pd.Series(dtype=float)
tiles = [
    {"label": "Realised today", "value": c.fmt_money(realised), "tone": c.tone_for(realised) or "",
     "caption": f"{c.fmt_pct(realised / acct.starting_balance, 2) if acct.starting_balance else '—'} · {ds['state']} · {c.fmt_money(ds['remaining'], sign=False)} left"},
    {"label": "Trades today", "value": str(ds["trades_today"]), "caption": f"max {acct.max_trades_per_day} per day"},
]
if len(live_daily):
    td = risk.trailing_drawdown_from_daily(live_daily, acct.starting_balance, acct.max_trailing_drawdown)
    last = td.iloc[-1]
    buf = float(last["buffer"])
    tiles.append({"label": "Drawdown buffer", "value": c.fmt_money(buf, sign=False),
                  "tone": "bad" if buf < acct.max_trailing_drawdown * 0.25 else ("warn" if buf < acct.max_trailing_drawdown * 0.5 else "good"),
                  "caption": f"limit at {c.fmt_money(last['threshold'], sign=False)}"})
    cons = risk.consistency(live_daily, acct.consistency_target_pct)
    if cons["best_day_pct"] is not None:
        tiles.append({"label": "Consistency", "value": f"{cons['best_day_pct']:.0f}%",
                      "tone": "good" if cons["compliant"] else "warn",
                      "caption": f"best day vs {acct.consistency_target_pct:.0f}% target"})
tiles.append({"label": "Best day", "value": c.fmt_money(s["best_day"]), "caption": f"worst {c.fmt_money(s['worst_day'])}"})
c.kpi_row(tiles)

# ---- equity ---------------------------------------------------------------------------------
c.section("Equity", "Cumulative net P&L after each closed trade, drawdown from the running peak beneath")
eq = metrics.equity_curve(df, acct.starting_balance)
st.plotly_chart(charts.equity_chart(eq, mode, title="", starting_balance=acct.starting_balance), use_container_width=True,
                config={"displayModeBar": False})

# ---- calendar -------------------------------------------------------------------------------
c.section("Daily P&L", "One square per trading day")
st.plotly_chart(charts.calendar_heatmap(metrics.daily_pnl(df), mode, title=""), use_container_width=True,
                config={"displayModeBar": False})

c.section("Recent trades", "Last 15 closed trades in this view · full list in Trade Journal")
recent = c.with_pct(df[df["exit_time"].notna()].sort_values("exit_time", ascending=False).head(15), acct.starting_balance)
c.show_df(recent[c.TRADE_LIST_COLS], tz, labels=c.TRADE_LIST_LABELS)
