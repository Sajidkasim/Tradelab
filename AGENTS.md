# AGENTS.md — PrimusTrader / PrimusLab (`codex/react-rebuild`)

Architecture overview, deployment setup, non-negotiable invariants, and coding rules for future sessions working on **`Sajidkasim/Tradelab`** (`codex/react-rebuild`).

---

## 1. What This App Does
**PrimusTrader / PrimusLab** is a private trading platform for discretionary futures (NQ/MNQ/ES), FX/Gold (EURUSD/GBPUSD/XAUUSD), and QQQ traders, plus a private 5-person trading group (**Sajid, Safwaan, Mubeen, Mustafa, Amir**).

### Main Modules
- **Strategy Lab (`/lab*`)** — Edge analytics, trade review/tagging, Plotly equity curves, FX Replay/CSV/Excel preview-confirm importer, custom trade fields, tag cleanup, backups, and owner user-access management.
- **Daily Journal (`/journal`)** — Calendar journal, multi-account trade cards, Lab linking, private Cloudflare R2 WebP screenshots, **Journal Execution Replay** (1m broker fill replay via ProjectX/Dukascopy), **Chart Vision** (on-device Tesseract.js + canvas TradingView reader with Cloudflare Vision fallback), and **Primax** AI assistant.
- **Backtesting / Multi-Chart Replay (`/backtesting`)** — Up to 3 synchronized `@luxalgo/vela@0.9.3` chart panes with custom drawing engine, deterministic 1m bar simulation (`services/replay_engine.py`), Databento/Dukascopy/QQQ archives, US economic calendar, layouts/templates, and export to Lab/Journal.
- **Mindset & Compound Edge (`/mindset`)** — Morning prep checklist, 3 server-signed cognitive drills, breathwork timer, Primax check-in, team daily high-score board, **Compound Edge** (365-day 3-pillar score + streak), and 3D brain anatomy viewer (`Three.js`).
- **Learn & Vision Board (`/learn`)** — Shared learning resources, personal Vision Board, and team Setup Gallery.
- **The Matrix (`/matrix`)** — Macro desk dashboard backed by `public.macro_scorecard` (refreshed via GitHub Action `tools/refresh_matrix.py` from FRED, CFTC COT, and FMP).
- **The Bullpen** — Private 5-person live room (Jitsi JaaS video, Supabase Realtime presence/chat/reactions, Fed/BLS macro RSS feed, TradingView webhook `/api/tv-webhook`, Gmail team alerts).

*(Legacy Streamlit code in `app.py`, `views/`, `ui/`, and `nightly.py` still exists in the repo for reference/legacy cron, but is NOT included in the Docker web image.)*

---

## 2. Tech Stack & Directory Layout

- **Backend (`webapp/`):** FastAPI (`webapp/app.py`, `create_app` factory) running on `uvicorn --workers 1` with OpenAPI/Swagger disabled. Serves `/api/*`, `/auth/callback`, and the built React SPA from `frontend/dist`.
- **Frontend (`frontend/`):** React 19 + Vite 8 + Tailwind CSS v4 (scoped with `tw:` prefix alongside custom CSS). Client-side SPA routing (`frontend/src/main.jsx` + `frontend/src/paths.js` via `history.pushState` and `primus:navigate`) keeps `<BullpenProvider>` and active Jitsi/Supabase Bullpen calls alive across tab switches between `<SiteExperience/>` and `<App/>` (`/lab*`, including `/lab/tools`). Key packages: `@luxalgo/vela@0.9.3`, `@supabase/supabase-js`, `@jitsi/react-sdk`, `plotly.js-basic-dist-min`, `tesseract.js`, `three` (with bundled `MeshoptDecoder` for the compressed ~2.1 MB `assets/hra-brain-female-v1.3.glb`).
- **Shared Core & Services (`core/`, `services/`, `extensions/`):**
  - `core/db.py` — SQLAlchemy Core schema (`accounts`, `instruments`, `setups`, `trades`, `settings`, `import_mappings`, `backtest_runs`, `bars_cache`, `rule_breaches`), CRUD, `migrate()`, JSON backup/restore.
  - `core/metrics.py`, `core/risk.py`, `core/edge.py`, `core/importers.py`, `core/fills_to_trades.py`, `core/backtest.py`, `core/projectx_api.py` (strictly read-only).
  - `services/replay_engine.py`, `services/replay_frames.py`, `services/replay_candles.py`, `services/team.py` (`MemberDatabase`), `services/import_flow.py`, `services/trade_labels.py`.
  - `extensions/ai_coach.py` — Primax AI assistant (Cloudflare Workers AI or Gemini REST API).
- **Offline Tools (`tools/`):** `refresh_matrix.py`, `workspace_backup.py`, replay archive indexers/packagers, password hashing, benchmarks.
- **Tests (`tests/` + `frontend/src/*.test.js`):** Pytest (475+ tests), Vitest unit tests, and Playwright browser tests.

---

## 3. Database, Storage & Deployment

