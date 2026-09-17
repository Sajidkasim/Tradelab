"""PrimusLab — entry point and navigation.

    streamlit run app.py
"""
import streamlit as st

from core.registry import load_extensions

st.set_page_config(page_title="PrimusLab", page_icon="assets/primuslab-icon.svg", layout="wide", initial_sidebar_state="auto")
st.logo("assets/primuslab-wordmark.svg", icon_image="assets/primuslab-icon.svg", size="large")

pages = {
    "Daily": [
        st.Page("views/edge_lab.py", title="Test & Log", icon=":material/tune:", default=True),
        st.Page("views/overview.py", title="Dashboard", icon=":material/dashboard:"),
        st.Page("views/journal.py", title="Trade Journal", icon=":material/receipt_long:"),
    ],
    "Research": [
        st.Page("views/performance.py", title="Analytics", icon=":material/monitoring:"),
        st.Page("views/model_lab.py", title="Strategy Models", icon=":material/science:"),
        st.Page("views/backtest.py", title="Strategy Backtester", icon=":material/history:"),
    ],
    "Account": [
        st.Page("views/risk.py", title="Risk", icon=":material/shield:"),
        st.Page("views/import_.py", title="Import", icon=":material/upload:"),
        st.Page("views/settings.py", title="Settings", icon=":material/settings:"),
    ],
}
load_extensions("extensions")            # user plug-ins
st.navigation(pages, position="sidebar").run()
