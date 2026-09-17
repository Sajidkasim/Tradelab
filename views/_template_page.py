"""Template for a new page. Copy to views/my_page.py, then add one line to app.py:
    st.Page("views/my_page.py", title="My page", icon=":material/star:")

Rules: stats from core.metrics, risk from core.risk, charts from core.charts, layout from ui.components.
"""
import streamlit as st

from core import charts, metrics
from ui import components as c
from ui import state
from ui.style import theme_mode

df_all, df = state.page_setup("My page")      # CSS + sidebar filters; df is already filtered
mode = theme_mode()
tz = state.tz()
acct = state.account()

c.page_header("My page", "One sentence on what this page answers")

if df.empty:
    c.empty_state("Nothing in this view", "Import trades or widen the filters.")
    st.stop()

s = metrics.summary_stats(df, acct.starting_balance)
c.kpi_row([
    {"label": "Net P&L", "value": c.fmt_money(s["net_pnl"]), "tone": c.tone_for(s["net_pnl"])},
    {"label": "Win rate", "value": c.fmt_pct(s["win_rate"])},
])

c.section("A chart", "Use core.charts so it follows the theme")
st.plotly_chart(charts.equity_chart(metrics.equity_curve(df, acct.starting_balance), mode, title=""),
                use_container_width=True, config={"displayModeBar": False})
