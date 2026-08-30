# Trader Phase 3 — "Vs the Market" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One chart, three lines, over time: your portfolio versus the S&P 500 and the Nasdaq — the third pillar of the original brief.

**Architecture:** A `daily_closes` table backfilled from Yahoo, and a pure module that walks day by day building a portfolio valuation series, converts it to time-weighted returns, and rebases all three series to zero at the start of the selected range. The chart is the only new screen.

**Tech Stack:** Unchanged. See `CLAUDE.md`.

---

## Scope

**Phase 3 delivers:**

- `daily_closes` backfill for every held instrument plus `SPY` and `QQQ`
- A daily portfolio valuation series (positions priced at each day's close, plus cash)
- Time-weighted return, so deposits never register as gains
- The three-line percentage chart with a range selector
- Delta chips: how far ahead or behind each index you are

**Phase 3 does NOT deliver:** trade replay. It shares this phase's daily price history and is the natural next step, but the benchmark is the thing the owner asked for and shipping it alone keeps the slice small.

## Decisions

| Decision | Rationale |
|---|---|
| **History starts at the seed date (28 Aug 2026)** | Owner's choice. Every point is real. Backdating would draw a curve for share counts that were not held then. |
| **Benchmarks use `adjclose`; positions use `close`** | Adjusted closes fold in dividends. The portfolio's own dividends are tracked as cash income, so a price-only benchmark would understate the index by roughly 1.2%/yr on SPY and quietly flatter the owner. Position *valuation* must use raw `close` — adjusted prices are retroactively revised and do not reflect what the account was actually worth. |
| **Time-weighted return, not simple percent change** | A deposit must never look like a gain. This is invariant #3 in `CLAUDE.md` and the whole reason buys and sells are not cash flows. |
| **The first day is the baseline; returns accrue from day two** | On the seed date the entire opening capital arrives as an external flow against a prior value of zero — a mathematically undefined return. The series starts at 0% there by definition. |
| **Dividends and charges are internal** | Both change cash without being contributions, so neither appears in the flow term. A dividend correctly shows up as portfolio return, which is what it is. |
| **Chart is on the Portfolio tab** | It answers "how am I doing", which is that screen's question. The journal answers "what did I do". |

## Test checkpoints

| After Task | You can test |
|---|---|
| 3 | Price history backfilled — a debug endpoint shows real closes for your tickers |
| 5 | The performance series as JSON: your daily values and returns |
| 7 | The chart: you vs S&P vs Nasdaq |

## File structure

```
backend/src/
  market-data/
    daily-close.entity.ts     NEW  one row per instrument per day
    history.service.ts        NEW  backfill + read
    yahoo.client.ts           MODIFY  add dailyBars()
  performance/
    series.ts                 NEW  PURE. valuation -> TWR -> rebased series
    series.spec.ts            NEW  the highest-risk file in this phase
    performance.service.ts    NEW  loads rows, calls series.ts
    performance.controller.ts NEW  GET /performance
    performance.module.ts     NEW
frontend/src/
  components/
    BenchmarkChart.tsx        NEW
  routes/Dashboard.tsx        MODIFY  render the chart
```

---

## Task 1: Daily close entity

**Files:**
- Create: `backend/src/market-data/daily-close.entity.ts`

- [ ] **Step 1: Write the entity**

```ts
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/**
 * One bar per instrument per trading day.
 *
 * Both prices are stored because they answer different questions. `close` is
 * what the position was actually worth that day. `adjClose` is retroactively
 * restated for dividends and splits, which is what a fair benchmark return
 * needs — an index compared on price alone loses its dividend yield and
 * flatters whoever it is measured against.
 */
@Entity('daily_closes')
@Unique(['instrumentId', 'date'])
export class DailyClose {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  instrumentId: string;

  /** Trading day as YYYY-MM-DD. A date, not a timestamp: bars are daily. */
  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column('numeric', { precision: 20, scale: 8, transformer: numericTransformer })
  close: number;

  @Column('numeric', { precision: 20, scale: 8, transformer: numericTransformer })
  adjClose: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build --prefix backend`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: daily close entity"
```

---

## Task 2: Yahoo daily bars

**Files:**
- Modify: `backend/src/market-data/yahoo.client.ts`

- [ ] **Step 1: Add the method**

Add to `RawQuote`'s file, alongside the existing methods:

```ts
export interface RawBar {
  date: string; // YYYY-MM-DD
  close: number;
  adjClose: number;
}
```

and inside `YahooClient`:

```ts
  /**
   * Daily bars from `from` to today. Yahoo's chart endpoint takes ONE symbol
   * per call — arrays are rejected — so callers loop.
   */
  async dailyBars(symbol: string, from: Date): Promise<RawBar[]> {
    const result = await this.yf.chart(symbol, {
      period1: from,
      period2: new Date(),
      interval: '1d',
    });
    const quotes = (result?.quotes ?? []) as {
      date: Date | string;
      close?: number | null;
      adjclose?: number | null;
    }[];

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
        };
      })
      .filter((b): b is RawBar => b !== null);
  }
