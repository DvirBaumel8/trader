# AI outcome tracking — design

**Date:** 2026-09-18
**Status:** Approved in conversation, not yet planned

## The problem, and what was rejected first

The owner asked to improve how the app works with AI, starting from a
concrete gap (a trade idea generated with no awareness of same-day news,
since fixed by adding real headlines to the prompt). One item on the
resulting worklist was a way to capture feedback on AI outputs.

The first design built for that was a thumbs-up/down button on each AI
result, backed by a shared `ai_feedback` table and a `POST /ai/feedback`
endpoint. It was fully implemented and tested, then rejected before its
frontend was wired up: "I don't think we need this feature this way... I
want us in the BE to develop a feedback loop mechanism." A manual thumbs-up
asks the owner to grade the AI every time; it does not, on its own, make the
AI's answers better, and it depends on him remembering to tap it.

## What "feedback loop" means here

Not human ratings. **Checking each AI opinion against what actually
happened**, automatically, using data the app already has. The purpose,
in the owner's words, is "to improve quality of the results" — so this
needs to cover all three opinion features, not just the one
(trade-idea) that makes an objectively checkable prediction.

## The three features need three different notions of "outcome"

**Trade-idea** is the only one that states a falsifiable, numeric
prediction: a proposed stop and target. Its outcome is objective — did
price hit one before the other.

