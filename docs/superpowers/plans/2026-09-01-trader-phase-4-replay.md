# Phase 4 — Trade Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, annotated daily candle chart of one trade — entry, exit, every fill and the stop levels — reachable in two taps, replacing the trip to TradingView after a trade closes.

**Architecture:** `daily_closes` gains OHLC (already fetched from Yahoo and discarded today), the backfill window widens to give a month of context, one new endpoint serves a trade plus its bars, and one new screen draws hand-rolled SVG candles. The existing Trades list in `Journal.tsx` and the position rows on the Portfolio tab become the ways in — no new nav tab.

**Tech Stack:** NestJS 12 + TypeORM 1.1.0 (hand-written migrations), `yahoo-finance2` v4, React 19 + Vite 8, Tailwind v4, hand-rolled SVG (no charting library), Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-09-01-trade-replay-design.md` — read it before starting; this plan implements it and does not repeat its reasoning.

## Global Constraints

- **`derive.ts` and `derive-trades.ts` stay pure** — no database, no network, fixture-driven tests. `derive-trades.ts` gains one output field in Task 2; its round-trip algorithm does not change.
- **`yahoo.client.ts` is the only file allowed to import `yahoo-finance2`.**
- **Never show a stale price as if it were fresh.** The chart states the last bar date it actually has rather than presenting a truncated window as complete.
- **Positions and trades are derived, never stored.** A trade's id is the composite `` `${symbol}:${enteredAt ISO}` ``, not a database key.
- **Schema changes go through a migration**, registered by hand in the explicit `migrations: [...]` array in `backend/src/database/data-source.ts`. Never re-enable `synchronize`.
- **Never run a destructive command against the `trader` database.** The backfill is safe — it upserts on `(instrumentId, date)`.
- **Do not run `nest build` while `npm run dev` is running.** Use `npx tsc --noEmit -p tsconfig.json` from `backend/` to typecheck.
- **The chart is verified on the phone**, not just in the typechecker.

## Deviations from the spec, decided while planning

Both are recorded here rather than silently applied:

1. **No trades list endpoint.** The spec named two endpoints. `Journal.tsx`'s `TradesTab` already gets the full derived `trades` array from `/portfolio/stats`, so a list endpoint would ship unused. Only the detail route, `GET /portfolio/trades/:id`, is built.
2. **`DerivedTrade` gains a `fills` field.** The detail screen needs each individual fill. Reconstructing them in the service by filtering transactions inside `[enteredAt, exitedAt]` would be correct only until two trades in one symbol touch at the same timestamp. `deriveTrades` already walks exactly those transactions while grouping, so it emits them. The stats response strips the field to keep that payload lean.

## Deviations recorded after implementation

This plan's **Tech Stack** line (above) and **Task 3**'s steps describe a
hand-rolled SVG chart, and are left as written — a plan is a record of what
was planned, not a running rewrite. What actually shipped diverged from both,
recorded here instead:

1. **The chart was rebuilt on `lightweight-charts@5.2.1`**, not the hand-rolled
   SVG the Tech Stack line and Task 3 describe. On-device testing showed the
   hand-rolled version could not give a touch crosshair, a full right-hand
   price scale, or legible markers without effectively reimplementing a
   charting library on a phone screen — see decision 7 (reversed) in
   `docs/superpowers/specs/2026-09-01-trade-replay-design.md`. Task 3's SVG
   code no longer exists in the codebase; `frontend/src/components/TradeChart.tsx`
   is the current implementation.
2. **The "Open in TradingView" link was built, then removed** at the owner's
   request once the rebuilt chart did the job he had previously been leaving
   the app for.
3. **Fill markers moved from being drawn at their exact price to being
   anchored to their bar**, so a marker no longer sits on top of, and hides,
   the candle it annotates.
4. **Five rounds of on-device feedback were needed** to get here. A later
   review then found that the direction fills snap in when they land on a
   non-trading day had been wrong throughout — snapping forward instead of
   backward — and had not been re-examined after the chart rebuild.

---

## Task 1: OHLC in the data layer

**Files:**
- Create: `backend/src/database/migrations/1788307200000-AddDailyCloseOhlc.ts`
- Modify: `backend/src/database/data-source.ts`
- Modify: `backend/src/market-data/daily-close.entity.ts`
- Modify: `backend/src/market-data/yahoo.client.ts`
- Modify: `backend/src/market-data/history.service.ts`
- Create: `backend/src/market-data/yahoo.client.spec.ts` (if absent — check first; if it exists, add to it)

**Interfaces:**
- Produces: `RawBar` gains `open: number | null; high: number | null; low: number | null` — consumed by `history.service.ts` and, in Task 2, by the trade detail response.
- Produces: `DailyClose` entity gains nullable `open`, `high`, `low` columns.

- [ ] **Step 1: Write the migration**

```ts
// backend/src/database/migrations/1788307200000-AddDailyCloseOhlc.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Candles need the intraday range. Yahoo already returns open/high/low in the
 * same chart response the backfill reads — the adapter simply discarded them
 * until Phase 4.
 *
 * Nullable on purpose: every row written before this migration has no values
 * for them, and stays that way until the backfill is re-run. A chart skips an
 * incomplete candle rather than the whole feature failing, and `close` alone
 * remains sufficient for the benchmark chart and the performance series.
 */
