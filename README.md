# TradeLab

A trading journal, performance dashboard, model lab, backtester and risk manager for
futures and options — built for a Topstep trader, works for any account.

- **Read-only toward your broker.** It imports fills and bars; it never places, modifies or cancels an order.
- **Backtests never mix with live trades.** FX Replay and engine results live in their own scope.
- **Every statistic comes from one tested core** (`core/`, 72 tests) — the backtester and the live pages use the same maths.
- **Light and dark themes**, switchable from the ☰ menu (top right) → Settings → Theme; charts follow.
- **An optional AI coach** that reads the trades in view and writes a four-part review — needs your own Anthropic or OpenAI key.

## Run it locally

Easiest: `./run.sh` (Mac/Linux) or `run.bat` (Windows) — see **RUN_ME_FIRST.md**. By hand:

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest -q                                     # 72 passed
streamlit run app.py                                    # opens http://localhost:8501
```

First visit: click **Load demo data** on the Overview to explore, then delete it from
Settings → Data when you import your own. Without `TRADELAB_DB_URL` the app uses a local
SQLite file at `data/tradelab.db`.

To pull from TopstepX, copy `.env.example` to `.env` and add your ProjectX username and API key.

## Put it on the web

See **[DEPLOY.md](DEPLOY.md)** — GitHub → Streamlit Community Cloud (free) with a Supabase
Postgres (free) so the journal survives restarts, plus the nightly auto-journal as a GitHub Action.

## Pages

| Page | What it answers |
|---|---|
| **Overview** | Am I up or down, what's my edge, where do I stand against today's limits |
| **Performance** | Win rate with confidence interval, R distribution, rolling edge, breakdowns by model / symbol / weekday / hour / session / hold time / confidence / rules, hour×weekday heatmap, best & worst, mistake cost and "what if I never…", rule adherence |
| **Model Lab** | Scorecard per setup, promotion check (30+ trades, positive expectancy, CI lower bound > 35%), compare models on cumulative R, rule checklists |
| **Backtest** | Bars from TopstepX or CSV, strategy files or a no-code rule builder, costs & exits, parameter sweep with an overfitting verdict, walk-forward, Monte Carlo, saved runs |
| **Risk Manager** | Today vs daily loss limit, trailing drawdown buffer (Topstep-style lock), consistency rule, position sizer, Kelly, risk of ruin, losing-streak odds, what-if simulator, breach log |
| **Trades** | Log a trade in one line (live P&L, % and R preview), a clean list in $ and % of account — click a row for its detail and edit form — weekly review with auto-observations, daily reviews from the nightly script, bulk edit, CSV/Excel export |
| **Import** | Manual entry with live P&L, CSV/Excel with a column mapper and saved profiles, FX Replay, clipboard, JSON, TopstepX live pull with FIFO pairing and broker reconciliation, inbox folder, backup/restore |
| **Settings** | Accounts (any prop firm), instruments, sessions & timezone, connections (broker + coach), appearance, data |
| **Coach** (on Overview, Performance, Journal) | What's working, what's leaking, one change this week, risk check — from the exact trades in view. Cached per view so it never re-bills for a re-render. |

## Nightly auto-journal

```bash
python nightly.py                 # today's fills -> trades -> review (Journal → Daily reviews)
python nightly.py --date 2026-09-15 --dry-run
```

Schedule with cron / Task Scheduler on your machine, or enable the included GitHub Action
(`.github/workflows/nightly.yml`) to run it against your hosted database every weekday evening.

## AI coach

Add one key to `.env` (local) or Streamlit secrets (hosted):

```
ANTHROPIC_API_KEY=sk-ant-...      # default model claude-sonnet-5
# or OPENAI_API_KEY=sk-...        # default model gpt-5.6-terra
# COACH_MODEL=...                 # optional override
```

The model receives aggregated statistics and short trade lines only — never keys or broker credentials.
A review is a few thousand input tokens: well under a cent. The nightly script appends a coach review
to each day's summary when a key is present.

## Layout

```
app.py             navigation
views/             one file per page — no maths in here, only calls into core/
ui/                design system (style.py), components, filters/state, coach panel, log-trade form
extensions/        drop-in plug-ins (new import sources, coach providers) — auto-loaded
core/registry.py   the extension points; core/db.py auto-migrates added columns
static/fonts/      Inter (OFL) served by the app; assets/ holds the wordmark
core/              the tested engine: db, metrics, fills_to_trades, risk, backtest, importers, projectx_api, charts
strategies/        drop-in backtest strategies (see example_orb.py for the contract)
tests/             72 tests with hand-computed answers
tools/shoot.py     headless screenshot helper for checking pages
nightly.py         auto-journal
```

## Conventions

- Money: `gross = (exit − entry) × qty × multiplier` (sign flipped for shorts), `net = gross − fees`
- `R = net / (|entry − stop| × qty × multiplier)`; scratches excluded from win rate; < 30 trades flagged as small sample
- Timestamps stored in UTC, shown in the configured timezone
- A trade is a position from flat to flat; scale-ins and partial exits become one trade with quantity-weighted prices
- Rows imported without a broker id get a fingerprint so re-importing a file never duplicates

## Extending it

Read **[CONTINUING_WITH_CHATGPT.md](CONTINUING_WITH_CHATGPT.md)** — the architecture, the rules
any change must follow, and copy-paste prompts for ChatGPT / Codex.
