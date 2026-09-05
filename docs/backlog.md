# Backlog

Everything raised and not yet done. Newest intake at the top of each section.
Finished items are removed once the work is committed — this file is meant to
be read as "what's left," not a history of what happened (that's `git log`).

**Read this before picking up work.** `CLAUDE.md` says what the project is;
this says what is outstanding.

## Bugs — correctness

- [ ] **Trade chart: shipped, awaiting the owner's eye.** He reported prices
  that looked wrong and sent screenshots; the data was correct throughout and
  the placement was not. Markers were anchored to the bar, so an arrow
  drifted as far from the fill as that day's range was tall (PLTR's 167.15
  sell drew near 185). Now anchored to the price, with the side chosen per
  fill from that candle's geometry (`markerSideForPrice`) so it lands in the
  emptier space rather than on the body. Fills, stops and the target all
  carry an axis label, so a level is read rather than guessed. And
  `plannedTarget` — recorded at entry and silently dropped before it reached
  `DerivedTrade` — is carried through and drawn.

  **Still to confirm on the phone:** whether the labels crowd the axis when
  several levels sit close together (PLTR's stop at 167.61 against its exit
  at 167.15 is the tightest real case), and whether the per-fill side choice
  actually reads well on a tall candle.

## UI

- [ ] **2 of 19 frontend lint warnings remain**, both `set-state-in-effect`
  (`EntrySheet.tsx:105`, `Journal.tsx:378`). Left deliberately: both are
  effects synchronizing local state with genuine external events (which
  entry/draft session is active; an async fetch resolving) rather than
  derivable-during-render state, and forcing either into a render-time or
  remount pattern would touch the app's most iOS-draft-loss-prone code for a
  cosmetic warning. The other 17 were fixed at the root: `BenchmarkChart.tsx`
  and `TradeChart.tsx` (`Range`/`Point`/`RANGES` moved to
  `lib/benchmarkRange.ts`; `TradeChart`'s replay `step` now resets via
  remount — `TradeDetail` keys it on trade id — instead of a reset effect)
  and `Journal.tsx`'s 12 `react(refs)` warnings (the `restored` value moved
  from a mutated ref to a plain `useState` capture, with a `restoreDone` flag
  replacing the "null the ref to mark consumed" trick).
- [ ] **Look hard at the UI as a whole.** More conventional components? Study
  comparable products and decide what the right shape actually is.

## The trade-idea prompt (design agreed, not built)

Approved in conversation, no code yet. The failure that motivated it: an
opinion on buying BITX that lectured the owner about having no crypto in his
profile, while he held 4,600 shares of it. It answered "should I open this?"
when the question was "should I add to this winner?".

- [ ] **Check the enlarged prompt actually improved the answer.** It is
  materially longer now; re-ask BITX and confirm it reads as an add/trim
  decision, and that the extra context sharpened rather than diluted it.
- [ ] **Ideas answers are slow.** Look at streaming, a smaller model for the
  first pass, or cutting prompt size.

## Tech debt

Raised as a block; each needs its own slice.

- [ ] **TypeScript 7 is blocked — everything else on the upgrade list is
  done.** `@types/node` 24→26, `@testing-library/jest-dom` 6→7, `jsdom` 27→30
  and `vitest` + `@vitest/coverage-v8` 4→5 all landed clean (merged coverage
  unchanged at 91.63% statements / 92.97% lines, so the blob-report merge
  survived). `vite-tsconfig-paths` was **deleted, not upgraded**: the backend
  declares no `paths` and no `baseUrl` and imports no aliases, so the plugin
  resolved nothing — removing it also silenced the deprecation notice that
  printed on every test run.

  **TypeScript 7 was tried and reverted.** It is the native (Go) compiler and
  ships no `lib.*.d.ts` files at all — they live inside the binary. `tsc
  --noEmit` and the whole test suite pass on it (vitest transpiles with
  esbuild/rolldown, not tsc), which makes it look fine, but the NestJS CLI
  watcher builds its own program through the JS API and cannot find the
  default libs: `npm run dev` dies with 11 × "Cannot find global type
  'Array'" and `TS6053: lib.es2023.full.d.ts not found`. Both packages are
  back on 6.x. **Recheck when `@nestjs/cli` states TS7 support** — verifying
  with `tsc --noEmit` alone is not enough, the acceptance test is a clean
  `npm run dev` recompile.

- [ ] **Concurrent edits to the same journal entry: probed, not fixed.**
  Confirmed by firing two overlapping `PATCH /journal/:id` requests: no
  corruption (Postgres's own row locking keeps exactly one transaction row,
  never zero or duplicated), but no conflict detection either — both
  requests get a 200, and whichever's write commits last silently overwrites
  the other with no signal to the loser that its save did not stick.

  **It is worse than lost data: the race also creates lock contention.** The
  e2e test written to document this was itself intermittently hanging the
  suite — roughly one run in six, a later spec's `POST /journal` would block
  past the 5s timeout waiting on locks the racing pair left behind. The test
  was removed for that reason (a flaky suite costs more than executable
  documentation of a gap already written up here), but the behaviour it
  exposed is the real argument for fixing this: two overlapping edits do not
  just silently drop one, they can stall unrelated writes.

  **Do not re-add a test that races two writes at the same row** without
  solving that — it destabilises everything that runs after it.

  A real fix means optimistic concurrency (a version/`updatedAt` check on
  `PATCH`, 409 on mismatch, and a frontend conflict UI) — real complexity for
  a single-user app mostly used from one device at a time. Worth a deliberate
  decision on whether this earns it, not a default yes.
- [ ] `getPortfolio` (`portfolio.service.ts`) is still ~227 lines — it fetches,
  derives, prices, and assembles a response in one method. `computeAtRisk`
  moved to `risk.ts` as a pure, unit-tested function; the trailing-stop
  high-water-price resolution moved to `TradesService.resolveHighWaterPrice`,
  shared with `getTrade()` — which turned up a real bug along the way:
  `getTrade()` had never folded in extended-hours extremes at all, so a
  trade's own detail page could resolve a TRAILING stop to a different price
  than the Stops page for the same position. Fixed, with an e2e regression
  test (`trades.e2e-spec.ts`, extended high above both the daily bar and the
  live quote) — and `test/yahoo-stub.ts` gained an `extendedExtremes` option
  since nothing could test this path before. What's left in `getPortfolio` is
  now mostly fetch-and-assemble (positions array, at-risk, stop tiers) — real
  further splitting would mean pulling pricing/assembly into its own method
  or file, not obviously a win over reading it top to bottom as one story.
