# Continuing PrimusLab with ChatGPT / Codex

You'll want to change things. This file makes that safe: the architecture in one page, the rules
a change must respect, and prompts you can paste. Use **Codex with GPT-6 Astra** pointed at the
repo folder for anything that touches more than one file; plain chat with **GPT-5.6 Sol** is fine
for a single page.

## React rebuild alongside Streamlit

The authorised browser rebuild is in `frontend/` and `webapp/`; see
[WEB_REBUILD.md](WEB_REBUILD.md). Keep the current Streamlit app available during
the transition. The same financial and privacy rules apply: React never computes
statistics, and the HTTP service calls the existing `core.metrics`, `core.edge`,
`core.charts` and database code without formula or signature changes.

For this interface, `frontend/src/components.jsx` replaces Streamlit's shared UI
components. `tools/web_theme.py` exports the existing PALETTE into CSS tokens for
both themes. `Workspaces.bump(key)` is the HTTP equivalent of `state.bump()` and
must run after writes. Access is checked for every private API request. Test new
logic with pytest, browser helper tests with Vitest, and the main user flows with
Playwright. Tests use a disposable database and never populate the hosted journal.

The React API is now single-owner and uses a personal password, not Google or
team membership. webapp.personal_access handles Argon2id password verification,
a bounded login throttle and revocable sessions stored separately from trades.
Do not reintroduce team selectors or mix their schemas into the owner journal.
Password entry/setup is performed by the human user; do not print credentials.
See GO_LIVE.md for the current four hosting settings and local setup helper.

## Owner-approved Strategy Lab draft (27 October 2026)

For the React laboratory only, the owner has explicitly requested one combined
All history and summary, with Backtesting and Live trading available separately.
This overrides the earlier separate-sample presentation requirement for All.
Keep original source labels and use core.metrics/core.charts on the selected raw
trades; never average per-source statistics in React. The owner has now authorised full tests and publishing the completed design.
See WEB_REBUILD.md for the implemented import, session and deletion safeguards.

The React importer keeps configuration in Import settings (File preferences /
Tag meanings). New strategies and renamed tags are user-editable guide entries,
not a fixed pair of models. Aliases preserve earlier names. Explicit keep-only
entries retain tags without classification. Preferences affect future imports;
existing labels only change through the explicit previewed re-import option.
All financial fields and core signatures remain untouched by these settings.

Explore a strategy also filters by entry weekday using the configured laboratory
session timezone (fixed UTC−4 by default). CSV Day meanings keep the original tag;
an import preview flags disagreement with the entry date. Day tags never replace
timestamps or determine the weekday filter. Existing untagged trades work too.

For the owner's explicitly confirmed full-target/stop tests, services.fixed_rr
adapts tagged backtests into separate model observations and calls the existing
core summary. Never save those model observations as recorded R or original risk.
Live/untagged/zero-result trades are excluded, recorded R takes priority in the
headline, and every future ratio requires its own explicit full-exit confirmation.

## The one-page architecture

```
app.py                  navigation only (st.navigation with one st.Page per view)
views/<page>.py         a page = read filters → call core → render with ui.components + core.charts
ui/state.py             page_setup(), global filters, get_db(), cached trades(), bump() after writes
ui/components.py        hero, kpi_row, progress, section, page_header, pill, big_number, note, empty_state, show_df, with_pct
ui/log_trade.py         the Log trade popover form (a fragment)
core/registry.py        extension points: import sources, coach providers; extensions/ is auto-loaded
views/_template_page.py copy this to add a page
ui/style.py             all CSS (Inter, hero, glass cards, motion); colours from core.charts.PALETTE; theme_mode()
ui/coach_panel.py       dormant Coach UI (not used by active pages)
core/coach.py           dormant Coach engine; retained for compatibility, not called by app or nightly
.streamlit/config.toml  native [theme.light] / [theme.dark] + Inter font faces served from static/
core/metrics.py         every statistic (summary_stats, breakdown, equity_curve, streaks, …)
core/risk.py            sizing, daily limit, trailing drawdown, consistency, Kelly, ruin, Monte Carlo
core/backtest.py        engine, sweep, plateau_check, walk_forward, rule builder, plugin loader
core/fills_to_trades.py FIFO pairing of fills; reconcile_with_broker
core/importers.py       auto_map, detect_shape, normalise, fingerprint, read_any
core/projectx_api.py    read-only TopstepX client (no order endpoints — keep it that way)
core/db.py              SQLAlchemy data layer, SQLite locally / Postgres hosted
core/charts.py          Plotly helpers, dark + light palette, theme()
strategies/*.py         backtest strategies: generate_signals(bars, params) + PARAMS + RANGES
nightly.py              auto-journal script
tests/                  regression suite — run `python -m pytest -q` after every change
```

Every page starts with `df_all, df = state.page_setup("Name")` — `df` is already filtered by the
sidebar. Reads go through `state.trades()`; after any write call `state.bump()` so caches refresh.

## Adding things — where each kind of change goes