```

- [ ] **Step 2: Verify against the live API**

```bash
cd /Users/dvir/claude/trader/backend && cat > ./probe.tmp.mjs <<'EOF'
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const r = await yf.chart('SPY', { period1: new Date('2026-08-01'), interval: '1d' });
console.log('bars:', r.quotes.length, '| last:', r.quotes.at(-1).date, r.quotes.at(-1).close);
EOF
node ./probe.tmp.mjs; rm -f ./probe.tmp.mjs
```

Expected: a bar count and a recent close.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: daily bars from yahoo"
```

---

## Task 3: History backfill

**Files:**
- Create: `backend/src/market-data/history.service.ts`
- Modify: `backend/src/market-data/market-data.module.ts`
- Create: `backend/test/history.e2e-spec.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/history.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('History (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE stop_levels, transactions, cash_flows, dividends, journal_entries, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('backfills closes for held instruments and both benchmarks', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-08-03',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/history/backfill')
      .expect(201);

    // NVDA plus the two benchmarks.
    expect(res.body.symbols).toEqual(
      expect.arrayContaining(['NVDA', 'SPY', 'QQQ']),
    );
    expect(res.body.barsWritten).toBeGreaterThan(0);

    const rows = await dataSource.query(
      "SELECT COUNT(*)::int AS n FROM daily_closes",
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('is idempotent — running twice does not duplicate bars', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-08-03',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    await request(app.getHttpServer()).post('/history/backfill').expect(201);
    const first = await dataSource.query(
      'SELECT COUNT(*)::int AS n FROM daily_closes',
    );
    await request(app.getHttpServer()).post('/history/backfill').expect(201);
    const second = await dataSource.query(
      'SELECT COUNT(*)::int AS n FROM daily_closes',
    );

    expect(second[0].n).toBe(first[0].n);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e --prefix backend -- history`
Expected: FAIL — 404 on `/history/backfill`.

- [ ] **Step 3: Write the service**

Create `backend/src/market-data/history.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { YahooClient } from './yahoo.client.js';
import { InstrumentsService } from '../instruments/instruments.service.js';

export const BENCHMARKS = ['SPY', 'QQQ'] as const;

@Injectable()
export class HistoryService {
  private readonly log = new Logger(HistoryService.name);

  constructor(
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    private readonly instrumentsService: InstrumentsService,
    private readonly yahoo: YahooClient,
  ) {}

  /**
   * Fetches daily bars for everything ever traded, plus the benchmarks, from
   * the first transaction onward. Safe to run repeatedly: bars are upserted on
   * (instrument, date), so a re-run refreshes rather than duplicates.
   */
  async backfill(): Promise<{ symbols: string[]; barsWritten: number }> {
    const [txnRows, instrumentRows] = await Promise.all([
      this.txns.find(),
      this.instruments.find(),
    ]);

    const earliest = txnRows.reduce<Date | null>(
      (min, t) => (min === null || t.executedAt < min ? t.executedAt : min),
      null,
    );
    if (earliest === null) return { symbols: [], barsWritten: 0 };

    // A few days of runway before the first trade, so the first day of the
    // series has a prior close to compare against.
    const from = new Date(earliest);
    from.setDate(from.getDate() - 7);

    const held = new Set(
      txnRows
        .map((t) => instrumentRows.find((i) => i.id === t.instrumentId)?.symbol)
        .filter((s): s is string => Boolean(s)),
    );
    for (const b of BENCHMARKS) held.add(b);

    let barsWritten = 0;
    const symbols: string[] = [];

    for (const symbol of held) {
      const instrument = await this.instrumentsService.findOrCreate(symbol);
      if (BENCHMARKS.includes(symbol as (typeof BENCHMARKS)[number])) {
        // Marked so benchmarks never appear as holdings.
        if (!instrument.isBenchmark) {
          instrument.isBenchmark = true;
          await this.instruments.save(instrument);
        }
      }

      try {
        const bars = await this.yahoo.dailyBars(symbol, from);
        if (bars.length === 0) continue;
        await this.closes.upsert(
          bars.map((b) => ({
            instrumentId: instrument.id,
            date: b.date,
            close: b.close,
            adjClose: b.adjClose,
          })),
          ['instrumentId', 'date'],
        );
        barsWritten += bars.length;
        symbols.push(symbol);
      } catch (err) {
        // One bad ticker must not abandon the whole backfill; the series
        // simply carries that instrument's last known price forward.
        this.log.warn(`daily bars failed for ${symbol}: ${String(err)}`);
      }
    }

    return { symbols, barsWritten };
  }
}
```

