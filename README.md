# PrimusLab

A trading journal, performance dashboard, model lab, backtester and risk manager for
futures and options — built for a Topstep trader, works for any account.

- **Read-only toward your broker.** It imports fills and bars; it never places, modifies or cancels an order.
- **Backtests never mix with live trades.** FX Replay and engine results live in their own scope.
- **Every statistic comes from one tested core** (`core/`) — the backtester and the live pages use the same maths.
- **Light and dark themes**, switchable from the ☰ menu (top right) → Settings → Theme; charts follow.

## Run it locally

Easiest on Mac: double-click **Open PrimusLab.command**. Or use `./run.sh` (Mac/Linux)
or `run.bat` (Windows) — see **RUN_ME_FIRST.md**. By hand:

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pytest -q                                     # run the complete test suite
PRIMUSLAB_LOCAL_ONLY=1 streamlit run app.py               # local use only
```

First visit: open **Test & Log → Add Trade**, or upload your FX Replay CSV on **Import**.
Without `TRADELAB_DB_URL` the owner uses the existing local `data/tradelab.db`.
Start locally with `./run.sh` or `run.bat`; local mode is restricted to loopback.
For the five-person website with Google sign-in, follow **[TEAM_SETUP.md](TEAM_SETUP.md)**.

To pull from TopstepX, copy `.env.example` to `.env` and add your ProjectX username and API key.

## Put it on the web

See **[DEPLOY.md](DEPLOY.md)** — GitHub → Streamlit Community Cloud (free) with a Supabase
Postgres (free) so the journal survives restarts, plus the nightly auto-journal as a GitHub Action.

## Pages

The sidebar groups everyday work under **Daily**, deeper tools under **Research**, and setup under **Account**.
Open **Quick page guide** in the sidebar whenever you need a reminder.

| Page | What it answers |
|---|---|
| **Test & Log** | Fast replay/forward logging; filter buy/sell → strategy → key level/timeframe → confirmations; immediate win rate, R, confidence interval and charts; news/session filters; saved combinations; import review queue; progress towards 1,000 trades |
| **Dashboard** | Am I up or down, what's my edge, where do I stand against today's limits |
| **Analytics** | Win rate with confidence interval, R distribution, rolling edge, breakdowns by model / symbol / weekday / hour / session / hold time / confidence / rules, hour×weekday heatmap, best & worst, mistake cost and "what if I never…", rule adherence |
| **Strategy Models** | Scorecard per setup, promotion check (30+ trades, positive expectancy, CI lower bound > 35%), compare models on cumulative R, rule checklists |
| **Strategy Backtester** | Bars from TopstepX or CSV, strategy files or a no-code rule builder, costs & exits, parameter sweep with an overfitting verdict, walk-forward, Monte Carlo, saved runs |
| **Risk** | Today vs daily loss limit, trailing drawdown buffer (Topstep-style lock), consistency rule, position sizer, Kelly, risk of ruin, losing-streak odds, what-if simulator, breach log |
| **Trade Journal** | Log a trade in one line (live P&L, % and R preview), a clean list in $ and % of account — click a row for its detail and edit form — weekly review with auto-observations, daily reviews from the nightly script, bulk edit, CSV/Excel export |
| **Import** | One upload → preview → confirm flow for FX Replay, CSV, Excel and JSON; other methods under More options |
| **Team** | Five invited Google accounts, separate private workspaces, optional shared results and owner-managed invitations |
| **Settings** | Accounts (any prop firm), instruments, sessions & timezone, connections (broker), appearance, data |

## Nightly auto-journal

```bash
python nightly.py                 # today's fills -> trades -> review (Journal → Daily reviews)
python nightly.py --date 2026-09-15 --dry-run
```

Schedule with cron / Task Scheduler on your machine, or enable the included GitHub Action
(`.github/workflows/nightly.yml`) to run it against your hosted database every weekday evening.

## Layout

```
app.py             navigation
views/             one file per page — no maths in here, only calls into core/
ui/                design system (style.py), components, filters/state, page guide, log-trade form
extensions/        drop-in plug-ins (new import sources) — auto-loaded
core/registry.py   the extension points; core/db.py auto-migrates added columns
static/fonts/      Inter (OFL) served by the app; assets/ holds the wordmark
core/              the tested engine: db, metrics, fills_to_trades, risk, backtest, importers, projectx_api, charts
strategies/        drop-in backtest strategies (see example_orb.py for the contract)
tests/             hand-computed answers, import persistence and research workflow checks
tools/shoot.py     headless screenshot helper for checking pages
nightly.py         auto-journal
```

## Conventions

### Test & Log workflow

Start in **Test & Log**. Choose **Backtesting**, **Forward testing** or **All** in the sidebar. All browses both histories; use **Results sample** to view either testing type without pooling the statistics. Demo trades are excluded from All.
Use **Add Trade** for either net dollars plus original dollar risk, or entry/stop/exit prices. **Save & log next**
keeps the setup labels and clears the result. Trading times are entered in New York local time.
Use **Review Imports** to open the existing FX Replay/CSV importer, then tag each imported trade without retyping results.
In **My Results**, all selected confirmation boxes must be present (SMT + CISD means both). News and market condition
remain **Not recorded** until explicitly labelled. New York includes 08:30–16:00 ET and follows daylight saving.
The 1,000-trade counter uses the selected account, period and source before setup filters. It is a collection target,
not a statistical guarantee. Average R is realised R; win/loss size is the ratio of average dollar outcomes, not planned target R.
Structured playbook labels are stored in the existing trade tags, so backups and exports keep them with the trade.

### Trade calculations

- Money: `gross = (exit − entry) × qty × multiplier` (sign flipped for shorts), `net = gross − fees`
- `R = net / (|entry − stop| × qty × multiplier)`; scratches excluded from win rate; < 30 trades flagged as small sample
- Timestamps stored in UTC, shown in the configured timezone
- A trade is a position from flat to flat; scale-ins and partial exits become one trade with quantity-weighted prices
- Rows imported without a broker id get a fingerprint so re-importing a file never duplicates

## Extending it

Read **[CONTINUING_WITH_CHATGPT.md](CONTINUING_WITH_CHATGPT.md)** — the architecture, the rules
any change must follow, and copy-paste prompts for ChatGPT / Codex.

### FX Replay Analytics exports

Native exports containing `dateStart`, `dateEnd`, `pair`, `side` and `rPnL` are recognised automatically.
The realised `rPnL` is imported through the existing result-only path; `uPnL`, `amount` and planned
reward/risk targets are not substituted for realised returns or futures contract sizes. Original
prices and quantities remain in notes. Choose the export time zone under File details & time zone.
Open rows and missing close times are reported, and duplicate IDs are skipped. No trades are
written until Confirm import. This reader was checked against the user's five-row export.
