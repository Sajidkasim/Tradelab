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

Local motion pass: the outcome selector now shows Win/Loss/Break-even only. The
internal not_recorded value remains for legacy/incomplete cards; no result is
assumed before selection. Home tool-card hover/keyboard focus opens the paper
preview and writes an illustrative note, while the Lab preview draws a setup,
marks its reaction and reveals its steps. Navigation gets a short underline and
arrow response. New Journal cards enter gently and scroll into view; selected
confirmations/outcomes, saved notices and attached charts give brief feedback.
All effects stop, preserve content, and respect reduced-motion preferences. No
extra motion library or video was added. Keep this iteration local for review.


## Private Journal screenshots and recoverable entry deletion — local pending review

Supersedes the earlier notes saying R2 is unconnected. A bucket-limited Object
Read & Write key for private `primuslab-images` was created with explicit user
approval. The four PRIMUS_R2_* settings are saved in Render using Save only
(no deployment), and in gitignored `data/private/r2.env` with mode 600. Never
print these values. A synthetic write/read/delete against the real bucket passed;
no trading records were uploaded. Public bucket access remains disabled.

`webapp.image_storage` uses boto3 on the server. Browser image routes check the
signed-in workspace and entry metadata before serving private bytes. Provider
errors return a generic 503. Hosted uploads stay disabled without all four
settings; local previews ignore cloud env keys and keep disposable local images.

Daily Journal Delete entry asks for confirmation and archives the entry with its
latest edits. Undo and Deleted entries can restore it. Restore refuses to replace
an active entry for the same date. Lab trades remain untouched. Archived entries
and detached images are retained; there is no permanent purge in this release.
Existing JSON backup includes archived settings and screenshot references, not
image bytes; download screenshots separately. This is not an image-inclusive backup.

Removed the creative draft roles caption under the Home trader names.
Validation: Python 273 passed (5 existing warnings), Vitest 22 passed, Playwright
55 passed, frontend production build passed. All UI/code changes remain local;
no commit, push, or deployment was performed.

## Lab settings drive CSV tags automatically — 1 November 2026

`services.import_tag_catalog` derives automatic import meanings from the same
private effective strategy/level/setup/news/condition lists as Explore and Add
trade. No second mapping save is needed after editing Lab settings. Category
tags such as `Key level timeframe: 15m` disambiguate shared names; bare names
only apply when one field/value is possible. Explicit saved mappings (including
Keep original tag only) take precedence. Hidden choices are not regenerated.

Unicode/case/space/punctuation normalisation and common numeric time units are
supported. Minor unique word typos and four-letter acronym transpositions can
match; different numbers, competing meanings and short acronym substitutions
cannot. Fuzzy work is bounded to 200 distinct unfamiliar names per file; exact
recognition still applies to all tags. Original CSV wording is preserved.
Unresolved tags cannot activate the legacy bare-confirmation interpretation.
No absence of a confirmation or reviewed status is inferred. Fixed-RR approvals
and financial data/formulas are unchanged.

Import preview exposes recognised meanings/spelling matches and unresolved names
separately. Only unresolved names trigger Review new tags. Import settings shows
its connected Lab tags in a collapsed section and keeps manual exceptions.
The signed preview binds the effective vocabulary so changing Lab choices before
confirmation requires a fresh preview. Preview does not save settings or trades.
Public labels now say Key level timeframe; internal keys remain compatible.

The owner approved publishing this revision for everyone on 1 November 2026.
Validation: 291 pytest tests passed (5 existing deprecation warnings), 23 Vitest
tests passed, all 56 Playwright checks passed, and the production build passed.
After compacting the connected-tag list, the automatic-import and both menu
appearance checks passed again. Fresh disposable review: http://127.0.0.1:8125/lab.

## Import guidance and Journal setup/results — 1 November 2026 release

The owner explicitly requested deployment to existing and new accounts. Automatic
tags derive from each authenticated member's existing Lab lists at read time;
there is no migration, owner-label copying or retroactive trade rewrite.
Unknown/ambiguous tags show a reason, a short optional CSV guide, and quick
meaning buttons when a saved name spans categories. The guide explains the
key-level chart versus entry chart and qualified CSV timeframe names. Saved
exceptions remain private; changing a meaning refreshes the signed preview.