- [ ] **Step 4: Add a controller and register it**

Create `backend/src/market-data/history.controller.ts`:

```ts
import { Controller, Post } from '@nestjs/common';
import { HistoryService } from './history.service.js';

@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Post('backfill')
  backfill() {
    return this.history.backfill();
  }
}
```

In `market-data.module.ts` add `TypeOrmModule.forFeature([DailyClose, Instrument, Transaction])`, import `InstrumentsModule`, and register `HistoryService` + `HistoryController`, exporting `HistoryService`.

**Note:** `InstrumentsModule` already imports `MarketDataModule`. To avoid a circular import, use `forwardRef(() => InstrumentsModule)` here and `forwardRef(() => MarketDataModule)` there, with `@Inject(forwardRef(...))` on the injected service.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:e2e --prefix backend -- history`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: daily price history backfill"
```

### ✋ TEST CHECKPOINT 1

```bash
curl -X POST http://localhost:3000/history/backfill
psql -d trader -c "SELECT i.symbol, COUNT(*), MIN(d.date), MAX(d.date) FROM daily_closes d JOIN instruments i ON i.id=d.\"instrumentId\" GROUP BY i.symbol ORDER BY i.symbol;"
```

Expected: a row per ticker plus SPY and QQQ, with plausible date ranges. **Check a close against your broker for one ticker** — if the history is wrong, every number downstream is too.

---

## Task 4: The series engine

The highest-risk file in this phase. Every number on the chart comes from here.

**Files:**
- Create: `backend/src/performance/series.ts`
- Create: `backend/src/performance/series.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/performance/series.spec.ts`:

