# AGENTS.md — PrimusLab (`Sajidkasim/Tradelab`)

Architecture overview and engineering rules for future sessions working on this repository (`main` branch).

## 1. What This App Does
**PrimusLab** is a Python + Streamlit trading journal, playbook/edge-research lab, prop-firm risk dashboard, and event-driven strategy backtester built for discretionary futures/options traders (TopstepX / ProjectX and FX Replay imports). It supports an invite-only workspace for up to **5 users** (1 owner + up to 4 teammates).

## 2. Tech Stack
- **Framework:** Python 3.11+, Streamlit (`>=1.46,<2`), Authlib (Google OIDC)
- **Data & Analytics:** Pandas, NumPy, Plotly, `openpyxl`
- **Storage:** SQLAlchemy Core (`>=2.0`) with SQLite locally and PostgreSQL (`psycopg[binary]`) on Supabase in production
- **HTTP / Integrations:** `requests` (read-only TopstepX/ProjectX client, optional AI coach)
- **Tests:** `pytest` (including Streamlit `AppTest` UI tests in `tests/`)

## 3. Repository Structure & How Layers Connect
This is a single-repo Streamlit monolith (no separate REST API server or JS build pipeline).

- **Entry points**
  - `app.py` — Sets page config/logo, syncs Streamlit theme (`ui/theme_bridge.py`), runs `access.begin_run()` + `access.require_login()`, loads `extensions/`, defines `st.navigation(..., position="hidden")`, and renders sidebar links.
  - `nightly.py` — Standalone cron/CLI job that pulls TopstepX fills, reconciles them, logs rule breaches, and writes daily markdown reviews (`data/reviews/`).
  - `run.sh`, `run.bat`, `Open PrimusLab.command` — Local launchers (`PRIMUSLAB_LOCAL_ONLY=1` on `127.0.0.1`).
- **Pages (`views/`)**
  - Daily nav: `edge_lab.py` (**Results**, default), `journal.py` (**Trades**), `team.py` (**Team**).
  - Hidden action page: `import_.py` (**Import FX Replay**).
  - More tools: `performance.py` (**Analytics**), `model_lab.py` (**Strategy Models**), `backtest.py` (**Strategy Backtester**), `risk.py` (**Risk**), `settings.py` (**Settings**).
  - Legacy/unreferenced: `overview.py`, `_template_page.py`.
- **UI Infrastructure (`ui/`)**
  - `access.py` — Fail-closed auth gate, local-only detection, identity & per-member DB resolution, screenshot path safety guard.
  - `state.py` — Session filters, `@st.cache_data` trade cache partitioned by workspace + `data_version`, per-run read cache, `page_setup()`, and `bump()` cache invalidation.
  - `components.py` — Shared HTML/CSS cards, KPI tiles, `esc()` HTML escaper, and `show_df()` formatting helper.
  - `style.py`, `theme_bridge.py`, `theme_sync/index.html` — Dark/light design tokens and Streamlit theme sync.
  - Feature widgets: `edge_lab.py` (playbook editor & `@st.fragment` quick logger), `trade_review.py`, `import_labels.py`.
  - Unused/legacy UI modules: `coach_panel.py`, `log_trade.py`.
- **Service Layer (`services/`)**
  - `team.py` — Verified Google OIDC claims, 5-seat roster (`primus_members`), `MemberDatabase` isolation, sanitized `Team.shared_results()`.
  - `import_flow.py` — File reader and FX Replay Analytics adapter.
  - `trade_labels.py` — Export tag parsing, mapping rules, bulk strategy updates.
- **Core Domain & Math (`core/`)**
  - `models.py` — Dataclasses (`Account`, `Instrument`, `Setup`, `Fill`, `Trade`) and source scopes (`LIVE_SOURCES`, `BACKTEST_SOURCES`, `DEMO_SOURCES`).
  - `db.py` — SQLAlchemy Core schema, `Database` CRUD, `bulk_update_trade_sessions()`, additive `migrate()`, JSON backup/restore (`export_json()` / `import_json()`).
  - `instruments.py` — Default CME futures + `OPT` contract specs and tick rounding.
  - `metrics.py` — Pure analytics functions (PnL/R, Wilson 95% CI, equity curve, drawdown, Sharpe/Sortino, streaks, breakdowns, heatmaps, session assignment).
  - `edge.py` — Playbook labels stored in `Trade.tags` as `edge:<key>:<value>` + `edge:reviewed`.
  - `risk.py` — Position sizing, daily loss limits, Topstep-style trailing drawdown, consistency rule, Kelly, risk of ruin, losing-streak DP, Monte Carlo, breach detection.
  - `importers.py`, `fills_to_trades.py` — Fuzzy column auto-mapping, SHA-1 deduplication fingerprints, FIFO fill-to-trade pairing and broker reconciliation.
  - `backtest.py` — Bar-by-bar simulator (next-bar-open fills, conservative stop-before-target tie-breaking, sweeps, plateau check, walk-forward, plugin loader).
  - `charts.py` — Plotly chart builders synced to theme tokens.
  - `projectx_api.py` — Strictly **read-only** TopstepX / ProjectX API client (no order endpoints).
  - `coach.py`, `demo.py`, `registry.py` — Optional AI coach (currently unwired in UI), deterministic demo trade generator, dynamic `extensions/` loader.