Journal trade cards have a compact optional Setup & result section: key level,
key level timeframe, entry timeframe, original amount risked and signed net P&L.
These optional narrative values do not create Lab trades or R. Explicitly
clearing a number persists null; old clients omitting fields preserve them.
Recorded P&L determines the narrative win/loss/break-even outcome on save.
Add to Strategy Lab prefills these details for confirmation through the unchanged
trade builder. Linked fields are server-controlled snapshots from that member's
Lab record; personal notes stay editable and Journal saves cannot alter Lab
money or labels. The existing auth/CSRF/cache/backup paths are retained.

Validation: 293 pytest tests passed (5 existing deprecation warnings), 23 Vitest,
56 full browser checks and production build passed. An added one-click review
browser check is also run before publishing. No financial core files changed.

## One appearance and archived vocabulary — 1 November 2026

Owner requested removal of Classic from the code. Its stylesheet, cursor assets,
appearance component, header/footer and chart branches are removed. Only the
existing light/dark interface remains; old appearance preferences are cleared.
The raw stylesheet is about 28 KB smaller (about 4 KB smaller gzipped); this is
a bundle-size measurement, not evidence that backend latency was caused by Classic.

Removed strategies, key levels and timeframe choices are returned separately in
private metadata.archived_choices. Strategies retain hidden_strategies; levels
now retain hidden_levels, and timeframes use existing hidden_choices. Legacy
levels still present only on historical trades are discoverable in the archive.
Default dropdowns exclude archived choices and the missing-label sentinels
Unclassified/Not recorded. Optional fields have a blank Choose placeholder; their
internal annotation keys/defaults are unchanged. All results still include
unlabelled trades. Historical trades and financial formulas are never rewritten.

Show archived beside a dropdown makes old labels selectable for exploration;
it does not reactivate them. Lab settings exposes named archives with Restore,
which adds a choice back to the editor for its normal explicit Save. Existing
trade reviews retain their saved values. Removing an active filter's choice
resets that filter to All/Any. The owner requested continuation of the live release.
Validation: 295 pytest tests passed (5 existing warnings), 23 frontend unit tests,
51 existing browser checks plus the new archive restore check passed. Updated
Journal dropdowns and retired-preference handling were also rechecked after the
final build. No database records or financial core files were changed for rollout.

## Local import review popup — 1 November 2026

Owner explicitly requested local changes only: do not commit, push or deploy this
revision until they approve. Unknown/ambiguous CSV tags now open a centred Review
tags prompt after preview, with the tag names, a short explanation and Review /
Cancel actions. Cancel preserves the preview and changes no tag meanings; raw
unmatched tags remain on imported trades. A compact reminder inside the preview
can reopen review. Tag review opens a dedicated view without file-setup tabs;
meaning changes re-preview without interrupting with another prompt.
Successful confirmation refreshes saved trades, keeps the success toast, and
navigates directly to the Trades anchor. Failed imports remain on the import
page. No backend, financial or privacy logic changed.
Validation: production build and 23 Vitest tests passed. All 54 browser checks
passed across regression runs (36 other flows, then the updated 18 workflow
checks). Desktop and phone checks cover automatic prompting, cancellation,
reopening review, preserving raw tags and redirecting to visible Trades after
confirmation. Earlier browser expectations were updated for the requested flow.
Nothing committed, pushed or deployed for this revision.

## Local release announcement — 1 November 2026

Owner requested local only; they will push and deploy. Strategy Lab now shows
What’s new for the 1 November release to existing members once their welcome /
tour is finished. Each private workspace records acknowledgement independently
through a CSRF-protected POST /api/release-notes/seen and cache bump. It is stored
separately from clock/tour settings. New accounts start with this version already
acknowledged because their welcome guide introduces the current experience.
My lab → What’s new always reopens the notes. Content covers automatic import
tags, review popup/cancel, return to Trades, archives, removal of Classic/missing
label choices and Journal setup/result detail. No existing trades are modified.
Local sample preview: tools/run_site_preview.py 8130 --release-notes.
Validation: 296 pytest passed (5 existing warnings), 23 Vitest passed, production
build passed; release-note desktop/phone and dismissal/reopen browser checks pass.

