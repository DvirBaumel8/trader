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

## The trade-idea prompt

Shipped. The failure that motivated building it in the first place: an
opinion on buying BITX that lectured the owner about having no crypto in his
profile, while he held 4,600 shares of it. It answered "should I open this?"
when the question was "should I add to this winner?".

**Fixed, 2026-09-13: the model misquoting the app's own figures.** Verified
against the database for the BITX opinion of 2026-09-04 16:49 — every small
per-position number matched to within a tenth of a point (ruling out a
live-quote-versus-close timing difference as the cause), but two aggregates
were inflated: LMND's weight (36.1% stated, 22.1% actual — +63%) and gross
exposure ($538,203/2.67x stated, $480,726/2.37x actual — +12%). The book
section already handed over the correct numbers under "computed by the app,
quote these, do not recalculate" — so a stronger instruction was not the fix,
because the model already had the right number and wrote a different one
anyway.

**The fix removes the model's ability to type these figures at all**, rather
than trying to catch a wrong one after the fact (cross-checking numerals in
free prose was considered and rejected — no reliable way to tell which of
several percentages in a paragraph is meant to be which known fact) or
hiding the real UI panel behind a decision the owner didn't want (a
duplicate-of-the-Portfolio-tab display was proposed and rejected — "why do we
need to duplicate the portfolio? We just need to take care the BE and LLM do
things right"). Instead, extending the pattern already proven for the
LEVELS block: the prompt now tells the model to write `{{GROSS_EXPOSURE}}`,
`{{GROSS_EXPOSURE_MULTIPLE}}` or `{{WEIGHT:<SYMBOL>}}` instead of typing a
number, for ANY position in the book, not only the one being asked about —
that's what would have caught the LMND case, since LMND was cited for
context on a BITX question. `substituteBookPlaceholders` (new, in
`trade-idea-context.ts`) fills these in with the real computed value before
the opinion is returned or saved, so both the live answer and its history
row carry the correct figure. An unresolved placeholder (invented ticker,
typo'd token) renders as a plain "—", never raw `{{...}}` syntax and never a
guess. The model still sees every real number as context for its own
reasoning — it just never writes one down itself.

**Shipped, 2026-09-13: the model's own time, found and cut.** The
pre-model work (ticker facts, record, book, profile) was already
parallelised — this closes the other half, the model call itself, which
the previous entry left as "needs the owner" because measuring it needs a
real key.

**Measured against the real API** (3 live `POST /api/ai/trade-idea`
calls): 16.5s, 17.9s, 15.9s, no retries — one successful call, genuinely
that slow. Gemini's own usage metadata broke it open: a representative
call spent **1,356 hidden "thinking" tokens** against **263 visible
ones** — the model was burning most of its time on an internal reasoning
pass that never reaches the screen, using the provider's default
(automatic) thinking budget that `llm.client.ts` never configured either
way.

**The fix:** `GeminiClient` now reads `LLM_THINKING_LEVEL` and passes it
as `thinkingConfig.thinkingLevel` when set (unset = the exact old
behaviour, the provider's own automatic budget — this is a knob, not a
new default, since less reasoning is a real quality trade-off on harder
cases). A/B tested directly against the real API on two deliberately
hard, mixed-signal cases — a trade idea on a name already held with a
prior chase-loss in it, and a subtle 6-trade win/loss pattern — `MINIMAL`
reached the same verdicts, cited the same real figures and tags
correctly, kept the same caveats, while cutting **22.2s→4.1s** and
**12.0s→4.9s**, at zero billed thinking tokens either time. No quality
regression found in that comparison. Set to `MINIMAL` in
`backend/.env` locally and in `render.yaml` for production (a plain
value, not a secret, so it applies on every deploy same as
`NODE_VERSION`/`DATABASE_SSL` already do) — his call to raise if a harder
real case ever reads shallower than before.

**The facts-snapshot-size question, closed 2026-09-13: measured, and it's
earning its size.** Pulled a real persisted trade-idea prompt and broke it
down by section: ~1,150 chars of fixed instructional preamble, ~1,420 for
the FACTS block (689 of that is the 10-day OHLCV table alone), the rest
book/record. Tested directly against the real API, holding thinking level
constant: a ~3x larger prompt (994 vs 344 input tokens) was only ~18%
slower (4.67s vs 3.81s avg over 3 runs) — input size has a real but
secondary effect, nowhere near what the thinking budget cost. More to the
point, the growth itself is the book/record sections doing their job: git
history shows each addition fixed a real bad-answer bug (the BITX
incident — the model ignoring a 4,600-share position it was asked about).
Trimming it would remove the context that makes answers trustworthy to
save under a second. Left as-is.

**Streaming, slice 1 of at least 2, shipped 2026-09-13: Portfolio
Summary.** The other lever, now that the reply itself is faster rather
than merely less slow. Built as a shared mechanism, deliberately shipped
smallest-and-safest slice first: `LlmClient.completeStream()` (retry
covers reaching a non-empty first chunk only — once anything has been
yielded, a client may already be rendering it, so a later failure ends
the stream rather than silently restarting it), and
`LlmService.portfolioSummaryStream()` streaming newline-delimited JSON —
`{"delta":"..."}` per chunk, one final `{"done":true,...}` line carrying
everything `portfolioSummary()` returns in one shot. One shape for every
outcome (unconfigured, failed before any text, or a real stream) means
the controller (`@Res()`, bypassing Nest's usual one-shot JSON handling)
just writes every yielded line with no branching, and the frontend's new
`streamNdjson()` helper (reusing `client.ts`'s own URL/auth-header logic
rather than growing a second copy) reads line-by-line the same way
regardless of which case produced the last one.

Verified live end-to-end: a direct call streamed 13 real delta chunks in
3.1s (down from 16-22s before the thinking-level fix) with a correct final
line; the in-app "Analyse my portfolio" button showed the same pipeline
correctly rendering a real quota-exceeded response once the day's free
Gemini quota ran out from all the session's testing — confirming the
error path renders live through the same code as the success path.

Deliberately NOT this slice: Trade Review and Symbol Pattern come next
(each has a `[..._META]` block at the START that must be buffered and
stripped before any text streams — one new rule, otherwise identical to
this slice). Trade Idea is last and hardest — `{{WEIGHT:LMND}}`-style
placeholders can appear ANYWHERE in its body and must never be shown raw,
so naive streaming risks flashing placeholder syntax or missing a
substitution split across a chunk boundary. Watchlist Ranking is excluded
entirely — its output is a structured ranked list, not prose, and
streaming a list building up character-by-character would read as broken
rather than responsive.

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

**Shipped, 2026-09-13: totals on the Trades screen, over a chosen period.**
The Trades tab now has its own period picker (1W/1M/6M/YTD/1Y/All, reusing
`BenchmarkChart`'s control via a new `RangeSelector`, extracted rather than
duplicated) that recomputes win rate, total P&L and the trade list from one
`/portfolio/stats?range=` fetch, so the tiles and the list can never
disagree about what's "in" the period. Total P&L is the one genuinely new
figure — summed, not averaged, across closed trades in the window.

Decided along the way, with him: the range picker *replaces* the Trades
tab's own custom From/To filter (`FilterBar` gained a `showDateFilter`
prop) rather than sitting alongside it — two date controls answering the
same question would have been confusing; a closed trade is filtered by its
**exit** date (when the P&L was realized), an open one falls back to its
entry date, exactly matching the frontend's pre-existing `filterTrades`
rule so nothing drifted; the page-level `StatsHeader` (win rate) stays
all-time everywhere it's shown rather than becoming period-aware only on
this one tab, so its meaning never silently depends on a sibling tab's
state.

Backend: `startOf` in `performance.service.ts` generalized into a shared
`rangeStartDate` (`common/date-range.ts`), reused by the new
`filterTradesByDate` in `derive-trades.ts` — the exact date rule lives in
one place rather than two slightly different reimplementations. Verified
live in a real browser (journaled a trade, watched the period picker
refetch and the tiles update correctly) after the usual local port-3000
contention forced a temporary Vite proxy retarget, reverted after.

**Shipped, 2026-09-13 (slice 1 of 2): the per-stock summary page, without
AI.** A new top-level **Stocks** tab — his call, over a buried link from
Portfolio/Watchlist/Trades — lists every symbol with at least one closed
trade (count, all-time total P&L), and tapping one opens `/stocks/:symbol`:
the same `RangeSelector` reused again, win rate, total P&L, two genuinely
new averages (position size — dollar cost basis at entry — and hold time in
days), fees paid on that ticker (open positions included, since an entry
fee is paid whether or not the position has closed), and the round-trip
trade list via the existing `TradeCard`.

Backend: `GET /portfolio/symbols` (the index) and
`GET /portfolio/symbols/:symbol?range=` (the detail), both on
`TradesService` — `getStats`'s tag-collapsing logic pulled into a shared
private method so the two trade lists in the app never describe a fill's
tags two different ways. `avgPositionSize` and `avgHoldingDays` added to
`summariseTrades` itself rather than a second, parallel stats function,
computed over closed trades only like every other outcome stat (unlike
`avgRisk`, which deliberately also counts open trades — "what I typically
make" is retrospective in a way "what I typically risk" is not).

**Extended the same day: the index also filters by period, and sorts.**
Raised after first landing all-time-only — a symbol closed last year no
longer sits on the list while looking at "this week." `getSymbolIndex` now
takes the same `range` param as `getStats`/`getSymbolSummary` and returns
`latestExit` per row (not just used to order server-side) so the frontend
can offer its own NEWEST/OLDEST/LARGEST/SMALLEST sort — the exact vocabulary
`sortTrades` already uses, via a new `sortSymbols` in `entryFilters.ts`
rather than a fourth ad hoc scheme. The sort *control* itself is a new
shared `ui/Select`, extracted after this exact dropdown shell (a `<select>`
paired with this chevron) turned up independently in Dashboard's and Stops'
own sort pickers — both refactored onto it rather than becoming a third
Stocks-specific copy. That refactor caught a real bug in all three
originals: the chevron span had no `aria-hidden`, so every sort control's
accessible name silently included a trailing "▼".

**Extended again the next day: renamed to Trades, a fees column, and three
small papercuts he flagged from a screenshot.** The tab label became
**Trades** (only the label — the route stays `/stocks` and
`/stocks/:symbol`, since `/trades/:id` already names the single-trade
detail page; the same label-vs-slug gap the "Watch" tab already lives
with, routing to `/watchlist`). With the top-level tab now doing that job,
the Journal's own **Trades sub-tab** — `TradesTab`, its period picker and
its `FilterBar` — was deleted outright rather than left as a second way to
browse the same trades; `Journal`'s default tab moved to **Activities**,
including the uiState/`RestoreLocation` fallback that used to read
`'TRADES'` and would otherwise have restored onto a tab that no longer
exists.

The index gained a **Fees** column (`feesPaid` on `getSymbolIndex`, same
paid-fees-in-the-window rule already used by the per-symbol page) and two
sort options, `FEES_HIGH`/`FEES_LOW` in `sortSymbols` — kept separate from
`LARGEST`/`SMALLEST` (P&L magnitude) rather than overloaded, since a
ticker's fee total and its P&L are different questions once both are
sortable. The list itself moved off repeated flex rows onto a CSS grid
with one header row (Symbol / Closed / Fees / P&L), so "closed" and "fees"
are named once instead of once per row — the screenshot he sent showed the
old repetition plainly once there were two numeric columns to name.

The same screenshot also showed `FilterBar`'s own sort `<select>` filling
the whole remaining row width — it had been left off the shared `ui/Select`
"for different width behaviour" when `Select` was extracted the day
before, and that was the actual bug: `Select` is `shrink-0`, `FilterBar`'s
own markup was `flex-1 w-full`. Migrated onto `Select`; `FilterBar.spec.tsx`
needed no changes; it wasn't asserting on the removed width classes.

Also renamed `StockDetail`'s "Avg hold" tile to **"Avg hold (days)"** — the
unit wasn't named anywhere on screen.

**Fixed the same day, from a phone screenshot: the header and the numeric
columns drifted out of alignment down the list.** Root cause: the header
row and each data row were separate CSS grids, so `auto` column widths
were computed from each one's own content alone — the header lined up
with whatever row happened to have similarly-wide fee/P&L figures and
drifted from every other. The browser check done when this shipped used
stub fees that were identical ($8.00) on both rows, which hid it; his real
data, with fee and P&L strings of very different widths, showed it
plainly. Fixed by merging the header and every row into one shared grid —
each row is now an `<a>` with `display: contents` so its cells become
direct items of that grid, with a full-width div standing in for the
divider the row's own box used to draw. Covered by a test asserting the
header and every row resolve to the same grid ancestor, since jsdom does
not run layout and cannot check pixel alignment directly; re-verified
live via `getBoundingClientRect` against his own portfolio data (the
header's right edge and a row's matched to the pixel).

**Extended again: sort by number of trades.** Two more `sortSymbols`
options, `TRADES_MOST`/`TRADES_FEWEST`, alongside the existing
NEWEST/OLDEST/LARGEST/SMALLEST/FEES_HIGH/FEES_LOW — kept as their own pair
rather than folded into an existing one, since a symbol's trade count is a
third independent dimension from its P&L and its fee total.

**Shipped, slice 2: the AI reading of his history in this name.** A
retrospective "Pattern in {symbol}" card on the Stock detail page —
deliberately not a buy/sell opinion, which is Trade Idea's job. The
comparison IS the answer: his stats in this name against his own overall
record over the SAME selected period (win rate, avg win/loss, avg risk,
position size, hold time), plus any setup/mistake tag that recurs in this
name, his own journal note text on these trades, and whether what he
actually does here matches his stated trading profile.

Backend: `symbol-pattern-{context,prompt,parse}.ts` follow the same
three-way split every AI feature in this app already uses, and reuse
rather than reinvent — `renderHistoryLines`/`RecordTrade` from
`trade-idea-context.ts` render the per-trade lines (already structurally
typed to accept `getSymbolSummary`'s tag-collapsed trades with no
adapter), and the two number sources are the existing
`getSymbolSummary(symbol, range)` and `getStats(range)`, never
recomputed. No placeholder-substitution needed here (unlike the trade-idea
fix) — every figure is a static snapshot at generation time, not a live
one that can drift before the model's answer is read. `SymbolPatternRead`
persists one row per generation, like `TradeReview` — regenerating for
NVDA/1M never overwrites NVDA/ALL, and each range keeps its own read
rather than losing one when he switches periods. Routes:
`GET/POST /ai/symbol-patterns/:symbol?range=`.

Frontend: `SymbolPatternCard.tsx`, modelled on `TradeReviewCard.tsx` minus
the grade badge (this isn't graded) — button-triggered like every other AI
feature, headline as the one line that survives collapsing per the app's
own convention. Verified live with a real Gemini call against his real
data: correctly flagged a one-trade sample as too small to conclude
anything, and compared his 100% win rate in the name against his 50%
overall with no invented figures.

**Bug found during that live check, fixed the same day: switching the
period picker on an already-open Stock detail page kept showing the
PREVIOUS period's just-generated read (or its failed-generate error),
instead of the newly-selected period's own.** Root cause: the card mirrored
`TradeReviewCard`'s `mutation.data ?? data` pattern, which is safe there
because a trade review is mounted once per fixed `tradeId` — this card
stays mounted across a `range` change, so the mutation's leftover result
outlived the prop that made it valid. Fixed by reading only the query's own
`data` (already kept current via the mutation's `onSuccess` writing into
that exact cache key) for the success path, plus a `useEffect` resetting
the mutation on `symbol`/`range` change for the error path, which has no
equivalent cache to fall back on. Covered by two tests, each confirmed to
fail without its half of the fix before being confirmed green with it.

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
