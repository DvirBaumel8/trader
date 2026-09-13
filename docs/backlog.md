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

**Closed, 2026-09-12: the e2e suite's intermittent flake (~1 in 20).**
Investigated at length across two sessions, never reproduced in isolation —
not fixed, not explained, closed because guessing further without new
evidence wasn't worth the time. Re-open the next time it actually happens
rather than chasing it blind again.

What's known, for whoever re-opens it: it only ever shows up under the
full sequential suite, never with a file run alone (40 isolated runs of
the most-affected file, 0 failures). It has produced at least three
unrelated-looking shapes across different spec files — a 404 on a row
just written, a nonsense 301 on a plain POST, and once a whole file
crashing with `socket hang up` after only partial requests — which reads
less like one bug than something at the Node/HTTP layer between one spec
file's teardown and the next one's startup. Ruled out: file parallelism,
the file under test, Postgres connection exhaustion (peaked at 11 of 100).
The leftover-test-users hypothesis was tried (`accounts.e2e-spec.ts` now
cleans up in `afterAll`, kept regardless) without a clear improvement.

**If it recurs:** don't reproduce blind. A temporary `.on('response', ...)`
listener on `test/http.ts`'s `http()` helper (append `pid, method, path,
status` to a file — Nest's own request logger is invisible in vitest's
default reporter on a passing run) is what separated the three failure
shapes from each other last time; the missing piece was always the
*cause*, not the existence, of any one of them.

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

  **Fixed, 2026-09-13: the Journal's day heading was still on device
  locale.** `chartDates.ts` and the trade chart's own `lightweight-charts`
  localization were already pinned to `en-US` on 2026-09-05 — but
  `Journal.tsx`'s `dayLabel`, the per-day grouping heading on the entries
  list, was missed in that sweep and still called `toLocaleDateString([],
  …)`. First reported as a non-issue on 2026-09-12 without a screenshot;
  reversed the same session once he actually saw his phone rendering "12
  בספט' 2026" under the entries list. Pinned to `en-US`, matching
  `chartDates.ts`; kept as a separate function in a new `lib/dayHeading.ts`
  rather than merged into `chartDates.ts`, because `dayLabel` reads a full
  instant (`occurredAt` carries a real time-of-day) while `chartDates.ts`
  deliberately forces UTC for plain calendar-date strings — merging them
  would have re-introduced the day-shift bug `chartDates.ts`'s own UTC
  parsing exists to prevent. Covered by an exact-string test
  (`dayHeading.spec.ts`), same convention as `chartDates.spec.ts`.

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

- [ ] **A calendar heatmap of daily P&L.** Raised 2026-09-13, from a
  competitor scan of four trading journals (Tradervue, TradeZella, Chartlog,
  Stonk Journal): two of the four lead with a month-at-a-glance calendar
  showing win/loss by day, and it's a pattern worth copying rather than a
  feature to resist — it serves "fast to read at a glance" directly, and the
  data already exists (`performance/series.ts`'s time-weighted daily
  series), so this is assembly, not new computation. Small and scoped enough
  to skip the brainstorm this section otherwise asks for; a checkpoint on
  where it lives (Portfolio tab? Trades tab, alongside the totals-over-a-
  period item below?) is the only real decision.

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

**Closed, 2026-09-13: competitor investigation, scoped down and done.**
Trimmed with him to four of the six named competitors (Tradervue, TradeZella,
Chartlog, Stonk Journal — TraderSync, Edgewonk and the adjacent non-journal
product dropped) and done as a fast pass — public pages and reviews, no
accounts created — rather than the hands-on depth originally asked for.
Delivered as "Journal Comps," a document per competitor plus an opinionated
conclusions section and a proposed-actions list. One action already promoted
to its own backlog entry (the calendar heatmap, in Features above); the rest
(a strategy/playbook layer over setup tags, natural-language draft-prefill,
closing the offline-support gap) were deliberately left in the research doc
rather than duplicated here — each needs its own design pass before it's
backlog material. Re-open only to go deeper on these four or to cover the
three that were dropped.

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

Nothing outstanding right now. `getPortfolio`'s size was reconsidered
2026-09-12 and closed rather than parked: no duplication with
`TradesService.getTrade()`'s high-water resolution (already shared via
`resolveHighWaterPrice`), and the only real argument — unit-testability of
its pure raw-rows-to-derived-shapes and position-assembly steps, given
`portfolio.service.ts`'s ~0.5% unit coverage — was judged not worth the risk
of touching code next to `derive.ts` for a marginal win. Revisit only if the
method actually grows or a real duplication shows up, not on line count alone.