## Local Backtesting chart prototype — 2 November 2026

Owner wants a new backtesting page built in small local stages, using their
Databento archive in /Users/sajidkasim/Documents/Primus Backtesting and LuxAlgo
Vela. No push, upload or deployment is authorised for this prototype.
@luxalgo/vela is pinned to 0.9.3 and loaded dynamically only on the new page.
Visible Vela attribution stays present; its LICENSE and NOTICE are copied into
docs/licenses/vela. No PineTS / Pine scripting addon is installed.

Install optional offline tools with .venv/bin/python -m pip install -r
requirements-replay.txt. tools/prepare_replay_sample.py streams 10,000-record
chunks from the DBN archive, selects the highest-volume outright NQ and ES
contract for one UTC sample day, validates OHLC bounds and duplicate timestamps,
and writes data/private/backtesting-preview.json (ignored, never bundled).
This contract selection is just for a static chart, not an approved rollover or
look-ahead-safe simulation rule. No synthetic gap bars are inserted.

Sample: 7 June 2010 UTC; NQM0 1,341 bars, ESM0 1,393 bars; JSON 256,456 bytes.
The existing authenticated API serves it only when config.local is true.
The new /backtesting SPA path and navigation are local-site-preview only.
The chart uses offline bars, no live provider, explicit UTC axis, no API keys.
It displays the available full day: replay, order simulation, timeframe controls,
rollovers and progress saving are deliberately later stages, not implemented.
No core trading/statistical formulas or stored trades changed.

Run tools/run_site_preview.py 8131 then open /backtesting for a disposable sample
workspace. Original DBN data remains untouched. The real-data browser check is
skipped when the ignored sample has not been prepared. Validation: 296 pytest
passed (5 existing warnings); frontend build and real NQ/ES market-switch,
canvas, tablet/dark-mode and one-data-fetch browser checks passed.

## Local full-page chart workspace — 2 November 2026

Owner asked for an FX Replay-like chart-first layout, retaining Primus styling.
/backtesting now fills the viewport with a compact toolbar and corner Back link;
no site header, hero or preview banner is rendered here. Native drawing tools
are enabled (lines, levels, Fibonacci, box, text and position drawings only — no
broker/order placement). The status strip keeps contract/date/UTC/sample scope
and attribution visible without a large panel.

Chart-only UTC aggregation in frontend/src/backtestingBars.js provides 1m, 2m,
5m, 15m, 30m, 1h and 4h from the loaded one-minute sample. Missing minutes stay
missing; OHLCV buckets use first open, extrema, last close and summed volume.
No seconds or exchange daily/weekly bars are offered from this one-day sample.
This is chart data processing, not trade-performance statistics or P&L.

One Vela instance stays mounted. setMarket changes resolution/symbol and
recomputes native studies; setTheme changes light/dark in place. The visible time
range is retained across changes. Drawings are held separately per contract in
memory so NQ levels do not appear on ES; no reload/cloud persistence is claimed.
The searchable Indicators dialog uses Vela's native catalog with add/remove and
input-settings access, and charts retain native legend controls. No Pine addon
or indicator formulas were introduced. Studies only have the loaded sample's
warm-up history. Replay and simulated orders remain a later stage.

Validation: 26 frontend unit tests and build passed; real-data browser checks
cover viewport fill, aggregation controls, indicator add/remove and survival
through symbol/theme changes, native settings and responsive 320/390/800px
layouts. Still local only; do not push or deploy without the owner's instruction.

## Local replay sessions and simulated trading — 2 November 2026

Supersedes the earlier chart-only/later-stage notes above. The owner requested a
session landing screen with date, start time, capital and micro/mini contract
size, then a full-page chart with play/pause, next candle, speed, market/limit/
stop entries, quantity, optional stop/target, cancellation and closing. Sessions
can be saved and resumed. Keep this local; no commit, push or deploy is authorised.

