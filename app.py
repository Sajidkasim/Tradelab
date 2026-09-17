"""TradeLab — entry point and navigation.

    streamlit run app.py
"""
import streamlit as st

from core.registry import load_extensions

st.set_page_config(page_title="TradeLab", page_icon="assets/icon.png", layout="wide", initial_sidebar_state="auto")
st.logo("assets/wordmark.png", icon_image="assets/icon.png", size="large")

pages = {
    "": [
        st.Page("views/overview.py", title="Overview", icon=":material/dashboard:", default=True),
        st.Page("views/performance.py", title="Performance", icon=":material/monitoring:"),
        st.Page("views/model_lab.py", title="Model Lab", icon=":material/science:"),
        st.Page("views/backtest.py", title="Backtest", icon=":material/history:"),
        st.Page("views/risk.py", title="Risk Manager", icon=":material/shield:"),
        st.Page("views/journal.py", title="Trades", icon=":material/receipt_long:"),
    ],
    "Data": [
        st.Page("views/import_.py", title="Import", icon=":material/upload:"),
        st.Page("views/settings.py", title="Settings", icon=":material/settings:"),
    ],
}
load_extensions("extensions")            # user plug-ins (import sources, coach providers)
st.navigation(pages, position="sidebar").run()
