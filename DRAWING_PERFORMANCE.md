# Drawing performance and session storage review

Local changes only. No commit, push, deployment or real session deletion performed.

## Findings and priority

1. **Repeated drawing paints during a gesture.** Pinned Vela 0.9.3 implements
   `DrawingInteraction.move → deps.changed → UserDrawingController.render` in
   `frontend/node_modules/@luxalgo/vela/dist/chunk-BDVUH2Y7.js`. Each raw move can
   repaint the entire top drawing canvas. `pointerMove → updateHover →
   topDrawingAt`, plus `cursorAt → hitAt`, also hit-test the drawings. The work
   grows with drawing count; a high-frequency mouse can submit more work than
   the display can present. Selection and final edits request additional paints.
   **Implemented:** `installDrawingPerformance` in
   `frontend/src/replayDrawingPerformance.js` keeps only the latest move per
   animation frame and coalesces top-layer paints. It flushes the final move
   before release. Native commit, selection, snapping and undo logic stay intact;
   Escape discards queued movement. All wrappers/frames are removed on unmount.

2. **Repeated layout serialization and pending save snapshots.**
   `BacktestingChart.saveLayout` previously called `drawings.toJSON`, captured
   renderer config and stringified the whole layout every three seconds,
   including unchanged layouts and active gestures. Changed snapshots updated
   React's workspace state and joined a promise queue; a slow connection could
   retain many obsolete documents. **Implemented:** dirty-event tracking,
   one-second quiet-period save, lightweight ten-second dirty fallback, no
   automatic snapshots while a pointer is held, and `latestLayoutWriter` with
   at most one request plus one replacement snapshot. Explicit Save, pause and
   Back still flush layouts. No data-series rebuild is used for drawing edits.

3. **Historical scans for data-driven tools.** NativeRenderer's
   `drawingProjector → barsInTimeRange` scans the loaded candle array from its
   beginning on each range lookup. Statistical drawings can request these
   repeatedly; ordinary trend lines do not use this path. **Implemented:** binary
   lower/upper bounds plus an exact inclusive slice of the sorted loaded candles.
   It does not fetch extra history, change candle values or reveal future bars.

4. **Repeated visibility filtering.** Vela's `onScreen` filters and allocates an
   array for painting, hit testing and selection. **Implemented:** reuse the
   result until the drawing document array or chart interval changes. Geometry
   changes still use the current drawing objects. Drawing visibility settings
   committed through Vela replace that document array.

5. **Interleaved drawing canvases and commit snapshots remain costs.**
   `prepareSlices` rasterizes drawings behind the candle/indicator layers and
   composites their canvases on data paints. `DrawingController.onIntent`,
   `sync` and `syncDrawings` serialize/deserialise documents and record undo on
   final edits. These are not per-move database writes, and Vela already lifts
   interleaved drawings onto the top canvas during a drag. Do not rebuild this
   machinery or reorder saved drawings without a real-device profile showing
   it is necessary. Future improvements, in order: cache unchanged slice
   textures; spatially index/cull geometry for very large drawing sets; replace
   full-document undo snapshots with bounded delta history upstream.

There was no observed increase in DOM canvas count as simple drawing count rose:
the isolated test kept seven canvases. That is not evidence of a general memory
leak. Ordinary line drawings did not re-aggregate historical candles. I could
not reproduce minute-long stalls in this isolated Mac benchmark, so those must
not be presented as a proven or completely resolved cause on every device.

## Minimal accurate approach

Keep candle/execution state separate from drawing previews. Process the newest
pointer position once per display frame, paint the drawing overlay, then let
Vela commit one final edit on release. Persist settled layouts asynchronously.
Never rebuild candle series, rerun trade execution or write to the database on
pointermove. Preserve the original UTC prices, SL/TP checks, shared replay clock
and private workspace checks. The adapter changes scheduling and range lookup,
not financial formulas. Vela stays pinned at 0.9.3; review this compatibility
adapter before upgrading the library.

## Measurements

Headless Chromium, local Mac, 1440×1000 viewport, 750 synthetic candles. Each
gesture below delivers 240 moves in one burst and commits one final line edit.
These numbers measure a stress burst, not a user's normal per-event latency.

| Drawings | Before handler work | After handler work | Paint calls before → after |
|---|---:|---:|---:|
| 20 | 12.3 ms | 0.3 ms | 221 → 2 |
| 100 | 15.9 ms | 0.3 ms | 221 → 2 |
| 300 | 34.5 ms | 0.6 ms | 221 → 2 |

With 300 drawings, time through two animation frames was 49.5 → 34.1 ms.
With 20 drawings it was 29.1 → 34.0 ms: scheduling is bounded by the display frame,
so reduced CPU work does not imply every small gesture paints sooner.
All cases kept one commit and seven canvases.

Reproduce without using any saved sessions:

```sh
npm --prefix frontend run dev -- --port 8140
# In a second terminal, from the repository root:
node frontend/tools-profile-drawings.mjs
```

For the actual app, enable opt-in diagnostics in the browser console:

```js
localStorage.setItem('primus-replay-profile', '1');
// Interact, then inspect bounded samples (no prices or credentials logged):
console.table(window.__primusReplayTimings?.filter(x => x.name.startsWith('drawings:')));
// Disable afterwards:
localStorage.removeItem('primus-replay-profile');
```

Compare identical sessions/devices with 0, 20 and 100 drawings. Use browser
Performance recording to inspect frame times, long tasks and canvas/GPU work.
Count `/layout` requests: none while holding a gesture; one settled snapshot
afterwards, no idle serialization of unchanged documents. The browser test
`drawing gestures defer layout snapshots until release` checks that behaviour.
Unit tests check exact range boundaries, canceled gestures and bounded writes.
Use CPU throttling and a real tablet before claiming the severe device-specific
stall is gone. Existing replay browser checks protect execution and layout state.

## Memory and permanent session removal

`webapp/replay_sessions.py:sessions` now discards each full saved session after
reading its small summary. Previously it retained every command log at once.
A local tracemalloc comparison with 100 synthetic sessions × 1,000 commands
measured 48.87 MiB peak before versus 1.01 MiB after. This is allocation for the
listing operation, not total Render process RAM or a measured production saving.

Deleted sessions previously retained all records indefinitely. On the practice
desk, expand **Deleted sessions → Delete permanently**, then type that session's
exact name. The authenticated endpoint requires the session to be deleted first,
and atomically removes its record, two layouts, session notes and index entry.
It preserves market-price archives and trades/entries already exported to the
Strategy Lab or Journal. It cannot access another user's workspace. No existing
sessions were removed during this work.

Permanent deletion frees logical database storage and a slot in the 100-session
limit; it is not a cure for chart-frame lag or a guarantee that database files
shrink immediately. SQLite normally reuses freed pages; Postgres reclamation is
managed by vacuum. No disruptive database compaction was run.

## Verification

`python -m pytest -q`: 351 passed, 5 existing deprecation warnings.
Frontend: 48 checks passed; production build passed.
Replay browser suite: 18 existing checks passed; two additional targeted checks
cover permanent deletion and drawing saves during gestures.