`tools/run_backtesting_preview.py 8132` uses the durable, ignored SQLite file
`data/private/backtesting-workspace.db`, separate from all existing journals and
Lab trades. `/backtesting` lists sessions; `?session=<uuid>` reopens one. Every
replay endpoint in `webapp/replay_sessions.py` is local-only and uses the existing
workspace and CSRF checks. Private settings store a bounded session index and
command log. Version checks reject stale tabs, UUID action IDs reject retries,
and candle-file digests prevent resuming against silently changed prices.

Optional ignored `data/private/replay-source.json` holds the local DBN source path
and inclusive first_day/last_day. Preparing an uncached date streams the archive
through the existing offline tool into ignored `data/private/replay-days/`.
Original DBN files remain untouched. First-time date preparation may take time;
cached days are reused. Dates are UTC days, not CME session templates. Per-day
volume still selects the fixed prototype contract, not a validated rollover rule.
MNQ/MES practice uses NQ/ES price history with micro dollar multipliers; it does
not claim actual historical micro-contract tape (the sample is from 2010).

`services/replay_engine.py` owns all new simulated money/fill arithmetic and uses
existing instrument tick sizes/multipliers. Orders submitted after the visible
candle first become eligible on the next one-minute candle. Adverse slippage,
configured per-side commission and opening gaps apply. Stop-first resolves
ambiguous candles conservatively; intrabar entries cannot claim an ambiguous
same-candle target or use an opening price that preceded their entry as a gap
exit. Positions close at the final candle; pending entries are cancelled. One
position or pending entry at a time; no scaling, partial fills, margin calls,
liquidation model or broker connection. No core formulas were changed.

`BacktestingSessions.jsx` queues actions/progress writes, autosaves every three
seconds and saves before returning to the list. It does not request candle data
for each step. `BacktestingChart.jsx` keeps Vela mounted while time advances.
Only revealed raw minutes enter timeframe aggregation or indicator data; partial
higher-timeframe bars therefore use only reached prices/volume. The browser
already has the selected day and projection, so this is a local practice replay,
not a tamper-proof competition engine. Trade history/balance display only the
current cursor snapshot. Drawings/study settings are still in-memory, not saved
with sessions. Replay history has not been uploaded to R2 or Render.

Tests cover next-open fills, micro/mini values, fees, slippage, stops/targets,
intrabar ambiguity, cancellation, immutable snapshots, session-end closure,
saving/resume, stale tabs, retry protection, CSRF, data changes and hosted guards.
The existing Google/password browser helpers now acknowledge the existing
release-notes popup before exercising navigation; the popup itself is unchanged.

Validation: `python -m pytest -q` completed with 309 passed, 5 existing
deprecation warnings in 21.06s. All 28 frontend unit tests, all 57 browser checks
and the production frontend build passed. Browser checks include session
creation, two-micro market entry/close, limit cancellation, play/step, saving,
reload/resume and phone/tablet layouts in light/dark mode. This is viewport
testing, not a claim of testing on a real Samsung tablet. Local preview runs at
http://127.0.0.1:8132/backtesting. Nothing was committed, pushed or deployed.

## Local replay usability follow-up — 2 November 2026

Owner requested recoverable session deletion, visible entry/SL/TP and stable zoom
while playing. Sessions now soft-delete with confirmation and can be restored
from Deleted sessions. Deleted IDs reject open/action/progress until restored;
all routes retain local/workspace/CSRF checks. No Lab trades are changed.

The chart uses a browser-only Vela provider named practice. getBars and subscribe
receive only reached, aggregated minutes; the streaming callback updates an
existing candle or appends new ones instead of reloading setMarket each step.
This preserves native bar spacing, horizontal pan and manual price scaling.
Market/timeframe changes still use setMarket. No network/provider data is fetched
per candle; native indicators follow the normal streaming path.

An open position has a locked blue entry line and red/green draggable SL/TP
lines. Unset levels explicitly read “drag to set”; they are visual suggestions,
not active protection. Drawing edits pause replay, snap to quarter-point ticks
and send an authenticated/versioned amend action. services.replay_engine applies
changes after the current candle, rejects invalid sides and preserves prior
snapshots. User removal of a managed line restores its authoritative display;
it must not silently cancel an active stop. Plot pointer interactions pause play.