```ts
import {
  buildValuationSeries,
  toCumulativeReturns,
  rebase,
  type DayInput,
} from './series.js';

const day = (
  date: string,
  value: number,
  flow = 0,
): DayInput => ({ date, value, externalFlow: flow });

describe('toCumulativeReturns', () => {
  it('is empty for no days', () => {
    expect(toCumulativeReturns([])).toEqual([]);
  });

  it('starts the first day at zero', () => {
    // The opening capital arrives against a prior value of zero, which has no
    // defined return. The first day is the baseline by definition.
    const r = toCumulativeReturns([day('2026-08-28', 10000, 10000)]);
    expect(r).toEqual([{ date: '2026-08-28', cumulative: 0 }]);
  });

  it('computes a simple gain', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-31', 11000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0.1, 10);
  });

  it('chains two days multiplicatively', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 100, 100),
      day('2026-08-29', 110),
      day('2026-08-30', 121),
    ]);
    expect(r[2].cumulative).toBeCloseTo(0.21, 10);
  });

  it('does not count a deposit as a gain', () => {
    // The single most important property in this file: adding money must not
    // register as performance.
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-29', 20000, 10000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0, 10);
  });

  it('does not count a withdrawal as a loss', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-29', 5000, -5000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0, 10);
  });

  it('separates a deposit from real performance on the same day', () => {
    // Started at 10k, deposited 5k, ended at 16k => the 1k is the return.
    const r = toCumulativeReturns([
      day('2026-08-28', 10000, 10000),
      day('2026-08-29', 16000, 5000),
    ]);
    expect(r[1].cumulative).toBeCloseTo(0.1, 10);
  });

  it('compounds a loss then a gain correctly', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 100, 100),
      day('2026-08-29', 50),
      day('2026-08-30', 100),
    ]);
    // -50% then +100% returns to flat, not to +50%.
    expect(r[2].cumulative).toBeCloseTo(0, 10);
  });

  it('holds flat rather than dividing by a zero prior value', () => {
    const r = toCumulativeReturns([
      day('2026-08-28', 100, 100),
      day('2026-08-29', 0),
      day('2026-08-30', 0),
    ]);
    expect(r[1].cumulative).toBeCloseTo(-1, 10);
    // Undefined, so it carries the previous value rather than printing NaN.
    expect(Number.isFinite(r[2].cumulative)).toBe(true);
  });
});

describe('rebase', () => {
  it('shifts a series so the first point is zero', () => {
    const r = rebase([
      { date: 'a', cumulative: 0.1 },
      { date: 'b', cumulative: 0.21 },
    ]);
    expect(r[0].cumulative).toBeCloseTo(0, 10);
    // (1.21 / 1.1) - 1
    expect(r[1].cumulative).toBeCloseTo(0.1, 10);
  });

  it('is empty for an empty series', () => {
    expect(rebase([])).toEqual([]);
  });

  it('handles a series already starting at zero', () => {
    const r = rebase([
      { date: 'a', cumulative: 0 },
      { date: 'b', cumulative: 0.5 },
    ]);
    expect(r[1].cumulative).toBeCloseTo(0.5, 10);
  });
});

describe('buildValuationSeries', () => {
  const closes = new Map([
    ['NVDA', new Map([['2026-08-28', 100], ['2026-08-31', 110]])],
  ]);

  it('prices held positions at each day close and adds cash', () => {
    const s = buildValuationSeries({
      dates: ['2026-08-28', '2026-08-31'],
      closes,
      txns: [
        {
          symbol: 'NVDA',
          side: 'BUY',
          quantity: 10,
          price: 100,
          fee: 0,
          executedAt: new Date('2026-08-28T12:00:00Z'),
        },
      ],
      flows: [
        {
          direction: 'DEPOSIT',
          amount: 1000,
          occurredAt: new Date('2026-08-28T12:00:00Z'),
        },
      ],
      dividends: [],
      charges: [],
    });

    // Day 1: bought 10 @ 100 with 1000 deposited => cash 0, positions 1000.
    expect(s[0]).toMatchObject({ date: '2026-08-28', value: 1000, externalFlow: 1000 });
    // Day 2: same 10 shares at 110.
    expect(s[1]).toMatchObject({ date: '2026-08-31', value: 1100, externalFlow: 0 });
  });

  it('carries the last known close forward when a bar is missing', () => {
    const gappy = new Map([['NVDA', new Map([['2026-08-28', 100]])]]);
    const s = buildValuationSeries({
      dates: ['2026-08-28', '2026-08-31'],
      closes: gappy,
      txns: [
        {
          symbol: 'NVDA',
          side: 'BUY',
          quantity: 10,
          price: 100,
          fee: 0,
          executedAt: new Date('2026-08-28T12:00:00Z'),
        },
      ],
      flows: [],
      dividends: [],
      charges: [],
    });
    expect(s[1].value).toBe(1000);
  });

  it('treats dividends and charges as internal, not as flows', () => {
    // Both move cash but neither is money the owner put in or took out.
    const s = buildValuationSeries({
      dates: ['2026-08-28'],
      closes: new Map(),
      txns: [],
      flows: [
        {
          direction: 'DEPOSIT',
          amount: 1000,
          occurredAt: new Date('2026-08-28T12:00:00Z'),
        },
      ],
      dividends: [
        { symbol: 'NVDA', amount: 50, occurredAt: new Date('2026-08-28T12:00:00Z') },
      ],
      charges: [{ amount: 20, occurredAt: new Date('2026-08-28T12:00:00Z') }],
    });
    expect(s[0].value).toBe(1030);
    expect(s[0].externalFlow).toBe(1000);
  });

  it('excludes a trade that has not happened yet', () => {
    const s = buildValuationSeries({
      dates: ['2026-08-28', '2026-08-31'],
      closes,
      txns: [
        {
          symbol: 'NVDA',
          side: 'BUY',
          quantity: 10,
          price: 100,
          fee: 0,
          executedAt: new Date('2026-08-31T12:00:00Z'),
        },
      ],
      flows: [],
      dividends: [],
      charges: [],
    });
    expect(s[0].value).toBe(0);
    expect(s[1].value).toBe(1100 - 1000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --prefix backend -- series`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `backend/src/performance/series.ts`:

```ts
import {
  derivePositions,
  deriveCash,
  type DerivedTxn,
  type DerivedFlow,
  type DerivedDividend,
  type DerivedCharge,
} from '../portfolio/derive.js';

export interface DayInput {
  date: string;
  /** Total account value at that day's close: positions plus cash. */
  value: number;
  /** Deposits minus withdrawals that day. Trades are NOT flows. */
  externalFlow: number;
}

export interface ReturnPoint {
  date: string;
  /** Cumulative return as a fraction: 0.1 is +10%. */
  cumulative: number;
}

export interface SeriesInput {
  dates: string[];
  /** symbol -> date -> close */
  closes: Map<string, Map<string, number>>;
  txns: DerivedTxn[];
  flows: DerivedFlow[];
  dividends: DerivedDividend[];
  charges: DerivedCharge[];
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Walks the calendar, valuing the portfolio at each day's close.
 *
 * Deliberately re-derives positions and cash from scratch for every day rather
 * than mutating a running total: it is the same code path the dashboard uses,
 * so the series and the live figures can never disagree.
 */
export function buildValuationSeries(input: SeriesInput): DayInput[] {
  const lastKnown = new Map<string, number>();

  return input.dates.map((date) => {
    const upTo = (when: Date) => dayOf(when) <= date;

    const txns = input.txns.filter((t) => upTo(t.executedAt));
    const flows = input.flows.filter((f) => upTo(f.occurredAt));
    const dividends = input.dividends.filter((d) => upTo(d.occurredAt));
    const charges = input.charges.filter((c) => upTo(c.occurredAt));

    const cash = deriveCash(txns, flows, dividends, charges);

    let positionsValue = 0;
    for (const p of derivePositions(txns)) {
      if (!p.isOpen) continue;
      const close = input.closes.get(p.symbol)?.get(date);
      if (close !== undefined) lastKnown.set(p.symbol, close);
      // A missing bar (holiday, halt, thin name) carries the last known price
      // rather than valuing the position at zero.
      const price = close ?? lastKnown.get(p.symbol);
      if (price !== undefined) positionsValue += price * p.quantity;
    }

    const externalFlow = input.flows
      .filter((f) => dayOf(f.occurredAt) === date)
      .reduce((sum, f) => sum + (f.direction === 'DEPOSIT' ? f.amount : -f.amount), 0);

    return { date, value: round(cash + positionsValue), externalFlow: round(externalFlow) };
  });
}

/**
 * Time-weighted return, chained daily.
 *
 *   r = (V - CF) / V_prev - 1
 *
 * Subtracting the flow before dividing is what stops a deposit registering as
 * a gain — the single most important property in this file.
 */
export function toCumulativeReturns(days: DayInput[]): ReturnPoint[] {
  const out: ReturnPoint[] = [];
  let growth = 1;

  days.forEach((day, i) => {
    if (i === 0) {
      // The opening capital arrives against a prior value of zero, which has
      // no defined return. Day one is the baseline.
      out.push({ date: day.date, cumulative: 0 });
      return;
    }
    const prev = days[i - 1].value;
    if (prev > 0) {
      growth *= (day.value - day.externalFlow) / prev;
    }
    // With no positive prior value the return is undefined; carry the last
    // figure rather than emitting NaN or Infinity.
    out.push({ date: day.date, cumulative: round(growth - 1) });
  });

  return out;
}

/** Shifts a cumulative series so its first point sits at zero. */
export function rebase(points: ReturnPoint[]): ReturnPoint[] {
  if (points.length === 0) return [];
  const base = 1 + points[0].cumulative;
  if (base === 0) return points.map((p) => ({ ...p, cumulative: 0 }));
  return points.map((p) => ({
    date: p.date,
    cumulative: round((1 + p.cumulative) / base - 1),
  }));
}

/** Converts a price series into a cumulative return series. */
export function pricesToReturns(
  dates: string[],
  closes: Map<string, number>,
): ReturnPoint[] {
  const out: ReturnPoint[] = [];
  let first: number | null = null;
  let last: number | null = null;

  for (const date of dates) {
    const price = closes.get(date) ?? last;
    if (price === undefined || price === null) continue;
    last = price;
    if (first === null) first = price;
    out.push({ date, cumulative: round(price / first - 1) });
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --prefix backend -- series`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: time-weighted return series engine"
```

---

## Task 5: Performance endpoint

**Files:**
- Create: `backend/src/performance/performance.service.ts`
- Create: `backend/src/performance/performance.controller.ts`
- Create: `backend/src/performance/performance.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write the service**

