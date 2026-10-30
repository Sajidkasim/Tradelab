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

The React API supports private per-person Google journals via Supabase PKCE;
see GOOGLE_LOGIN.md for the explicit deployment switch and provider setup.
webapp.google_access verifies provider identities and issues revocable sessions.
Never use editable user metadata or a client workspace key for authorization.
The owner retains the original tables; each other verified identity has separate
storage. Every API read/write, import token, cache and backup is workspace-scoped.
There are no team selectors or sharing routes. Password mode remains an explicit
single-owner rollback, disabled while Google mode is active. Never print secrets.

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

The import page offers Include break-even trades? Yes / No. No excludes closed
trades with exactly zero realised net P&L before preview, insertion or re-import
label updates. Missing results and open trades are not break-even. The signed
preview binds this choice, and the preview reports the excluded count. Existing
journal trades are never deleted by this option. The choice is remembered after
confirmation; older clients default to including break-even trades.

The React strategy editor, Explore dropdown and trade-entry suggestions share
services.strategy_catalog. Newly used/mapped strategies appear in the editor
too. Removing a choice saves hidden_strategies inside edge_playbook so older
trades and CSV aliases cannot silently re-add it. Saved trades and All results
are unchanged; re-adding the exact name restores the choice.

Lab settings has separate Setup labels, Session windows and News & market tabs.
Strategies & levels now lives in the same, wider Lab settings window; the old
Manage trades editor is removed. This tab saves through the existing private
playbook endpoint and retains its shared vocabulary and hidden-choice behaviour.
RR imports support multiple separately approved ratios (including 1:2 and 1:3).
Each target must keep its own full-exit confirmation. Unmapped or conflicting
tags stay unclassified, and target tags never become recorded financial R.
Confirmation, level-timeframe and entry-timeframe choices are shared by Explore
and trade entry. New mapped/saved values are discoverable; explicit removals
persist in hidden_choices in the lab setting. Removing a choice never edits
stored trade tags. Reviews retain an existing trade's selected legacy labels.
Older clients can still save sessions/news without overwriting setup lists.

For the owner's explicitly confirmed full-target/stop tests, services.fixed_rr
adapts tagged backtests into separate model observations and calls the existing
core summary. Never save those model observations as recorded R or original risk.
Live/untagged/zero-result trades are excluded, recorded R takes priority in the
headline, and every future ratio requires its own explicit full-exit confirmation.

## Research workflow preview — 29 October 2026

The owner requested My tests, specific review issues with original-risk entry,
previewed tag cleanup and saved Explore setups. They explicitly require a
working local preview **before any upload or deployment**. These research
changes are not approved for publishing yet. Wait for their approval before
pushing or deploying them; earlier release authorisations do not cover this draft.

`services/research.py` keeps private test definitions and saved filters in the
existing settings table. `lab:test:<uuid>` trade tags store membership, so JSON
backups include the definitions, filters and membership together. Planned RR is
descriptive and never generates recorded risk, R or a full-exit assumption.
Rules are fixed once a test has trades; duplicate the definition for a different
experiment. Duplicate protection stays journal-wide; re-imports never move
existing trades between tests. Assignment is a separate explicit action.

`services/review.py` reports missing strategy, unreviewed confirmations and
missing original risk. Explicit original dollar risk on result-only trades goes
through the unchanged `Database.update_trade` calculation. Price-derived stop
risk is protected. `lab:risk-unavailable` explicitly leaves R blank while allowing
a review to be completed. Target ratios never fill in missing risk.

`services/tag_cleanup.py` previews label merges, signs the private workspace/
settings/trade snapshot, then applies labels/settings in one transaction. It
never updates financial columns. Approved aliases update CSV meanings, lab
choices, test strategy labels and saved filters. Every API write bumps the
private workspace cache. No changes to `core/`.

Run `tools/run_research_preview.py` for the disposable example journal at
http://127.0.0.1:8115/lab. It never reads real database settings or credentials.

## Control design preview — 29 October 2026