Sample inspection: NQM0 has 140 flat OHLC candles and 36 timestamp gaps; ESM0
has 51 flat candles and 4 gaps. All observed OHLC prices are on quarter-point
ticks. Prices/gaps were not smoothed or fabricated. This is a sample check, not
validation of the entire archive. Finer intraminute playback needs finer source
history rather than invented tick paths.

Validation: 311 pytest passed with 5 existing warnings in 28.85s; build passed.
The three relevant browser flows passed (chart/studies/responsive, replay/order
resume, delete/restore), and the replay test passed again with a real mouse drag
of the stop line and server-side persisted-price verification. Preview restarted
on port 8132 against the same durable local database. No publishing performed.

Playback verification also found Vela 0.9.3 getVisibleRange rounds/clamps to
whole loaded bars; feeding it back each candle progressively changed zoom.
`frontend/src/replayViewport.js` is an isolated compatibility adapter for the
pinned native renderer's exact logical viewport. View locked (default) restores
barSpacing/rightOffset adjusted for appended bars; Following leaves native
stream follow behaviour active. This adapter intentionally uses guarded native
internals and must be rechecked before upgrading Vela. Manual price scaling is
retained. The zoom/pan browser scenario passed; before/after historical-region
pixel comparison changed only 0.18% during playback (including the live price
line), below the 2.5% check limit. All four targeted browser flows passed after
the final locked/follow control and narrow-phone adjustments. 28 frontend unit
tests passed. No push or deploy.

## Local pending-order price boxes, context menu and watermark — 2 November 2026

Buy/Sell now shows an entry box and SL/TP controls while the submitted order is
still pending. Fill timing is unchanged: market orders fill at next-minute open.
services.replay_engine permits validated pending-order amendments without changing
submission time, and carries brackets into the fill. Each snapshot includes a
server-calculated ticket with reference price, draft/active prices and gross
hypothetical SL/TP dollar results; pending market figures are estimates before
fees, not realised results. No money formulas moved into React or core changes.

ReplayCanvasTools replaces the managed native drawing lines with DOM price boxes
at real projected prices. Drag/release snaps to ticks and submits the existing
versioned amend action; X removes a bracket, cancels a pending entry or schedules
an open-position close. Unset brackets explicitly say Drag to set. The entry is
movable only for pending limit/stop orders, never for an already filled trade.
The guarded, pinned Vela adapter now exposes its native drawing projector for
price conversions including manual/log/inverted scales. Check it on upgrades.

Right-click on the price pane opens Buy/Sell limit or stop according to clicked
price versus current price, using the selected bottom-bar quantity, plus Reset
chart view, Move to last candle and Chart settings. No table/object-tree/hide
options, date jump or clipboard commands are included. Escape/outside click
closes the menu. One position/pending entry restriction still applies.

The timeframe watermark is enabled initially and can be toggled in Chart settings
→ Symbol → Replay → Timeframe watermark. Preference is local to the browser.
Both themes and the existing viewport preservation remain intact. Current local
preview is port 8132; its durable session database is preserved through restart.

Validation: 312 pytest passed, 5 existing warnings in 23.76s; 28 frontend unit
checks and build passed. Five targeted browser flows passed, including pending
SL drag before any fill, active SL drag, order cancel/close, reload/resume,
context-menu order placement, watermark switching, narrow layouts and playback.
No commit, push or deployment. No real broker integration.

## Local saved custom intraday timeframes — 2 November 2026

The toolbar + opens Your timeframes. Default shortcuts omit 2m; users can add
whole-minute/hour intervals from 1m through 12h and save 1–10 browser-local
shortcuts. Removing the active shortcut selects the first remaining choice.
Malformed local preferences fall back safely. Custom intervals use the same
UTC OHLCV aggregation and revealed-minute filtering; gaps remain gaps.

Daily/weekly/monthly are explicitly NOT enabled in this one-day preview. The
editor explains that multi-session history is the next data step. Do not present
an incomplete single-day bucket as a complete week/month. Earlier sessions,
exchange-session boundaries and a validated contract-roll policy must accompany
those chart periods. No source data, core formulas or hosted settings changed.

Validation: 312 pytest passed (5 existing warnings), 29 frontend unit checks,
6 targeted browser flows including custom timeframe switching and reload
persistence, and production build passed. Local port 8132 serves the new build
on refresh; no backend restart is needed for these frontend-only changes.
No commit, push or deployment performed.

