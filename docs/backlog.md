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
  - *Not the file under test.* `journal.e2e-spec.ts` alone: 0 failures in
    15 + 25 = 40 runs across two sessions. It only flakes as part of the
    full suite.
  - *Not multiple owner rows, at least not as the sole cause* — see below.

  **The leftover-users hypothesis was tried, 2026-09-12, and did not confirm
  it.** `accounts.e2e-spec.ts` now cleans up in `afterAll` too, not just
  `beforeEach` (the one-line fix this file previously proposed). Across 24
  full-suite runs after the fix: 2 failures (~8%), no visible improvement on
  the ~5% rate the "1 in 20" estimate implies — the sample is too small to
  call that conclusively unchanged, but it is not the clear drop the
  hypothesis predicted. **Keep the fix regardless** — leaking rows past a
  test file's own run is a real gap independent of whether it explains this
  flake — but treat the userId/wrong-user theory as unconfirmed, not closed.

  **New evidence that the old theory is incomplete — three different
  failure shapes now, not one.** None of these three (all from the same
  ~35-run session) match the documented 404-on-a-just-written-row pattern:
  - `journal.e2e-spec.ts > accepts a trade with an empty note`:
    `expected 201, got 301 "Moved Permanently"` on a plain `POST /journal`.
    A 301 is not something application code here ever issues (no redirect
    call exists in `src/`).
  - `journal.e2e-spec.ts > a dividend raises cash but not contributed
    capital`: failed the same session, detail not captured — the harness
    moved to the next check before it was re-caught.
  - `portfolio.e2e-spec.ts`: not a single test but the **whole suite**
    failed with `Error: socket hang up`, killing the file after only 8 of
    its usual ~20+ requests. A suite-level crash is a different class of
    failure from a wrong assertion — something aborted mid-request, which
    smells like a connection getting closed out from under an in-flight
    call rather than a logic bug returning the wrong data.

  **Ruled out, 2026-09-12: Postgres connection exhaustion.** Polled
  `pg_stat_activity` against `trader_test` every 200ms through a full clean
  run: peaked at 11 connections against a `max_connections` of 100. Not
  connection-pool pressure.

  **Where this leaves it.** Three unrelated-looking symptoms (a stale
  assertion value, a nonsense HTTP status, a mid-request crash) across three
  different spec files, only under the full sequential suite, never in
  isolation, and not explained by connection count. That combination reads
  less like an application bug in any one query and more like something at
  the Node/HTTP layer breaking between one spec file's app teardown and the
  next one's startup — but that is a guess, not a finding.

  **Next step, if resumed:** reach for evidence before another hypothesis.
  A temporary `.on('response', ...)` listener added to `test/http.ts`'s
  `http()` helper (removed again after use — it appends
  `pid, method, path, status` to a file, since Nest's own request logger is
  invisible in vitest's default reporter on a passing run) is what
  distinguished these three shapes from each other this session; the
  missing piece is the *cause* of the 301 and the hang-up, not just their
  existence. Catching one under a debugger or with `NODE_DEBUG=http` to see
  what actually arrived on the socket would say more than another blind
  reproduction loop.

  Both are still in `journal.e2e-spec.ts`, still only under the full suite,
  which keeps the "something about running after other files" framing —
  but a wrong-user 404 and a bad-status-code 301 are not obviously the same
  defect. **Next step, if resumed:** stop assuming one root cause. Capture
  a failing run's `RequestLoggingMiddleware` output (`Logger('Request')`,
  logged per-request, currently invisible because vitest suppresses
  passing-run console output) to see what actually hit the socket
  immediately before a 301.


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

- [ ] **5 frontend lint warnings remain, not the 2 last recorded here** — the
  count drifted after the chart file was split (`f996e1a`) and after Google
  sign-in landed, and nobody re-ran `npm run lint --prefix frontend` since.
  Re-verified 2026-09-12:

  - Three `react(set-state-in-effect)`, same shape as before and still the
    right call to leave: each synchronizes local state with a genuine
    external event, not derivable-during-render state.
    `EntrySheet.tsx:160` (which entry/draft session is active),
    `Journal.tsx:359` (an async fetch resolving), and one not previously
    listed, `Login.tsx:254` (whether the Google script tag is already on the
    page).
  - Two `react-hooks(exhaustive-deps)`, new since the chart split and not
    previously triaged: `useCallouts.ts:117` and `:268` want `seriesRef`,
    `chartRef` and `containerRef` in their dependency arrays. Almost
    certainly fine to leave — refs are stable identities, the same reasoning
    that applies to the set-state warnings above — but that is a guess, not
    a decision made on purpose the way the other three were. Worth five
    minutes to actually look and either silence with a reason or fix.
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