export class AddDailyCloseOhlc1788307200000 implements MigrationInterface {
  name = 'AddDailyCloseOhlc1788307200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.daily_closes
        ADD COLUMN IF NOT EXISTS open numeric(20,8),
        ADD COLUMN IF NOT EXISTS high numeric(20,8),
        ADD COLUMN IF NOT EXISTS low numeric(20,8);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.daily_closes
        DROP COLUMN IF EXISTS open,
        DROP COLUMN IF EXISTS high,
        DROP COLUMN IF EXISTS low;
    `);
  }
}
```

- [ ] **Step 2: Register it in the data source**

In `backend/src/database/data-source.ts`, add the import and append to the array (order matters — it runs after the initial schema):

```ts
import { AddDailyCloseOhlc1788307200000 } from './migrations/1788307200000-AddDailyCloseOhlc.js';
```

```ts
  migrations: [InitialSchema1788220800000, AddDailyCloseOhlc1788307200000],
```

- [ ] **Step 3: Add the columns to the entity**

In `backend/src/market-data/daily-close.entity.ts`, after the `adjClose` column, add:

```ts
  /**
   * Intraday range, for candle charts. Nullable: rows backfilled before
   * Phase 4 have no values until the backfill is re-run, and a bar Yahoo
   * returns without them is still worth storing for its close.
   */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  open: number | null;

  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  high: number | null;

  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  low: number | null;
```

Also update the entity's class doc comment, which currently says "Both prices are stored because they answer different questions" — it now describes five.

- [ ] **Step 4: Write the failing test for the adapter**

This file does not exist yet — create it. The sibling specs in `backend/src/market-data/` (`select-price.spec.ts`, `market-data.service.spec.ts`) show the conventions this repo uses for doubles; follow them for how `YahooClient` receives its `yf` dependency.

```ts
import { describe, expect, it } from 'vitest';
import { YahooClient } from './yahoo.client.js';

function clientReturning(quotes: unknown[]): YahooClient {
  // The adapter only ever calls .chart() here; the rest of the Yahoo surface
  // is irrelevant to bar mapping.
  const fake = { chart: async () => ({ quotes }) };
  return new YahooClient(fake as never);
}

describe('dailyBars OHLC mapping', () => {
  it('keeps open, high and low when Yahoo returns them', async () => {
    const client = clientReturning([
      {
        date: '2026-08-28T00:00:00.000Z',
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        adjclose: 11,
      },
    ]);
    const [bar] = await client.dailyBars('AAPL', new Date('2026-08-01'));
    expect(bar).toEqual({
      date: '2026-08-28',
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      adjClose: 11,
    });
  });

  it('stores a bar missing high and low rather than dropping it', async () => {
    const client = clientReturning([
      { date: '2026-08-28T00:00:00.000Z', open: 10, close: 11, adjclose: 11 },
    ]);
    const [bar] = await client.dailyBars('AAPL', new Date('2026-08-01'));
    expect(bar.close).toBe(11);
    expect(bar.high).toBeNull();
    expect(bar.low).toBeNull();
    expect(bar.open).toBe(10);
  });

  it('still drops a bar with no usable close', async () => {
    const client = clientReturning([
      { date: '2026-08-28T00:00:00.000Z', open: 10, high: 12, low: 9 },
    ]);
    expect(await client.dailyBars('AAPL', new Date('2026-08-01'))).toEqual([]);
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run (from `backend/`): `npx vitest run src/market-data/yahoo.client.spec.ts`
Expected: FAIL — the mapper returns no `open`/`high`/`low` keys yet.

- [ ] **Step 6: Keep the OHLC in the adapter**

In `backend/src/market-data/yahoo.client.ts`, widen `RawBar`:

```ts
export interface RawBar {
  date: string; // YYYY-MM-DD
  close: number;
  adjClose: number;
  /** Intraday range. Null when Yahoo omits it for that bar. */
  open: number | null;
  high: number | null;
  low: number | null;
}
```

Then in `dailyBars`, widen the quote type and map the three through. Add a small local helper rather than repeating the guard three times:

```ts
    const quotes = (result?.quotes ?? []) as {
      date: Date | string;
      open?: number | null;
      high?: number | null;
      low?: number | null;
      close?: number | null;
      adjclose?: number | null;
    }[];

    const finite = (n: number | null | undefined): number | null =>
      typeof n === 'number' && Number.isFinite(n) ? n : null;

