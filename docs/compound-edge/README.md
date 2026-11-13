# Compound Edge scoring

Apply `01-schema.sql` then `02-scoring.sql` as the database owner. Run the
numbered test scripts against a disposable Supabase database. The tests use
synthetic identities and roll back. These scripts have not been applied to the
hosted database.

The scoring trigger considers verified events only. The backend must assign
the Supabase user UUID from verified identity and a stable source ID per
event, and use conflict handling for delivery retries. Browser events carry
no scoring authority.

| Event | Evidence the backend must verify |
| --- | --- |
| Checklist or mindset completion | The saved checklist was completed or the exercise was finished. |
| Journal save | The saved entry has a non-empty pre-trade plan. Record `pre_trade_plan_filled: true` only after checking the saved entry. |
| Plan followed or no-trade confirmation | The saved Journal confirmation. Either event awards the same 20-point credit once. |
| Backtest active minute | One event per observed minute of interaction, timestamped in that minute. Repeated records in one UTC minute count once across sessions. Idle timers and client-supplied durations are insufficient. |
| Strategy Lab review | A saved note (`note_saved: true`) or `reviewed_trade_count` of at least five distinct trades in one review session. Filter clicks and imports alone earn zero. |

The database has a private market-closure table for full-day closures. Load the
chosen market calendar before relying on holiday skips in production. Streaks
count qualifying days scoring at least 50. Rest days and closures can earn
habit points but neither advance nor break the streak. An unfinished current
day is never counted as a miss. Changing timezone reassigns past verified
events to the corresponding local dates. Streaks use the current rest-day
schedule across the visible history.

## Running inside Primus

The app implementation uses authenticated FastAPI and existing private workspace
settings storage (Postgres on the hosted app, SQLite locally). It does not
require the separate Supabase Data API schema or browser credentials. The
numbered SQL files remain a reference implementation for a future direct
Supabase integration. They are not a second source of live habit scores.

The workspace and Learn use the same summary endpoint. It refreshes on focus
and every 30 seconds while visible. This follows the app's existing server-side
session model without enabling a separate browser Supabase session.

- Journal credit applies to saves for the trader's current Journal date.
- Checklist credit follows saved completion. Mindset credit follows a timed
  breathwork completion or a submitted timed drill with answers.
- Replay credit measures intervals of up to 75 seconds between successful
  manual replay interactions in the same session. Autoplay saves do not earn
  credit. The server uses its own clock, validates the session and caps elapsed
  time at 20 minutes. This measures interaction signals and cannot establish
  whether someone actually paid attention or rule out a scripted client.
- Five distinct confirmed reviews must fit in one 30-minute window. A new or
  changed non-empty note on a saved trade earns credit separately.
- Holiday skips use the published NYSE full-day closures for 2026–2028 as the
  discipline calendar. This calendar is independent of CME replay availability.
  Extend the published coverage before 2029. Existing saved activity is not
  backfilled. Existing Google members see the grid from their workspace signup
  date, limited to the latest 365 days.