- **Plugins:** `strategies/` (e.g., `example_orb.py`), `extensions/` (non-underscore `.py` files auto-loaded at startup).

## 4. Database, Deployment & Configuration
- **Hosting:** Streamlit Community Cloud + Supabase PostgreSQL (`TRADELAB_DB_URL`, PgBouncer pooler with `prepare_threshold=None`).
- **Multi-tenant isolation:**
  - Owner uses the root database.
  - Each teammate gets a `MemberDatabase`: separate SQLite file (`data/members/<hex32>.db`) locally, or separate Postgres schema (`primus_<hex32>`) bound via SQLAlchemy `schema_translate_map={None: self.schema}` in production.
- **Timestamps:** All DB timestamps are stored as **naive UTC** and converted to the user's configured timezone (`tz` setting) only for display.
- **Environment variables / Streamlit secrets:**
  - `TRADELAB_DB_URL` — Postgres/Supabase URL (defaults to `data/tradelab.db`).
  - `PRIMUSLAB_OWNER_EMAIL` — Owner's Google email.
  - `PRIMUSLAB_LOCAL_ONLY=1` — Local-only bypass (only active when `[auth]` is unconfigured AND server address is loopback).
  - `PRIMUSLAB_SCREENSHOTS_PERSISTENT=1` — Enables chart uploads on hosted deployments (off by default on ephemeral disks).
  - `[auth]` in `.streamlit/secrets.toml` — Google OIDC (`client_id`, `client_secret`, `cookie_secret`, `redirect_uri`, `server_metadata_url`).
  - `PROJECTX_USERNAME`, `PROJECTX_API_KEY` — Optional read-only TopstepX credentials (owner-only).
- **GitHub Actions:**
  - `.github/workflows/nightly.yml` — Runs `python nightly.py` Mon–Fri at 21:45 UTC.
  - `.github/workflows/matrix-refresh.yml` — Intentionally lives on `main` (GitHub Actions requirement for scheduled triggers) while checking out `codex/react-rebuild`. Do not delete or break it without checking first.

## 5. Non-Negotiable Invariants (Do Not Break)
1. **Fail-closed auth & tenant isolation:**
   - Never weaken `ui/access.py:is_local()`, `services/team.py:verified_google()`, `MemberDatabase` (`schema_translate_map`), `ui/access.py:can_use_broker()` (owner-only ProjectX), or `ui/access.py:safe_screenshot()` (path-traversal guard).
   - `Team.shared_results()` must always re-verify active + `shared=True` on every read (never cross-user cached) and strip private fields (`notes`, `tags`, `mistake_tags`, `screenshot_path`, `account_id`, IDs).
2. **Backtests vs. Live separation:**
   - Never pool `Backtests` and `Live` trades (`All` scope) into statistical metrics. `All` is browse-only; analytical views must pick a single sample (`ui/state.py:statistics_sample()`).
3. **Cache invalidation discipline:**
   - Every DB write in `views/` or `ui/` must call `state.bump()` so `st.cache_data` trade reads and per-run reads refresh cleanly.
4. **SQLite & PostgreSQL parity:**
   - Automated tests run on SQLite, while production runs on Supabase Postgres behind PgBouncer. Keep all SQLAlchemy queries, migrations, sequence resets, and `MemberDatabase` schema operations compatible with both dialects.
5. **HTML safety:**
   - Always escape dynamic/user-provided strings with `c.esc(...)` (from `ui/components.py`) before interpolating them into `st.markdown(..., unsafe_allow_html=True)` or `c.note(...)`.
6. **Read-only broker client:**
   - Never add order-placement or account-mutation endpoints to `core/projectx_api.py` (enforced by `tests/test_projectx_api.py`).
7. **Streamlit internal API watchpoint:**
   - `ui/access.py` imports `streamlit.runtime.scriptrunner.get_script_run_ctx` to scope per-run caches. Verify this carefully whenever upgrading Streamlit.

## 6. Coding & Testing Rules
- Keep `core/` pure and free of Streamlit imports so math, importers, backtesting, and DB code stay fast and unit-testable.
- Prefer batch SQLAlchemy Core updates (like `db.bulk_update_trade_sessions()`) over per-row `db.update_trade()` loops when modifying many trades.
- Never commit `.env`, `.streamlit/secrets.toml`, local `.db` files, or `.DS_Store` files.
- Always run the full test suite before committing:
  ```bash
  pytest -q
  ```
- When fixing a bug, add a focused regression test under `tests/`.