- [ ] **Ideas answers are slow — the model's own time is untouched.** The pre-model work (ticker facts, record, book, profile) was parallelised, with the old error-ordering semantics pinned by `ticker-facts.service.spec.ts` and `trade-idea.service.spec.ts`.

  **Not done, and needs the owner:** the model call itself. It is already `gemini-3.6-flash`, so there is little headroom in a smaller first pass, and measuring needs a real key — the suite blanks `LLM_API_KEY` on purpose. Streaming is the other lever and is a UI change, not a latency one: it would make the wait *legible* rather than shorter. The facts snapshot grew from ~1,600 to ~4,600 characters with no measurement of what the growth bought.

## Features requested, not yet designed

Raised 2026-09-12. Each needs its own brainstorm before any plan — written
here so nothing is lost, not as an instruction to start building.

- [ ] **Broker integration — Interactive Brokers, read-only, via the Flex Web
  Service.** Researched 2026-09-12 and deferred the same day; written up so
  the research is not repeated. The owner trades through **Handy Trader**,
  which is IBKR's own mobile app (Israeli clients reach it through Interactive
  Israel, a gateway onto the IBKR engine). So the account is an IBKR account,
  which is the best case available.

  **The chosen route: the Flex Web Service.** A Flex Query is defined once in
  Client Portal — which fields to include: executions, positions, cash
  transactions, commissions, dividends, margin interest — and IBKR issues a
  token. A server then fetches an XML report over two REST calls:
  `SendRequest` (token + query id + `v=3`) returns a reference code, and
  `GetStatement` returns the report a few seconds later. Read-only by
  construction, no order permission anywhere near it, no daily login, no 2FA
  prompt, no desktop process. Free. Rate-limited to roughly one request per
  second, which a once-a-day pull never approaches.

  **The two routes rejected.** The Client Portal Web API offers live data and
  order placement but needs either a gateway process running continuously or
  an OAuth flow plus regular re-authentication — the wrong shape for an API on
  Render. The TWS API needs TWS or IB Gateway running on a machine that never
  sleeps, which rules itself out. Third-party aggregators (SnapTrade, Plaid
  Investments) are paid, and the brief says free while this serves one user.

  **The design constraint that matters most.** The feed must NOT write
  transactions. Invariants 1 and 2 exist because the journal is the only write
  path into the portfolio, and that is what keeps the diary self-sustaining —
  a feed that writes directly would end the journal, because he would stop
  writing entries the moment the app already knew. The right shape is
  *reconciliation*: the feed says "the broker shows a PLTR sell on the 9th you
  have not journalled", and he journals it in one tap with the fields
  pre-filled. The broker supplies the *what*; he keeps the *why*.

  **Why this also closes the numbers gap.** It delivers exactly what the
  reconciliation item at the top of this file needs: every execution with its
  real commission, the cash transactions, and dividends and margin interest
  the app does not model at all. The gap stops being something he spots by eye
  and becomes a screen that tells him what does not match.

  **Blocked on one check by him:** whether Client Portal → Settings → Account
  Settings → **Flex Web Service** is available on his account and will issue a
  token. Interactive Israel accounts are IBKR accounts so it should be, but if
  Client Portal features are restricted for that channel the whole design
  changes, and that is worth knowing before anything is built.

  **Security:** the token reads full account history. It belongs in Render's
  environment only — never in the repo, never pasted into a chat.

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

- [ ] `getPortfolio` (`portfolio.service.ts`) is still ~227 lines, now mostly fetch-and-assemble (positions array, at-risk, stop tiers) after `computeAtRisk` moved to `risk.ts` and the trailing-stop high-water resolution moved to `TradesService.resolveHighWaterPrice` (shared with `getTrade()`). Further splitting is not obviously a win over reading it top to bottom — parked unless it grows.