| You want to… | Do this | Restart needed? |
|---|---|---|
| Store a new field on trades (e.g. `strike`) | Add a `Column(...)` to `trades_t` in `core/db.py` and a field on `Trade` in `core/models.py`. The database **auto-migrates** on next start (SQLite and Postgres). | yes |
| Add a new page | Copy `views/_template_page.py`, add one `st.Page(...)` line in `app.py`. | yes |
| Add a new import source (another broker) | Drop a file in `extensions/` that calls `core.registry.register_import_source(...)` — see `extensions/_example_source.py`. It appears as a tab on Import. No core changes. | yes |
| Add a statistic | A pure function in `core/metrics.py` + a test in `tests/test_metrics.py`; then show it via `ui.components`. | no |
| Add a backtest strategy | A file in `strategies/` with `generate_signals`, `PARAMS`, `RANGES`. | no |
| Add a risk rule | A function in `core/risk.py` + test; surface it on the Risk page's relevant tab. | no |
| Make an interactive widget feel instant | Wrap it in a function decorated `@st.fragment` (see `ui/log_trade.py`, `views/risk.py`). | no |
| Add a coach provider | `core.registry.register_coach_provider(name, fn)` from an extension file. | yes |
| Change colours / spacing / type | `ui/style.py` (CSS) and `.streamlit/config.toml` (theme tokens). Charts: `core/charts.py` PALETTE. | no |

Tables are created and migrated additively; nothing is ever dropped automatically.

## Rules for any change (paste these into the first message)

```
Rules for working on this repository:
1. Statistics come from core.metrics, risk numbers from core.risk, charts from core.charts. Never recompute a
   win rate, P&L, R or drawdown inside a view file.
2. Do not change formulas or signatures in core/. If you think there is a bug, write a failing test in tests/
   that proves it, show me, and wait.
3. The app is read-only toward the broker. Never add order placement, modification or cancellation.
4. Secrets come from .env / st.secrets only. Never hardcode, log or display an API key.
5. New UI uses ui.components (hero, kpi_row, section, show_df, pill, empty_state) and st.plotly_chart(fig,
   use_container_width=True, config={"displayModeBar": False}) with mode from ui.style.theme_mode().
   Both themes must work: colours only via the CSS variables in ui/style.py (--tl-ink, --tl-surface, …) or
   core.charts.PALETTE. No new hex colours in views, no st.metric, no emoji in headings.
6. Live and backtest trades stay separate: use state.SCOPES / LIVE_SOURCES / BACKTEST_SOURCES.
7. After every write to the database call state.bump().
8. Run `python -m pytest -q` and paste the output before you tell me you're done. Add a test for any new
   logic that isn't pure UI.
9. Give me complete files, never fragments with "..." in them.
```

## Prompts

**Start a session (Codex)**
> Read README.md and CONTINUING_WITH_CHATGPT.md, then `views/overview.py` and `ui/state.py` so you know the patterns. Confirm the nine rules in one line each. Then wait for my request.

**Add a page section**
> On the Analytics page, add a section "Expectancy by month" under the breakdowns: use metrics.add_time_features to derive a `month` column (YYYY-MM), metrics.breakdown(df, "month"), and charts.breakdown_bar with value "expectancy". Follow the existing section pattern. Complete file, tests still green.

**Add a strategy for the backtester**
> Create strategies/vwap_reclaim.py implementing generate_signals(bars, params) -> DataFrame with signal/stop/target: long when close crosses back above session VWAP after having been below it for at least `min_bars_below` bars, stop `stop_atr` ATRs below entry, target `target_r` × risk. Use core.backtest.vwap and core.backtest.atr. Include PARAMS and RANGES. Add a test in tests/ that runs it on 300 synthetic bars and asserts it returns one row per bar with signals in {-1,0,1}.

**Options fields**
> Add optional fields strike, expiry, option_type (call/put) and legs (JSON) to Trade, the trades table (core/db.py, additive columns only), the Journal editor and the manual entry form. Multiplier for options stays 100. Keep every existing test passing and add one that round-trips an option trade through the database.

**Change what the coach says**
> Edit `SYSTEM_PROMPT` in core/coach.py to add a fifth heading "### Session plan for tomorrow" (two bullets, based on the best session and model in the brief). Keep it under 260 words. Update tests/test_coach.py if the heading list is asserted anywhere.

**Pin the FX Replay mapping**
> Here is the header row of my FX Replay export: [paste]. Add an entry to core.importers.SYNONYMS for any column that auto_map misses, and add a test that auto_map on exactly these headers maps symbol, direction, pnl, r_multiple, session and entry_time.

**Something looks wrong**
> Screenshot attached at 1280px width. [say what's wrong]. Fix it in ui/style.py or the view file; don't touch core/.

**Check it before I deploy**
> Run `python -m pytest -q`. Then start `streamlit run app.py --server.headless true` and use tools/shoot.py to screenshot each page (views listed in app.py). Report any exception text you see and fix it.

**If it "improves" the core**
> You changed core/metrics.py. Revert that file to its previous content and make the change in the view instead. The core's answers are hand-verified; rewrites are how silent errors get in.

## What to keep an eye on

- After each live pull, Import → Live API shows **reconciliation** against the broker. It should be zero.
  If it isn't, an instrument multiplier is wrong (Settings → Instruments), not the maths.
- Any statistic on fewer than 30 trades carries a **small sample** badge. It's there for a reason.
- The backtester's **plateau verdict** and **walk-forward OOS** are the anti-fooling-yourself tools. A single
  green backtest is not evidence.
