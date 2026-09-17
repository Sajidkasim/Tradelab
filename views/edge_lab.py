"""A focused workspace for recording and comparing trading hypotheses."""
import streamlit as st

from core import charts, edge, metrics
from ui import components as c, state
from ui.edge_lab import SCOPE_LABELS, playbook, playbook_editor, quick_log, research_sidebar, review_imports
from ui.style import theme_mode

df_all, df = state.page_setup("Test & Log", sidebar_renderer=research_sidebar)
mode = theme_mode()
db = state.get_db()
base = edge.prepare(df)
scope = state.filters()["scope"]
base_stats = metrics.summary_stats(base)
lists = playbook()


def with_used(values, column):
    """The playbook list first, then any label already on a trade in this sample (so nothing becomes unfilterable)."""
    used = sorted(set(base[column].dropna()) - set(values) - {edge.UNKNOWN}) if column in base else []
    return list(values) + used


def change_lane(lane):
    st.session_state["edge_lane"] = lane


def reset_explorer():
    for key in list(st.session_state):
        if key.startswith("edge_filter_"):
            del st.session_state[key]


def load_recipe(recipe):
    reset_explorer()
    for name, value in recipe.items():
        if name == "confirmations":
            for confirmation in value:
                st.session_state[f"edge_filter_confirm_{confirmation}"] = True
        else:
            st.session_state[f"edge_filter_{name}"] = value


active_lane = st.session_state.get("edge_lane", "Explore my edge")
if active_lane == "Log a trade":
    c.page_header("One trade at a time.", "Capture the setup. Keep the evidence.", SCOPE_LABELS[scope])
elif active_lane == "Import & review":
    c.page_header("Turn trades into evidence.", "Bring in your history, then add what you saw.", SCOPE_LABELS[scope])
else:
    c.research_header(SCOPE_LABELS[scope])
if "edge_flash" in st.session_state:
    st.success(st.session_state.pop("edge_flash"))
if active_lane == "Explore my edge":
    with st.container(key="edge_sample"):
        c.sample_progress(base_stats["trades"])
lane = st.radio("Workspace", ["Explore my edge", "Log a trade", "Import & review"],
                format_func=lambda v: {"Explore my edge": "My Results", "Log a trade": "Add Trade", "Import & review": "Review Imports"}[v],
                horizontal=True, key="edge_lane", label_visibility="collapsed")

if lane == "Log a trade":
    quick_log()
elif lane == "Import & review":
    review_imports(base)