The owner requested clearer typography, selected buttons with ticks, styled
strategy/timeframe dropdowns, a searchable key-level picker and removable active
filters. Confirmations sit directly below Entry timeframe. These frontend changes are local only. The owner explicitly repeated:
**Do not upload until we review.** Do not commit/push/deploy this design before
that review and approval. Preview at http://127.0.0.1:8115/lab uses disposable
sample trades. No financial formulas, API behaviour or real journals changed.

## Import usability review — 29 October 2026

The React website no longer exposes Advanced tools; Classic navigation calls the
journal section Trades. CSV preview uses 20-row pages (within the existing
200-row server preview limit), with a persistent bottom confirmation action and
new/duplicate counts. Mobile previews use labelled cells. Duplicate-only files
clearly state that nothing is new. Previewing never saves, and confirmation still
uses the existing signed preview and private workspace checks. File and import
settings changes are disabled while an operation is pending. Chart cleanup keeps
the original DOM node so Plotly can release it even after unmount.

These latest changes are local for review; do not deploy without approval.
A disposable local SQLite measurement with 1,000 synthetic trades took about
0.96 s preview, 0.99 s confirm, 1.04 s duplicate preview, and 64 ms median Results
response across 30 requests. Process RSS after warm-up was 182 MB and ended at
184 MB. These are local measurements, not hosted Supabase latency or a guarantee
of production capacity. Financial formulas were not changed.

## Phone dropdown consistency — 29 October 2026

Add/edit trade Key level / PDA uses the saved-level dropdown rather than a
browser datalist input. Existing legacy labels remain selectable; edit the
available levels in Lab settings → Strategies & levels. Shared Select now uses
StyledSelect in both appearances, retaining Classic styling and applying
consistent Modern fonts, colours, selected states and phone touch sizing.
Opening a non-searchable dropdown focuses its list, not a typing input.
Keyboard and top-layer menu behaviour remain shared. Changes stay local for
review before publishing.

## Personal welcome and UK journal clock — 30 October 2026

`webapp/journal_preferences.py` stores each journal's display/entry clock and
first-visit state. UK uses Europe/London (GMT/BST); existing journals default to
America/New_York. Trade entry converts the selected wall clock to UTC and rejects
DST gaps/repeated times. The trade list, CSV preview and result chart use the
journal clock. From/To filters use complete local calendar days, including DST
changes. Session windows/weekday filters use their separate Session clock;
CSV parsing uses its explicit export clock. Europe/London is also available as
a Session clock. No core formulas were changed.

Only newly provisioned non-owner Google journals start with blank strategies,
levels and confirmations and no preset personal import guide. Shared generic
timeframes/session windows remain editable. An automatic welcome dialog explains
setup → input/import → Explore and offers optional personal labels and a clock.
`/api/welcome` is private, can complete once, and never resets an existing journal.
Existing accounts retain all saved settings and are not forced through onboarding.
New settings travel with full JSON backups. These changes are local for review.

## The one-page architecture

### Classic appearance preview — 29 October 2026

The owner requested an optional Bloomberg 2000 inspired edition. The Modern /
Classic switch in the header and sign-in screen remembers a browser preference
(`primus-appearance`). Classic uses its own navy, burgundy and pale market-panel
CSS tokens in `frontend/src/classic.css`, compact controls, navigation and tables.
Classic also has bundled pixel SVG arrow/hand cursors for mouse devices, raised
desktop-style controls and inset fields. Text inputs retain the typing cursor.
Classic selects use `StyledSelect.jsx` with top-layer menus so scrolling filters
and dialogs cannot clip options. Key-level search shares that menu. Keep arrow,
Home/End, type-to-select, Tab and Escape controls working; Escape closes only
the menu before its containing dialog. Modern uses the same dropdown component with its light/dark theme tokens.
Chart changes affect presentation only. Modern retains its light/dark preference.
This remains a local preview; do not commit, push or deploy before owner review.

### Account activity preview — 29 October 2026

