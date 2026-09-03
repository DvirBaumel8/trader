# Trade Idea — Design

**Date:** 2026-09-03
**Status:** Approved, not yet planned

## The problem

Every feature in this app so far describes what the owner already did. The
portfolio shows what he holds, the journal records why he bought it, the
benchmark chart says how it went. Nothing helps before the money is committed.

He wants to name a ticker he is considering and hear a view: does this fit the
way he trades, is the stock worth buying right now, and is the risk/reward
worth taking.

## What it is

`POST /ai/trade-idea { symbol }`. The price is always the live quote — he is
asking "should I buy this now", so a typed price would be a second, stale
answer to a question he did not ask.

The response is an opinion, a proposed stop and target, and the arithmetic
those imply against his own recorded risk.

## Decisions

**The app computes, the model judges — but the model may propose levels.**
Everywhere else in this codebase the model may only quote numbers the app
calculated. That rule protects facts about his account: P&L, risk, R. A stop
on a trade he has not taken is not a fact about his account; it is a
suggestion, the same thing a human would offer. So the model proposes the
stop and the target, and the app does every calculation that follows from
them. The model never states a ratio it worked out itself.

**Fundamentals come from the model, and are labelled.** The owner asked for a
fundamental view. Only the model can give one: beyond P/E and market cap,
Yahoo offers nothing this app trusts. So the model may use its own knowledge
of the business and sector, must mark it as unverified, and must say when it
may be out of date. This is a deliberate, bounded exception to "every number
is computed", and it applies only to prose about the company — never to a
figure.

**Nothing about a researched ticker is persisted as market data.**
`instruments` and `daily_closes` mean "things he owns". Bars are fetched on
demand and thrown away; the existing 60-second quote cache absorbs repeats.

**Opinions ARE persisted.** Asked for explicitly. "What did it say before I
bought LMND" is the question that makes this feature worth more in six months
than it is on the first day.

**Not included: what this would do to his book.** Offered and declined.
Concentration and leverage effects are left out.

## Data

`yahoo.client.ts` remains the only file importing `yahoo-finance2`
(CLAUDE.md invariant 5). It gains a call for daily bars of an arbitrary
symbol, alongside the quote it already serves.

An unrecognised ticker returns 404 with a plain message, the same way seeding
an unknown symbol does. A provider failure produces no opinion at all rather
than a partial one.

**A stale quote is never presented as live** (invariant 6). If the price
backing the opinion is stale, the response says so and the saved record keeps
that flag, because an opinion about a price is only as good as the price.

## Indicators

New pure module `backend/src/market-data/indicators.ts` — no database, no
network, fixture-tested, in the style of `derive.ts` and `risk.ts`:

- 52-week high and low, and the distance from each
- 20, 50 and 200-day simple moving averages, and where price sits against each
- ATR(14), as a volatility yardstick a stop can be reasoned about against
- Relative volume today, reusing `relative-volume.ts` rather than
  reimplementing its rule
- P/E and market cap, passed through from the quote

Each value is null when it cannot be computed honestly — a name with four
months of history has no 200-day average, and saying so beats extrapolating.

## The model contract

The system prompt reuses the existing analyst role and the trader profile,
plus rules specific to this task. The user turn carries the indicator block
and the request.

The model returns its prose AND two structured levels: a proposed stop and a
proposed target.

**If those levels cannot be parsed, the app renders the prose and omits every
derived number, saying why.** A missing ratio is honest; a guessed one is the
failure this whole app is built to avoid.

## What the app computes

From the live price and the model's two levels:

- risk per share, reward per share, and the resulting R:R
- the share count that would risk his own average risk per trade, taken from
  his recorded history, and what that position would be worth

So the answer ends in his own terms:

> To risk your usual $1,489, this stop implies 84 shares — $12,400.

No position size is typed. The yardstick is his own behaviour.

## Persistence

New table `trade_ideas`: `symbol`, `entryPrice`, `priceStale`, the proposed
`stop` and `target`, the computed `riskReward`, the opinion text, the facts
snapshot, `model`, `createdAt`. List, detail and delete endpoints mirroring
`ai_summaries`, whose shape this deliberately follows.

## UI

A fourth navigation tab. This is a different activity from recording what
happened, and folding it into the Journal would blur that tab's single job.
Type a ticker, get the opinion, with previous ideas listed beneath.

## Errors

| Case | Behaviour |
|---|---|
| Unknown ticker | 404, plainly worded |
| Provider unavailable | No opinion; say the data could not be fetched |
| Stale quote | Opinion given, staleness stated and stored |
| Model busy / quota | The existing failure copy from `llm.service.ts` |
| Levels unparseable | Prose shown, derived numbers omitted, reason stated |

## Testing

`indicators.ts` and the risk/reward arithmetic are pure and fixture-driven.
The unparseable-levels fallback gets its own tests. An e2e test drives the
whole path with a stubbed model and asserts the persisted row and the
computed fields. No test calls a real model — `test/global-setup.ts` blanks
the key, and that guarantee is relied on here.

## Slices

1. **Indicators and the endpoint, with no AI at all** — computed facts about
   a ticker, from data the app trusts. Useful and testable on its own.
2. The model call, the structured levels, and the app-computed risk/reward
3. Persistence and history
4. The screen

## Out of scope

Position sizing beyond the average-risk yardstick. Portfolio fit,
concentration and correlation. Web-grounded research — the free Gemini tier
rejects grounded calls outright (see `llm.service.ts`), so it needs a paid
key and is a decision for another day. Any automated action: this feature
produces an opinion and never an order.