## Replay stages 1–4 local implementation — 2 November 2026

New sessions load tools.prepare_replay_history context via load_history; older
sessions retain original files/digests. Prior-day volume chooses daily outright
contracts; first coverage uses deterministic symbol ordering. No backward price
adjustment. Daily/weekly/monthly use UTC calendar boundaries with revealed current
minutes and earlier completed daily candles. Default review day is 2013-01-25:
314 earlier daily candles and 5,153 NQ / 5,487 ES preceding minute bars. Earliest
coverage (2010-06-07) remains available; first periods can be incomplete.

Per-session chart layout saving/restoration covers drawings per market, studies
and inputs/visibility, cosmetic config, timeframe/symbol and exact logical/manual
price scale. Explicit Save and Back wait for layout writes; background checks
save changed snapshots every three seconds. Dedicated layout records do not
invalidate the order-log version. Payloads are bounded and workspace/CSRF guarded.

Closed replay trades can explicitly Send to Lab / Journal / both. The server
projects the saved cursor, refuses future exits, retains initial-stop risk when
available, and uses existing Trade/Database calculation. Stable external IDs
and deterministic Journal card IDs prevent retry duplicates. Other accounts
cannot open, edit layouts or transfer another member's session.

Private immutable SHA-256 candle storage, packaging utility and hosted opt-in
configuration are implemented. The initial automatic approval rejection blocked
external upload; the owner then specifically approved both prepared Databento
bundles to primuslab-images. Both uploaded and verified by read-back; public
access unchanged. No UI deployment. See docs/REPLAY_DEPLOYMENT.md for host secret
file/flag requirements and outstanding real-tablet/data-permission/hosted checks.

Local real-history 5/10/25-read benchmark: max 0.385/0.846/1.974 seconds; process
peak RSS about 192 MB. Measurements are local, not a hosted capacity guarantee.
Full regression: 316 pytest passed (5 existing warnings), 30 frontend unit tests,
62 browser checks and production build passed. The final Journal snapshot
normalisation was rechecked with the focused replay/storage tests. Current
preview remains port 8132 with the existing durable local database. No commit,
push, production secret changes or deployment performed.


## Replay Beta release controls — 2 November 2026

Owner now explicitly requests upload and deployment and confirms written permission
for other users to view purchased history. This supersedes the earlier local-only
release restriction for these replay changes. Existing Google workspace isolation
and private R2 credentials remain unchanged.

New York / London chart display clocks follow IANA DST rules and persist in session
layouts. UTC remains the storage and aggregation convention; start time is labelled
UTC. Speed slider has 0.25/0.5/1/2/4/8/16/32 steps per second. Arrow menu jumps to
a favourite New York-time session start; editable times/favourite persist per browser.
Jumps are forward-only, process intervening fills, and clearly stop at the loaded
day boundary. Backtesting is labelled Beta. Hosted date choices come only from
the prepared manifest (2010-06-07 and 2013-01-25), not the entire raw archive.

Hosted price reads use a two-bundle immutable cache, shared prices only; personal
sessions, drawings and positions remain workspace-scoped in persistent PostgreSQL.
The Docker image includes Vela's licence and notice. All core formulas unchanged.
Validation: 317 pytest passed, 5 existing warnings in 25.75s; 33 frontend unit
checks, 63 browser checks and production build passed. Hosted-path regression
proves session creation/reopen/progress use R2 without Mac files.

## Full local replay archive and paired charts — 2 November 2026

Latest user request is LOCAL REVIEW ONLY; do not push or deploy these changes.
`tools/index_replay_history.py` builds a durable local SQLite minute index from
all downloaded outright NQ/ES history, excluding spreads. It resumes an interrupted
build; UTC dates use integer day conversion rather than slow timestamp formatting.
Index: data/private/replay-index.db (ignored). Completed: 14,682,323 unique minutes,
5,091 available dates, 2010-06-06 through 2026-11-01. Full SQL checks found zero
invalid OHLCV or non-minute timestamps. Local loads on 2013-01-25, 2020-06-02 and
2026-10-30 took 0.41–0.45 seconds. These are local, not hosted timings.