**Symbol-pattern** and **trade-review** never forecast price. Both,
however, already name specific mistake tags pulled from the owner's own
journal (`TradeReviewFacts.mistakes`, and the mistake tags folded into
`SymbolPatternFacts.trades[].mistakes`) — real, structured signals already
computed elsewhere in the app, not something invented for this feature.
Their outcome is behavioral: did the mistake the AI called out **recur** in
the owner's next trade in that symbol, or not. This is weaker evidence than
a price check, but it is a real, data-backed signal rather than a
fabricated metric, and it directly serves "improve quality" — a pattern
read whose named mistake never recurs is doing its job; one that recurs
every time is not (or the owner isn't reading it).

## Data source correction: no reliance on stored `daily_closes`

The first pass assumed grading trade-idea outcomes against the
`daily_closes` table already used for charts and backtesting. That is
wrong: `TickerFactsService` deliberately writes nothing to `daily_closes`
for a ticker that is merely researched — only for one actually held or
watched — precisely so that table keeps meaning "things the owner holds."
Trade-idea exists for pre-trade research, so most graded ideas would be on
symbols with no stored bars at all.

Resolution therefore fetches bars **live** from `YahooClient.dailyBars`
for the window since the idea was created, the same primitive
`HistoryService.fetchAndStore` already calls — without persisting them.
This preserves the "never write bars for a merely-looked-at ticker"
invariant while still letting every idea get graded, not just ones on
names the owner went on to buy.

## Architecture

**One shared table, `ai_outcomes`** — same shape as the rejected
`ai_feedback` table minus the human rating, because the three features
already share this shape (a feature name, a pointer to one persisted
opinion row, a status, when it resolved):

```
id           uuid, pk
userId       uuid, indexed
feature      'trade_idea' | 'symbol_pattern' | 'trade_review'
entityId     uuid — the TradeIdea / SymbolPatternRead / TradeReview row
status       'pending' | 'target_hit' | 'stop_hit' | 'repeated' | 'improved' | 'expired'
resolvedAt   timestamp | null
createdAt    timestamp
```

`status`'s five non-pending values span both grading kinds; a given
`feature` only ever produces the subset that applies to it
(`target_hit`/`stop_hit`/`expired` for trade-idea, `repeated`/`improved`/
`expired` for the other two). One column keeps the table simple; the
DB does not need a CHECK constraint enforcing the subset — the resolver
code is the only writer.

**`entityId` needs the id-threading fix redone.** None of
`TradeIdeaResult`, `SymbolPatternResult`, `TradeReviewResult` currently
expose the persisted row's own database id — this was built and verified
during the rejected feedback-capture work and rolled back with it, but the
gap is real and independent of that UI: without a row id there is nothing
for `entityId` to point at. Re-adding `id: string | null` to the three
result interfaces, threaded through both the generate and read paths of
each service, is part of this work.

**A row is created at generation time**, not lazily — every successful
`analyse`/`analyseStream` (trade-idea), `generate`/`generateStream`
(symbol-pattern), and `reviewTrade`/`reviewTradeStream` (trade-review) call
also writes one `ai_outcomes` row with `status: 'pending'`, right after
the opinion itself is saved. This is the row resolution later updates.

**Resolution is on-demand, not scheduled.** No scheduler exists in this
app; `HistoryService.ensureFresh` sets the precedent for "freshness is a
property of asking, not of a background job having run." A method on a new
`AiOutcomeService` — `resolvePending(userId)` — walks that user's pending
rows and, per feature, applies its grading rule (below). It runs whenever
`GET /ai/outcomes` is called, mirroring the read-triggered top-up pattern
`HistoryService` already uses for daily bars.

## Grading rules

**Trade-idea:** for each pending row, fetch `TradeIdea.stop`,
`.target`, `.entryPrice`, `.createdAt`, `.symbol`. `TradeIdea` doesn't
store direction, but `computeTradeRisk` already infers it the same way at
generation time (`stop < entryPrice < target` → LONG, the reverse → SHORT)
— the resolver re-derives it identically rather than storing it a second
time. Fetch daily bars for that symbol from `createdAt` to today (live,
via `YahooClient.dailyBars`, not persisted). Walk the bars in order,
checking the bar's low against the stop and high against the target for a
LONG (the reverse for a SHORT):
  - a bar that crosses the stop before the target → `stop_hit`
  - a bar that crosses the target before the stop → `target_hit`
  - a row with `TradeIdea.stop === null` (levels were unreadable) is never
    inserted as a pending row in the first place — nothing to check
  - neither crossed within 30 days of `createdAt` → `expired`
  - neither crossed, still inside 30 days → stays `pending`

A bar that crosses both stop and target the same day is resolved as
`stop_hit` — the conservative read, matching how a real stop-loss order
would have filled first if price gapped through both.

**Symbol-pattern and trade-review:** for each pending row, read the
mistake tags named in the opinion's own `factsSnapshot` (`mistakes` on
trade-review's facts; the per-trade `mistakes` already embedded in
symbol-pattern's `trades` for that symbol). Find the owner's next CLOSED
trade in the same symbol with `enteredAt` after the opinion's `createdAt`
(reusing `TradesService.deriveAllTrades` + the existing
`tagsByEntryId` lookup, the same way `SymbolPatternService` and
`TradeReviewService` already gather trade/tag data — no new provider
calls).
  - no such trade yet → stays `pending`
  - a next trade exists and shares at least one mistake tag with the
    opinion → `repeated`
  - a next trade exists and shares none → `improved`
  - no qualifying next trade within 90 days of `createdAt` → `expired`
    (behavior takes longer to observe than a price move, hence the
    longer window than trade-idea's 30 days)

## What this deliberately does not do

- **No scheduled job / cron.** Resolution piggybacks on a read, like
  `HistoryService.ensureFresh` — no new infra, no worry about a sleeping
  free-tier provider missing a scheduled fire.
- **No UI.** Purely backend, queryable via `GET /ai/outcomes` (list, with
  status) once this ships. How to surface an AI feature's own track record
  is a separate, later decision.
- **No feedback into the model or the prompt yet.** This stores the
  ledger; using it to change future prompts, thresholds, or which model
  is used is future work `ai_outcomes` makes possible but does not itself
  do.
- **No outcome tracking for portfolio-summary or watchlist-ranking.**
  Neither persists a row identifying one opinion the way the three
  covered features do (portfolio-summary isn't persisted per-call at all,
  watchlist-ranking is one row per whole list, not per ticker) — out of
  scope here, matching the boundary the rejected `ai_feedback` design
  already drew for the same reason.

## Open questions for the plan

- Whether `resolvePending` should also run opportunistically right after
  a new opinion is generated (to resolve *other* still-pending rows for
  that user), or strictly on `GET /ai/outcomes` — affects how quickly a
  stale `pending` row gets updated without the owner ever hitting the new
  endpoint.
- Exact response shape of `GET /ai/outcomes` (flat list vs. grouped by
  feature) — deferred to the plan since no UI consumes it yet.