The owner requested device information and fresher Manage access data. Auth-only
additive columns record bounded browser user-agent hints, the server-observed
connection address and last-seen timestamps. Never trust raw forwarding headers
or infer an exact phone model, Wi-Fi name or physical location. No geolocation
service is called. Owner-only `/api/access` returns account/session metadata,
never another person's journal, auth token or provider subject. Visible Google
sessions report activity each minute; updates are throttled to 30 seconds.
Manage access refreshes every 15 seconds when visible and on explicit refresh.
“Active recently” means within two minutes, not verified live presence. Existing
sessions acquire new metadata on their next private request. The login notice
and privacy page disclose collection. This change is local pending owner review.

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

## Strategy tester wording — 30 October 2026

The owner calls this a strategy tester, not a journal. Frontend copy uses
My lab, Tester clock, lab backups and a private strategy tester welcome.
Internal database keys and API paths keep their names for compatibility.
This wording change remains local pending review.

The Results/Trades text links above Research test are replaced by a clear Go to
trades button at the right of the research controls. It scrolls to the existing
Trades section using the same navigation handler and fills the row on phones.

Header controls share a fixed responsive grid in both appearances. Classic no
longer constrains the outer app frame, so its logo, appearance switch and My lab
menu keep the same viewport positions when switching. Tested coordinate parity
at 320, 390, 768, 1366 and 1920px; Classic retains its colours and control styling.

## Simpler tester: My tests removed — 30 October 2026

The owner removed My tests from the current interface. App no longer renders the
research-test selector, experiment editor or Classic My tests link. Import,
trade entry and bulk editing have no test-destination/assignment controls. The
Go to trades shortcut stays, and Results/Trades show all source-matching trades
with ordinary setup filters. Welcome explains those filters rather than My tests.
Stored experiments and membership tags remain in the database and full backups;
reviewing a trade preserves its existing membership. Backend compatibility APIs
remain available but are not linked in the interface. No trades are deleted.

Import settings now starts with File setup: trade source and File time zone, plus
a static destination when only one account exists. More options contains date
format, duplicate label updates and manual column matching; it starts open when
the saved day-first/update-label choice is enabled. File parsing and signed
preview behaviour are unchanged. Time-zone help uses the selected tester clock.

## Backtesting / Live only — 30 October 2026

The owner wants a strategy tester with only Backtesting and Live. Import settings
and manual entry expose those two choices. Original source IDs remain intact
when staying in the same testing type, preserving duplicate identification.
The All Results option remains the combined view. Trading-account controls,
filters and names are removed from the interface, including import confirmation
and backup help. Existing records retain their account IDs internally; do not
rewrite/delete them. Saved Results filters are read with account_id=null so old
hidden account filters cannot exclude trades. Google sign-in and owner access
management remain; those are people, not trading accounts. Public wording and
privacy help use lab/strategy tester, while internal keys stay compatible.

My lab now includes Import settings. It opens the existing Import page dialog;
when already importing it preserves the current file, mapping and signed preview.
The opening request is consumed once, so later visits do not reopen the dialog.

## Optional five-step tour — 30 October 2026

All labs receive the current version of the guide once, including existing users.
TOUR_VERSION in journal_preferences versions this rollout; completion/skip saves
the version privately. Metadata reads never rewrite existing settings.
Newly provisioned Google labs also have tour_status=pending. The welcome setup is
followed by GuidedTour: Explore → Add trade → Import → Results → My lab. Existing
labs with no current-version completion start with the optional guide. My lab → Quick guide
replays it. A modal SVG spotlight blocks background edits and highlights one
control, with Back/Next/Skip and Escape to skip. Completion shows a green Ready
to test tick. Private /api/tour saves completed/skipped in journal preferences;
skipping a replay does not erase completion. Clock, labels, trades and imports
are not changed by the guide. Keep focus restoration, responsive positioning,
resize/scroll cleanup and correct menu highlighting. The owner approved publishing this guide to all users on 30 October 2026.

Tour visual revision: the owner disliked the large modal-style card. The tour
now uses a 300px compact tooltip, one-sentence descriptions, 26% background shade,
a thin palette-based highlight and side placement where desktop space permits.
The first step highlights the actual Strategy selector; Back is hidden on step 1.

