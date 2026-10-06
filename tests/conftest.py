"""Tests use an explicit loopback-only local app, never a real Google session."""
import pytest
import streamlit as st


@pytest.fixture(autouse=True)
def local_app(monkeypatch):
    monkeypatch.setenv("PRIMUSLAB_LOCAL_ONLY", "1")
    # run.sh supplies this CLI flag. AppTest does not start a server, so mirror it.
    get_option = st.get_option
    monkeypatch.setattr(st, "get_option", lambda name: "127.0.0.1" if name == "server.address" else get_option(name))