`webapp.replay_index` reads bounded windows: 14 calendar days of preceding minutes
for intraday/4h plus up to 370 days of daily context. Current candles include only
reached minutes at the common replay clock. UTC calendar aggregation and unadjusted
prior-day-volume contracts remain explicit conventions; no invented gap prices.
Older saved sessions retain their original candle file/digest. New session market
choices are NQ and ES; legacy micro sessions remain readable.

Two-chart toggle shares one replay cursor; markets, timeframes, drawings and study
settings remain independent. Primary/secondary layouts have separate private keys;
Save and Back flush both layouts. On narrow screens charts stack. SL/TP draft
anchors start at entry without placing actual exits until dragged; ticket amounts
are computed by the Python simulation service, throttled during drag, direction
and contract quantity included. Draft handles are visually separated at entry.

Backtesting journal saves session strategy, entry timeframe, checklist and notes.
Existing private Lab choices are suggested; extra confirmations can be entered.
Send completed trade explicitly from Trades to Lab/Journal; its saved research
labels/notes follow the trade through existing edge label and DB calculations.
Retries remain duplicate-safe. No broker writes or core formula changes.

The full index is LOCAL only. Current hosted manifest still contains two dates;
shipping the entire archive online requires a separate chunked private-R2 release.
Do not commit the database, raw archive, prepared price files or credentials.

Final local validation: 320 pytest passed, 5 existing warnings in 22.83s;
34 frontend checks and 64 full browser checks passed (1.7m). Production build
passed. A real local review session on 2020-06-02 opens paired NQ 4h / ES 1m at
09:30 New York, with both clocks aligned. No commit, push or deployment of this
local revision. Old cloud history remains unchanged. Local preview: port 8132.

## Calendar and longer 4H correction — 2 November 2026

Local only; no upload/deployment. New session always uses a calendar date input,
with refreshed availability on each opening, rather than retaining a stale two-date
select. Shows indexed coverage explicitly. tools/index_replay_charts.py prepares
52,282 prior-day-volume-selected UTC 4H candles across the full local archive.
webapp.replay_index.four_hour_history supplies the completed prefix before each
session date; current-day 4H still aggregates only reached minutes. The replay
response enriches chart-only context without changing original candle digests,
orders, financial results or session progress. Existing sessions receive it too.
A 2013-01-25 session receives 4,199 prior 4H candles; 2020-06-02 receives 15,864,
both back to June 2010. Switched 4H initially shows the latest 180 bars; users can
pan/zoom into the full loaded archive. Legacy short-layout views upgrade once,
then save a chart-context version so later user zoom is respected.
Validation: 321 pytest passed (5 existing warnings), 35 frontend unit checks;
calendar stale-choice/2020-date regression and paired-chart/scaling checks pass.

## Shared replay setup dropdowns — 2 November 2026

Local only. ReplaySetupFields is shared by Backtesting journal and Send practice
trade. Strategy, key level, key-level timeframe, entry timeframe, confirmations,
news and market choices read the current private /api/metadata catalogue each
form opening; no separate hardcoded vocabulary or typing-only strategy control.
Saved legacy choices remain identifiable without adding them to the active lists.
Session defaults and per-trade Send overrides are separate. ExportInput accepts an
optional validated setup; existing clients still use session journal defaults.
The existing edge.write_labels and Trade/Database paths carry selected labels and
notes into Lab, and the Journal-only path retains setup fields too. Retries do
not duplicate records or overwrite already-linked Lab trades. No core formulas
or broker integration changed. Local preview restarted on 8132.
Validation: 322 pytest passed, 5 existing warnings in 26.46s; 35 frontend unit
checks and build passed. Three targeted browser flows cover new private Lab
choices appearing in replay dropdowns, persistence, phone layout and trade export.
No push or deployment performed.

## Continuous local replay — 2 November 2026

