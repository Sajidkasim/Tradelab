"""A focused workspace for recording and comparing trading hypotheses."""
import streamlit as st

from core import charts, edge, metrics
from ui import components as c, state
from ui.edge_lab import playbook, research_sidebar
from ui.style import theme_mode

c.page_header("Results", "See how your strategy performs.")
df_all, df = state.page_setup("Results", sidebar_renderer=research_sidebar)
mode = theme_mode()
db = state.get_db()
base = edge.prepare(df)
if not base.empty:
    base["setup_name"] = base["setup_name"].fillna("").replace("", "Unclassified")
scope = state.filters()["scope"]
lists = playbook()


def with_used(frame, values, column):
    """The playbook list first, then any label already on a trade in this sample (so nothing becomes unfilterable)."""
    used = sorted(set(frame[column].dropna()) - set(values) - {edge.UNKNOWN}) if column in frame else []
    return list(values) + used


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


@st.fragment
def explore(base, lists, mode):
    """Keep setup exploration together; extra statistics stay behind More detail."""
    db = state.get_db()
    builder, results = st.columns([1, 1.65], gap="large")
    with builder:
        strategies = with_used(base, lists["strategies"], "setup_name")
        remembered_strategy = st.session_state.get("edge_filter_strategy") or "All strategies"
        if remembered_strategy not in ["All strategies"] + strategies:
            strategies.append(remembered_strategy)
        strategy = st.selectbox("Strategy", ["All strategies"] + strategies, key="edge_filter_strategy") or "All strategies"
        with st.container(border=True):
            st.markdown("**Explore a setup**")
            recipes = state.setting("edge_recipes", {})
            if recipes:
                with st.expander("Saved combinations"):
                    recipe_name = st.selectbox("Combination", list(recipes), key="edge_saved_recipe")
                    st.button("Apply combination", on_click=load_recipe, args=(recipes[recipe_name],), use_container_width=True)
            direction = st.radio("Buy or sell?", ["Both", "long", "short"], horizontal=True,
                                 format_func=lambda v: {"Both": "Both", "long": "Buy", "short": "Sell"}[v], key="edge_filter_direction")
            level = st.selectbox("Key level / PDA", ["Any level"] + with_used(base, lists["levels"], "edge_level") + [edge.UNKNOWN],
                             key="edge_filter_level") or "Any level"
            tf_cols = st.columns(2)
            timeframe = tf_cols[0].selectbox("Level timeframe", ["Any timeframe"] + edge.TIMEFRAMES + [edge.UNKNOWN],
                                         key="edge_filter_timeframe", help="The chart the key level was drawn on.") or "Any timeframe"
            entry_timeframe = tf_cols[1].selectbox("Entry timeframe", ["Any timeframe"] + edge.TIMEFRAMES + [edge.UNKNOWN],
                                               key="edge_filter_entry_timeframe", help="The chart the entry was taken on.") or "Any timeframe"
            st.caption("Confirmations · selected boxes must all be present")
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
    matched = edge.select(base, **query)
    closed = metrics.closed(matched)
    s = metrics.summary_stats(matched)
    r_sample = metrics.summary_stats(closed[closed["r_multiple"].notna()]) if not closed.empty else metrics.summary_stats(closed)
    with results:
        c.selection_path([strategy, {"Both": "Buy + sell", "long": "Buy", "short": "Sell"}[direction],
                          level, " + ".join(confirmations) or "Any confirmation", window])
        c.kpi_row([
            {"label": "Win rate", "value": c.fmt_pct(s["win_rate"]),
             "caption": "Small sample · under 30 trades" if s["small_sample"] else "Closed wins and losses"},
            {"label": "Average R", "value": c.fmt_r(s["avg_r"]),
             "caption": f"R recorded on {r_sample['trades']} of {s['trades']} trades"},
            {"label": "Trade count", "value": f"{s['trades']:,}", "caption": "Matching closed trades"},
        ])
        if s["trades"]:
            st.plotly_chart(charts.equity_chart(metrics.equity_curve(matched), mode, title=""),
                            use_container_width=True, config={"displayModeBar": False}, key="edge_equity_chart")
        else:
            c.empty_state("No closed trades match yet", "Add a trade in Trades, or clear your setup filters.")
            st.page_link("views/journal.py", label="Go to Trades", icon=":material/receipt_long:")
    with st.expander("More detail"):
        c.kpi_row([
            {"label": "Net result", "value": c.fmt_money(s["net_pnl"])},
            {"label": "Profit factor", "value": c.fmt_ratio(s["profit_factor"])},
            {"label": "Win / loss size", "value": c.fmt_ratio(s["payoff_ratio"])},
            {"label": "Expectancy / trade", "value": c.fmt_money(s["expectancy"])},
        ])
        lo, hi = s["win_rate_ci"]
        st.caption(f"95% win-rate interval: {c.fmt_pct(lo)}–{c.fmt_pct(hi)}. "
                   f"{s['wins']} wins · {s['losses']} losses · {s['scratches']} break-even. "
                   f"Break-even trades are excluded from win rate; {s['open_trades']} open trades are excluded.")
        c.sample_progress(len(metrics.closed(base)))
        if not closed.empty:
            c.outcome_strip(closed.sort_values("exit_time"))
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
                                    use_container_width=True, config={"displayModeBar": False}, key="edge_breakdown_chart")
                with right:
                    c.show_df(table[[category, "trades", "win_rate", "avg_r", "small_sample"]],
                              labels={category: dimension, "avg_r": "Average R", "small_sample": "Under 30 trades"})
            else:
                c.empty_state("No groups meet that sample size", "Lower the minimum or add more trades to this sample.")
            st.caption("These are historical associations. A combination found in backtesting still needs a separate forward sample.")
            with st.container(border=True):
                st.caption(f"{s['trades']:,} matching closed trades")
                cols = ["entry_time", "symbol", "direction", "setup_name", "net_pnl", "r_multiple", "edge_level", "edge_confirmation_set", "edge_news"]
                c.show_df(closed[cols].sort_values("entry_time", ascending=False), state.tz(),
                          labels={"edge_level": "Key level", "edge_confirmation_set": "Confirmations", "edge_news": "News", "setup_name": "Strategy"})
                st.download_button("Export this sample", closed[cols].to_csv(index=False).encode(),
                                   "primuslab_edge_sample.csv", "text/csv")


explore(base, lists, mode)
