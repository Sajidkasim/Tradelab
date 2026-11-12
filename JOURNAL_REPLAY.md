# Journal Trade Replay — local implementation

## Implemented

Journal → Trade replay imports explicit execution CSV metadata into one private,
atomic workspace setting. It does not insert trades, calculate P&L or change
existing journal results. Repeating the same import skips duplicates; conflicting
execution/trade IDs reject the entire batch. Up to 1,000 replay records / 10,000
executions per workspace. Optional `account` namespaces external trade IDs.
Original CSV rows, including supplied fee/result fields, are preserved as metadata.

Linked Journal cards also have Replay, using the existing Lab trade's aggregate
entry/exit. These do **not** invent partial executions. A root-only NQ/ES record
cannot be replayed through ProjectX until exact contract information is supplied;
use the detailed execution CSV rather than change the financial record.

The modal uses the existing pinned Vela 0.9.3 chart and compatibility helpers,
without modifying the adapter. It has play/pause, forward stepping, 1–32 bars/sec,
RAF scheduling, reached execution markers and original notes. Candles become
visible when the minute has completed; all executions in that completed minute
can then appear together. This is not tick replay. There is no rewind.

Backend pages are 750 minutes; active chart history is capped at 3,000 candles,
with one pending page. Updates stream through the provider callback; a bounded
series replacement occurs on eviction, never setMarket on each tick. Old history
beyond the retained window is not currently scroll-paged in this Journal view.
Empty windows pause with an explicit next-window/retry action, rather than making
unbounded requests through weekends or missing history. Closing aborts requests.
No provider candle data is written to disk or shared caches.

## Execution CSV interchange format

Required: `trade_id,execution_id,symbol,timestamp,side,quantity,price,role`.
Optional: `notes,account` and other original fields. UTF-8 CSV, up to 1 MB / 10,000
rows. Side is buy/sell; role is entry/exit. Keep the same trade_id for partial
executions and a different execution_id per fill. Conflicting duplicate IDs fail.

Use offset-aware ISO timestamps, or specify the actual IANA export timezone.
Unknown timezone means do not guess. DST ambiguous/nonexistent local times fail.
Prices/quantities stay strings in metadata; finite positive validation only.

Futures examples: `CON.F.US.NQ.Z26`, `CON.F.US.ES.Z26`, also MNQ/MES with an exact
quarterly expiry. Short form `NQ.Z26` is expanded without changing the expiry.
Supported Dukascopy mappings: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF,
NZDUSD, XAUUSD. Broker suffixes and CFD aliases are deliberately not guessed.

## Native report support (verified against supplied schemas)

TopstepX Trades CSV: Id, ContractName, EnteredAt, ExitedAt, EntryPrice,
ExitPrice, Size, Type; extra fees/PnL/commission fields preserved verbatim.
Dates are MM/DD/YYYY (user confirmed 11/10/2026 = 10 November). Timestamp offsets
are used directly; TradeDay's accounting timezone never replaces execution times.
MNQZ6 resolves to CON.F.US.MNQ.Z26 using the entry year's decade, with an explicit
nearby-year check. Each closed trade/leg retains its broker ID; rows are not merged.

FTMO **website Trading Journal** CSV: Ticket, Open, Close, Type, Volume, Symbol,
and two Price columns. Entry and exit Price are read by column position, not a
DictReader which would overwrite the first Price. Ordered original column names
and values preserve both prices and every supplied result/fee field.
This is not a blanket claim of support for MT5 terminal HTML/XLSX reports.

The FTMO website export's timezone remains UNKNOWN. It has no offsets. Import
requires an explicitly confirmed export timezone; do not assume website exports
use the MT5 server clock. Synthetic tests use a labelled hypothetical timezone.
No real FTMO rows were imported with an assumed timezone.

Supplied TopstepX file: 4 MNQ closed trades, all structurally validated in memory;
8 entry/exit markers. Supplied FTMO file: 227 rows. Gold/EURUSD/GBPUSD (76 rows)
have configured reference mappings; US100.cash, US500.cash, US30.cash and BTCUSD
(151 rows) currently do not. Unmapped native trades are preserved as metadata,
with provider unavailable and explicit candle error. No NQ or other substitute
is silently used. Reference CFD mapping/price-scale validation remains required.
No supplied private CSV or copied real trade data was committed to the repo.

