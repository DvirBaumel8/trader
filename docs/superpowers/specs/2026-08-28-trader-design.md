# Trader — v1 Design

**Date:** 2026-08-28
**Status:** Approved, ready for implementation planning

## Purpose

A portfolio and trading journal for one active trader (the author), built so that
trading decisions are data-driven and reviewable after the fact.

Two horizons:

1. **Now** — deliver daily value to the author as an active trader.
2. **Later** — distribute to friends, then friends of friends, then a paid
   subscription. This means the UI quality bar is a product bar, not a personal-tool
   bar, from the first screen.

The guiding constraint is **start small**. It is easy to add features that add
complexity without adding value. v1 does three things well.

## The core idea

Most journaling tools fail because logging a trade and journaling a trade are two
separate chores, so the journal rots. Here they are the same act:

> **You seed your portfolio once. From that point on, the diary maintains it.**

There is no separate "add transaction" screen. You write a journal entry about a
trade, and the portfolio updates as a consequence. One place to type, and the thing
you must do (keep the portfolio current) is the same as the thing you want to do
(record your reasoning).

## v1 scope

**In:**

- One-time portfolio seeding (opening positions + starting cash)
- Trading diary: trade entries, free notes, and cash entries on one timeline
- Setup and mistake tagging on entries
- Derived positions with realized and unrealized P&L
- Cash balance and true account value
- Performance over time vs S&P 500 and Nasdaq

**Out (v1):**

Options, crypto, broker integration, AI features, tax reporting, watchlists, price
alerts, screeners, multi-currency, dividend tracking, multi-user accounts.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Responsive mobile-first web app, installable as a PWA | One codebase; sharing is a link; no App Store friction. Native is a phase-2 question. |
| 2 | Diary is the ledger; seed once, then journal | Collapses two features into one and makes the journal self-sustaining. |
| 3 | Positions derived from transactions, never stored | Positions cannot drift out of sync with the journal. |
| 4 | US stocks & ETFs, long and short. No options, no crypto | Matches what the author actually trades; keeps the model small. |
| 5 | Cash is tracked; account value = cash + positions | Enables true account value, buying power, real allocation weights, and idle cash correctly dragging returns. |
| 6 | Cash may go negative (margin) | A legitimate state, not an error. Never blocked, never warned. |
| 7 | Per-trade fees, default $4, editable | The author's real cost structure; fees are material over many trades. |
| 8 | Benchmark is a time comparison of % return, three lines on one chart | What the author asked for. Dollar-value "shadow portfolio" view is future work. |
| 9 | No AI in v1 | An AI coach reading an empty journal has nothing to say. Schema is designed so AI is cheap to add once history exists. |
| 10 | Local, single user | Fastest path to daily use. Dev server binds to LAN so the phone can install the PWA. Every row still carries `user_id`. |
| 11 | Dark visual direction | Matches reference #1; reads as a trader's instrument, flatters charts, makes P&L colors pop. |
| 12 | React + NestJS + PostgreSQL | Author's existing stack (`stock-investigator`); patterns and conventions carry over. |
| 13 | Yahoo Finance for market data | Free, no API key, already in use in `stock-investigator`. |

## Architecture

```
trader/
├── backend/                 NestJS + TypeORM + PostgreSQL
│   └── src/
│       ├── market-data/     Yahoo adapter, quote cache, daily-close backfill
│       ├── journal/         entries, tags
│       ├── transactions/    trades + cash flows; written only via journal
│       ├── portfolio/       derives positions and cash from transactions
│       └── performance/     daily valuation series, TWR, benchmark series
└── frontend/                React + Vite + Tailwind + TanStack Query
```

Module boundaries are strict and one-directional:

- `market-data` knows nothing about portfolios. It answers "what did X cost on day D"
  and "what is X worth now".
- `portfolio` derives state from stored transactions. It never calls Yahoo.
- `performance` consumes `portfolio` and `market-data`. It never reads the journal.
- `journal` is the only write path into `transactions`.

Each module exposes a typed service interface and can be tested without the others.

## Data model

All tables carry `user_id` referencing a single seeded local user, so going
multi-user later is a configuration change rather than a migration.

### `users`
One seeded row. `id`, `display_name`, `default_fee` (numeric, default `4.00`),
`created_at`.

