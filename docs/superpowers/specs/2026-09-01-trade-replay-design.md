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

~~A **static** annotated daily candle chart of one trade, reachable in two taps
from wherever the owner already is. Not an animation: he described looking at a
chart, not watching a movie, and a daily-bar trade of a few days would animate
in about a second anyway.~~ **REVERSED 2026-09-02: an annotated daily candle
chart, static by default, with an opt-in replay.** See decision 1 below.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | ~~Static chart, not animated playback~~ **REVERSED 2026-09-02: replay added, off by default** | The owner, after using the static version: "when I planned the feature I thought we will present candle one by one with a nice delay so a user can watch the trade on going, that's more cool... that's should feel like a replay." The point isn't decoration — seeing the whole chart at once means judging the trade with the ending already known, while revealing it forward recreates what he actually knew at each moment, which is the "learn from it" this feature exists for. The original reasoning (a daily-bar trade would animate in about a second) undersold it: real windows run 25–45 bars including the month of context either side, long enough for a reveal to read as something, not a blink. |
| 1a | **Static by default; a Play button starts the replay** | His explicit qualification on reversing decision 1: he often opens a trade just to check where his stop sits, and being forced through an animation on every open would wear out fast — the same failure mode as the always-on staleness banner. The chart opens exactly as before (everything shown); replay is something he asks for, not something that happens to him. Reaching the end of a replay (or skipping to it) leaves the identical static chart behind. |
| 2 | **Context before *and* after the trade** | Owner's explicit request. Learning from a trade needs the setup that preceded it and what happened after he left. |
| 3 | **Fixed window, ~1 month either side. No pan or zoom** | Fits a phone screen and shows the whole story at once. Pinch-zoom on a chart is where mobile bugs live, and the owner chose against it. |
| 4 | **Daily candles (OHLC), not a close-only line** | He is comparing this to a TradingView daily chart, which is candles. The intraday range is also the only thing that shows whether price wicked through his stop and recovered. |
| 5 | **Two entry points: Journal's existing Trades tab, and the Portfolio tab** | Owner's choice of two ways in, corrected against the codebase. `Journal.tsx`'s `TradesTab` already lists round trips with filtering and sorting — a new top-level Trades tab would duplicate it. Closed trades are reached from Journal, open ones from Portfolio, which is how the app already splits them. |
| 6 | **On the chart: every individual fill, plus stop levels. Nothing else** | Owner's selection. He deliberately left off the planned target and the journal note — execution facts, not narrative. Keeps a phone-sized chart readable. |
| 7 | ~~Hand-rolled SVG, no charting library~~ **REVERSED 2026-09-02: use `lightweight-charts`** | The original reasoning — that a library's value is concentrated in pan/zoom, which decision #3 declined — was sound for what was asked then and wrong for what the owner asked for after seeing it on his phone. He wants a crosshair reporting the touched candle's date, a horizontal price line under his finger ("to check a gap"), and a full right-hand price scale. All three are built-in behaviour in `lightweight-charts`, TradingView's own free library. Hand-rolling them means writing a touch crosshair, axis-label engine and marker layout from scratch — rebuilding that library, worse, on a phone. The hand-rolled price-tick algorithm had already collapsed to a single visible level for BITX's narrow range where TradingView shows ten. |
| 7a | **Pan and zoom stay disabled** | Decision #3 still holds, and now for a second reason: a pannable chart inside a scrolling page competes with the page's own vertical scroll on a phone. The crosshair — the thing actually asked for — works without them. Re-enabling is a one-line option change if the owner wants it later. |
| 7b | ~~An "Open in TradingView" link accompanies the chart~~ **REMOVED 2026-09-02 at the owner's request** | It was added as an escape hatch for indicators and drawing tools. After using the rebuilt chart on his phone he asked for it to be taken out. Read the signal: the chart now does the job he was leaving the app to do, so the escape hatch is clutter rather than reassurance. |
| 7c | **Crosshair floats freely (`CrosshairMode.Normal`), not magnetised to candles** | The first build snapped the horizontal line to the nearest candle's OHLC. The owner's use is checking a gap, which means placing the line at an arbitrary level *between* candles — exactly what magnet mode prevents. |
| 7d | **Buys are green, sells are red** | Both were the accent colour at first, leaving direction carried only by arrow shape. The owner asked for red sells. This deliberately gives markers the same hues as the candles, so size, shape and position have to carry the "this is *my* action" distinction instead. |
| 8 | **Open trades are included, reached from Portfolio rather than Journal** | Costs almost nothing: `deriveTrades` already returns them with `isOpen`, and the chart simply has no exit marker with the window running to today. Journal's Trades tab deliberately filters to `!t.isOpen` and directs open positions to the Portfolio tab; replay follows that existing split rather than fighting it. |

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

**No new nav tab.** `Journal.tsx`'s `TradesTab` (line 98) already lists round
trips with filtering and sorting, fed by `/portfolio/stats`, and keys each row
by `` `${t.symbol}-${t.enteredAt}` `` — already the composite id this design
uses. The list is not rebuilt; it becomes tappable.

- **New route: `/trades/:id`** — the detail screen: a header of the trade's
  numbers, and the chart beneath it. The only new route.
- **Journal → Trades tab.** Each `TradeCard` becomes a link to its trade's
  detail screen. Closed trades only, as that tab already filters.
- **Portfolio tab.** Tapping a position opens the detail screen for its open
  trade — the way in for a position still being held, matching where the app
  already sends open positions.
