"""PrimusLab — entry point and navigation.

    streamlit run app.py
"""
import streamlit as st

from core.registry import load_extensions
from ui import access

st.set_page_config(page_title="PrimusLab", page_icon="assets/primuslab-icon.svg", layout="wide", initial_sidebar_state="auto")
st.logo("assets/primuslab-wordmark.svg", icon_image="assets/primuslab-icon.svg", size="large")
from ui.theme_bridge import sync_theme
sync_theme()
access.require_login()

pages = {
    "Daily": [
        st.Page("views/edge_lab.py", title="Results", icon=":material/tune:", default=True),
        st.Page("views/journal.py", title="Trades", icon=":material/receipt_long:"),
        st.Page("views/team.py", title="Team", icon=":material/group:"),
    ],
    "Trade actions": [st.Page("views/import_.py", title="Import FX Replay", icon=":material/upload:")],
    "More tools": [
        st.Page("views/performance.py", title="Analytics", icon=":material/monitoring:"),
        st.Page("views/model_lab.py", title="Strategy Models", icon=":material/science:"),
        st.Page("views/backtest.py", title="Strategy Backtester", icon=":material/history:"),

        st.Page("views/risk.py", title="Risk", icon=":material/shield:"),
        st.Page("views/settings.py", title="Settings", icon=":material/settings:"),
    ],
}
load_extensions("extensions")            # user plug-ins
navigation = st.navigation(pages, position="hidden")
with st.sidebar:
    for page in pages["Daily"]:
        st.page_link(page)
    with st.expander("More tools", icon=":material/apps:"):
        for page in pages["More tools"]:
            st.page_link(page)
navigation.run()
