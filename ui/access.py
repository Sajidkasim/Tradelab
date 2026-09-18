"""Google login gate and current-user storage. Identity never comes from a picker."""
import os
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

from core.db import Database
from core.models import Account
from services.team import Identity, Team

load_dotenv()


def setting(name, default=""):
    if os.getenv(name) is not None:
        return os.environ[name]
    try:
        return st.secrets.get(name, default)
    except FileNotFoundError:
        return default


def auth_configured():
    try:
        return bool(st.secrets.get("auth", {}).get("client_id"))
    except FileNotFoundError:
        return False


def is_local():
    # Explicit opt-in AND a loopback-bound server. Hosted deployments fail closed.
    return (setting("PRIMUSLAB_LOCAL_ONLY") == "1" and not auth_configured()
            and st.get_option("server.address") in ("127.0.0.1", "localhost", "::1"))


@st.cache_resource(show_spinner=False)
def root_database():
    db = Database.from_env()
    db.init()
    if not db.accounts():
        db.upsert_account(Account("My account", 50000, 1000, 2000))
    return db


def owner_email():
    return str(setting("PRIMUSLAB_OWNER_EMAIL") or root_database().get_setting("team_owner_email", "")).strip().lower()


@st.cache_resource(show_spinner=False)
def _team(email):
    return Team(root_database(), email)


def directory():
    return _team(owner_email())


def current_identity():
    if is_local():
        return Identity("owner", "My workspace", True)
    if not auth_configured() or not st.user.is_logged_in:
        raise PermissionError("Sign in to open your workspace.")
    return directory().join(dict(st.user))


def require_login():
    from ui import components as c
    from ui.style import inject_css
    try:
        identity = current_identity()
    except (PermissionError, ValueError) as exc:
        inject_css()
        c.page_header("Welcome to PrimusLab", "Your trading workspace. Your team, when you choose to share.")
        if not auth_configured():
            st.info("Google sign-in needs connecting before this website can be opened to the team.")
            st.caption("Setup instructions: TEAM_SETUP.md. Local use: start with run.sh or run.bat.")
        elif not st.user.is_logged_in:
            st.button("Continue with Google", on_click=st.login, type="primary")
            st.caption("Only the owner and invited teammates can enter.")
        else:
            st.warning(str(exc))
            st.button("Use another Google account", on_click=st.logout)
        st.stop()
    old = st.session_state.get("workspace_identity")
    if old is not None and old != identity.key:
        st.session_state.clear()
    st.session_state["workspace_identity"] = identity.key
    return identity


@st.cache_resource(show_spinner=False)
def _member_database(email, key):
    return _team(email).database(key)


def current_database():
    identity = current_identity()
    if is_local():
        return root_database()
    directory().member(identity.key)  # check revocation before every data access
    return _member_database(owner_email(), identity.key)


def can_use_broker():
    return current_identity().owner


def sidebar():
    identity = current_identity()
    st.caption("MY WORKSPACE" if is_local() else identity.name)
    if not is_local():
        with st.popover("My account", icon=":material/account_circle:"):
            st.write(identity.name)
            st.button("Sign out", on_click=st.logout)


def screenshot_directory():
    path = Path("data/screenshots") / current_identity().key
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_screenshot(value):
    if not value:
        return None
    candidate = Path(value).resolve()
    root = Path("data/screenshots").resolve()
    key = current_identity().key
    allowed = candidate.is_relative_to(root / key)
    # Existing owner screenshots used the root folder before team accounts existed.
    allowed = allowed or (key == "owner" and candidate.parent == root)
    return candidate if allowed and candidate.is_file() else None