    return quotes
      .map((q) => {
        const close = q.close;
        if (typeof close !== 'number' || !Number.isFinite(close)) return null;
        return {
          date: new Date(q.date).toISOString().slice(0, 10),
          close,
          // A bar without an adjusted close falls back to the raw one rather
          // than being dropped; the difference only matters across dividends.
          adjClose:
            typeof q.adjclose === 'number' && Number.isFinite(q.adjclose)
              ? q.adjclose
              : close,
          // A bar missing part of its range is still worth its close: the
          // chart skips that candle, the benchmark is unaffected.
          open: finite(q.open),
          high: finite(q.high),
          low: finite(q.low),
        };
      })
      .filter((b): b is RawBar => b !== null);
```

- [ ] **Step 7: Run the test to confirm it passes**

Run: `npx vitest run src/market-data/yahoo.client.spec.ts`
Expected: PASS.

- [ ] **Step 8: Widen the backfill window and persist the new columns**

In `backend/src/market-data/history.service.ts`, replace the runway comment and line:

```ts
    // A few days of runway before the first trade, so the first day of the
    // series has a prior close to compare against.
    const from = new Date(earliest);
    from.setDate(from.getDate() - 7);
```

with:

```ts
    // Runway before the first trade. Seven days was enough for the benchmark
    // series to have a prior close; the trade chart needs about a month of
    // context before an entry, and Yahoo serves daily history indefinitely
    // for free, so this costs nothing but a slightly longer first backfill.
    const from = new Date(earliest);
    from.setDate(from.getDate() - 45);
```

and extend the upsert to carry the new columns:

```ts
        await this.closes.upsert(
          bars.map((b) => ({
            instrumentId: instrument.id,
            date: b.date,
            close: b.close,
            adjClose: b.adjClose,
            open: b.open,
            high: b.high,
            low: b.low,
          })),
          ['instrumentId', 'date'],
        );
```

- [ ] **Step 9: Run the backend suites**

Run (from `backend/`): `npm test` then `npm run test:e2e`
Expected: both PASS. The e2e global setup drops and re-creates `trader_test`, so the new migration runs against an empty database there as part of the run.

- [ ] **Step 10: Apply the migration to the real local database and re-backfill**

Both commands are safe: the migration is `ADD COLUMN IF NOT EXISTS`, and the backfill upserts on `(instrumentId, date)`.

```bash
cd backend && npm run migration:run
curl -s -X POST http://localhost:3000/history/backfill | head -20
```

(The backfill needs the API running. If `npm run dev` is not up, start it from the repo root first — and remember it needs an auth token now, so either use a token from a login or run the backfill before the guard matters by calling it from a logged-in browser session.)

- [ ] **Step 11: Verify the OHLC actually landed**

```bash
psql -d trader -c 'SELECT i.symbol, dc.date, dc.open, dc.high, dc.low, dc.close FROM daily_closes dc JOIN instruments i ON i.id = dc."instrumentId" ORDER BY dc.date DESC LIMIT 5;'
psql -d trader -c 'SELECT count(*) AS bars_without_range FROM daily_closes WHERE high IS NULL OR low IS NULL;'
psql -d trader -c 'SELECT min(date) AS earliest_bar FROM daily_closes;'
```

Expected: the first query shows populated `open`/`high`/`low`; `bars_without_range` is 0 (or a small number if Yahoo genuinely omitted a bar's range); `earliest_bar` is now roughly 45 days before the first transaction rather than 7.

- [ ] **Step 12: Commit**

```bash
git add backend/src/database backend/src/market-data
git commit -m "feat: store daily OHLC and widen the backfill window"
```

---

## Task 2: The trade detail endpoint

**Files:**
- Modify: `backend/src/portfolio/derive-trades.ts`
- Modify: `backend/src/portfolio/derive-trades.spec.ts`
- Create: `backend/src/portfolio/trade-window.ts`
- Create: `backend/src/portfolio/trade-window.spec.ts`
- Modify: `backend/src/portfolio/portfolio.service.ts`
- Modify: `backend/src/portfolio/portfolio.controller.ts`
- Modify: `backend/src/portfolio/portfolio.module.ts`
- Create: `backend/test/trades.e2e-spec.ts`

**Interfaces:**
- Consumes: `RawBar`'s OHLC and the `DailyClose` columns from Task 1.
- Produces: `TradeFill { executedAt: string; side: 'BUY' | 'SELL'; price: number; quantity: number; fee: number }` and `DerivedTrade.fills: TradeFill[]`.
- Produces: `tradeId(symbol: string, enteredAt: Date): string` and `parseTradeId(id: string): { symbol: string; enteredAt: string } | null` from `trade-window.ts`.
- Produces: `windowBounds(enteredAt: Date, exitedAt: Date | null, tradingDays?: number): { fromDate: string; toDate: string | null }` from `trade-window.ts`.
- Produces: `GET /portfolio/trades/:id` returning `{ trade, fills, stopLevels, bars, lastBarDate }`. (`PortfolioController` carries a `portfolio` prefix — see Step 9.)
- Produces: each position in `GET /portfolio` gains `tradeId: string | null`.

- [ ] **Step 1: Write the failing test for the trade id and window helpers**

```ts
// backend/src/portfolio/trade-window.spec.ts
import { describe, expect, it } from 'vitest';
import { parseTradeId, tradeId, windowBounds } from './trade-window.js';

describe('tradeId', () => {
  it('round-trips a symbol and entry timestamp', () => {
    const id = tradeId('AAPL', new Date('2026-08-28T13:30:00.000Z'));
    expect(id).toBe('AAPL:2026-08-28T13:30:00.000Z');
    expect(parseTradeId(id)).toEqual({
      symbol: 'AAPL',
      enteredAt: '2026-08-28T13:30:00.000Z',
    });
  });

  it('rejects a malformed id rather than guessing', () => {
    expect(parseTradeId('AAPL')).toBeNull();
    expect(parseTradeId('')).toBeNull();
    expect(parseTradeId(':2026-08-28T13:30:00.000Z')).toBeNull();
    expect(parseTradeId('AAPL:not-a-date')).toBeNull();
  });

  it('survives a symbol round trip through URL encoding', () => {
    const id = tradeId('BRK.B', new Date('2026-08-28T13:30:00.000Z'));
    expect(parseTradeId(decodeURIComponent(encodeURIComponent(id)))?.symbol).toBe(
      'BRK.B',
    );
  });
});

describe('windowBounds', () => {
  it('pads about a month of trading days either side of a closed trade', () => {
    const { fromDate, toDate } = windowBounds(
      new Date('2026-08-28T13:30:00.000Z'),
      new Date('2026-09-04T13:30:00.000Z'),
    );
    // 21 trading days is ~29-31 calendar days once weekends are included.
    expect(fromDate < '2026-08-01').toBe(true);
    expect(fromDate > '2026-07-20').toBe(true);
    expect(toDate! > '2026-10-01').toBe(true);
    expect(toDate! < '2026-10-10').toBe(true);
  });

  it('leaves an open trade unbounded at the right edge', () => {
    const { toDate } = windowBounds(new Date('2026-08-28T13:30:00.000Z'), null);
    expect(toDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run (from `backend/`): `npx vitest run src/portfolio/trade-window.spec.ts`
Expected: FAIL — `trade-window.ts` does not exist.

- [ ] **Step 3: Write `trade-window.ts`**

```ts
// backend/src/portfolio/trade-window.ts

/**
 * A trade is derived, never stored, so it has no database id. Symbol plus
 * entry timestamp identifies it uniquely: two trades in one symbol cannot
 * overlap, because a trade is the span from flat to flat.
 *
 * This means an id goes stale if the opening transaction is edited — the
 * trade is simply re-derived under a new one. The endpoint 404s rather than
 * rendering an empty chart.
 */
export function tradeId(symbol: string, enteredAt: Date): string {
  return `${symbol}:${enteredAt.toISOString()}`;
}

export function parseTradeId(
  id: string,
): { symbol: string; enteredAt: string } | null {
  // Split on the FIRST colon only: the ISO timestamp contains colons too.
  const separator = id.indexOf(':');
  if (separator <= 0) return null;
  const symbol = id.slice(0, separator);
  const enteredAt = id.slice(separator + 1);
  if (!symbol || Number.isNaN(Date.parse(enteredAt))) return null;
  return { symbol, enteredAt };
}

/** Trading days of context on each side of the trade. About one month. */
const PADDING_TRADING_DAYS = 21;

/** Calendar days needed to span N trading days, weekends included. */
function calendarDaysFor(tradingDays: number): number {
  return Math.ceil((tradingDays / 5) * 7);
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The bar range the chart asks for: padded either side so the setup before
 * the entry and the aftermath of the exit are both visible.
 *
 * `toDate` is null for an open trade — there is no right edge yet, and the
 * query simply takes everything up to the latest bar that exists. No bar is
 * ever invented to fill the padding.
 */
export function windowBounds(
  enteredAt: Date,
  exitedAt: Date | null,
  tradingDays: number = PADDING_TRADING_DAYS,
): { fromDate: string; toDate: string | null } {
  const padding = calendarDaysFor(tradingDays);

  const from = new Date(enteredAt);
  from.setUTCDate(from.getUTCDate() - padding);

  if (exitedAt === null) return { fromDate: toDateString(from), toDate: null };

  const to = new Date(exitedAt);
  to.setUTCDate(to.getUTCDate() + padding);
  return { fromDate: toDateString(from), toDate: toDateString(to) };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/portfolio/trade-window.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add `fills` to the derived trade**

In `backend/src/portfolio/derive-trades.ts`, add the exported type and the field:

```ts
/** One transaction inside a trade, as executed. */
export interface TradeFill {
  executedAt: Date;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
}
```

Add two fields to `DerivedTrade`:

```ts
  /**
   * Every transaction that composed this trade, in execution order. Emitted
   * here rather than reconstructed by the caller: the grouping walk already
   * has exactly these rows, and re-deriving them from a date range would be
   * ambiguous where one trade closes and another opens at the same instant.
   */
  fills: TradeFill[];

  /**
   * The stop tiers recorded on the transaction that opened the trade — the
   * plan as it stood at entry, which is what the chart draws. Carried here
   * for the same reason as `fills`: the walk already holds them.
   */
  openingStops: StopLevelInput[];
```

Then in `deriveTrades`, carry both through the existing walk. Add to the `OpenTrade` interface:

```ts
  fills: TradeFill[];
  openingStops: StopLevelInput[];
```

Where an `OpenTrade` is created (the flat → open transition), initialise
`fills: []` and `openingStops: t.stopLevels ?? []` — the opening transaction's
tiers, captured once and not overwritten by later scale-ins, because the chart
draws the plan as it stood at entry.

For every transaction applied to an open trade, including the opening one,
push its fill:

```ts
      open.fills.push({
        executedAt: t.executedAt,
        side: t.side,
        price: t.price,
        quantity: t.quantity,
        fee: t.fee,
      });
```

and pass `fills: open.fills` and `openingStops: open.openingStops` through when
the completed trade is pushed to the result. Keep the existing rounding, P&L
and risk logic untouched — this task adds outputs, it does not change any
number `deriveTrades` already produces.

- [ ] **Step 6: Add a fixture test for `fills`**

Add to `backend/src/portfolio/derive-trades.spec.ts`, matching the file's existing fixture style:

```ts
  it('emits every fill of a scaled trade, in execution order', () => {
    const [trade] = deriveTrades([
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 100,
        fee: 4,
        executedAt: new Date('2026-08-28T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 110,
        fee: 4,
        executedAt: new Date('2026-08-29T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'SELL',
        quantity: 20,
        price: 120,
        fee: 4,
        executedAt: new Date('2026-09-01T13:30:00.000Z'),
      },
    ]);

    expect(trade.fills).toHaveLength(3);
    expect(trade.fills.map((f) => f.side)).toEqual(['BUY', 'BUY', 'SELL']);
    expect(trade.fills[1].price).toBe(110);
    expect(trade.fills[2].quantity).toBe(20);
  });

  it('keeps a re-entry’s fills out of the first trade', () => {
    const trades = deriveTrades([
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 100,
        fee: 4,
        executedAt: new Date('2026-08-28T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'SELL',
        quantity: 10,
        price: 110,
        fee: 4,
        executedAt: new Date('2026-08-29T13:30:00.000Z'),
      },
      {
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 5,
        price: 105,
        fee: 4,
        executedAt: new Date('2026-08-31T13:30:00.000Z'),
      },
    ]);

    expect(trades).toHaveLength(2);
    expect(trades[0].fills).toHaveLength(2);
    expect(trades[1].fills).toHaveLength(1);
  });
```

Run: `npx vitest run src/portfolio/derive-trades.spec.ts`
Expected: PASS, including the two new cases and every pre-existing one.

- [ ] **Step 7: Extract the trade assembly and add the detail method**

In `backend/src/portfolio/portfolio.service.ts`, the body of `getStats()` currently loads transactions, instruments and stop levels, builds `levelsByTxn`, and calls `deriveTrades(...)`. Extract everything up to and including the `deriveTrades(...)` call into a private method, and have `getStats()` call it:

```ts
  /**
   * Every round trip, with the stop plan recorded at entry attached. Shared
   * by the stats summary and the trade detail screen so the two can never
   * disagree about what a trade is.
   */
  private async deriveAllTrades(): Promise<DerivedTrade[]> {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, instrumentRows, levelRows] = await Promise.all([
      this.txns.find({ where: { userId: user.id } }),
      this.instruments.find(),
      this.stopLevels.find(),
    ]);
    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));

    const levelsByTxn = new Map<string, StopLevel[]>();
    for (const l of levelRows) {
      levelsByTxn.set(l.transactionId, [
        ...(levelsByTxn.get(l.transactionId) ?? []),
        l,
      ]);
    }

    return deriveTrades(
      txnRows.map((t) => ({
        symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        executedAt: t.executedAt,
        stopLevels: (levelsByTxn.get(t.id) ?? [])
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((l) => ({
            kind: l.kind,
            price: l.price,
            trailPercent: l.trailPercent,
            quantity: l.quantity,
          })),
        plannedTarget: t.plannedTarget,
      })),
    );
  }

  async getStats() {
    const trades = await this.deriveAllTrades();
    return {
      ...summariseTrades(trades),
      // Fills are for the detail screen; sending them for every trade would
      // bloat a response the list view re-fetches often.
      trades: trades.map(({ fills, ...rest }) => rest),
    };
  }
```

Then add the detail method. It needs the `DailyClose` repository injected — check the constructor and add `@InjectRepository(DailyClose)` if it is not already there, plus `DailyClose` in `portfolio.module.ts`'s `TypeOrmModule.forFeature([...])`.

```ts
  /**
   * One trade with everything the chart draws: its fills, the stop tiers
   * recorded at entry, and the daily bars either side of it.
   */
  async getTrade(id: string) {
    const parsed = parseTradeId(id);
    if (!parsed) throw new NotFoundException('Unknown trade');

    const trades = await this.deriveAllTrades();
    const trade = trades.find(
      (t) =>
        t.symbol === parsed.symbol &&
        t.enteredAt.toISOString() === parsed.enteredAt,
    );
    // A stale link after the opening transaction was edited lands here. The
    // trade still exists under a new id; this one no longer identifies it.
    if (!trade) throw new NotFoundException('Unknown trade');

    const instrument = await this.instruments.findOne({
      where: { symbol: trade.symbol },
    });
    if (!instrument) throw new NotFoundException('Unknown trade');

    const { fromDate, toDate } = windowBounds(trade.enteredAt, trade.exitedAt);
    const bars = await this.closes.find({
      where: {
        instrumentId: instrument.id,
        date: toDate ? Between(fromDate, toDate) : MoreThanOrEqual(fromDate),
      },
      order: { date: 'ASC' },
    });

    const { fills, openingStops, ...summary } = trade;
    return {
      trade: summary,
      fills,
      stopLevels: openingStops,
      bars: bars.map((b) => ({
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
      // The chart says what it actually has rather than implying the window
      // is complete: the backfill is manual, so bars can end before the trade
      // does.
      lastBarDate: bars.at(-1)?.date ?? null,
    };
  }
```

`openingStops` comes straight off the trade, added in Step 5 — no separate lookup. `getStats()` strips it alongside `fills`, so update that map to `trades.map(({ fills, openingStops, ...rest }) => rest)`.

`Between` and `MoreThanOrEqual` are TypeORM operators; add them to the existing `typeorm` import in this file. `NotFoundException` comes from `@nestjs/common`.

- [ ] **Step 8: Add `tradeId` to each position**

In whatever method builds the `/portfolio` response, after positions are computed, look up the open trade per symbol and attach its id, so the Portfolio tab can link straight to the chart:

```ts
    const openTradeBySymbol = new Map(
      (await this.deriveAllTrades())
        .filter((t) => t.isOpen)
        .map((t) => [t.symbol, tradeId(t.symbol, t.enteredAt)]),
    );
```

and set `tradeId: openTradeBySymbol.get(p.symbol) ?? null` on each position in the response.

- [ ] **Step 9: Add the controller route**

`PortfolioController` is bound to `@Controller('portfolio')`, so the final path is **`/portfolio/trades/:id`** — namespaced with the rest of the portfolio surface, and no second controller needed. Add alongside the existing `@Get('stats')`:

```ts
  /**
   * The id is a `symbol:ISO-timestamp` composite, URL-encoded by the client.
   * Nest gives back the decoded segment, so no manual decode here.
   */
  @Get('trades/:id')
  getTrade(@Param('id') id: string) {
    return this.portfolio.getTrade(id);
  }
```

Add `Param` to the existing `@nestjs/common` import in this file.

- [ ] **Step 10: Write the e2e test**

```ts
// backend/test/trades.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { http, login } from './http.js';

describe('Trades (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('404s an unparseable trade id', async () => {
    await http(app, token).get('/portfolio/trades/nonsense').expect(404);
  });

  it('404s a well-formed id that matches no trade', async () => {
    await http(app, token)
      .get(
        `/portfolio/trades/${encodeURIComponent('ZZZZ:2026-08-28T13:30:00.000Z')}`,
      )
      .expect(404);
  });

  it('requires a token', async () => {
    await request(app.getHttpServer())
      .get('/portfolio/trades/anything')
      .expect(401);
  });
});
```

Seed a trade through the journal API the way `backend/test/journal.e2e-spec.ts` already does, then assert `GET /portfolio/trades/:id` returns its `trade`, `fills` (one per transaction), `stopLevels`, `bars` and `lastBarDate`. Follow that file's existing seeding helpers rather than writing rows directly — transactions are only ever written through a journal entry.

- [ ] **Step 11: Run the suites**

Run (from `backend/`): `npm test` then `npm run test:e2e`
Expected: both PASS.

- [ ] **Step 12: Verify by hand against the real database**

```bash
# Grab a real trade id from the stats endpoint, then fetch its detail.
curl -s -H "Authorization: Bearer <token>" http://localhost:3000/portfolio/stats \
  | python3 -c "import json,sys; t=json.load(sys.stdin)['trades'][0]; print(t['symbol'], t['enteredAt'])"
```

Then request that trade and confirm the response carries bars with populated `open`/`high`/`low`, one entry in `fills` per transaction, and a `lastBarDate`.

- [ ] **Step 13: Commit**

```bash
git add backend/src/portfolio backend/test/trades.e2e-spec.ts
git commit -m "feat: trade detail endpoint with fills, stops and daily bars"
```

---

## Task 3: The chart and the detail screen

**Files:**
- Create: `frontend/src/lib/candleScale.ts`
- Create: `frontend/src/lib/candleScale.spec.ts`
- Create: `frontend/src/components/TradeChart.tsx`
- Create: `frontend/src/routes/TradeDetail.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/TradeCard.tsx`
- Modify: `frontend/src/routes/Dashboard.tsx`

**Interfaces:**
- Consumes: `GET /portfolio/trades/:id` from Task 2, and `tradeId` on each position from `GET /portfolio`.
- Produces: `scaleBars(bars, width, height, padding)` from `candleScale.ts` — pure geometry, no React.

- [ ] **Step 1: Write the failing test for the chart geometry**

The scaling is the part worth testing: everything else is SVG markup.

```ts
// frontend/src/lib/candleScale.spec.ts
import { describe, expect, it } from 'vitest';
import { priceRange, scaleBars, type Bar } from './candleScale';

const bars: Bar[] = [
  { date: '2026-08-27', open: 10, high: 12, low: 9, close: 11 },
  { date: '2026-08-28', open: 11, high: 15, low: 10, close: 14 },
];

describe('priceRange', () => {
  it('spans the lowest low to the highest high', () => {
    expect(priceRange(bars, [])).toEqual({ min: 9, max: 15 });
  });

  it('widens to include an off-chart stop level', () => {
    expect(priceRange(bars, [8])).toEqual({ min: 8, max: 15 });
  });

  it('ignores a bar with no range rather than collapsing the scale', () => {
    const withGap: Bar[] = [
      ...bars,
      { date: '2026-08-29', open: null, high: null, low: null, close: 13 },
    ];
    expect(priceRange(withGap, [])).toEqual({ min: 9, max: 15 });
  });

  it('gives a flat series breathing room instead of a zero-height plot', () => {
    const flat: Bar[] = [
      { date: '2026-08-27', open: 10, high: 10, low: 10, close: 10 },
    ];
    const { min, max } = priceRange(flat, []);
    expect(max).toBeGreaterThan(min);
  });
});

describe('scaleBars', () => {
  it('places the first bar at the left and the last at the right', () => {
    const scaled = scaleBars(bars, { width: 100, height: 50 });
    expect(scaled[0].x).toBeLessThan(scaled[1].x);
    expect(scaled[1].x).toBeLessThanOrEqual(100);
  });

  it('puts a higher price higher on screen (smaller y)', () => {
    const scaled = scaleBars(bars, { width: 100, height: 50 });
    expect(scaled[1].highY).toBeLessThan(scaled[0].lowY);
  });

  it('marks a bar with no range so the caller can skip its candle', () => {
    const withGap: Bar[] = [
      { date: '2026-08-29', open: null, high: null, low: null, close: 13 },
    ];
    expect(scaleBars(withGap, { width: 100, height: 50 })[0].hasRange).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run (from `frontend/`): `npx vitest run src/lib/candleScale.spec.ts`
Expected: FAIL — `./candleScale` does not exist.

- [ ] **Step 3: Write `candleScale.ts`**

```ts
// frontend/src/lib/candleScale.ts

/** A daily bar as the API returns it. Only `close` is guaranteed. */
export interface Bar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

export interface ScaledBar {
  date: string;
  x: number;
  /** Top and bottom of the candle body, in viewBox units. */
  bodyTop: number;
  bodyBottom: number;
  highY: number;
  lowY: number;
  closeY: number;
  /** False when the bar lacks open/high/low — draw a dot, not a candle. */
  hasRange: boolean;
  isUp: boolean;
}

export interface Dimensions {
  width: number;
  height: number;
  /** Stop levels widen the scale so a stop below the low is still on screen. */
  stopPrices?: number[];
}

/** Right padding leaves room for the stop-level price labels. */
const PAD = { top: 8, right: 44, bottom: 16, left: 8 };

export function priceRange(
  bars: Bar[],
  extraPrices: number[],
): { min: number; max: number } {
  const values: number[] = [];
  for (const b of bars) {
    values.push(b.close);
    if (b.high !== null) values.push(b.high);
    if (b.low !== null) values.push(b.low);
  }
  values.push(...extraPrices);
  if (values.length === 0) return { min: 0, max: 1 };

  let min = Math.min(...values);
  let max = Math.max(...values);
  // A flat series would collapse to a zero-height plot; give it room.
  if (max - min < 1e-9) {
    const pad = Math.abs(max) * 0.01 || 0.02;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

/**
 * The scale both the candles and the annotations share. Exported so stop
 * lines and fill markers land on exactly the same axis as the bars.
 */
export function makeScale(bars: Bar[], dims: Dimensions) {
  const { min, max } = priceRange(bars, dims.stopPrices ?? []);
  const span = max - min;
  const plotWidth = dims.width - PAD.left - PAD.right;
  const plotHeight = dims.height - PAD.top - PAD.bottom;
  const step = bars.length > 1 ? plotWidth / (bars.length - 1) : 0;

  return {
    min,
    max,
    y: (price: number) => PAD.top + (1 - (price - min) / span) * plotHeight,
    x: (index: number) => PAD.left + index * step,
    /** Candle width, leaving a gap between neighbours. */
    barWidth: Math.max(1, step * 0.6),
    plotRight: dims.width - PAD.right,
  };
}

export function scaleBars(bars: Bar[], dims: Dimensions): ScaledBar[] {
  const scale = makeScale(bars, dims);

  return bars.map((b, i) => {
    const hasRange = b.open !== null && b.high !== null && b.low !== null;
    const closeY = scale.y(b.close);
    if (!hasRange) {
      return {
        date: b.date,
        x: scale.x(i),
        bodyTop: closeY,
        bodyBottom: closeY,
        highY: closeY,
        lowY: closeY,
        closeY,
        hasRange: false,
        isUp: true,
      };
    }
    const open = b.open as number;
    return {
      date: b.date,
      x: scale.x(i),
      bodyTop: scale.y(Math.max(open, b.close)),
      bodyBottom: scale.y(Math.min(open, b.close)),
      highY: scale.y(b.high as number),
      lowY: scale.y(b.low as number),
      closeY,
      hasRange: true,
      isUp: b.close >= open,
    };
  });
}

/**
 * Which bar a fill belongs to. Fills carry a full timestamp, bars a date, so
 * the comparison is on the date part. Returns -1 when the fill falls outside
 * the window or on a day with no bar — the caller skips that marker rather
 * than drawing it at a guessed position.
 */
export function indexForDate(bars: Bar[], isoTimestamp: string): number {
  const day = isoTimestamp.slice(0, 10);
  return bars.findIndex((b) => b.date === day);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/candleScale.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write `TradeChart.tsx`**

```tsx
// frontend/src/components/TradeChart.tsx
import {
  indexForDate,
  makeScale,
  scaleBars,
  type Bar,
} from '../lib/candleScale';

export interface Fill {
  executedAt: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  fee: number;
}

export interface StopLevel {
  kind: 'FIXED' | 'TRAILING';
  price: number | null;
  trailPercent: number | null;
  quantity: number;
}

const W = 320;
const H = 190;

/**
 * The same palette the rest of the app uses: up/down for price, accent for
 * the owner's own actions, so a fill never reads as a price move. Validated
 * against the dark chart surface in BenchmarkChart.tsx — do not substitute
 * a hue without re-running that check.
 */
const UP = '#22c55e';
const DOWN = '#f43f5e';
const ACCENT = '#2dd4bf';
const MUTED = '#7d8da6';

export function TradeChart({
  bars,
  fills,
  stopLevels,
}: {
  bars: Bar[];
  fills: Fill[];
  stopLevels: StopLevel[];
}) {
  if (bars.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface-1 p-3 text-xs text-muted">
        No price history for this window yet — run a backfill.
      </p>
    );
  }

  // A trailing tier has no fixed level to draw; it is listed in the header
  // instead of being drawn at a guessed price.
  const drawableStops = stopLevels.filter(
    (s): s is StopLevel & { price: number } =>
      s.kind === 'FIXED' && s.price !== null,
  );

  const dims = {
    width: W,
    height: H,
    stopPrices: drawableStops.map((s) => s.price),
  };
  const scale = makeScale(bars, dims);
  const scaled = scaleBars(bars, dims);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Daily candles for this trade, with your fills and stop levels"
    >
      {scaled.map((b) =>
        b.hasRange ? (
          <g key={b.date}>
            <line
              x1={b.x}
              x2={b.x}
              y1={b.highY}
              y2={b.lowY}
              stroke={b.isUp ? UP : DOWN}
              strokeWidth="1"
            />
            <rect
              x={b.x - scale.barWidth / 2}
              y={b.bodyTop}
              width={scale.barWidth}
              // A doji would otherwise be invisible.
              height={Math.max(1, b.bodyBottom - b.bodyTop)}
              fill={b.isUp ? UP : DOWN}
            />
          </g>
        ) : (
          // A bar Yahoo returned without its range: show the close, don't
          // invent a candle.
          <circle key={b.date} cx={b.x} cy={b.closeY} r="1.5" fill={MUTED} />
        ),
      )}

      {drawableStops.map((s, i) => (
        <g key={`stop-${i}`}>
          <line
            x1={0}
            x2={scale.plotRight}
            y1={scale.y(s.price)}
            y2={scale.y(s.price)}
            stroke={MUTED}
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text
            x={scale.plotRight + 4}
            y={scale.y(s.price) + 3}
            fill={MUTED}
            fontSize="9"
          >
            {s.price}
          </text>
        </g>
      ))}

      {fills.map((f, i) => {
        const index = indexForDate(bars, f.executedAt);
        if (index === -1) return null;
        const x = scale.x(index);
        const y = scale.y(f.price);
        // Buys point up, sells point down; both sit ON the fill price.
        const points =
          f.side === 'BUY'
            ? `${x},${y - 5} ${x - 4},${y + 2} ${x + 4},${y + 2}`
            : `${x},${y + 5} ${x - 4},${y - 2} ${x + 4},${y - 2}`;
        return (
          <polygon
            key={`fill-${i}`}
            points={points}
            fill={ACCENT}
            stroke="#0a0e17"
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
}
```

No target line and no journal note — decision #6.

- [ ] **Step 6: Write `TradeDetail.tsx`**

```tsx
// frontend/src/routes/TradeDetail.tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Money } from '../components/Money';
import { signClass } from '../components/format';
import {
  TradeChart,
  type Fill,
  type StopLevel,
} from '../components/TradeChart';
import type { Bar } from '../lib/candleScale';
import type { Trade } from '../components/TradeCard';

interface TradeDetailResponse {
  trade: Trade;
  fills: Fill[];
  stopLevels: StopLevel[];
  bars: Bar[];
  lastBarDate: string | null;
}

export function TradeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['trade', id],
    queryFn: () =>
      api<TradeDetailResponse>(`/portfolio/trades/${encodeURIComponent(id)}`),
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  // A trade id goes stale when its opening transaction is edited — the trade
  // still exists, under a different id. Say so rather than drawing nothing.
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          This trade no longer exists — it may have been edited since you opened
          it.
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-accent"
        >
          Back
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-down">Couldn’t load this trade.</p>;

  const { trade, fills, stopLevels, bars, lastBarDate } = data;
  const trailing = stopLevels.filter((s) => s.kind === 'TRAILING');

  // The backfill is manual, so the window can end before the trade does.
  // Never present a truncated chart as the whole story.
  const staleThrough =
    lastBarDate !== null &&
    ((trade.exitedAt !== null && lastBarDate < trade.exitedAt.slice(0, 10)) ||
      (trade.exitedAt === null &&
        lastBarDate < new Date().toISOString().slice(0, 10)))
      ? lastBarDate
      : null;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-sm text-muted"
      >
        ← Back
      </button>

      <header className="space-y-1">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-text">{trade.symbol}</h1>
          <span className="text-xs text-muted">
            {trade.direction}
            {trade.isOpen ? ' · open' : ''}
          </span>
        </div>
        <div className={`text-2xl font-semibold ${signClass(trade.realizedPnl)}`}>
          <Money value={trade.realizedPnl} />
        </div>
        <p className="text-xs text-muted">
          {trade.rMultiple !== null && `${trade.rMultiple.toFixed(2)}R · `}
          entry <Money value={trade.avgEntry} />
          {trade.avgExit !== null && (
            <>
              {' '}
              · exit <Money value={trade.avgExit} />
            </>
          )}
          {trade.holdingDays !== null && ` · held ${trade.holdingDays}d`}
        </p>
      </header>

      <TradeChart bars={bars} fills={fills} stopLevels={stopLevels} />

      {trailing.length > 0 && (
        <p className="text-xs text-muted">
          {trailing.length === 1 ? 'A trailing stop' : 'Trailing stops'} of{' '}
          {trailing.map((s) => `${s.trailPercent}%`).join(', ')} — not drawn,
          because the level moved with price.
        </p>
      )}

      {staleThrough && (
        <p className="text-xs text-muted">
          Price history only runs to {staleThrough}. The backfill is manual —
          run it to see the rest of this trade.
        </p>
      )}
    </div>
  );
}
```

Check `Money`'s actual prop name in `frontend/src/components/Money.tsx` before writing this — if it differs from `value`, match the existing component rather than changing it.

- [ ] **Step 7: Add the route**

In `frontend/src/main.tsx`, inside the `AppShell` route group so the nav and connection banner stay:

```tsx
            <Route path="trades/:id" element={<TradeDetail />} />
```

with the matching import. Note it is nested under `AppShell`, unlike `/login`.

- [ ] **Step 8: Make the Journal trade list tappable**

In `frontend/src/components/TradeCard.tsx`, wrap the row in a `<Link>` to `` `/trades/${encodeURIComponent(`${trade.symbol}:${trade.enteredAt}`)}` ``. Keep the existing markup and classes; add only the link, a `hover:`/`active:` affordance consistent with the app, and enough tap target for a thumb. `Journal.tsx` needs no change — it already renders `TradeCard` per trade.

- [ ] **Step 9: Make Portfolio positions tappable**

In `frontend/src/routes/Dashboard.tsx`, `PositionRow` gains the same treatment, linking to `` `/trades/${encodeURIComponent(p.tradeId)}` `` when `p.tradeId` is non-null, and rendering exactly as it does today when it is null (a position with no open trade — e.g. a seeded holding whose transactions have been edited away — must not become a dead link).

- [ ] **Step 10: Run the frontend suite and typecheck**

Run (from `frontend/`): `npm test` then `npx tsc -b`
Expected: PASS and clean.

- [ ] **Step 11: Phone checkpoint**

Per `working-agreement.md`, this is the real gate — a clean typecheck proves very little about an SVG on a small screen.

1. `npm run dev` from the repo root.
2. On the phone, open Journal → Trades, tap a closed trade.
3. Check: candles render and are legible at phone width; your fill markers sit at the right dates and prices; the stop line(s) are where you set them; the header numbers match the card you tapped from.
4. Go back, open the Portfolio tab, tap an open position, and confirm its chart renders with no exit marker.
5. Confirm the stale-data line appears if your last backfill predates a recent trade.

**STOP — do not commit until this checkpoint is confirmed on the phone.**

- [ ] **Step 12: Commit**

```bash
git add frontend/src
git commit -m "feat: trade replay chart and detail screen"
```

---

## After the plan

Update `CLAUDE.md`'s phase status: Phase 4 (trade replay) complete, and add a line to the documentation map for the Phase 4 spec and this plan. Record any deviations hit during execution in this file as they happen, per the project's convention.