- **New component: `TradeChart.tsx`** — ~~hand-rolled SVG, following
  `BenchmarkChart.tsx`'s conventions (viewBox scaling, `w-full`, theme tokens,
  no external dependency)~~ **REVERSED 2026-09-02, per decision 7 above: built
  on `lightweight-charts@5.2.1`.** It still matches the app's own dark palette
  (colours declared as local constants — `BG`, `TEXT`, `MUTED`, `GRID`, `UP`,
  `DOWN`, `ACCENT` — passed into the library's `layout`/`grid`/`crosshair`
  options) rather than the library's defaults, so it reads as part of the app
  and not a bolted-on widget. `createChart` renders a `CandlestickSeries` with
  `autoSize: true` inside a fixed-height container; `handleScroll`/
  `handleScale` stay off per decision 7a. Fill and stop annotations are
  `lightweight-charts` series markers (`createSeriesMarkers`), not hand-drawn
  SVG shapes — see "The chart" below.

### The chart

**REVERSED 2026-09-02 (decision #7): this section described the pre-reversal
hand-rolled SVG design. What actually shipped, in `TradeChart.tsx`:**

- **Candles.** Still a body from open to close and a wick from low to high,
  now drawn by `lightweight-charts`' `CandlestickSeries` rather than hand-built
  geometry. Up/down colours are still `#22c55e` / `#f43f5e` — the same values
  as `--color-up`/`--color-down` — but passed to the library as literal hex
  constants (`UP`, `DOWN` in the component), since a series option cannot read
  a CSS custom property.
- **Fill markers.** ~~One per individual fill, at its own price and date: a
  triangle pointing up for a buy, down for a sell~~ **One per individual fill,
  anchored to its bar rather than its exact price** — an arrow (`arrowUp` for
  a buy, `arrowDown` for a sell) placed `belowBar`/`aboveBar` via the
  library's series-marker API, labelled with the fill price as text. Anchoring
  to the bar (not `atPriceMiddle`) was chosen so the marker never sits on top
  of, and hides, the candle it annotates — including a seeded fill whose
  recorded price falls outside that day's real range, which now reads as "this
  fill, on this date" instead of a rendering glitch. Colour follows decision
  7d: buys green (matching up candles), sells red (matching down candles), so
  shape and position — not colour — carry "this was my action." A fill that
  landed on a non-trading day (weekend, holiday) snaps to the last trading
  session **at or before** the fill's date, the session that was actually open
  when the fill happened — snapping forward, which an earlier version did,
  could draw an exit on the session *after* the trade had already closed. The
  UI states below the chart when a fill was snapped, or falls outside its
  day's range, rather than showing either silently.
- **Stop levels.** A `FIXED` tier still gets a dashed horizontal line
  (`createPriceLine`, muted colour) across the full width. Its built-in price
  label is suppressed — the library ties a price line's title and axis chip to
  the same visibility switch, and both would collide with the price scale and
  a recent/open trade's exit marker at the chart's right edge.
  ~~Each `FIXED` tier also gets its own square marker (`atPriceMiddle`),
  staggered onto a bar away from that edge, labelled `Stop <price>`.~~
  **REVISED 2026-09-02: the label moved off the plot entirely.** The owner,
  on the PLTR trade: "things are still bidding each other here" — a
  fixed-fraction anchor point put a stop's label wherever the chart happened
  to be busiest, still landing on candles or on a fill's label (the
  fixed-fraction staggering only ever solved stop-label-vs-stop-label
  collision, not stop-vs-candle or stop-vs-fill). Rejected in its place: (a)
  an absolutely-positioned DOM overlay driven by `priceToCoordinate()`,
  pinned to a chart margin — still has to dodge fill labels near that margin
  and has to be resynced by hand on every resize/redraw; (b) searching the
  visible window for a horizontal band no candle's high–low span crosses at
  the stop price — not guaranteed to exist (BITX's two stops sit 39 cents
  apart on a ~$10 range, where candles routinely span the full window), so
  it still needs a fallback anyway. Shipped instead: the dashed lines stay
  unlabelled, and identity + price move into a compact text line below the
  chart, ordered top to bottom (`Stops, top to bottom: 167.13, 142.63`). A
  label that isn't drawn on the plot cannot collide with anything on the
  plot, which holds regardless of how tight the stops or how busy the
  candles are. During replay (decisions 1/1a), the lines themselves are held
  back until the entry fill's bar is revealed — the stop was set at entry,
  so drawing it earlier would flag "something happens near this price"
  before the owner himself knew it. The text summary below the chart is not
  gated by replay; it is reference fact, same as the always-visible header.
  A `TRAILING` tier still has no fixed price to draw and stays out of the
  chart; it is listed in the trade detail screen's text instead (not the
  "header" — see below), exactly as this section originally specified.
- **Header.** Unchanged from the original design: symbol, direction, P&L, R
  multiple, holding days, avg entry and exit, on `TradeDetail.tsx` above the
  chart — all fields `DerivedTrade` already provides. (Trailing-stop text
  lives in that screen's body copy near the chart, not literally inside this
  header block.)

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

~~Animated playback~~ **REVERSED 2026-09-02 — see decisions 1 and 1a: playback
shipped, static by default with a Play button.** Pan and zoom; intraday bars;
attaching a chart image to a journal entry; comparing a trade against the
index over the same window; scheduled backfill.

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
- **2026-09-02 addition:** replay's frame sequencing — which bars and which
  fill markers are visible at step N, and whether the stop lines have
  appeared yet — moved into `frontend/src/lib/tradeReplay.ts` as pure
  functions (`replayFrame`, `totalReplaySteps`) with fixture tests in
  `tradeReplay.spec.ts`, the same convention `candleScale.ts` already
  established: no chart, no DOM, no timer. Covered: nothing revealed before
  the first step; a marker appearing only at or after its own bar (entry and
  exit, and two fills sharing one bar); the stop lines gated on the entry
  fill's bar; and the final step matching the full static chart exactly,
  including the case of a trade with no fills to gate on.
