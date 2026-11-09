# Frontend performance and reliability checks

This pass keeps replay execution/P&L in Python and leaves the Vela 0.9.3 adapter
and 3,000-candle history policy intact. It does not deploy or modify saved trades.

## Changes

- Strategy Lab is loaded as a separate route chunk rather than on every visit.
- Plotly loads when its chart approaches the viewport, with reserved height to
  avoid layout jumps and an explicit chart retry action.
- Hashed build assets receive immutable one-year caching. HTML and private API
  responses retain no-store; private data never enters the public asset cache.
- Replay opening names its fetch/preparation stages and offers retry/back actions.
  Cancelled opening results cannot reopen the chart after returning to sessions.
- Failed timeframe history is gated until explicit retry or a new selection,
  preventing repeated automatic loading attempts. The existing chart is retained.
- Authenticated home visitors get links to Journal, results and an unfinished
  replay when replay is enabled. Rules warn before leaving with unsaved changes.
- Matrix distinguishes stored snapshots, update time unknown, and snapshots older
  than 48 hours. Observation/provider details remain attached to each reading;
  unavailable readings show no inferred values. Refresh failures retain the last
  snapshot. Snapshot age is not the age of every underlying observation.
- Shared button sizing and keyboard focus styling cover the site and Journal;
  compact replay trading/viewport controls keep their existing geometry.

## Measured samples (9 November 2026)

Local, fresh browser contexts, 2.5-second observation window, no CPU/network
throttling. Encoded resource bytes exclude requests that have not finished and
are not a full-session download estimate.

| Metric | Before | After |
| --- | ---: | ---: |
| Main JavaScript (uncompressed build) | 431.50 KB | 338.49 KB |
| Main JavaScript (gzip build estimate) | 130.58 KB | 105.60 KB |
| Journal initial encoded resource bytes | 929,240 | 513,185 |
| Homepage initial encoded resource bytes | 682,453 | 654,885 |
| Replay chart ready | 1,878 ms | 1,892 ms |
| Replay frame interval p95 | 16.8 ms | 16.8 ms |

The replay timings are effectively unchanged in this single comparison. Do not
claim a replay speedup, zero dropped frames, 120 Hz validation, or absence of
long-session leaks from this smoke benchmark. Heap values are Chromium's coarse
estimates. The before/after comparison covers 25 seconds of playback. A separate final
120-second playback soak also passed save/resume with zero reported JavaScript
errors or HTTP 5xx responses. A real ProMotion device and a multi-hour session
remain distinct from these headless checks.

The public deployed origin was checked read-only without authentication; DOM-ready
times were 539–834 ms across four routes. These were public entry screens, not an
authenticated replay benchmark. Production replay needs an authorized test account
and dedicated disposable sessions. No deployment was changed by the audit.

The 3D model remains a separate, on-demand feature chunk; its source geometry and
rendering were not rewritten. Its ~12 MB payload is not loaded on Home/Journal.

## Repeat the checks

Use the project Node runtime and Playwright browser installation if they are not
already on PATH. From repository root:

```sh
node tools/audit_frontend.mjs http://127.0.0.1:8133 data/private/frontend-audit.json
.venv/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser -- e2e/replay-performance.spec.js
REPLAY_SOAK_MS=120000 npm --prefix frontend run test:browser -- e2e/replay-performance.spec.js
npm --prefix frontend run test:browser -- e2e/workspace-polish.spec.js
npm --prefix frontend run test:browser -- e2e/replay-session.spec.js --grep 'continues into the next day|stationary zoomed|failed timeframe'
```

Build before running pytest: HTTP tests read frontend/dist. Browser regressions
start isolated test servers and use temporary workspaces, not the owner's journal.
The replay smoke test records chart-ready time, API response timings, frame
intervals and coarse heap estimates to replay-performance.json in test-results.
Tests fail on JS errors, server errors, missing cursor progress or failed resume.
Existing boundary and bounded-paging regressions are part of the release check.

For opt-in API/history/render profiling in a browser:

```js
localStorage.setItem('primus-replay-profile','1')
// After exercising replay, inspect window.__primusReplayTimings.
// Turn off afterwards:
localStorage.removeItem('primus-replay-profile')
```

The timing buffer is bounded and stays on the device. No telemetry service,
background reporting, provider subscription or credentials are added.