- **Hosting:** Docker (`Dockerfile.web`, 2-stage Node 22 + Python 3.13-slim, non-root UID 10001) on **Render** (`deploy/render.yaml`, Frankfurt, **`standard` — 1 CPU / 2 GB RAM**, **`numInstances: 1`**, **`--workers 1`**) behind `https://primustrader.co.uk`.
- **Database:** Supabase PostgreSQL (`TRADELAB_DB_URL`, `psycopg` v3, `prepare_threshold=None` for PgBouncer) in production; local SQLite (`data/tradelab.db` / `data/primus-web-preview.db`) for dev.
  - **Multi-tenant isolation:** Owner uses `public` schema; each Google user gets `primus_<32hex>` via SQLAlchemy `schema_translate_map={None: schema}` (never Postgres `search_path`). `harden_tables()` enables RLS with zero policies and revokes `PUBLIC`/`anon`/`authenticated` privileges.
  - **Timestamps:** Stored as naive UTC in DB; converted for display only.
  - **JSON documents in `settings`:** Journal entries, replay sessions/layouts, journal-replay imports, compound edge, mindset drills, resources, vision board, and gallery live in `settings_t` (`key` max length 80 chars).
- **Object Storage (Cloudflare R2):** Private S3 bucket for WebP screenshots (`primus-journal/v1/...`), Databento replay chunks, Dukascopy/QQQ SQLite archives (restored to `/tmp` on boot), and daily Fernet-encrypted backups. Never expose direct bucket URLs — proxy images through authenticated endpoints.
- **GitHub Actions (`.github/workflows/`):**
  - `web-tests.yml` (Vitest + Vite build + pytest + Playwright), `matrix-refresh.yml`, `workspace-backup.yml`, `database-readiness.yml`, `nightly.yml`.

---

## 4. Non-Negotiable Invariants (Do Not Break)

1. **Pin `@luxalgo/vela` at exact `0.9.3` (`frontend/package.json`):**
   - `replayDrawingPerformance.js`, `replayDrawingInteractions.js`, `replayDrawingGeometry.js`, `replayViewport.js`, and `BacktestingChart.jsx` monkey-patch private Vela internals (see `DRAWING_PERFORMANCE.md`). Never bump `@luxalgo/vela` without rewriting and profiling all drawing adapters.
2. **Single-worker / single-instance assumption (`--workers 1`, `numInstances: 1`, 1 CPU / 2 GB RAM):**
   - In-memory Google PKCE verifiers, `Workspaces.frames` cache invalidation, `replay_gate` (`Semaphore(4)`), `ByteCache` budgets, and Bullpen alert cooldowns all assume one worker process. Do not increase workers/instances without moving shared state to Postgres/Redis.
3. **Fail-closed auth, CSRF, Origin & tenant isolation:**
   - Every private endpoint must use `Depends(workspace)` (or `Depends(replay_slot)` for heavy replay routes) and derive the workspace key strictly from the verified server-side session token.
   - Never weaken `Settings.validate()`, `Origin == config.public_url`, `X-Primus-CSRF`, `RequestLimits`, `harden_tables()`, or `MemberDatabase`'s `schema_translate_map`.
   - Always wrap workspace DB mutations in `with app.state.workspaces.workspace_lock(member['key']):` and call `app.state.workspaces.bump(member['key'])`.
   - Keep `replay_gate` behind authentication (`Depends(replay_slot)`), never in an unauthenticated outermost middleware.
4. **Deterministic replay & immutable digests (`services/replay_engine.py`):**
   - Saved sessions verify `data_digest` and replay `commands` deterministically. Changing archive manifests or fill-simulation rules can break reopening saved user sessions (HTTP 409) or alter historical P&L.
5. **SQLite & PostgreSQL parity (`core/db.py`):**
   - Tests run on SQLite while production runs on Supabase Postgres behind PgBouncer. Keep all SQL queries, `ON CONFLICT` clauses, `LIKE` escapes, migrations, and sequence resets compatible with both dialects.
6. **Financial math stays in Python (`core/metrics.py`, `core/risk.py`, `core/db.py`):**
   - Never pool `Backtesting` and `Forward testing` (`All` scope) into statistical metrics.
   - Keep `core/projectx_api.py` strictly read-only (no order endpoints).
7. **CSP & sandboxed iframes (`webapp/app.py`):**
   - TradingView embeds, Jitsi JaaS, and bundled Tesseract WASM workers rely on the current CSP and sandboxed `srcDoc` setup. Test all three before tightening CSP.
8. **Upload & storage hygiene:**
   - Always close `UploadFile` handles in `try ... finally:` blocks, enforce byte limits in `RequestLimits`, and call `image_storage.discard_unreferenced(...)` when permanently deleting unreferenced images.

---

## 5. Coding & Testing Rules

- Avoid N+1 SQL queries and full-table `trades_df()` scans in web handlers — use targeted helpers in `core/db.py` (`get_trade_by_external_id`, `get_trades_by_ids`, `find_trade_id_by_tag`, `iter_settings_for_keys`).
- Never commit `.env`, `.streamlit/secrets.toml`, local `.db` files, or `.DS_Store` files.
- Keep `core/` free of FastAPI/Streamlit runtime requirements (guard any legacy Streamlit secret fallback).
- Run all checks before committing:
  ```bash
  cd frontend && npm test && npm run build
  cd .. && pytest -q
  ```
- When fixing a bug, add a focused regression test in `tests/` or `frontend/src/*.test.js`.