Create `backend/src/performance/performance.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Dividend } from '../transactions/dividend.entity.js';
import { Charge } from '../transactions/charge.entity.js';
import { UsersService } from '../users/users.service.js';
import {
  buildValuationSeries,
  pricesToReturns,
  rebase,
  toCumulativeReturns,
} from './series.js';

export type Range = '1M' | '6M' | 'YTD' | '1Y' | 'ALL';

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(DailyClose)
    private readonly closes: Repository<DailyClose>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    @InjectRepository(CashFlow)
    private readonly flows: Repository<CashFlow>,
    @InjectRepository(Dividend)
    private readonly dividends: Repository<Dividend>,
    @InjectRepository(Charge)
    private readonly charges: Repository<Charge>,
    private readonly users: UsersService,
  ) {}

  async getSeries(range: Range = 'ALL') {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, flowRows, divRows, chgRows, instrumentRows, closeRows] =
      await Promise.all([
        this.txns.find({ where: { userId: user.id } }),
        this.flows.find({ where: { userId: user.id } }),
        this.dividends.find({ where: { userId: user.id } }),
        this.charges.find({ where: { userId: user.id } }),
        this.instruments.find(),
        this.closes.find(),
      ]);

    if (txnRows.length === 0 && flowRows.length === 0) {
      return { range, points: [], deltas: null };
    }

    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));

    // symbol -> date -> price. Positions use raw closes; benchmarks use
    // adjusted ones, so an index keeps its dividend yield.
    const closes = new Map<string, Map<string, number>>();
    const adjusted = new Map<string, Map<string, number>>();
    for (const row of closeRows) {
      const symbol = symbolById.get(row.instrumentId);
      if (!symbol) continue;
      if (!closes.has(symbol)) closes.set(symbol, new Map());
      if (!adjusted.has(symbol)) adjusted.set(symbol, new Map());
      closes.get(symbol)!.set(row.date, row.close);
      adjusted.get(symbol)!.set(row.date, row.adjClose);
    }

    // The calendar is the set of days the benchmark traded — the market's own
    // trading days, rather than days the owner happened to be active.
    const spy = adjusted.get('SPY') ?? new Map();
    let dates = [...spy.keys()].sort();

    const firstActivity = [
      ...txnRows.map((t) => t.executedAt),
      ...flowRows.map((f) => f.occurredAt),
    ]
      .sort((a, b) => a.getTime() - b.getTime())[0]
      ?.toISOString()
      .slice(0, 10);
    if (firstActivity) dates = dates.filter((d) => d >= firstActivity);
    dates = dates.filter((d) => d >= startOf(range, dates));

    const valuation = buildValuationSeries({
      dates,
      closes,
      txns: txnRows.map((t) => ({
        symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        fee: t.fee,
        executedAt: t.executedAt,
      })),
      flows: flowRows.map((f) => ({
        direction: f.direction,
        amount: f.amount,
        occurredAt: f.occurredAt,
      })),
      dividends: divRows.map((d) => ({
        symbol: symbolById.get(d.instrumentId) ?? 'UNKNOWN',
        amount: d.amount,
        occurredAt: d.occurredAt,
      })),
      charges: chgRows.map((c) => ({
        amount: c.amount,
        occurredAt: c.occurredAt,
      })),
    });

    const you = rebase(toCumulativeReturns(valuation));
    const sp = rebase(pricesToReturns(dates, adjusted.get('SPY') ?? new Map()));
    const nasdaq = rebase(
      pricesToReturns(dates, adjusted.get('QQQ') ?? new Map()),
    );

    const points = dates.map((date, i) => ({
      date,
      you: you[i]?.cumulative ?? null,
      sp500: sp[i]?.cumulative ?? null,
      nasdaq: nasdaq[i]?.cumulative ?? null,
    }));

    const last = points.at(-1);
    return {
      range,
      points,
      deltas: last
        ? {
            vsSp500:
              last.you !== null && last.sp500 !== null
                ? last.you - last.sp500
                : null,
            vsNasdaq:
              last.you !== null && last.nasdaq !== null
                ? last.you - last.nasdaq
                : null,
          }
        : null,
    };
  }
}

/** The first date inside the requested range, given the available calendar. */
function startOf(range: Range, dates: string[]): string {
  if (range === 'ALL' || dates.length === 0) return dates[0] ?? '0000-01-01';
  const latest = new Date(dates[dates.length - 1]);
  if (range === 'YTD') return `${latest.getUTCFullYear()}-01-01`;
  const months = range === '1M' ? 1 : range === '6M' ? 6 : 12;
  const from = new Date(latest);
  from.setUTCMonth(from.getUTCMonth() - months);
  return from.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Write the controller and module**

Create `backend/src/performance/performance.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { PerformanceService, type Range } from './performance.service.js';

