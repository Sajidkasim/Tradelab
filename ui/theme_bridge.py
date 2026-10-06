"""Keep custom panels and Plotly in sync with Streamlit's native theme menu."""
from pathlib import Path
import streamlit as st
from streamlit.components.v1 import declare_component

_component = declare_component('primus_theme', path=str(Path(__file__).with_name('theme_sync')))


def sync_theme():
    with st.container(key='primus_theme_sync'):
        value = _component(key='primus_theme', default=None)
    if value in ('light', 'dark'):
        st.session_state['browser_theme'] = value
