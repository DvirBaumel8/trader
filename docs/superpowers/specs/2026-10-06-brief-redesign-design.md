# Brief Redesign — Design

Date: 2026-10-06
Status: approved in conversation, awaiting written-spec review

## Problem

The Daily Brief repeats what the Portfolio and Watch screens already show
(the "Current coverage" section is a price card per ticker) and its notes are
mechanical signals the owner would spot himself — momentum streaks recur on
the same names day after day. It reports what happened, not what to do.

## Goal

The Brief answers one question: **what needs my attention or a decision
today, and why?** It is read at different times of day, so every section
adapts to the market session.

Built on data no generic product has: the owner's stops and his own journal
reasoning.

## Research behind it

- Swing-trader morning notes start with regime (risk-on/off, leading and
  lagging sectors) before names, and end with trade management.
- Schwab's 2026 AI portfolio insights: the few holdings that moved most, and
  why (news).
- Pre-market routines favour a short, focused read over a long list.
- Stops do not fire outside regular hours; a gap past a stop fills at the
  open, not at the stop.

## Out of scope

Since-last-visit diffing, an events timeline, yesterday's P&L attribution,
an "earnings plan" feature, push notifications, any paid data source.

## Page layout (top to bottom)

1. **Header** — "Brief", session badge, updated time, refresh.
2. **AI summary** — one or two sentences on the single most important thing.
   Hidden when AI is unavailable.
3. **Market mood line** — e.g.
   `SPY uptrend +0.4% · QQQ mixed −0.2% · VIX 17.8 (+1.1) · Leading XLE · Lagging XLK`,
   with this week's economic events as one quiet line beneath it.
4. **Needs attention** — the decision queue. Empty state:
   "Nothing needs a decision today."
5. **Movers** — up to five holdings with a notable move, each with a
   headline and a thesis check. Hidden when none qualify.
6. **Watch triggers** — watchlist names that fired a signal today.
   Hidden when none.

Removed: the "Current coverage" section and the Market / Portfolio / Watch
grouping. Order is by urgency, not by list.

## Session baseline

The backend already labels each quote's session (`PRE`, `REGULAR`, `POST`,
`OVERNIGHT`, `CLOSED`) and whether it is an extended-hours print.

- **PRE / OVERNIGHT:** moves are measured from the prior regular close to the
  extended-hours price, labelled as such. Crossed stops read as gaps that
  will not fire until the open.
- **REGULAR:** live price.
- **POST / CLOSED:** the day's regular close is final; extended prints are
  labelled, never presented as the close.

Stale quotes are labelled stale everywhere.

## Decision queue

Computed entirely in the backend, no AI. One item per symbol per kind;
items are ordered by kind (below), then by position market value, descending.
Each item is one line with the triggering number, and links to the holding.
Long and short positions are mirrored throughout.

| Priority | Kind | Rule |
|---|---|---|
| 1 | `STOP_CROSSED` | Any current stop tier has `passed = true` (from `portfolio/stop-distance.ts`). Outside regular hours the copy says the stop has been gapped and will not fire until the open. |
| 2 | `NEAR_STOP` | The nearest unpassed tier is within 1 ATR(14) of the current price, measured in dollars. Skipped when ATR cannot be computed. |
| 3 | `NO_STOP` | An open position with no current stop levels, including a plan cleared through its tombstone revision. |
| 4 | `EARNINGS` | Earnings fall on today or on the next trading day after the current session. The line carries the stop status, e.g. "reports before next open · stop 8.2% away" or "· no stop". |
| 5 | `THESIS_BROKEN` | Rule-based, from the entry reasons of the position's opening fill (below). |

**Thesis rules.** They use the entry reasons on the journal entry that opened
the current position:

- `ENTRY_SMA_150`: a long whose latest regular close is below the 150-day
  SMA; a short whose close is above it.
- `ENTRY_BREAKOUT`: the breakout level is the highest high of the 20 trading
  days before the entry date (for a short, the lowest low). Broken when the
  latest regular close is back below it (a short: above it).

Other reasons (`ENTRY_VOLUME`, `ENTRY_NEWS`) have no rule. Missing bars mean
no item, never a guess.

## Market mood

Daily bars from the existing Yahoo client, cached as today:
SPY, QQQ, ^VIX, and the 11 SPDR sector ETFs
(XLK, XLF, XLE, XLV, XLI, XLY, XLP, XLU, XLB, XLRE, XLC).

- **Trend** for SPY and QQQ: `UP` when price > EMA20 > SMA50 and EMA20 is
  rising over five days; `DOWN` when the mirror holds; otherwise `MIXED`.
  The same helpers as the existing momentum rule.
- **Change:** percentage change against the prior regular close, following
  the session baseline.
- **VIX:** level and point change.
- **Sectors:** the best and worst ETF by today's percentage change.
- A missing or stale symbol is labelled or omitted, never shown as fresh.

Economic events from the existing `EconomicCalendarClient` stay as one line
under the mood block.

## Movers

- **Ranking:** holdings ranked by |today's move| ÷ ATR(14). Qualify at
  ≥ 1 ATR; cap at 5.
