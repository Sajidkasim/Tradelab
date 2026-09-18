"""Tests use an explicit loopback-only local app, never a real Google session."""
import pytest


@pytest.fixture(autouse=True)
def local_app(monkeypatch):
    monkeypatch.setenv("PRIMUSLAB_LOCAL_ONLY", "1")