const RANGES: Range[] = ['1M', '6M', 'YTD', '1Y', 'ALL'];

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  get(@Query('range') range?: string) {
    const valid = RANGES.includes(range as Range) ? (range as Range) : 'ALL';
    return this.performance.getSeries(valid);
  }
}
```

Create `performance.module.ts` registering the six entities via
`TypeOrmModule.forFeature`, importing `UsersModule`, and providing the service
and controller. Register `PerformanceModule` in `app.module.ts`.

- [ ] **Step 3: Verify against real data**

```bash
curl -s "http://localhost:3000/performance?range=ALL" | python3 -m json.tool | head -40
```

Expected: a `points` array with `date`, `you`, `sp500`, `nasdaq`, plus `deltas`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: performance endpoint with benchmark series"
```

### ✋ TEST CHECKPOINT 2

Hit `/performance` and read the JSON. **Sanity-check the first day: all three
series must be exactly 0.** Then check the most recent `you` against the
dashboard — if your account is up 2% since seeding, this should say ~0.02.

---

## Task 6: The chart

**Files:**
- Create: `frontend/src/components/BenchmarkChart.tsx`

- [ ] **Step 1: Validate the three-series palette**

Three categorical series means the palette validator is mandatory.

```bash
cd /private/tmp/claude-501/bundled-skills/*/dataviz
node scripts/validate_palette.js "#2aa79b,#7b8cde,#c2792f" --mode dark --surface "#0a0e17"
```

Fix any FAIL by re-stepping a hue before writing the component. Record the
passing palette in a comment in the file.

- [ ] **Step 2: Write the chart**

An inline SVG line chart, three series, no dual axis. It must:

- Draw a **zero baseline** in the muted border colour — the reference every
  line is read against
- Use **2px strokes**, no point markers except the final point of each series
- **Direct-label the final point** of each line (`You +2.1%`), since three
  series is at or under the four-series direct-label threshold
- Include a **legend**, so identity is never colour-alone
- Format the y-axis as percentages, with a **tap-anywhere crosshair** reading
  out all three values for that date
- Render an explicit empty state when there are fewer than two points

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: three-line benchmark chart"
```

---

## Task 7: Put it on the dashboard

**Files:**
- Modify: `frontend/src/routes/Dashboard.tsx`

- [ ] **Step 1: Fetch and render**

Add a `['performance', range]` query and render `BenchmarkChart` between the
cash/deployed cards and the holdings list, with the range selector
(1M / 6M / YTD / 1Y / All) above it and the two delta chips beneath.

- [ ] **Step 2: Verify and commit**

```bash
npm run test && npm run build
git add -A && git commit -m "feat: benchmark chart on the dashboard"
```

### ✋ TEST CHECKPOINT 3 — the third pillar

Open the dashboard. Three lines, all starting at 0%. **Check the delta chips
against your own sense of the last few days** — if the market was up and you
were down, the chip must say so.

Expect the chart to be nearly empty at first: the series starts 28 August and
one bar exists so far. It becomes readable within a week.

---

## Phase 3 done

```bash
npm test && npm run build
```

Update `CLAUDE.md`: mark Phase 3 complete, add the `performance` module to the
layout, and record deviations in this plan.

## Deferred

- **Trade replay** — the natural next step, and the daily history it needs now
  exists. Animating a daily candle chart from entry to exit with markers.
- **Scheduled backfill.** Backfill is manual today. A daily job matters once
  the app runs somewhere other than the owner's laptop.
- **Dollar-value shadow portfolio** — "the same money in SPY would be worth
  $X", alongside the percentage view.
