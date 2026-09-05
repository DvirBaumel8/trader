# Backlog

Everything raised and not yet done. Newest intake at the top of each section.
Finished items are removed once the work is committed — this file is meant to
be read as "what's left," not a history of what happened (that's `git log`).

**Read this before picking up work.** `CLAUDE.md` says what the project is;
this says what is outstanding.

## Bugs — correctness

- [ ] **Trade chart shows prices that are visibly wrong.** Called out as a basic
  feature that must be right. **Needs a concrete example — investigated once
  and nothing reproduced.** Ruled out so far, against the real database:

  - The stored bars are sound: 1,176 rows, zero null `open`/`high`/`low`,
    OHLC internally coherent, `adjClose` equal to `close` (so no split or
    dividend adjustment is skewing anything), and fresh through the last
    trading day.
  - No trade predates its own price history — earliest fill 2026-08-28
    against bars from 2026-07-14 — so the 45-day runway is doing its job
    and no chart is missing the context around its entry.
  - The chart passes `date` to `lightweight-charts` as a business-day
    string, so there is no timezone conversion to shift a bar by a day.
  - Null OHLC cannot reach the candle series: `hasRange` filters those bars
    out before `setData` (deliberately omitting a candle rather than
    inventing a flat one).

  **The most likely candidate left is placement, not price.** A *seeded*
  opening fill is stamped with the seed date and the owner's average cost
  rather than a real historical print, so `placeFills` relocates its marker
  to an earlier bar whose range actually contains that price. That is
  working as designed and is honest about it, but a marker sitting on a day
  he did not trade, at a price that is an average rather than a print, is
  exactly the kind of thing that reads as "wrong" on the phone. **Ask which
  symbol and what looked off before changing anything here.**

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
- [ ] **The trade-idea result buries its numbers** under ~400 words of prose.
  A compact verdict strip above the writing, prose collapsible below.
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