else:
    builder, results = st.columns([0.92, 1.55], gap="large")
    with builder:
        with st.container(border=True, key="edge_builder"):
            c.step_label("01", "Build a question", "What happens when these conditions line up?")
            recipes = db.get_setting("edge_recipes", {})
            if recipes:
                with st.expander("Saved combinations"):
                    recipe_name = st.selectbox("Combination", list(recipes), key="edge_saved_recipe")
                    st.button("Apply combination", on_click=load_recipe, args=(recipes[recipe_name],), use_container_width=True)
            direction = st.radio("Buy or sell?", ["Both", "long", "short"], horizontal=True,
                                 format_func=lambda v: {"Both": "Both", "long": "Buy", "short": "Sell"}[v], key="edge_filter_direction")
            strategies = with_used(lists["strategies"], "setup_name")
            remembered_strategy = st.session_state.get("edge_filter_strategy") or "All strategies"
            if remembered_strategy not in ["All strategies"] + strategies:
                strategies.append(remembered_strategy)
            strategy = st.selectbox("Strategy", ["All strategies"] + strategies, key="edge_filter_strategy") or "All strategies"
            level = st.selectbox("Key level / PDA", ["Any level"] + with_used(lists["levels"], "edge_level") + [edge.UNKNOWN],
                                 key="edge_filter_level") or "Any level"
            tf_cols = st.columns(2)
            timeframe = tf_cols[0].selectbox("Level timeframe", ["Any timeframe"] + edge.TIMEFRAMES + [edge.UNKNOWN],
                                             key="edge_filter_timeframe", help="The chart the key level was drawn on.") or "Any timeframe"
            entry_timeframe = tf_cols[1].selectbox("Entry timeframe", ["Any timeframe"] + edge.TIMEFRAMES + [edge.UNKNOWN],
                                                   key="edge_filter_entry_timeframe", help="The chart the entry was taken on.") or "Any timeframe"
            c.step_label("02", "Add the confirmation", "Checked boxes must all be present on the trade")
            cols = st.columns(2)
            confirmations = [value for i, value in enumerate(edge.CONFIRMATIONS)
                             if cols[i % 2].checkbox(value, key=f"edge_filter_confirm_{value}")]
            with st.expander("Session, news & market"):
                window = st.selectbox("Session window", ["New York", "All sessions"] + list(edge.NY_WINDOWS) + ["Other"], key="edge_filter_window") or "New York"
                st.caption("New York = 08:30–16:00 ET. Opening drive = 09:30–10:00 ET.")
                news = st.selectbox("News", ["Any news status"] + edge.NEWS + [edge.UNKNOWN], key="edge_filter_news") or "Any news status"
                condition = st.selectbox("Market condition", ["Any condition"] + edge.CONDITIONS + [edge.UNKNOWN], key="edge_filter_condition") or "Any condition"
                remembered_symbol = st.session_state.get("edge_filter_symbol") or "All markets"
                symbols = sorted(set(base["symbol"].dropna()) | {remembered_symbol}) if not base.empty else [remembered_symbol]
                symbols = [s for s in symbols if s != "All markets"]
                symbol = st.selectbox("Market", ["All markets"] + symbols, key="edge_filter_symbol") or "All markets"
            query = dict(direction=direction, strategy=strategy, level=level, timeframe=timeframe, entry_timeframe=entry_timeframe,
                         confirmations=confirmations, news=news, condition=condition, window=window, symbol=symbol)
            with st.expander("Save this combination"):
                name = st.text_input("Name", placeholder="e.g. NY buy · 4H FVG · SMT + CISD", key="edge_recipe_name")
                if st.button("Save combination", disabled=not name.strip(), use_container_width=True):
                    db.set_setting("edge_recipes", {**recipes, name.strip(): query})
                    state.bump()
                    st.toast("Combination saved")
            st.button("Clear setup filters", on_click=reset_explorer, use_container_width=True)
            st.caption("Start broad. Add one condition at a time.")
    matched = edge.select(base, **query)
    closed = metrics.closed(matched)
    s = metrics.summary_stats(matched)
    r_sample = metrics.summary_stats(closed[closed["r_multiple"].notna()]) if not closed.empty else metrics.summary_stats(closed)
    with results:
        c.selection_path([{"Both": "Buy + sell", "long": "Buy", "short": "Sell"}[direction], strategy,
                          level, " + ".join(confirmations) or "Any confirmation", window])
        badge = c.pill("amber", "Small sample") if s["small_sample"] else c.pill("info", f"{s['trades']:,} closed trades")
        c.hero("WIN RATE · YOUR SELECTED COMBINATION", c.fmt_pct(s["win_rate"]),
               f"{s['wins']} wins <span class='tl-separator'>/</span> {s['losses']} losses "
               f"<span class='tl-separator'>/</span> {s['scratches']} break-even &nbsp; {badge}",
               facts=[{"k": "Average R / trade", "v": c.fmt_r(s["avg_r"])},
                      {"k": "Profit factor", "v": c.fmt_ratio(s["profit_factor"])},
                      {"k": "Matching trades", "v": f"{s['trades']:,}"}])
        if s["trades"]:
            c.kpi_row([{"label": "Net result", "value": c.fmt_money(s["net_pnl"]), "tone": c.tone_for(s["net_pnl"])},
                       {"label": "Win / loss size", "value": c.fmt_ratio(s["payoff_ratio"]), "caption": "Average $ win ÷ average $ loss"},
                       {"label": "Expectancy / trade", "value": c.fmt_money(s["expectancy"]), "caption": "Average net dollars, including fees"}])
            lo, hi = s["win_rate_ci"]
            interval = f"{c.fmt_pct(lo)}–{c.fmt_pct(hi)}" if s["win_rate"] is not None else "needs a win or loss"
            st.caption(f"95% win-rate interval: {interval} · R recorded on {r_sample['trades']} of {s['trades']} trades.")
            st.caption(f"Break-even trades are excluded from win rate. {s['open_trades']} open trade(s) excluded from all results.")
            if s["small_sample"]:
                c.note("<b>Still collecting evidence.</b> Fewer than 30 matching trades. Keep logging before drawing conclusions.")
            c.section("The path, not just the percentage", "Net P&L and drawdown for this exact combination · chronological order")
            st.plotly_chart(charts.equity_chart(metrics.equity_curve(matched), mode, title=""),
                            use_container_width=True, config={"displayModeBar": False})
            c.outcome_strip(closed.sort_values("exit_time"))
            st.caption("Last 30 results · W win / L loss / B break-even · hover for the trade result")
        else:
            c.empty_state("No closed trades match yet", "Log this setup, label imported trades, or clear a filter to explore a wider sample.")
            btns = st.columns(2)
            btns[0].button("Log the first trade", on_click=change_lane, args=("Log a trade",), type="primary", use_container_width=True)
            btns[1].button("Import & label trades", on_click=change_lane, args=("Import & review",), use_container_width=True)
            c.note("<b>Make the result explainable.</b> The same tags you select here are the ones you record on each trade.")
    if not closed.empty:
        c.section("What makes the difference?", "Compare within your current filters. Change one dimension to investigate the pattern.")
        row = st.columns([1.2, 1, 1])
        dimensions = {"Strategy": "setup_name", "Key level": "edge_level", "Confirmation combination": "edge_confirmation_set",
                      "Buy / sell": "direction", "New York window": "edge_window", "News day": "edge_news",
                      "Market condition": "edge_condition", "Level timeframe": "edge_timeframe",
                      "Entry timeframe": "edge_entry_timeframe"}
        dimension = row[0].selectbox("Compare by", list(dimensions), key="edge_compare_by")
        values = {"Average R": "avg_r", "Win rate": "win_rate", "Net P&L": "net_pnl"}
        value = row[1].selectbox("Show", list(values), key="edge_compare_value")
        min_trades = row[2].selectbox("Minimum trades per group", [1, 10, 30, 50, 100], key="edge_compare_min")
        category = dimensions[dimension]
        table = metrics.breakdown(matched, category)
        table = table[table["trades"] >= min_trades]
        if not table.empty:
            left, right = st.columns([1.3, 1])
            with left:
                st.plotly_chart(charts.breakdown_bar(table, category, values[value], mode, title="", by_sign=value != "Win rate"),
                                use_container_width=True, config={"displayModeBar": False})
            with right:
                c.show_df(table[[category, "trades", "win_rate", "avg_r", "small_sample"]],
                          labels={category: dimension, "avg_r": "Average R", "small_sample": "Under 30 trades"})
        else:
            c.empty_state("No groups meet that sample size", "Lower the minimum or add more trades to this sample.")
        st.caption("These are historical associations. A combination found in backtesting still needs a separate forward sample.")
        with st.expander(f"Inspect the {s['trades']:,} matching closed trades"):
            cols = ["entry_time", "symbol", "direction", "setup_name", "net_pnl", "r_multiple", "edge_level", "edge_confirmation_set", "edge_news"]
            c.show_df(closed[cols].sort_values("entry_time", ascending=False), state.tz(),
                      labels={"edge_level": "Key level", "edge_confirmation_set": "Confirmations", "edge_news": "News", "setup_name": "Strategy"})
            st.download_button("Export this sample", closed[cols].to_csv(index=False).encode(),
                               "primuslab_edge_sample.csv", "text/csv")

with st.expander("Edit strategies & key levels", icon=":material/edit_note:"):
    playbook_editor()
