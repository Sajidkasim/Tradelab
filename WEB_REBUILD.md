# PrimusLab Strategy Lab

The personal React/FastAPI app runs alongside the legacy Streamlit app. The live
service is https://primuslab-web.onrender.com. It uses the existing owner database
and one personal password. It has no Google login or team endpoints.

## Interface

Results and Trades share one Strategy Lab page. All is first and selected by
default. At the owner's explicit request, All combines the selected raw trades
into one core-generated history and summary. Backtesting and Live trading remain
available individually. Live trading is the display label for the existing
Forward testing API scope; stored sources are unchanged. Older API clients retain
their separate-sample contract unless they send combined=true.

Explore a strategy stays open. The graph uses the existing core equity series,
with palette-derived colour, area shading, hover values and the actual final
closed-trade marker. Drawdown is optional. No price feed or fake-live indicator is
shown, and no financial series is computed in React. The three cards show win
rate, average realised R and trades analysed. Missing R stays missing.

Trades shows 8 records per page, Import, Add trade, All trades / To finish and a
Review next action. Individual deletion requires confirmation. Manage trades
contains playbook lists, bulk strategy labels, CSV download and Delete all trades.
Delete-all shows the whole-journal count, then requires typing that count. The
server verifies a short-lived session-bound snapshot of full record contents,
including protection against SQLite ID reuse. Deletion is transactional, rejects
stale snapshots, and preserves accounts and settings.

## Sessions and settings

My journal → Lab settings edits session names/times, the session clock, news
labels and market-condition labels. Defaults confirmed by the owner are fixed
UTC−4 throughout the year:

- Asia: 20:00–02:00
- London: 02:00–07:00
- New York pre-market: 07:00–09:30
- New York open: 09:30–12:00
- Lunch: 12:00–13:30
- Afternoon: 13:30–16:00

The optional New York clock follows seasonal UTC−4/UTC−5. Session assignment uses
entry time; windows are start-inclusive and end-exclusive. Overnight windows are
split into ordinary intervals passed to core.metrics.session_of. Overlaps and
invalid names/times are rejected. Gaps remain included under All sessions.
Settings are stored under primuslab_lab_settings and included in JSON backups.
Existing trades are not rewritten when session windows change. Market options
come from saved journal symbols.

## CSV import

Drop a CSV, TSV, Excel or JSON file, preview, then confirm. Native FX Replay
Analytics is recognised automatically. The preview shows strategy/confirmation/
note coverage, detailed labels and any errors. Export timezone is explicit,
including UTC, fixed UTC−4, New York or London. Remember my import settings stores
account, source, clock, day-first dates and label-update preference after a
confirmed import; it does not store credentials.

Recognise strategy tags offers suggestions that only take effect after saving.
It is available before upload and includes the owner's confirmed FX Replay
groups; see [FX_REPLAY_TAGS.md](FX_REPLAY_TAGS.md). Saved custom mappings take
priority. Ambiguous bare 15M is left unassigned; Level TF: 15M and Entry TF: 15M
keep the two roles separate. FVG explicitly mapped as a key level is preserved
in an audit tag without being counted as an entry confirmation.
One export label can map to multiple fields. The owner's CONTINUATION, HTF LEVEL
1HR FVG and CISD FVG labels have suggestions for strategy, level/timeframe and
both confirmations respectively. Original tag strings are retained. Changed
confirmations still require an explicit review.

Update labels on existing trades is opt-in. The preview matches source/account,
external trade ID, symbol, direction and entry time. Non-empty provided labels
may update existing labels. Blank fields preserve saved details. Incoming notes
are appended once, and existing notes remain intact. Saved financial fields are
never updated by label re-import. Signed approval covers import options, mapping
rules and the proposed changes. Stale plans are rejected. With label updates
selected, new rows and label updates share one transaction.

FX Replay's amount is not assumed to be a futures contract count. Its realised
rPnL is retained. maxRiskReward and planned targets are not treated as realised R.
A richer export's notes/strategy columns are preserved when present; a file with
no notes cannot supply journal content. Screenshots require separate storage.

## Local development and checks

```bash
.venv/bin/python -m pip install -r requirements-web.txt
npm --prefix frontend ci
.venv/bin/python tools/web_theme.py
npm --prefix frontend run build
bash run-web.sh
```

The loopback preview uses a separate SQLite database; it never imports hosted or
old local records automatically. If data/private/personal-login.env exists, the
launcher loads its protected password configuration. Otherwise loopback preview
opens without a password. Hosted deployment always requires HTTPS, PostgreSQL,
an Argon2id password hash and a session secret. See GO_LIVE.md.

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

Browser checks use disposable servers on ports 8111 and 8112, including one with a
synthetic password. They never open the real hosted database. Cover combined and
single-source results, imports and re-imports, mappings, notes, session editing,
backups, pagination, deletion, themes, mobile layout and password locking.

The service calls core.metrics/core.charts/core.risk without changing formulas or
signatures, and invalidates reads with Workspaces.bump after writes. The legacy
bars backtester, full risk suite and read-only broker integration remain in the
repository, outside the rebuilt UI. No broker order-writing code is added.

## Deployment and data

Use the existing Render service, Dockerfile.web, one worker/instance and the
persistent Supabase database. Keep auto-deploy off and publish tested commits
manually. No login credentials or database settings need changing for UI updates.
Keep the default onrender URL unless PRIMUSLAB_PUBLIC_URL and trusted origin
checks are intentionally updated together.

My journal → Backup & restore downloads full JSON or trades CSV. JSON contains
trades, labels, notes, accounts and settings. Image files and login sessions are
excluded. Restore is allowed only into an empty journal. Never use the real
journal for destructive checks or populate it with synthetic preview data.
