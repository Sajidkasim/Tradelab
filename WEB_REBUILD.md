# PrimusLab Strategy Lab

## Local research draft awaiting owner approval

The 29 October draft adds **My tests**, specific trade-review issues and original
risk completion, previewed **Clean up tags**, and saved Explore filter setups.
The graph's interaction stays unchanged. The owner asked to see the working
preview before any upload: do not push or deploy this draft until approved.

Build with `cd frontend && npm run build`, then run
`.venv/bin/python tools/run_research_preview.py` from the repository root. Open
http://127.0.0.1:8115/lab. This uses a temporary SQLite journal and example trades,
separate from both the existing local journal and the hosted private journals.

Test definitions and saved setups are private settings; trade membership uses
`lab:test:<id>` tags. Full JSON backups restore them together. A trade belongs
to one test, and duplicate detection remains journal-wide. Re-imports update
labels only when explicitly selected and never reassign an existing trade.
Create a new experiment for a different target; planned RR does not create R.

The HTTP service adds `/api/studies`, `/api/study-assignment`,
`/api/saved-setups`, and `/api/label-cleanup`. All use the current private-session
and CSRF checks. Tag-cleanup previews expire after ten minutes and reject a
changed trade/settings snapshot. Merges update vocabulary, CSV meanings and
saved filters atomically, with financial values and notes preserved. Import
settings are read once per file rather than once per row.

The personal React/FastAPI app runs alongside the legacy Streamlit app. The live
service is https://primuslab-web.onrender.com. It uses the existing owner database
and supports password mode or Google sign-in with independent private journals.
See [GOOGLE_LOGIN.md](GOOGLE_LOGIN.md) for the explicit Google configuration.
It has no team or shared-journal endpoints.

## Interface

The public entrance uses the owner's supplied Primus compass logo, a dark
emerald split layout and a decorative market study. The illustration never reads
journal data or represents recorded performance. Mobile prioritises the password
form in password mode, with a show/hide control and keyboard submission. Google
mode instead presents one Continue with Google action, with private journal
creation on first verified sign-in. Other members' data is never selectable.
The entrance's fixed dark tokens are exported from the existing chart palette
by tools/web_theme.py; the private journal still supports both themes.

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
contains bulk strategy labels, CSV download and Delete all trades. Strategy and
key-level lists live in My journal → Lab settings → Strategies & levels, in a
wider settings window shared with confirmation, timeframe and session settings.
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

Import settings opens File preferences and Tag meanings. File preferences save
without an upload and contain optional column matching and existing-trade label
updates. The normal import page stays focused on upload and preview. Only tags
absent from the saved guide appear in the new-tag review prompt.

Tag meanings is a searchable, compact guide with one editor at a time. Add a tag
supports future models and categories; Another CSV name preserves the original
name as an alias. Keep original tag only is remembered without classifying it.
New mapped strategy, confirmation and timeframe names populate the available
lists. Suggestions take effect only after saving a meaning, which refreshes an
open preview automatically. Existing trades are not rewritten by preferences.
See [FX_REPLAY_TAGS.md](FX_REPLAY_TAGS.md). Ambiguous bare 15M is left unassigned;
Level TF: 15M and Entry TF: 15M
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

## Confirmed fixed-RR backtests

The owner confirmed on 27 October 2026 that the current 1:3 test closes every
winner at the full target and every loser at the full stop. A Target RR meaning
in the tag guide has an explicit full-target/full-stop checkbox. It is off by
default for new models, including later 1:2 tests. The mapping stores canonical
rr:target and rr:fixed tags; it does not write inferred financial fields.

services.fixed_rr builds a separate copy of eligible closed backtests with model
observations (+3R/-1R for 1:3), then calls the unchanged core.metrics.summary_stats.
Live, untagged, target-only and zero-result rows are excluded. Conflicting targets
are flagged instead of guessed. The dollar graph and saved R/risk/P&L stay intact.

Results offers a Target RR filter and shows its definition near the three cards.
Average R · fixed test is used only when every selected closed trade qualifies
and no recorded R exists. It is explicitly a model before costs. If any recorded
R exists, the original Average R card takes priority and the model is a separately
labelled comparison. Partial subsets never silently replace the headline average.
The model's R values are not described as measured net returns. Existing records
receive target tags only through an opted-in label-update import preview.

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
opens without a password. Hosted deployment requires HTTPS, PostgreSQL and a
session secret. Google mode uses the provider configuration in GOOGLE_LOGIN.md;
the retained password mode requires an Argon2id hash. See GO_LIVE.md.

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

Browser checks use disposable servers on ports 8111, 8112 and 8114, including a
synthetic password and mocked Google accounts. They never open the real hosted database. Cover combined and
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

## Next backend priorities — retained at the owner's request, 28 October 2026

These are planned improvements, not implemented or scheduled work:

1. Fetch trade-list pages from the server instead of sending the full journal to
   the browser. Preserve core-generated results across all matching trades.
2. Replace the global journal-operation lock with per-journal coordination so one
   user's import does not block another user's work. Keep authorization and
   workspace-scoped cache invalidation intact.
3. Add encrypted, dated off-site backups and verify restores against a disposable
   database. Review storage costs and destination before configuring transfers.
4. Add a database-readiness check and monitoring; the current /health endpoint
   checks application responsiveness only.
5. Formalize versioned migrations and a separate test deployment/database.
6. Record import history: file name/date, additions, duplicates and failures,
   scoped to the importing user's journal.

Measure real latency before increasing hosting spend. Keep Render and Supabase.
The owner bought primustrader.co.uk from Wix and explicitly selected `/lab` for
the existing PrimusLab journal/research section. See DOMAIN_SETUP.md for routing,
DNS, Google sign-in and the staged cutover. The broader homepage will be added
later; the root currently redirects to the laboratory when Lab routing is enabled.
