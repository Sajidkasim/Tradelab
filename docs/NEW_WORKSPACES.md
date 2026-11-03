# Learn, Market Lab and Mindset

Local implementation, 3 November 2026. Uses React/Vite, the existing FastAPI
service, the existing settings table and existing private image storage. No new
subscription, database, service or backtesting engine.

## Navigation and content

Website mode (`PRIMUS_SITE_ENABLED=1`, already used by Home/Journal, or the local
site preview) exposes `/learn`, `/market-lab` and `/mindset`. The shared header
links all three; routes are lazy-loaded and use the existing light/dark palette.
Google sign-in return paths include the new pages.

Learn and Mindset resources are public to read. The owner starts with publishing
rights; everyone else is read-only. Under Learn -> Manage publishers the owner
can approve a teammate's verified Google account after its first sign-in, and
revoke it immediately. Email, device details and account lists are not public.
The server checks publishing permission on every write. Publishers can edit the
shared library, so grant the role only to trusted team members.

To publish: Add resource -> choose video, article or guide -> title, description,
category, URL or written text -> optional thumbnail, tags, exercise and app link
-> Publish resource. New category names are allowed. Articles render as plain
text, not HTML. Videos accept validated YouTube links; playback is click-to-load
using YouTube's privacy-enhanced embed host. Content starts empty, with no sample
lessons, imported material or invented author claims. The initial resource limit
is 200 entries, not a fixed category schema.

Storage: shared `primus_resources_v1` and `primus_publishers_v1` settings in the
owner's existing database. Client data never selects an authorization identity.

## Market Lab

This phase exposes the repository's existing `strategies.example_orb` through
`core.backtest.run_backtest`; it is labelled as a built-in rule, not a user's
strategy. No arbitrary Python, ranking or AI execution is accepted. The replay
engine and order behavior are not modified.

Choose NQ/ES, available UTC history dates, an interval (1/5/15/30/60 minutes),
opening range, New York session-start time, target R, capital, contracts and costs.
The source timestamps stay UTC; copies are converted DST-aware for this rule.
Opening range must be a multiple of the candle interval. Windows are limited to
10 calendar days and 16,000 raw candles. One research request runs at a time;
concurrent requests receive a retry message. Missing days, duplicate timestamps
and contract-roll crossings fail without storing results. Closed dates are skipped.

Reads use bounded indexed local day queries, or the existing private R2 execution
chunks. They do not decode downloaded archives or read all history per request.
The owner's recorded written permission for users to view the purchased history
is in REPLAY_DEPLOYMENT.md. No new candle-download endpoint is exposed.

Metrics come directly from the existing core, with trade count, tested dates,
actual candle coverage, contract, costs and rule settings shown. Only the last
30 summaries are retained per user in `primus_market_runs_v1`. Nothing is inserted
into Journal or Strategy Lab trade records. Sparse/no-trade results are explicit.
No user results are shared or ranked. The initial rule uses intraday source bars,
next-open fills, conservative stop-first ambiguity, and end-of-data liquidation,
as documented in the existing engine. It is not tick-accurate execution.

## Mindset privacy and storage

The breathing exercise is optional, silent and local to the page: four seconds
in, six seconds out, Start/Pause/Resume/Stop. It starts stopped. A reduced-motion
preference disables expansion animation. No exercise activity is stored.

The vision board saves up to 50 goals/reminders in each person's own
`primus_vision_v1` setting. Neither the owner nor publishers have a route to
another member's board. There are no trade links or sharing controls. Private
uploads reuse the existing image compression/authenticated-storage pipeline,
with a reserved internal date partition; they do not create Journal entries.
Replacing/removing a goal removes its old object after its metadata write.
Unreferenced uploads are cleaned up after metadata-write failure.

Image links use HTTPS and load only after an explicit click, because loading
contacts the external host. Uploaded images are private and served by an
authenticated per-user endpoint with no-store caching. Notes use the existing
backup/settings storage; image bytes remain in the existing separate image store.
No generated psychology articles, diagnoses or performance promises are included.

## Later phases

Optional lesson progress, richer article formatting and content image uploads,
additional explicit strategy adapters, larger/background scans, side-by-side
comparisons and vision-board sharing are intentionally not included. Add fields
or adapters to the separate modules rather than modifying financial core formulas.

## Changed files

- `frontend/src/main.jsx`, `SiteExperience.jsx`: routes/navigation/theme context.
- `LearnPage.jsx`, `MindsetPage.jsx`, `MarketLabPage.jsx`: page entry points.
- `WorkspacePages.jsx`, `ResourceLibrary.jsx`, `VisionBoard.jsx`,
  `BreathingExercise.jsx`, `workspace-pages.css`: shared presentation and workflows.
- `webapp/app.py`, `learning.py`: routes, schemas, role checks and private board.
- `webapp/replay_sessions.py`, `market_lab.py`: bounded source adapter and core run.
- Tests: `tests/test_learning_pages.py`, `tests/test_market_lab.py`,
  `frontend/src/breathingExercise.test.js`, `frontend/e2e/workspace-pages.spec.js`.

## Verification

- Full Python suite: 369 passed (5 existing warnings).
- Frontend unit tests: 68 passed; production build passed.
- Browser checks: four new workspace flows, three existing scaling checks and
  the existing private-site sign-in flow passed. The sign-in test now acknowledges
  the existing release-notes popup before navigating from Journal to Lab.
- After the final changes, seven backend workflow tests passed again, including
  private image replacement/deletion cleanup and cross-user access checks.
- `git diff --check` passed. No commit, push or deployment was performed.

## Learning story and brain explorer — 3 November 2026

Local design update: Learn now includes four original, static starter guides and
19 searchable glossary terms in `learningContent.js` / `LearnFoundations.jsx`.
These introduce charts, risk, testing and review. They are separate from the team's
editable resource library. Further-reading links point to CME and CFTC sources;
no external articles or videos have been copied into the library.

Mindset begins with `BrainExplorer.jsx` and the small original procedural mesh in
`brainModel.js`. Pointer drag, arrow keys and rotation/reset buttons move the 3D
illustration. Region buttons select PFC, amygdala or hippocampus; internal regions
use a transparent surface. Geometry and locations are expressly schematic. The
copy explains connected functions rather than diagnosing a user's brain state,
with NIMH source links. Reflection prompts lead into the existing breathing and
private-goals sections. No reflections or brain selections are recorded.

Rendering is browser-only, coalesced to one requested animation frame, with a
capped pixel ratio and bounded mesh. It has no idle animation loop, external model
asset, new dependency, AI call or storage service. Effects and resize observers
are cleaned up on unmount. Existing theme and reduced-motion support remain.
The shared navigation labels Market Lab (Beta), matching Backtesting (Beta).

Checks: 71 frontend unit tests passed, seven workspace browser flows passed, and
production build / git diff checks passed. Browser coverage includes pointer and
keyboard rotation, reset, idle stability, inside-region selection, glossary search,
phone/dark layouts, existing resource publishing and private-board persistence.
No commit, push or deployment performed.