## Provider setup — blocked pending credentials and permission

ProjectX uses the existing read-only core/projectx_api.py client. No order APIs
are called. Server credentials: PROJECTX_USERNAME and PROJECTX_API_KEY. Neither
was configured locally during implementation. There is currently one server
credential pair, **not** per-user broker linking. Do not enable other workspaces
unless this credential's data rights explicitly cover them.

Enable a provider only after confirming permitted retrieval, public/private
chart display and scope with the provider. Set the respective
JOURNAL_REPLAY_PROJECTX_APPROVED=1 or JOURNAL_REPLAY_DUKASCOPY_APPROVED=1, and
JOURNAL_REPLAY_<PROVIDER>_WORKSPACES to a comma-separated list of server-verified
workspace keys (owner is the local/single-owner key). Defaults deny access.
These flags record an operator decision; they are not evidence of a licence.

Dukascopy downloads fixed-host daily BID minute candle BI5 files, using explicit
symbol/scale mappings, UTC days, zero-based months, bounded download/decompression
and candle validation. This adapter is tested against synthetic binary fixtures,
not a live approved production feed. It is not FTMO's feed; spreads/highs/lows can
differ and original executions/results are never moved to fit these candles.

All routes require the existing workspace authorization (and CSRF on writes).
Provider fetches run in FastAPI worker threads, with 2 concurrent fetches and 20
window requests per minute per workspace per process. Multi-process deployments
would need a distributed limiter. No financial tables or market archives migrate.

Documentation reviewed:
- https://help.topstep.com/en/articles/11187768-topstepx-api-access
  Confirms historical data and separate API subscription; this does not establish
  redistribution rights or guarantee expired-contract coverage. Pricing displayed
  on 10 Nov 2026: $29/month, or $14.50 with advertised Topstep discount. Provider
  pricing/eligibility must be checked before subscribing.
- https://gateway.docs.projectx.com/docs/category/market-data/
- https://wiki.dukascopy.com/en/development/data-export
- https://www.dukascopy.com/swiss/english/marketwatch/historical/
  Export availability alone does not establish commercial website display rights.

No new chart library or dependency versions were introduced. No Google/Gemini
service is needed. Ongoing hosting, data-display licences and per-user API
eligibility are not priced or confirmed by this implementation.

## Verification

Synthetic Python fixtures exercise timezone/DST handling, exact contracts,
partial execution preservation, duplicate/conflict handling, private ownership,
provider access gates, bounded windows and missing data. Browser checks use
synthetic candles with the actual Vela renderer, not a live broker connection.
No real NQ or FTMO trade was validated because provider credentials/permissions and the FTMO export timezone
were unavailable. No user source candles/trades were changed. Not deployed.

Final local checks: 426 pytest tests (four existing deprecation warnings), 98
frontend tests, production build and six replay/Journal browser checks passed.
The final two replay browser checks were repeated after the notes integration.

Native follow-up checks: 429 pytest tests, 98 frontend tests, build and three
replay browser checks passed. Actual supplied exports were inspected only in
memory; anonymised schema fixtures exercise native imports in disposable DBs.
FTMO timezone and four unmapped CFD/crypto symbols remain explicit blockers.

## FTMO clock confirmed by user — 10 November 2026

User relayed that website Trading Journal exports follow MT5 platform time,
currently GMT+2 following the recent clock change. Added explicit FTMO_MT5
preset (also a button in Journal replay imports). It uses UTC+2 winter / UTC+3
summer on US DST dates. This follows FTMO's dated clock-change notices, not
Europe/Prague or a fixed +2 for all records. Duplicate/missing transition-hour
local timestamps reject rather than guessing an offset. Existing offset-aware
timestamps remain authoritative.

FTMO notice confirming autumn clock change:
https://ftmo.oanda.com/blog/trading-updates/trading-update-22-oct-2026-2/
Spring notice:
https://ftmo.com/en/blog/trading-updates/trading-update-09-mar-2023/

The supplied May–June 2026 records are summer GMT+3: first entry 18:23:30 maps
to 15:23:30 UTC. All 227 records / 454 markers parsed in memory using the
preset, with no actual journal writes. This supersedes the timezone blocker
above. Missing provider approvals/credentials and CFD mappings remain blockers.