Local only. The complete Databento download is already saved once in the ignored
replay-index.db (5,091 dates, 2010-06-06 through 2026-11-01); the session desk now
makes that saved coverage explicit. No archive re-import or cloud upload is needed.
New and unfinished sessions no longer liquidate at a loaded day boundary. The
private version-checked /continue route appends the next available trading day,
with immutable per-day signatures and retained cursor/commands/entry/SL/TP/fees.
Play and next-candle load another day when needed; the session-jump shortcut can
also load the following day. The Vela instance stays mounted, keeping drawings,
indicators and viewport. Save/reload preserves the combined timeline. Weekend
and holiday gaps up to seven calendar days are allowed; isolated two-date hosted
samples never bridge years. At archive exhaustion positions remain saved/open.
An open position or pending order cannot silently cross a selected contract roll.
Completed legacy session-end exits are retained at their original cursor, so
continuing an old session never rewrites a previously displayed financial result.
No core formula/signature changes, broker calls, pushes or deployments.
Validation: 328 pytest passed (5 existing warnings) in 24.54s, 35 frontend unit
checks and build passed. Three targeted browser flows passed, including crossing
midnight with an open position, saving/reopening it and manually closing later.

## Full R2 archive release — 3 November 2026

Owner explicitly requested uploading full history and fixing hosted/local parity.
New webapp.replay_archive reads bounded gzip chunks with SHA-256 and 12 MB
uncompressed limits. tools/package_replay_archive.py builds canonical per-day
chunks from active_contracts and shared daily/4H context, then uploads with
read-back checks before publishing the shipped hash-only manifest. Old v1 price
bundles stay available for frozen existing session signatures. Hosted results now
include earlier 4H context as local results do; saved journal setup dropdowns use
the same already-shipped private Lab catalogue. The archive is about 111 MB.
Full tests: 330 passed, 5 existing warnings in 22.05s; 35 frontend checks and build
passed. No core formulas or broker integration changed. See REPLAY_DEPLOYMENT.

## Indicator limits, styled favorites and interval sync — 3 November 2026

Local only; no commit or deployment. replayPreferences orders the existing minute
intervals (including custom 1–720 minute values) before daily/weekly/monthly.
Each native indicator has a Maximum timeframe selector in Indicators / On your
chart; Sessions has the same limit in its settings. Interval-driven hiding keeps
manual eye-toggle intent separate and restores visibility on smaller intervals.
The saved studies retain inputs, manual visibility and maximum interval.

Drawing favorites has a direct toolbar entry. Named line, horizontal line/ray
and rectangle/square presets deep-copy style, text and tool properties without
anchors or prices. Vela tool templates omit literal text, so a one-placement
created listener applies the copied text through its public drawings.update API.
Rename/delete and an empty state are supported; legacy templates migrate into
the toolbox. Native starred tool types also persist. drawingFavorites and
 drawingToolFavorites are private chart-default fields; existing workspace tests
verify a second user cannot inherit these preferences.

Split Sync intervals defaults off. Enabling matches the active interval; future
changes update both panes atomically without propagating symbols, drawings or
viewport settings. chartGroup persists the toggle. Forced layout saves wait for
pending chart switches, and registered savers always use current settings.
Validation: 353 pytest passed (5 existing warnings), 64 Vitest checks passed,
production build passed. Replay browser suite: 27 passed; the sync save/reload
check passed separately after correcting its wait for completed layout writes.
The local preview is on port 8132 using its existing persistent preview database.

## Trade draft protection and Journal results — 3 November 2026

Local only. TradeForm compares its complete editable draft against its opening
snapshot. useTradeDismissal guards backdrop clicks, Escape, close and Cancel in
both the Lab trade modal and Journal-to-Lab modal. An untouched form closes
without prompting; unsaved changes require confirmation, and in-flight saves
cannot be dismissed. Browser navigation also warns for an unfinished draft.

Journal cards have a private setup_grade ('', A+, A, B); this is not a Lab label
and is not sent into Lab statistics. daily_journal.with_day_result adapts recorded
card results into core.metrics.daily_pnl, without formula changes. Calendar dots
are green/red/blue for positive/negative/zero total, only once all unique trades
have recorded P&L. Missing results and no-trade days have no outcome dot. Linked
Lab records remain authoritative and duplicate links count once. Totals are
response-only derived values, never additional stored financial records.
Validation: 360 pytest passed (5 existing warnings), 64 frontend unit checks,
4 Journal browser flows and production build passed. Local preview: port 8132.