- **Each row:**
  - symbol, % move, × ATR, and the dollar change in the position's value
    (signed by direction);
  - **headline:** the newest Finnhub `companyNews` item for the symbol from
    the last 24 hours, with source and time, linking to the article.
    "No news found" when there is none or Finnhub is unconfigured;
  - **thesis:** entry reasons as chips (e.g. *Breakout · Volume*), and one AI
    line weighing the journal note against the move and the headline.

## Watch triggers

The existing `BREAKOUT` rule, and `MOMENTUM` only on the first day of a
streak (`momentumStreakDays === 1`). Watch rows only. Holdings no longer
produce these notes.

## AI

- **One call per brief.** Structured output:
  `{ summary: string, thesis: Record<symbol, string> }`.
- **Facts block:** the queue, the mood line, the movers with headlines, and
  each mover's journal body and entry reasons, all already computed by the
  backend. The system prompt's "never invent a number" rule is unchanged.
- **Cache:** the existing per-user cache is kept. The signature becomes the
  queue (kind + symbol), the mover symbols and the headline ids; maximum age
  30 minutes.
- **Failure:** on any AI failure the summary and thesis lines are omitted
  silently; chips and headlines still render.

## Architecture

### Backend

Pure, fixture-tested rules, each in its own file:

- `market-data/brief-queue.ts` (new) — the decision queue. Inputs: positions,
  stop-distance rows, ATR per symbol, earnings dates, session, entry reasons
  plus entry date, bars.
- `market-data/brief-mood.ts` (new) — the mood line from index, VIX and
  sector bars plus quotes.
- `market-data/brief-movers.ts` (new) — ranking, the cap, dollar impact.
- `market-data/daily-brief.ts` — keeps the ATR/EMA/SMA helpers, which the
  new files share, and the BREAKOUT/MOMENTUM rules for watch rows. The
  ATR_MOVE note is retired; movers replace it.
- `market-data/daily-brief.service.ts` — orchestration only: fetches the data
  in parallel, calls the pure functions, attaches Finnhub headlines, runs the
  AI call, caches.
- `llm/daily-brief-context.ts` and `llm/daily-brief-prompt.ts` — rewritten
  for the new facts and the structured output.

Every per-user read (positions, stops, journal entries) filters by the user
resolved through `usersService.currentUser()`.

### API

Same route, `GET /watchlist/daily-brief` (and `?refresh=1`). New response:

```ts
{
  generatedAt: string;
  refreshAfterSeconds: number;
  session: MarketSession | null;
  marketDataAvailable: boolean;
  mood: {
    indices: { symbol: 'SPY' | 'QQQ'; trend: 'UP' | 'DOWN' | 'MIXED' | null;
               changePct: number | null; stale: boolean; extended: boolean }[];
    vix: { level: number; change: number | null; stale: boolean } | null;
    leader: { symbol: string; changePct: number } | null;
    laggard: { symbol: string; changePct: number } | null;
  };
  events: { title: string; detail: string; eventAt: string }[];
  queue: { kind: 'STOP_CROSSED' | 'NEAR_STOP' | 'NO_STOP' | 'EARNINGS' | 'THESIS_BROKEN';
           symbol: string; title: string; detail: string }[];
  movers: { symbol: string; changePct: number; atrMultiple: number;
            dollarChange: number; extended: boolean; stale: boolean;
            reasons: { code: string; label: string }[];
            headline: { title: string; source: string; url: string; at: string } | null;
            thesis: string | null }[];
  watchTriggers: { kind: 'BREAKOUT' | 'MOMENTUM'; symbol: string; title: string; detail: string }[];
  summary: string | null;
  summaryAt: string | null;
}
```

`coverage`, `notes` and `narrative` are removed. The frontend is the only
consumer.

### Frontend

`routes/Brief.tsx` is rewritten as display only, as small components:
`MoodLine`, `AttentionQueue`, `MoverRow`, `WatchTriggers`. Rows use the
existing link destinations (`/?symbol=` for holdings, `/watchlist?symbol=` for
watch rows). Every label and number comes from the backend.

## Failure handling

Each source degrades on its own:

| Source | Failure | Effect |
|---|---|---|
| Finnhub | unconfigured, error, or no news | "No news found" |
| AI | unavailable or quota | summary and thesis lines hidden |
| Yahoo bars | missing for a symbol | omitted from mood/movers; ATR-dependent items skipped |
| Quotes | stale | labelled stale |
| Fed calendar | down | existing `marketDataAvailable` notice |

## Testing

- Fixture unit tests for `brief-queue`, `brief-mood` and `brief-movers`:
  long and short; each session; fixed and trailing tiers; scaled-out tiers;
  a cleared plan; a gap through a stop; missing bars; ATR unavailable.
- Service spec with stubbed Yahoo, Finnhub and LLM clients (no external
  calls), including the AI cache signature and AI failure.
- A per-user isolation test: another user's stops and journal never appear.
- Brief.spec.tsx for each section's empty and populated states.
- An iPhone-WebKit browser test at 402 px, then the owner's check on his
  phone.

## Delivery slices

Each slice is planned, implemented by a Sonnet subagent, reviewed, and
verified by the owner on his phone before the next.

1. **Clean up and mood line:** remove coverage and grouping, add the mood
   line and the events line; watch triggers move to their own section.
2. **Decision queue.**
3. **Movers with headlines.**
4. **Thesis check and AI summary:** the new structured AI call and cache.
