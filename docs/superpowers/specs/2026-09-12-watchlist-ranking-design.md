# Watchlist ranking — design

**Date:** 2026-09-12
**Status:** Approved in conversation, not yet planned

## The problem, and the design that was rejected first

The owner asked for his watchlist ordered best to worst, so he can see what to
buy next. The first proposal was a weighted score: four numbers — price versus
the 150-day average, whether that average is rising, distance from the
52-week high, and ATR — combined with agreed weights into a 1–10.

He rejected it, and he was right on both counts.

**It was shallow.** Four market parameters is not a world-class answer to
"what should I buy next", and dressing them up with decimal places would have
implied a precision nothing underneath supports.

**It threw away the only thing nobody else has.** The app holds his entire
trading record — every trade, every stop, the setups and mistakes he tagged
himself — and the proposed score used none of it.

**And it was too ambitious in the wrong place.** Building a stock-rating
engine from scratch is a large, well-trodden problem. Somebody else has
already done it.

## What already exists, and was not being used

Two discoveries shaped this design. Both were checked against live data rather
than assumed.

**His data already reaches the model.** `trade-idea-context.ts` builds a book
(positions, cash, at-risk) and a record (win rate, average win and loss,
expectancy in R, closed count, and the last fifteen trades with their setup
and mistake tags), and `trade-idea-prompt.ts` embeds both. The trade-idea
feature has had this from the start; the watchlist opinion inherits it by
reusing `TradeIdeaService.analyse`. What was missing was not the data — it was
a scoring design that used it.

**An expert rating is already in the provider we use.** `yahoo-finance2`'s
`quoteSummary` carries analyst consensus, and nothing in the app reads it. For
NVDA, live:

```
recommendationMean   1.28  (1 = strong buy … 5 = sell), from 57 analysts
price targets        mean 327.65 · high 515 · low 180   vs 218.29 now
trend this month     9 strong buy · 48 buy · 2 hold · 1 sell
revenue growth      +105.9%    earnings growth +127.8%
profit margin        63.7%     ROE 117%
```

Free, no API key, no new vendor, and no change to invariant 6 — the fetch goes
in `yahoo.client.ts`, which remains the only file importing the library. A
paid rating API was considered and rejected: it would break "free while this
serves one user" for something already available.

## The design: three views, reconciled

Not one number from four inputs. Three independent views of a ticker, and the
model's job is to reconcile them — especially where they disagree.

**1 — The street.** Analyst consensus, number of analysts, price targets
against the current price, how that consensus has moved in recent months,
revenue and earnings growth, margins. Fetched, not computed. This is the
"existing solution" leg: the app does not attempt to out-analyse fifty-seven
analysts.

**2 — The tape.** What the app already computes: price against his 150-day
average, whether that average is rising, distance from the 52-week high and
low, ATR as a fraction of price, relative volume, P/E.

**3 — Him.** Win rate, expectancy in R, average risk, the open book and its
concentration, margin usage, the last fifteen closed trades with their tagged
setups and mistakes — and, specifically, **his own history in the ticker being
ranked**: has he traded it, how did it go, what did he tag it.

The output worth reading is the reconciliation, not an average:

> The street is strongly bullish and sees 50% upside to its mean target. The
> tape says it is extended — 8% above your 150-day and close to its high. You
> have traded this name twice, sized up on conviction both times, and lost on
> one. This is the setup your own profile names as your weakness.

No vendor can write that third sentence. It is the part that is his.

## Output

A **ranked order**, best to worst, with per ticker:

- a one-line verdict, always visible
- the full reasoning, collapsed behind `CollapsibleCard` — the app's one way
  of showing a long generated answer, so this behaves like the portfolio
  summary, the trade review and the trade idea

**No numeric score.** "NVDA 7.4 versus AMD 7.1" implies a precision that three
disagreeing views cannot support, and the ordering already carries the
comparison. If a number is wanted later it can be added; it cannot easily be
taken away once he has started trusting it.

**One model call for the whole watchlist, not one per ticker.** Ranking *is*
comparison: a model shown one ticker at a time cannot order them, and sorting
its separate answers afterwards would require exactly the invented number this
design rejects.

## Freshness

**Cached, recomputed daily, with a manual refresh.**

The inputs justify it: daily bars change once a day, analyst consensus moves
over weeks, and his record changes only when he journals. A model call per
page view would spend money and ten seconds of waiting to produce nearly the
same answer.

The stored ranking keeps the facts it was built from — the same reason
`ai_summaries` stores a `factsSnapshot`: an answer whose inputs are gone
cannot be audited later, and "why did it say that" is a question he will ask.

Shown with the age of the answer, and a re-run button. A ranking whose age is
hidden is a stale price wearing a fresh face, which invariant 7 exists to
prevent.

## What this deliberately does not do

- **No position sizing.** The trade-idea design already settled that the app
  derives size from a stop, and the model never states a dollar figure.
- **No "buy this" instruction.** It ranks attention, not actions.
- **No paid data.** If the free consensus is unavailable for a ticker — ETFs
  and thin names often have none — the ranking says so for that ticker rather
  than scoring it on two views while implying three.

## Open questions for the plan

- How many tickers can go in one prompt before it becomes unwieldy, and what
  happens to a watchlist of fifty. A cap with a stated rule is acceptable; a
  silent truncation is not.
- Whether a ticker with no analyst coverage is ranked at all, or listed
  separately as "not enough to judge".