## Home + separate Journal concept — 30 October 2026

The owner requested a local-only PrimusTrader Home and daily Journal beside the
existing Lab. **Do not commit, push or deploy this draft until it is reviewed.**
Run `.venv/bin/python tools/run_site_preview.py` and open
http://127.0.0.1:8118/. It uses a disposable directory, example Lab trades and
clearly labelled example Journal entries; it never reads real secrets or data.
The files disappear when this preview process stops. Other previews and the
live website retain their existing routes and behavior.

Settings.site_preview is deliberately false by default and validates only with
local=True and lab_path='/lab'. The server injects an opt-in meta tag; only that
preview serves Home at / and the new Journal at /journal. Existing /lab remains
the strategy tester. The normal root redirect is unchanged. No R2 keys were
created or copied, and no cloud image uploads were enabled.

Home includes the owner's five supplied names: Sajid Kasim, Safwaan Alad,
Mubeen Patel, Mustafa Dal and Amir Patel. Suggested desk roles/nicknames are
explicitly draft labels, not verified professional credentials. The price-action
illustration is labelled illustrative, not live performance. The news and calendar
are official free branded TradingView widgets, lazy-loaded inside sandboxed
iframes without same-origin access to private Primus content. Keep attribution
and fallback provider links. No paid APIs or fabricated news/prices.

The Journal has a per-day plan, session notes, lesson, mindset and up to six
screenshots. webapp.daily_journal stores notes/metadata in private workspace
settings, so existing JSON backups retain the text. Local preview screenshots
are decoded/limited/re-encoded to WebP, with no original metadata, and stored
only under the disposable directory, segregated by authenticated workspace.
Files are served only through authenticated image routes; no public static
mount. Removal detaches references; detached files remain inaccessible until
preview cleanup removes the temp directory. Export notes and individual image
downloads are separate. Saving drafts/photos never modifies Lab trades or stats.
The entire new Journal API is disabled outside the explicit local concept.
Production Google return-to-Journal, R2 integration, permanent storage and a
complete image-inclusive backup need a separately reviewed implementation before
publishing this Journal. Authentication/isolation are already exercised with
fake Google identities in tests; no real user records are used.

Local Lab visual alignment: the concept Lab now shares Home/Journal's PrimusTrader
header, centered navigation, cream/green palette, typography and sharper controls.
Modern/Classic appearance is inside My lab in this preview. Scoped lab-preview.css
and data-site-lab styling apply only with the preview opt-in; normal headers and
Classic's retro controls retain their existing behavior. Filters, statistics and
trade workflows are unchanged. Browser coverage checks shared header alignment,
320–1440px layouts, settings, dark mode, Classic switching and the phone guide.

Homepage visual revision: HeroStudy replaces the large faded logo/chart overlay
with an original SVG candle study, key-level reaction callout and three process
labels. CSS entrance/drawing animations finish within about 2 seconds and are
disabled for prefers-reduced-motion. No video, image service or live prices are
used. This remains local-only; build and the three concept browser tests pass.

Dark mode audit: Home/Journal now follow primus-theme rather than resetting the
Journal to light. Their shared header has an accessible sun/moon toggle, also on
phones. The Lab's existing menu keeps the same preference. Scoped dark tokens
and component overrides cover cards, writing surfaces, calendar, selected states
and messages; TradingView embeds receive the selected colorTheme. Four concept
browser checks pass, including theme persistence, contrast, mobile widths and
dark Journal saving. All changes remain local for review.

## Production Home and notes Journal routing — 30 October 2026

The owner manually deployed the draft, then requested the missing Home/Journal.
Production from_env now enables site_enabled by default when /lab routing is
configured (PRIMUSTRADER_SITE_ENABLED=0 rolls back to the old Lab-only entry).
site_preview remains restricted to local data. The enabled website injects a
separate primus-site-enabled marker, serves /, /journal and /lab, and applies the
shared header/theme. Home has no sample/live-preview banners. Sign in uses /lab.
Daily notes use the existing authenticated private workspace database and backup;
no sample data is seeded. Every write retains CSRF and isolation checks. Image
routes remain local-preview-only and the hosted Journal hides uploads until
permanent storage is configured. Do not enable local-only mode on Render.

