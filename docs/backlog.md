# Backlog

Everything raised and not yet done. Newest intake at the top of each section.
Finished items are removed once the work is committed — this file is meant to
be read as "what's left," not a history of what happened (that's `git log`).

**Read this before picking up work.** `CLAUDE.md` says what the project is;
this says what is outstanding.

## Bugs — correctness

- [ ] **The app's numbers disagree with his broker — balance, returns and
  history, all of it.** Raised 2026-09-12. He will bring the specific gaps;
  this is a joint investigation, not something to guess at alone.

  **Do not start by changing code.** The first deliverable is a
  *reconciliation*: for one account, on one date, put our figure and the
  broker's figure side by side and find where they part. Candidates worth
  suspecting, in the order they are most likely to matter:

  - **Fees.** Defaults are applied per entry; the broker charges its own
    schedule, per fill, sometimes with a minimum. A systematic few-dollars-per
    -trade gap compounds into a visible P/L difference.
  - **Cash.** Invariant 3 says buys and sells are not cash flows. If the
    broker's "balance" includes settled cash, margin interest, or dividends
    the journal has never seen, the two definitions of "cash" are simply not
    the same number — and dividends and margin interest are not modelled at
    all.
  - **Which price.** `select-price.ts` picks pre-market / regular /
    after-hours by `marketState`; the broker may mark at the official close.
    Comparing a 4:30pm figure to a 4:00pm close is a real gap and not a bug.
  - **Partial fills and averaging.** One journalled entry can stand for
    several broker fills at different prices; the average is then ours, not
    theirs.
  - **Seeded history.** Everything before the seed is a single opening
    position, so any realised P/L from before that date exists in the broker
    and not here.
  - **Corporate actions.** Splits and symbol changes are not handled anywhere.

  **Shape of the work:** ask him for one date, one account screenshot, and one
  ticker where the gap is largest; reconcile that single case end to end;
  only then decide what is a bug, what is a definition difference worth
  documenting, and what needs modelling. Related: the broker-integration
  discussion below — a live feed makes this measurable continuously instead
  of by hand.

- [ ] **A glitch in the Trades screen filter.** Raised 2026-09-12 alongside
  the totals request below: "there is a glitch in the UI with the filter."
  Not yet reproduced or characterised — ask him what he sees, or reproduce on
  a phone-width viewport, before touching it.

- [ ] **The e2e suite flakes about 1 run in 20, and the cause is still
  unknown.** Investigated at length; recording what was ruled out so the next
  attempt does not repeat it.

  **Signature.** Always the same shape: a request 404s for a row created
  moments earlier in the same test. Seen in `journal.e2e-spec.ts` (PATCH an
  entry just POSTed) and twice in `trades.e2e-spec.ts` (PATCH stops on a trade
  just journalled). The file varies between runs; `ticker-facts` and
  `trade-idea` have also failed earlier in the day.

  **Ruled out — do not re-test these.**
  - *Not file parallelism.* `fileParallelism: false` is honoured. Measured
    with `--reporter=json`: twelve files, zero overlapping starts, each
    beginning ~380ms after the previous one ended.
  - *Not the file under test.* `journal.e2e-spec.ts` alone: 0 failures in 25
    runs. It only flakes as part of the full suite.
  - *Not multiple owner rows.* `trader_test` holds exactly one user after a
    run.

  **Where the evidence points.** Both failing queries filter by `userId`
  (`findOne({ id, userId })` and `txns.find({ userId, instrumentId })`), so
  the likely story is a request resolving to a different user than the one
  that wrote the row — `currentUser()` falling back to `ensureDefaultUser()`
  when the AsyncLocalStorage context is missing, with more than one user
  present. `accounts.e2e-spec.ts` leaves its last test's users behind (its
  cleanup is in `beforeEach`, so the final test's rows are never deleted), and
  it runs FIRST, so every later file runs with extra users in the table.

  **Cheapest next step**, if it is ever worth the time: have
  `accounts.e2e-spec.ts` clean up in `afterAll` as well, and see whether the
  rate changes. That is one line and tests the leading hypothesis without
  instrumenting anything.


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

- [ ] **"Avg risk" does not explain itself.** Raised 2026-09-12: he saw the
  tile on the Journal header and did not know what it meant. That is the
  finding — not a bug in the number, which is correct (see the answer in
  conversation and `summariseTrades` in `derive-trades.ts`), but a figure
  occupying prime screen space that its own owner cannot read.

  The number is the average dollars at risk across every trade that set a
  stop, open ones included, excluding plans whose risk computes to zero. The
  sub-label says "N with a stop", which explains the denominator and not the
  quantity.

  **Decide with him:** either the tile gets a tap-to-explain (one line: "what
  you typically put at risk per trade — the average of entry-to-stop across
  N trades"), or the label changes to something self-evident. A tooltip is
  the wrong shape on a phone; a tap that expands one line of prose is the
  pattern already used elsewhere for caveats.

  **Sweep, per step 4:** every other bare number on a header tile has the
  same problem in waiting — win rate, expectancy in R, the Stops page's
  own average risk per position. If the fix is a pattern, make it one
  component and apply it to all of them rather than patching this tile.

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
  comparable products and decide what the right shape actually is. A first
  pass against the owner's own screenshots produced three concrete findings;
  one is fixed, two are decisions.

  **Fixed:** the placement caveats under the trade chart were four lines of
  permanent furniture — 20 of 57 fills came from the seed, so "some fills sit
  outside the price range for their day" was true on most screens. Folded
  into a "Why some markers sit where they do" toggle, wording unchanged. The
  bars-are-behind warning stays in the open: it is transient and it resolves,
  which is the only one worth interrupting a glance for.

  **Decide: dates follow the device locale, money does not.** Every money
  value is pinned to `en-US`; dates pass `[]` to `toLocaleDateString`, and
  `lightweight-charts` gets no `localization` at all. On the owner's phone
  that renders Hebrew month abbreviations under an otherwise English screen.
  This is deliberate — `chartDates.spec.ts` says "order is the VIEWER's
  locale to decide" — so it was left alone, but the consequence is mixed
  script in a product meant to be charged for. Pinning both to English is
  two lines; keeping device dates is also coherent. Not the agent's call.

  **Watch: axis labels may now crowd.** The current-price badge already
  overlapped its neighbouring gridline label before any of this (visible on
  MSTR, BITX and PLTR). Fills, stops and the target now each add one. If it
  is unreadable on a phone, label only the levels that carry the decision —
  stop and target — and leave fills to their lines plus the text beneath.

## The trade-idea prompt (design agreed, not built)

Approved in conversation, no code yet. The failure that motivated it: an
opinion on buying BITX that lectured the owner about having no crypto in his
profile, while he held 4,600 shares of it. It answered "should I open this?"
when the question was "should I add to this winner?".

- [ ] **The model misquotes the app's own figures.** Found while checking
  whether the enlarged prompt improved the answer — it did, decisively (see
  below), but the same answer overstated two portfolio aggregates.

  Verified against the database for the BITX opinion of 2026-09-04 16:49:

  | Figure | Model said | Actually | |
  |---|---|---|---|
  | BITX weight | 9.0% | 9.0% | ok |
  | ETHU / HOOD / IREN weights | 6.5 / 8.8 / 7.4% | 6.4 / 8.9 / 7.5% | ok |
  | BITX holding | 1,000 sh, $18,150 | 1,000 sh, $18,155 | ok |
  | Prior BITX profit | $7,172 | $7,172 | ok |
  | **LMND weight** | **36.1%** | **22.1%** | **inflated by 63%** |
  | **Gross exposure** | **$538,203 / 2.67x** | **$480,726 / 2.37x** | **inflated by 12%** |

  The small per-position numbers match to within a tenth of a point, which
  is what rules out my method as the cause: those figures come from the same
  snapshot at the same moment, so a live-quote-versus-close difference
  cannot explain fourteen points on LMND. The two that are wrong are the two
  aggregates, and both are load-bearing — the recommendation leans on
  "LMND occupying 36.1% of the account" and on total leverage.

  The book section already hands these over under the heading "computed by
  the app, quote these, do not recalculate", and LMND's correct 22.1% was in
  the prompt. So a stronger instruction is not the fix; the model overrode a
  number it had been given. This is the exact failure the product brief
  refuses — a plausible figure that is wrong — and it is worse inside prose,
  where there is no axis to check it against.

  Directions, none obviously right: have the UI show the app's own
  concentration figures beside the opinion so a mismatch is visible; or
  cross-check the numerals in the answer against the facts snapshot and flag
  disagreements; or stop giving the model aggregates it can restate and let
  it reason only about the position in question. Worth deciding before the
  Ideas tab is trusted for sizing.

- [ ] **Ideas answers are slow — the waiting before the model was removed;
  the model's own time is untouched.** The request used to do four
  independent things one after another before the prompt was even built:
  the ticker facts (itself two serial provider round trips), then the record
  and the book, then the profile off disk. Nothing needed anything from
  anything else. They now run together, in both places — `getPortfolio`
  alone is documented at 1.1s and 2.6s in real use, and the quote and the
  history were a further two round trips in series.

  Error semantics were preserved deliberately rather than incidentally:
  running concurrently means several failures can settle at once, so both
  services check results in the order they used to run. An unknown ticker is
  still a 404 and not whatever the database happened to throw. Pinned by
  `ticker-facts.service.spec.ts` and `trade-idea.service.spec.ts`, including
  the ordering itself — the 503 paths had no coverage at all before, and the
  restructure introduced a real bug there that only tsc caught.

  **Not done, and needs the owner:** the model call itself. It is already
  `gemini-3.6-flash`, so there is little headroom in "a smaller model for
  the first pass". Measuring what remains needs a real key — the suite
  blanks `LLM_API_KEY` on purpose — so the end-to-end saving here is
  reasoned from the recorded `getPortfolio` timings, not measured. Streaming
  is the other lever and is a UI change, not a latency one: it would make
  the wait *legible* rather than shorter. The prompt is also worth a look —
  the stored facts snapshot grew from ~1,600 to ~4,600 characters when the
  book and record were added.

## Features requested, not yet designed

Raised 2026-09-12. Each needs its own brainstorm before any plan — written
here so nothing is lost, not as an instruction to start building.

- [ ] **Totals on the Trades screen, over a chosen period.** Today the Trades
  tab lists round trips and a stats header (win rate, average risk,
  expectancy in R) computed over everything. He wants a **total profit and
  loss across all trades**, and the **same period filter the benchmark chart
  already has** — with every figure on the screen recomputed for the selected
  period, not just the list filtered.

  **Reuse before invention:** the range selector already exists in
  `frontend/src/lib/benchmarkRange.ts` (`Range`, `RANGES`) and is rendered by
  `BenchmarkChart`. That control, not a second one. The recomputation is the
  backend's job — invariant 5 — so `derive-trades.ts` stats gain a date
  window rather than the frontend summing rows.

  Ships with the filter-glitch fix above, since both touch that control.

- [ ] **A per-stock summary page.** One ticker, one page, over a chosen date
  range:
  - every transaction in the range, in full detail
  - total profit and loss on that ticker
  - averages — position size, hold time, R, win and loss
  - **fees paid on this ticker**, which nothing surfaces per-symbol today
  - an **AI reading of his history in this name** specifically

  Much of this exists in pieces: `derive-trades.ts` already produces round
  trips per instrument, the fees tab already aggregates by period, and the
  trade-idea prompt already assembles a record section. The page is mostly
  assembly plus one new aggregation — but it is the first screen whose whole
  subject is a single symbol, so it deserves its own design pass.

  The AI reading should reuse the existing pattern rather than invent one:
  `CollapsibleCard`, a stored `factsSnapshot`, and the model quoting the
  app's computed figures rather than recomputing them (see "The model
  misquotes the app's own figures" above — a per-ticker answer is exactly
  where that failure would bite).

## Research and working sessions (no code)

Raised 2026-09-12. These produce documents and decisions, not features. Each
is a sit-down with the owner, not something to complete alone and present.

- [ ] **Competitor investigation.** Who else builds a trading journal, what
  their product actually is, and what their front end does well. Deliverable:
  one document per competitor — a short summary of the company and product —
  plus a conclusions section and a list of proposed actions for us.

  **Do the front end properly rather than from marketing pages.** Screenshots
  and pricing pages say what a company wants to be seen as; the interaction
  is where the lessons are. Where a product has a free tier or a public demo,
  use it and record what the flows feel like — how an entry gets logged, how
  a trade is reviewed, what the mobile experience is.

  The list to start from (to confirm with him): Tradervue, TraderSync,
  Edgewonk, TradeZella, Chartlog, Stonk Journal. Worth including at least one
  adjacent non-journal product for the UI alone.

  **The conclusions must be opinionated.** "They all have a calendar view" is
  an observation; "we should not build a calendar view, because X" is the
  deliverable. The brief's "resist features" applies hardest here — a
  competitor scan is the single most reliable way to talk yourself into ten
  features that add no value.

- [ ] **A working session on how the app uses AI.** Two halves, both
  collaborative:

  1. **The markdown.** Read `CLAUDE.md`, `docs/product-brief.md`,
     `docs/working-agreement.md` and `docs/trader-profile.md` together and
     improve them with him. `trader-profile.md` matters most of the four —
     it is the only one the running app reads at request time, so a weakness
     there degrades every answer the product gives. Pair this with an online
     scan of current practice on agent instruction files, and bring back what
     is actually worth adopting rather than a summary of the genre.

  2. **The prompts.** Walk `backend/src/llm/` with him — the portfolio
     summary, the trade review, the trade idea, and the watchlist ranking
     once it exists. Show the real assembled prompt for a real case, not the
     template. Two known problems to bring to that session: the model
     restating aggregates wrongly (see "The model misquotes the app's own
     figures" above), and the facts snapshot having grown from ~1,600 to
     ~4,600 characters with no measurement of what the growth bought.

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
