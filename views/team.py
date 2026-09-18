"""A small team directory and explicitly shared, read-only results."""
import pandas as pd
import streamlit as st

from core import metrics, charts
from ui import access, state, components as c
from ui.style import theme_mode

state.page_setup("Team", sidebar_renderer=lambda _: st.caption("Shared results · your own journal stays in My workspace"))
identity = access.current_identity()
c.page_header("Your team", "Different strategies. One place to learn from each other.", "5 workspace places")

if not access.owner_email():
    c.empty_state("Bring your team together", "Start with your Google email, then add your four teammates.")
    if access.is_local():
        with st.form("team_owner_setup"):
            email = st.text_input("Your Google email", placeholder="you@gmail.com")
            if st.form_submit_button("Set workspace owner", type="primary"):
                try:
                    from services.team import Team
                    Team(access.root_database(), email)
                    access.root_database().set_setting("team_owner_email", email.strip().lower())
                    state.bump()
                    st.rerun()
                except ValueError as exc:
                    st.error(str(exc))
    st.caption("Google sign-in also needs connecting before teammates can join online. See TEAM_SETUP.md.")
    st.stop()

team = access.directory()
me = team.member(identity.key)
if access.is_local():
    st.info("You're using the local workspace. Connect Google sign-in before sharing the website with your team.")

with st.expander("My sharing", icon=":material/visibility:"):
    with st.form("team_sharing"):
        shared = st.checkbox("Let my teammates see my results", value=me["shared"])
        st.caption("Shares results, markets and strategy names. Trade notes, screenshots and account details stay private.")
        if st.form_submit_button("Save sharing"):
            team.set_sharing(identity.key, shared)
            state.bump()
            st.rerun()

roster = team.roster(identity.key)
active = [person for person in roster if person["active"]]
c.section("People", "Choose a teammate to explore the results they have shared.")
cards = []
for person in active:
    status = "Shared results" if person["shared"] else ("Private workspace" if person["joined"] else "Invited")
    cards.append({"label": person["name"], "value": "You" if person["key"] == identity.key else "Teammate", "caption": status})
c.kpi_row(cards)

selection = st.selectbox("Teammate", [person["key"] for person in active],
                         format_func=lambda key: next(person["name"] for person in active if person["key"] == key))
selected = next(person for person in active if person["key"] == selection)
if not selected["shared"]:
    c.note("This workspace is private. Results appear here when its owner chooses to share.")
else:
    # Permission and current sharing status are checked at read time; never cached across users.
    try:
        data = team.shared_results(identity.key, selection)
        scope = st.radio("Testing type", ["Backtests", "Live"], format_func=state.SOURCE_LABELS.get, horizontal=True)
        sample = data[data["source"].isin(state.SCOPES[scope])] if not data.empty else data
        stats = metrics.summary_stats(sample)
        c.kpi_row([
            {"label": "Closed trades", "value": str(stats["trades"])},
            {"label": "Win rate", "value": c.fmt_pct(stats["win_rate"])},
            {"label": "Average R", "value": c.fmt_r(stats["avg_r"])},
            {"label": "Net result", "value": c.fmt_money(stats["net_pnl"])}])
        if stats["small_sample"]:
            st.caption("Small sample: fewer than 30 closed trades.")
        if stats["trades"]:
            st.plotly_chart(charts.equity_chart(metrics.equity_curve(sample), theme_mode(), title=""),
                            use_container_width=True, config={"displayModeBar": False})
            c.section("Strategies", "Each strategy keeps its own record.")
            c.show_df(metrics.breakdown(sample, "setup_name"), labels={"setup_name": "Strategy"})
            with st.expander("Shared trades"):
                c.show_df(sample[["entry_time", "symbol", "direction", "setup_name", "net_pnl", "r_multiple"]], state.tz())
        else:
            c.empty_state("No results in this sample yet", "Try the other testing type, or check back after more trades are logged.")
    except PermissionError as exc:
        st.info(str(exc))

with st.expander("Compare shared results"):
    rows = []
    for person in active:
        if not person["shared"]:
            continue
        try:
            data = team.shared_results(identity.key, person["key"])
        except PermissionError:
            continue
        for scope in ("Backtests", "Live"):
            sample = data[data["source"].isin(state.SCOPES[scope])] if not data.empty else data
            result = metrics.summary_stats(sample)
            rows.append({"Teammate": person["name"], "Testing type": state.SOURCE_LABELS[scope],
                         "Trades": result["trades"], "Win rate": c.fmt_pct(result["win_rate"]),
                         "Average R": c.fmt_r(result["avg_r"]), "Sample": "Under 30" if result["small_sample"] else "30+"})
    if rows:
        st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
    else:
        st.caption("Comparisons appear when someone chooses to share.")

if identity.owner:
    with st.expander("Manage team", icon=":material/person_add:"):
        st.caption("Add a teammate's Google email, then send them the website link yourself. No email is sent by PrimusLab.")
        with st.form("team_invite"):
            name = st.text_input("Teammate's name")
            email = st.text_input("Teammate's Google email")
            if st.form_submit_button("Add teammate", type="primary"):
                try:
                    team.invite(identity.key, email, name)
                    state.bump()
                    st.rerun()
                except ValueError as exc:
                    st.error(str(exc))
        others = [person for person in roster if person["key"] != "owner"]
        if others:
            with st.form("team_access"):
                target = st.selectbox("Teammate access", [person["key"] for person in others],
                                      format_func=lambda key: next(p["name"] for p in others if p["key"] == key))
                enabled = st.radio("Access", ["Enabled", "Paused"], horizontal=True)
                st.caption("Pausing access also turns off that teammate's sharing. Their trades are kept.")
                if st.form_submit_button("Update access"):
                    team.set_active(identity.key, target, enabled == "Enabled")
                    state.bump()
                    st.rerun()