## Local personal-workspace revision — do not deploy until owner does

Owner requested a charcoal dark palette (light design retained), page-specific
Journal/Lab sign-in entrances and one shared private account across both tools.
Unlock accepts optional workspace copy and a Journal paper preview. Google start
accepts only allowlisted return_to paths, stored in the signed session, then
returns to the selected page after callback. Existing sign-in calls still default
to Lab. Header reads the current session, shows My workspace when signed in,
and signs out through the existing endpoint. No new identity or data-sharing
model is introduced. Local-only ?preview=signin at /journal or /lab lets the
owner review entrance designs; its Google button is disabled. Normal preview
navigation continues to use disposable sample data. Nothing in this revision
has been committed, pushed or deployed; owner will deploy after review.

Local Lab polish: loading uses the existing Primus compass with a restrained
orbit (reduced-motion supported), clearer loading copy and larger supporting
Lab text. PrimusHeader accepts the Lab's theme/toggle so the sun/moon control is
visible beside My lab on desktop and outside the mobile menu. Classic switches
to Modern when selecting dark mode. Journal-to-trade linking was discussed as
an explicit linked trade form (several trades per daily entry); it is not yet
implemented. Saving Journal notes must never create financial observations.

## Local Journal day/trade workspace — not approved for deployment

The Journal now keeps Before/During/After session notes above expandable trade
cards. Cards contain market, direction, strategy (same private Lab catalogue),
entry time, live/backtesting, personal notes and per-trade screenshots. One day
can contain up to 30 narrative cards. Save entry stores the day; it does not
create Lab observations. Images retain the existing six-per-day local-preview
limit. Screenshots attach to stable UUID cards, while older session screenshots
remain accessible. Removing a card detaches its images to the day and never
removes the associated Lab trade. Cloud image storage is still not connected.

DailyEntry accepts validated narrative fields only; link IDs are server-owned.
Older clients that omit cards preserve them. Notes and card/link metadata remain
in private settings and the existing JSON export/backup. PUT /api/journal/{day}/
trades/{id}/link validates membership in the current private Lab. The explicit
Add to Strategy Lab form reuses TradeForm and the existing trade builder with
actual result and original risk. Its allowlisted journal_day/journal_trade_id
create a server-only lab:journal:day:uuid tag and recoverable, retry-safe link.
Unchanged core maths handles financial values. Repeated submission of the same
card cannot create another observation. An already imported trade can be linked
without changing financial fields. Journal-created Lab trades have a link back
to /journal?day=YYYY-MM-DD&card=uuid; Open in Lab uses /lab?trade=id#trades.

Calendar saved days have a filled green state in both themes. Month browsing,
calendar and the month's saved entry list are grouped in one rail; the calendar
also stays visible on phones. Long strategy choices wrap. The writing prompts
are plain plan/observation/review text. Local tools/run_site_preview.py now seeds
clearly labelled example cards. Latest new preview is http://127.0.0.1:8122/journal;
its data is disposable. Existing previews were not restarted. Nothing from this
iteration has been committed, pushed or deployed. Owner will deploy after review.

Local follow-up: removed the signed-in My workspace header/mobile shortcut;
Home/Journal navigation remains and Sign in appears only while signed out.
Homepage section order is People (01), Market Briefing (02), Workspace (03).
Section/card arrival animations run once, leave content visible without JS, and
respect reduced motion. Journal trade cards now store an explicit outcome enum
(not_recorded/win/loss/breakeven) and bounded confirmation strings from the Lab
catalogue. These are narrative annotations and never manufacture P&L or R.
Confirmation choices prefill Add to Strategy Lab; linking reads the actual core
trade's net result and reviewed labels into the Journal snapshot. Older clients
omitting the added fields preserve them. Current preview: port 8123 (older
previews remain intact). Full checks: 270 pytest, 53 Playwright, 22 Vitest passed;
production build passed. Keep all of this local for the owner's review/deploy.
