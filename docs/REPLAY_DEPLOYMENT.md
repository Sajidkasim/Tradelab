# Replay deployment handoff

The local implementation is available at http://127.0.0.1:8132/backtesting.
Existing sessions use their original day files. New sessions add preceding
calendar history. Default prepared review date: 25 January 2013.

## Durable history

`tools/prepare_replay_history.py` streams the DBN archive offline; it retains up
to 370 days of daily context and eight calendar days of minute context. It
selects each day's outright contract using previous available day volume;
initial coverage falls back to deterministic symbol order. Series are
unadjusted. Daily/weekly/monthly buckets are UTC calendar periods, not exchange
settlement/RTH candles. The first available period may be incomplete. No gaps
are filled and no intra-minute path is invented.

Two prepared bundles (2010-06-07 and 2013-01-25) were uploaded with explicit
owner approval to private R2 `primuslab-images`, under `primus-replay/v1/`.
Read-back SHA-256 checks passed. No public bucket access was enabled.
Manifest: `data/private/replay-package/manifest.json` (no credentials).
The remainder of the archive has not been preprocessed/uploaded. Local new-date
preparation remains on demand; hosted dates must be prepared and uploaded first.

`python tools/package_replay_history.py` packages locally only.
`python tools/package_replay_history.py --upload-r2` explicitly uploads prepared
bundles using private R2 env settings. Never commit r2.env or candle bundles.

## Render configuration

Keep existing persistent PostgreSQL, Google sign-in and session-secret settings.
Provide the generated manifest as a Render secret file, for example
`/etc/secrets/replay-manifest.json`, then set:

- PRIMUS_REPLAY_MANIFEST=/etc/secrets/replay-manifest.json
- PRIMUS_REPLAY_ENABLED=1
- Existing PRIMUS_R2_* connection values, never browser-visible.

Replay is OFF on hosted services unless explicitly enabled. Missing manifest or
storage configuration fails validation. Hosted requests read private R2 bundles;
they never depend on this Mac or decode DBN archives. The /backtesting sign-in
return path is allowlisted; every replay/layout/transfer route checks the current
workspace. Do not enable LOCAL mode on a host.

## Saving and transfers

Sessions, layouts and Journal/Lab entries use the existing per-person database
settings/tables and are covered by the normal JSON backup paths. Candle bundles
are immutable independent objects and must be backed up with their manifest.
Drawings, study types/inputs/visibility, cosmetics and logical/manual price
viewport are saved per session. Vela native 0.9.3 adapters require rechecking on
upgrade. Simulated trades transfer only after explicit Send, to Lab, Journal or
both. Stable external/card IDs make retries safe. Existing notes are retained;
initial stop risk is preserved and absent risk remains absent. Transfers are
marked backtest, never live trading.

## Validation and remaining launch checks

Local real-history benchmark (one session, TestClient): 5/10/25 concurrent reads,
no errors, approximately 0.385/0.846/1.974 seconds max, process peak RSS
191,660,032 bytes. Response about 1.36 MB. This is not Render throughput or a
multi-device/mobile-network measurement. Google-workspace isolation tests cover
cross-user session/layout/transfer denial. Storage tests verify digest checks.

The owner confirmed written permission for other users to view the history on
2 November 2026. Still required before widening the Beta: test on the real Samsung
tablet, measure hosted latency/concurrent saves,
validate roll/session assumptions against the intended trading convention, and
perform a production backup/restore drill. UTC calendar charts and unadjusted
rolls are explicit current conventions, not settlement-accurate CME pivots.
The release uses the existing Render plan and private R2 connection; no new
subscription or public bucket is required. Only manifest-listed dates are selectable
online. New York/London display clocks follow DST; aggregation remains UTC calendar
boundaries. Session jump times use New York, move only forward within the loaded
day and process all intervening fills. Speed slider supports 0.25–32 steps/second.
Clock and chart layout save per session; jump preferences save on the browser.
An immutable two-bundle cache avoids repeat R2 downloads while saving progress;
private session/position data is never shared through that cache.