### `instruments`
`id`, `symbol`, `name`, `type` (`STOCK` | `ETF`), `is_benchmark` (boolean),
`created_at`. Benchmarks (`SPY`, `QQQ`) are ordinary instruments with
`is_benchmark = true`, so they get price history without ever appearing as holdings.

### `journal_entries`
`id`, `user_id`, `kind` (`TRADE` | `NOTE` | `CASH`), `body` (text), `occurred_at`,
`created_at`, `updated_at`.

The single timeline. A `TRADE` entry owns exactly one transaction. A `CASH` entry
owns exactly one cash flow. A `NOTE` entry owns neither and moves nothing.

### `transactions`
`id`, `user_id`, `entry_id`, `instrument_id`, `side` (`BUY` | `SELL`), `quantity`
(numeric, positive), `price`, `fee`, `executed_at`.

Shorts are not a separate side. Selling below a zero position produces a negative
derived quantity, which is a short. The UI confirms this is intentional at entry time.

### `cash_flows`
`id`, `user_id`, `entry_id`, `direction` (`DEPOSIT` | `WITHDRAW`), `amount`,
`occurred_at`.

Only external money movement. Buys and sells are internal transfers between cash and
positions and are **not** cash flows for return purposes.

### `tags`
`id`, `user_id`, `type` (`SETUP` | `MISTAKE`), `label`, `created_at`.
Reusable across entries, created on the fly from the entry sheet.

### `entry_tags`
Join: `entry_id`, `tag_id`.

### `daily_closes`
`instrument_id`, `date`, `close` (split/dividend adjusted). Primary key on
`(instrument_id, date)`. Backfilled for every held instrument plus `SPY` and `QQQ`,
from the earliest seed date forward.

### `quotes`
`instrument_id`, `price`, `fetched_at`. Short-lived live-price cache.

### Derived, never stored

**Position** per instrument:
```
quantity      = Σ(BUY qty) − Σ(SELL qty)          (negative ⇒ short)
cost_basis    = Σ(BUY qty × price + fee) for the open lots
realized_pnl  = Σ over closing fills of (proceeds − fee − matched cost)
unrealized    = quantity × current_price − cost_basis
```

**Cash balance:**
```
cash = Σ deposits − Σ withdrawals
     − Σ(BUY qty × price + fee)
     + Σ(SELL qty × price − fee)
```

**Account value:** `cash + Σ(position quantity × current price)`.

Lot matching for realized P&L is **FIFO**.

## Returns and benchmark engine

The one place where a bug is silent, plausible-looking, and expensive. Built as pure
functions over inputs, with no database and no network access.

For each trading day `t` in the requested range:

```
V_t   = cash on day t + Σ(position quantity on t × close price on t)
CF_t  = deposits on t − withdrawals on t
r_t   = (V_t − CF_t) / V_{t−1} − 1
cum   = Π(1 + r_t) − 1
```

All three series — portfolio, SPY, QQQ — are re-based to 0% at the first day of the
selected range (1M / 6M / YTD / 1Y / All), so the chart always answers "how have I
done versus the indices *over this window*".

Because buys and sells are internal transfers, they do not appear in `CF_t`. Only
real deposits and withdrawals do. This is the textbook definition of time-weighted
return, and it means depositing $10k cannot register as a gain.

### Edge cases

| Case | Behavior |
|---|---|
| Weekend / market holiday | No data point; positions carry forward. |
| Missing close for a trading day | Carry the last known close forward, mark the point as interpolated. |
| `V_{t−1} <= 0` (account wiped or fully on margin) | Daily return is undefined. Curve holds flat for that day and the range is flagged in the UI. Never print a nonsense number. |
| Instrument with no price history | Blocked at entry time, not silently mispriced. |
| Splits and dividends | Handled by Yahoo's adjusted closes. |
| Range start before the first seed date | Series begins at the seed date. |

## Market data

Yahoo Finance, unofficial API, no key.

- **Quotes:** fetched on load and on pull-to-refresh, cached briefly. Batched into
  one request per screen, not one per holding.
- **Daily closes:** backfilled on first seed for all held instruments plus `SPY` and
  `QQQ`; incrementally topped up thereafter.
- **Ticker validation:** on entry, before the transaction is written.

