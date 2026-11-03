# Replay fixes — local review

No commit, upload, deployment or real user-session deletion was performed.

## Single-drawing bottleneck

The earlier drawing stress benchmark used `zIndex:1`, above the candles. Native
Vela places a newly drawn line/rectangle at `zIndex:-0.5`, behind the candles.
That difference matters: `NativeRenderer.paintData → UserDrawingController.
prepareSlices → WebGL2Backend.drawSliceTexture` creates a plot-sized canvas
interleave layer and uploads it via `texImage2D` on every data repaint. This
explains why even one drawing adds work that ordinary built-in indicators do
not: those indicators normally emit geometry directly.

Measured locally in headless Chromium at 1800×1000, device pixel ratio 2, with
750 synthetic candles and 30 complete paints per case:

| Backend | Drawings | Median paint | p95 paint | Texture uploads |
|---|---:|---:|---:|---:|
| WebGL2 | 0 | 0.1 ms | 0.5 ms | 0 |
| WebGL2 | 1 square | 7.5 ms | 10.9 ms | 30 |
| Canvas2D | 0 | 0.1 ms | 0.3 ms | 0 |
| Canvas2D | 1 square | 0.6 ms | 0.8 ms | 0 |

The benchmark calls `gl.finish()` to include pending GPU work. It is synthetic,
not a hosted or tablet FPS guarantee. Reproduce with Vite on port 8140 and
`node frontend/profile-single-drawing.mjs` from the repository root.

Replay now selects Vela's documented `nativeBackend:'canvas2d'` option. This
avoids full-canvas CPU-to-WebGL uploads without changing drawing depth, anchors,
selection, snapping, editing, deletion or candle/execution calculations. It
retains the previous bounded pointer/paint scheduling adapter. No dependency
files were modified. This finding supersedes the single-drawing uncertainty in
the earlier DRAWING_PERFORMANCE.md stress-test report.

## Trade controls

Unset TP/SL labels previously had fixed long-oriented CSS offsets. Labels now
separate above/below entry according to long/short direction. TP is below entry
for shorts and above for longs; SL uses the opposite side. The actual price line
does not move just to avoid overlapping labels. Dragging preserves the initial
grab offset and follows the pointer during the gesture, with a larger 40px grab
target and direction-neutral resize affordance. Existing tick snapping,
direction constraints, Escape cancellation and final server amendment stay in
place. No execution formulas were changed.

## Session deletion

The session section is the backtesting practice desk, not Journal days. Deletion
now permanently removes replay records, both chart layouts and session setup
notes. There is no recoverable archive UI. Single/multiple/all deletion requires
typing `DELETE N`; validation and deletion use the authenticated workspace and
an atomic database transaction. Unknown or unauthorized IDs abort the batch.
"All" deletes only the IDs included in the confirmation snapshot, so a session
created concurrently is not silently deleted. Previously archived sessions are
included when the owner explicitly chooses Delete all sessions.

Accounts, shared candles, chart defaults, exported Strategy Lab trades and
Journal entries are preserved. No existing user sessions were deleted during
implementation or testing. Deleted database pages may be reused rather than
immediately shrinking the physical database file.

## Homepage

The matching section was `03 / Your workspace`, containing Journal and Strategy
Lab cards. A third card now says **Free Backtesting** and: “Test your ideas with
free historical replay. Currently in beta; chart availability is limited.” It
links to `/backtesting` and spans the row responsively.

## Per-user chart defaults

The existing private workspace database supports separate settings per signed-in
user. The implementation uses that model, never a shared global default.
Settled/manual layout saves also retain a small whitelist of chart defaults:
renderer config, studies, timeframe, shortcuts, clock and watermark preferences.
New sessions inherit them; existing sessions retain their saved layouts. An
inactive split pane does not overwrite the selected pane's defaults. Drawings,
positions and viewport zoom/pan are excluded from the defaults.

Chart settings → Symbol → Replay offers separate **1-minute watermark** and
**5-minute watermark** switches plus the existing master watermark switch.
Preferences persist through new sessions/reloads and are isolated between users.
The private chart-defaults PUT endpoint also supports explicit reset; it rejects
non-preference fields and oversized documents and retains CSRF/origin checks.

## Files changed

- `frontend/src/BacktestingChart.jsx`: backend selection, defaults, watermark switches and synchronous shortcut save.
- `frontend/src/ReplayCanvasTools.jsx`: direction-aware labels, preserved grab offset and larger handles; no idle geometry loop without a ticket.
- `frontend/src/replayTicketLayout.js`: pure screen-position helper.
- `frontend/src/backtesting.css`: grab-target sizing/hover styling.
- `frontend/src/BacktestingSessions.jsx`: selection and permanent/bulk confirmation UI.
- `webapp/replay_sessions.py`: atomic private deletion, preference endpoints and new-session defaults.
- `frontend/src/SiteExperience.jsx`: Free Backtesting promotional card.
- `frontend/src/site-preview.css`: responsive third-card placement.
- `frontend/profile-single-drawing.mjs`: reproducible default-depth rendering benchmark.
- `tests/test_replay_sessions.py`: deletion safeguards, retained data and cross-user/default isolation tests.
- `frontend/src/replayTicketLayout.test.js`: long/short screen-placement tests.
- `frontend/e2e/replay-session.spec.js`: drawing/replay regression, long/short TP/SL drags, permanent/bulk deletion and cross-session watermark persistence.
- `REPLAY_UI_REVIEW.md`: this review and measurement record.

No choice needs confirmation before local review. Publishing remains with you.

## Verification results

- Full Python suite: `353 passed, 5 warnings in 24.72s` (existing deprecation warnings).
- Frontend unit tests: 52 passed.
- Complete replay browser suite: 23 passed.
- After the final selected-pane preference guard and grab-label adjustment:
  20 targeted API tests and four focused browser tests passed.
- Production build and `git diff --check` passed.
- Local review: http://127.0.0.1:8132/backtesting
