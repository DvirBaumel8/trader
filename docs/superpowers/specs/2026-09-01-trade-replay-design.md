# Trader — Phase 4: Trade Replay Design

**Date:** 2026-09-01
**Status:** Approved, ready for implementation planning

## Purpose

In the owner's own words:

> Most of the times when a trade is finished I'm opening TradingView in daily
> graph to see what happened during the trade and I'm trying to learn from it.

That trip is the thing this feature replaces. The product's job is to show the
same daily chart he would have opened anyway — except this one already knows
the trade: where he got in, where he got out, and where his stop was.
TradingView will never know any of that.

This is the feature deferred twice on purpose: Phase 2 pushed it to Phase 3
because it needs daily price history, and Phase 3 shipped the benchmark chart
alone to keep the slice small. Its blocker is gone — the `daily_closes`
backfill exists — so it is now the natural next step.

## What it is

A **static** annotated daily candle chart of one trade, reachable in two taps
from wherever the owner already is. Not an animation: he described looking at a
chart, not watching a movie, and a daily-bar trade of a few days would animate
in about a second anyway.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Static chart, not animated playback** | Matches the described workflow. Playback is not ruled out forever — nothing here prevents adding it — but it buys little on daily bars and costs real work. |
| 2 | **Context before *and* after the trade** | Owner's explicit request. Learning from a trade needs the setup that preceded it and what happened after he left. |
| 3 | **Fixed window, ~1 month either side. No pan or zoom** | Fits a phone screen and shows the whole story at once. Pinch-zoom on a chart is where mobile bugs live, and the owner chose against it. |
| 4 | **Daily candles (OHLC), not a close-only line** | He is comparing this to a TradingView daily chart, which is candles. The intraday range is also the only thing that shows whether price wicked through his stop and recovered. |
| 5 | **Two entry points: the journal timeline *and* a new Trades tab** | Owner's choice, over either alone. The journal is where he already is after a trade; the Trades tab is the browse-and-review surface. |
| 6 | **On the chart: every individual fill, plus stop levels. Nothing else** | Owner's selection. He deliberately left off the planned target and the journal note — execution facts, not narrative. Keeps a phone-sized chart readable. |
| 7 | **Hand-rolled SVG, no charting library** | `BenchmarkChart.tsx` and `FeesChart.tsx` are already hand-rolled SVG on a CVD-validated dark palette. With a fixed window and no gestures, a library's value (pan, zoom, virtualization, touch handling) is concentrated in exactly the features decision #3 declined. A candle is a rect plus a line. |
| 8 | **Open trades are included, not just closed ones** | Costs almost nothing: `deriveTrades` already returns them with `isOpen`, and the chart simply has no exit marker with the window running to today. Reviewing a position mid-flight is worth having. |

## The data problem this must solve first

**`daily_closes` today stores only `close` and `adjClose` — there is no
open/high/low.** Phase 3's deferred note described replay as "animating a daily
candle chart", but candles are not buildable on that schema.

The fix is cheap because the data is already being fetched and thrown away:
`yahoo.client.ts`'s `dailyBars()` requests `interval: '1d'`, and Yahoo returns
OHLC in that response — the mapper keeps `close` and `adjclose` and discards the
rest.

Three changes:

1. **Schema.** `daily_closes` gains `open`, `high`, `low`. Nullable, because
   rows backfilled before this phase have no values for them until refilled.
2. **Adapter.** `dailyBars()` keeps the OHLC it already receives. A bar missing
   any of the three is still stored — `close` alone remains sufficient for the
   benchmark, and the chart can skip an incomplete candle rather than the whole
   feature failing.
3. **Window.** The backfill currently starts at *earliest transaction − 7 days*
   (`history.service.ts`). That leaves about five trading days of runway, which
   is not the "month before" decision #3 promises. It widens to **− 45 days**.
   Yahoo serves daily history indefinitely for free, so this costs nothing.

Re-running the backfill is safe and required: it upserts on
`(instrumentId, date)`, so it refills existing rows rather than duplicating
them.

**Untouched:** `select-price.ts`, the benchmark chart, and the performance
series all keep using `close`/`adjClose` exactly as they do now. Invariant #7
(price by session) and the Phase 3 decision that benchmarks use `adjclose`
while positions use raw `close` are unaffected.

## Architecture

### Backend

**Reuse, do not duplicate.** `portfolio.service.ts` already assembles trades
with their stop tiers attached (the `deriveTrades(...)` call in the stats path,
around line 166). That assembly moves to a shared method both the stats
endpoint and the new trades endpoints call. `derive-trades.ts` itself does not
change.

Two endpoints:

- **`GET /trades`** — the list. Every round trip, newest first, carrying the
  `DerivedTrade` fields that already exist: symbol, direction, quantity,
  `avgEntry`, `avgExit`, `enteredAt`, `exitedAt`, `holdingDays`, `realizedPnl`,
  `isWin`, `isOpen`, `riskAmount`, `rMultiple`.
- **`GET /trades/:id`** — one trade, plus what the chart needs: its individual
  fills (date, side, price, quantity, fee), its stop tiers (`kind`, `price`,
  `trailPercent`, `quantity`), and the daily bars for the window.

**Trade identity.** A trade is derived, never stored (Phase 2's decision, and
the same reason positions are derived), so it has no database id. The id is a
composite of **symbol and entry timestamp**, formatted as
`<symbol>:<enteredAt as an ISO-8601 UTC string>` — for example
`AAPL:2026-08-28T13:30:00.000Z`. It is stable for as long as the underlying
transactions are, reproducible without storing anything, and URL-safe once
encoded.

This has a consequence worth stating plainly: Phase 2 allows editing and
deleting journal entries, so editing a trade's opening transaction changes its
id. A link to a trade can therefore go stale. The detail endpoint returns a
404, and the UI says the trade no longer exists rather than rendering an empty
chart. Nothing is corrupted — the trade is simply re-derived under a new id.

**Window.** The bars returned span roughly one month of trading days either
side of the trade: from ~21 trading days before `enteredAt` to ~21 after
`exitedAt`, clamped to what exists. For an open trade, or one that closed
recently, the window simply ends at the latest bar available — no padding is
invented.

### Frontend

- **New route: `/trades`** — the Trades tab, added to `AppShell`'s nav. Round
  trips newest-first: symbol, direction, P&L, R multiple, open/closed.
- **New route: `/trades/:id`** — the detail screen: a header of the trade's
  numbers, and the chart beneath it.
- **Journal tap-through.** Tapping a trade entry in the timeline opens the
  detail screen for the round trip that entry belongs to. Because one trade
  spans several entries when scaling in or out, the mapping is entry → its
  trade, not entry → its own chart.
- **New component: `TradeChart.tsx`** — hand-rolled SVG, following
  `BenchmarkChart.tsx`'s conventions (viewBox scaling, `w-full`, theme tokens,
  no external dependency).

### The chart

- **Candles.** Body from open to close, wick from low to high. Up bodies use
  the existing `--color-up` (`#22c55e`), down bodies `--color-down`
  (`#f43f5e`) — the tokens already defined in `index.css`.
- **Fill markers.** One per individual fill, at its own price and date: a
  triangle pointing up for a buy, down for a sell. Scale-ins and scale-outs are
  therefore visible as separate marks, which is the point of decision #6.
- **Stop levels.** Dashed horizontal lines at each tier's price. A trailing
  tier has no fixed price to draw; it is listed in the header instead of drawn,
  rather than drawn at a guessed level.
- **Header.** Symbol, direction, P&L, R multiple, holding days, avg entry and
  exit — all fields `DerivedTrade` already provides.

## Known limitations, accepted

- **An intraday trade is a single candle.** Opened and closed the same day, it
  cannot show a path. This was already accepted as a Phase 2 decision when the
  owner chose daily bars: "Free Yahoo serves daily history indefinitely, so
  nothing decays and no snapshotting is needed. Trade-offs: an intraday trade
  is a single candle."
- **The backfill is still manual.** Phase 3 deferred a scheduled job, and this
  phase does not add one. The chart is only as fresh as the last backfill run,
  and a trade that closed after it will have no bars past that date. The UI
  must not present a truncated window as if it were complete — it states the
  last date it has, in keeping with "never show a stale price as if it were
  fresh."
- **No target line, no journal note on the chart.** Deliberately excluded by
  the owner. Both are already captured in the data, so adding either later is a
  display change, not a migration.

## Out of scope

Animated playback; pan and zoom; intraday bars; attaching a chart image to a
journal entry; comparing a trade against the index over the same window;
scheduled backfill.

## Testing

- `derive-trades.ts` is unchanged, so its existing fixture tests still cover
  the round-trip logic. The new work is the window calculation and the trade-id
  round trip, which are pure functions and get the same fixture treatment
  `derive.ts` has: no database, no network.
- The OHLC mapper change gets a unit test proving a bar missing `high` or `low`
  is still stored with its `close`, rather than dropped.
- An e2e test covers `GET /trades` and `GET /trades/:id`, including the 404 for
  a stale id.
- The chart itself is verified on the phone, per `working-agreement.md` — a
  clean typecheck proves very little about an SVG on a small screen.