## Screens

Mobile-first. Every screen is designed at phone width first and expanded for desktop.

### Dashboard (`/`)
Account value and today's change at the top, with the cash and deployed split beneath
it — cash shown distinctly and in red when negative (margin).

The three-line percentage chart is the centerpiece: you, S&P 500, Nasdaq, with a
range selector (1M / 6M / YTD / 1Y / All) and two delta chips (`vs S&P +5.8%`,
`vs Nasdaq +1.5%`).

Below, holdings: cards on mobile, a table on desktop, showing symbol, quantity,
market value, and return.

### Journal (`/journal`)
One chronological feed grouped by day. Trade entries carry a compact header
(`BUY NVDA 10 @ 168.20 · fee $4`) above the note body and tags. Notes are text only.
Cash entries are a thin single-line row. Filterable by ticker, tag, and kind.

### New entry (bottom sheet)
The most-used surface in the app, so it is a sheet rather than a page.

- Kind selector: Trade / Note / Cash
- Trade: ticker autocomplete, buy/sell toggle, quantity, price, fee (prefilled from
  the user default), date defaulting to now, note body, setup and mistake pickers
- Cash: deposit/withdraw, amount, date
- Note: body and optional ticker association

### Position detail (`/positions/:symbol`)
Current quantity, average cost, realized and unrealized P&L, total fees paid on the
name — then every journal entry that ever touched that ticker, in order. The story of
the trade, which is what makes the journal worth keeping.

### Settings (`/settings`)
Default fee, benchmark selection, seed/reset.

## Visual direction

Dark, following reference #1. Deep navy and near-black surfaces, a restrained accent,
and green/red reserved exclusively for P&L so that color always means one thing. Dense
but calm — the information density of a terminal without the noise.

Chart work follows the `dataviz` skill: the benchmark chart is the screen every other
screen is judged against.

## Error handling

- **Yahoo unavailable:** serve the last cached quote with a visible `stale 14:32`
  marker. A wrong number shown as if fresh is worse than no number.
- **Unknown ticker:** blocked at entry with a clear message.
- **Sell below zero position:** confirm that a short is intended; allow it.
- **Buy exceeding cash:** allowed silently. Margin is a legitimate state.
- **Backfill failure:** the dashboard renders with the data it has and says which
  range is incomplete.

## Testing strategy

- **Returns engine** — the priority. Pure functions, fixture-driven golden tests: a
  known transaction and cash-flow set must produce a known curve. Covers deposits mid
  range, withdrawals, negative cash, a zero-value day, and missing closes.
- **Position derivation** — partial sells, multiple lots, FIFO realized P&L, shorts
  and covers, fees folded into basis.
- **Cash balance** — every transaction type, including negative balances.
- **Market data adapter** — recorded fixtures only, never live network in tests.
- **API integration** — against a disposable test database.
- **UI** — verified in a real browser at an iPhone viewport via the Chrome MCP, not
  assumed from the code.

## Tooling

- `superpowers` — TDD for the returns engine, then `writing-plans` → `executing-plans`
- `dataviz` skill — the benchmark chart
- Chrome MCP — driving the running app at a phone viewport, screenshots, console
- Recharts for charting. TradingView `lightweight-charts` is deferred until candles
  are embedded in trade entries (reference #1), which v1 does not do.

Deliberately not added: a Postgres MCP (TypeORM suffices) and any LLM MCP (v1 has no
AI).

## Future work

Ordered roughly by expected value:

1. **AI auto-enrichment of trade entries** — capture market context at entry time
   (day move, position versus recent range, headlines) so entries are data-rich
   without extra typing, and every later AI feature has a dataset.
2. **AI review** — weekly pass over entries and performance, surfacing patterns and
   contradictions between stated thesis and actual behavior.
3. **Ask-your-journal** — natural language questions over the author's own history.
4. **Dollar-value shadow portfolio** — "the same money in SPY would be worth $X",
   alongside the percentage view.
5. **Multi-user and hosting** — Google sign-in, deployment, invite a friend.
6. **Options support** — the largest modeling jump; only if the author starts trading
   them.
7. **Broker import** — CSV first, API sync later.
8. **Integration with `stock-investigator`** — pull agent analysis into a position's
   detail view.
