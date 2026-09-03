# Trade Idea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name a ticker and get an opinion on it — whether it fits how the owner trades, whether the stock is worth buying now, and what the risk/reward looks like — before any money is committed.

**Architecture:** The app fetches bars and a quote for any symbol through the existing `YahooClient`, computes a block of indicators in a pure module, and hands that to the model along with the owner's trading profile. The model returns prose plus two structured levels (a proposed stop and target); the app computes every figure that follows from them. Nothing about a researched ticker is written to `instruments` or `daily_closes` — those mean "things he owns" — but the opinions themselves are persisted.

**Tech Stack:** NestJS 12, TypeORM (migrations; `synchronize` is off), PostgreSQL 18, `yahoo-finance2` behind `yahoo.client.ts`, React 19, Vite 8, Tailwind v4, TanStack Query, Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-09-03-trade-idea-design.md`

## Global Constraints

- **`yahoo.client.ts` is the ONLY file allowed to import `yahoo-finance2`.** It already exposes `quote(symbol)` and `dailyBars(symbol, from)`; this feature needs no new provider method.
- **The app computes, the model judges.** The model may propose a stop and a target, and may write prose about the business from its own knowledge (clearly labelled, with staleness acknowledged). It may state no other figure it was not given, and it never computes a ratio.
- **If the structured levels cannot be parsed, render the prose and omit every derived number, saying why.** A missing ratio is honest; a guessed one is the failure this app exists to avoid.
- **Never present a stale price as live.** If the quote backing an opinion is stale, say so and store that flag.
- **Nothing about a researched ticker is persisted as market data.** No writes to `instruments` or `daily_closes`.
- **Price is always the live quote.** There is no user-supplied entry price.
- **Schema changes go through migrations** in `backend/src/database/migrations/`, named `<epoch-ms>-<Name>.ts`, and must be registered by hand in `backend/src/database/data-source.ts` — that file lists every migration class explicitly and a new one will silently never run if you skip it.
- **Do not run `nest build` while `npm run dev` is running.** Typecheck with `npx tsc --noEmit -p tsconfig.json` from `backend/`.
- **e2e runs against `trader_test`.** Never run anything against `trader`, which holds the owner's real portfolio.
- **No test may reach the network at all** — not Yahoo, not an LLM, not anything external. Stub the client with `overrideProvider`. The suite must pass with the machine offline.
- **Mobile is the primary device.** The iOS decimal keypad has no minus key; any numeric input uses a toggle, never a typed `-`.
- **Frontend typecheck is `npx tsc -b`, not `tsc --noEmit -p`** — the build enforces `noUnusedLocals` across test files and `--noEmit -p` does not. Verify with `npm run build` from the repo root before claiming a frontend task is done.

---

## Status (2026-09-03)

**Slices 1, 2 and 5 are done and merged to `main`. Slices 3 and 4 are not
started.** So the endpoint exists with nothing storing its answers and no
screen in front of them: `POST /llm/trade-idea` returns an opinion, but
nothing is persisted (Task 6's migration and entity were never written) and
there is no Ideas tab (`frontend/src/routes/` has no Ideas route). The feature
is not usable by the owner yet — it is reachable only by curl.

Do not read the ticked boxes below as "the feature shipped": Slices 1-2 were
implemented in an earlier session that never ticked them, and the boxes were
brought up to date afterwards by checking which files and commits actually
exist.

---

## Slice 1 — What the numbers say, with no AI at all

### Task 1: The indicators module

**Files:**
- Create: `backend/src/market-data/indicators.ts`
- Test: `backend/src/market-data/indicators.spec.ts`

**Interfaces:**
- Consumes: `RawBar` from `./yahoo.client.js` — `{ date: string; close: number; adjClose: number; open: number | null; high: number | null; low: number | null; volume: number | null }`.
- Produces:
  ```ts
  export interface IndicatorSet {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    percentFromSma20: number | null;
    percentFromSma50: number | null;
    percentFromSma200: number | null;
    high52w: number | null;
    low52w: number | null;
    percentFromHigh52w: number | null;
    percentFromLow52w: number | null;
    atr14: number | null;
    atrPercentOfPrice: number | null;
    relativeVolume: number | null;
    barsAvailable: number;
  }
  export function computeIndicators(bars: RawBar[], currentPrice: number): IndicatorSet;
  ```

- [x] **Step 1: Write the failing tests**

Create `backend/src/market-data/indicators.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeIndicators } from './indicators';
import type { RawBar } from './yahoo.client';

/** A flat series of `n` bars at `price`, one per day, with a fixed volume. */
function flat(n: number, price: number, volume = 1_000_000): RawBar[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    close: price,
    adjClose: price,
    open: price,
    high: price,
    low: price,
    volume,
  }));
}

describe('computeIndicators', () => {
  it('averages the last N closes for each moving average', () => {
    const bars = [...flat(180, 100), ...flat(20, 110)];
    const r = computeIndicators(bars, 110);
    expect(r.sma20).toBeCloseTo(110, 6);
    // 50 bars: 30 at 100, 20 at 110.
    expect(r.sma50).toBeCloseTo((30 * 100 + 20 * 110) / 50, 6);
    expect(r.barsAvailable).toBe(200);
  });

  it('returns null for an average it does not have the history for', () => {
    // 200 bars are needed for a 200-day average. Extrapolating from 60 would
    // be a plausible number that is not the thing it claims to be.
    const r = computeIndicators(flat(60, 100), 100);
    expect(r.sma20).toBeCloseTo(100, 6);
    expect(r.sma50).toBeCloseTo(100, 6);
    expect(r.sma200).toBeNull();
    expect(r.percentFromSma200).toBeNull();
  });

  it('expresses distance from an average as a signed fraction of that average', () => {
    const r = computeIndicators(flat(30, 100), 110);
    // 110 against a 100 average is +10%.
    expect(r.percentFromSma20).toBeCloseTo(0.1, 6);
  });

  it('takes the 52-week high and low from intraday extremes, not closes', () => {
    // 200 bars, deliberately fewer than the 252-bar window, so the extremes
    // set below are inside it. With 300 the window would drop the first 48
    // and this test would silently assert nothing.
    const bars = flat(200, 100);
    bars[10] = { ...bars[10], high: 150 };
    bars[20] = { ...bars[20], low: 50 };
    const r = computeIndicators(bars, 100);
    expect(r.high52w).toBe(150);
    expect(r.low52w).toBe(50);
    expect(r.percentFromHigh52w).toBeCloseTo((100 - 150) / 150, 6);
    expect(r.percentFromLow52w).toBeCloseTo((100 - 50) / 50, 6);
  });

  it('computes ATR from the true range, including gaps against the prior close', () => {
    // Two bars: the second gaps up and its true range is measured from the
    // previous close, not its own low — that is the whole point of ATR.
    const bars: RawBar[] = [
      { date: '2026-01-01', close: 100, adjClose: 100, open: 100, high: 101, low: 99, volume: 1 },
      { date: '2026-01-02', close: 110, adjClose: 110, open: 110, high: 112, low: 108, volume: 1 },
    ];
    // Not enough bars for a 14-period ATR.
    expect(computeIndicators(bars, 110).atr14).toBeNull();

    const many = [...flat(20, 100)];
    const r = computeIndicators(many, 100);
    // A perfectly flat series has no range at all.
    expect(r.atr14).toBeCloseTo(0, 6);
  });

  it('measures current volume against the 20 days before it', () => {
    const bars = [...flat(20, 100, 1_000_000), ...flat(1, 100, 2_000_000)];
    expect(computeIndicators(bars, 100).relativeVolume).toBeCloseTo(2, 6);
  });

  it('is all nulls for no bars at all, rather than throwing', () => {
    const r = computeIndicators([], 100);
    expect(r.sma20).toBeNull();
    expect(r.high52w).toBeNull();
    expect(r.atr14).toBeNull();
    expect(r.relativeVolume).toBeNull();
    expect(r.barsAvailable).toBe(0);
  });
});
```

- [x] **Step 2: Run them and watch them fail**

Run: `cd backend && npx vitest run src/market-data/indicators.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

Create `backend/src/market-data/indicators.ts`:

```ts
import type { RawBar } from './yahoo.client.js';

/**
 * Chart facts about a ticker, computed from bars the app fetched — the
 * numbers a trader would read off a chart before deciding.
 *
 * Every field is null when it cannot be computed honestly: a name with four
 * months of history has no 200-day average, and a bar without a high has no
 * true range. Extrapolating would produce a plausible number that is not the
 * thing it claims to be, which is the failure this codebase exists to avoid.
 *
 * Pure and dependency-free in the style of `derive.ts` and `risk.ts`: no
 * database, no network, fixture-tested. The caller does the I/O.
 */
export interface IndicatorSet {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  /** Signed fraction of the average: 0.1 means price is 10% above it. */
  percentFromSma20: number | null;
  percentFromSma50: number | null;
  percentFromSma200: number | null;
  high52w: number | null;
  low52w: number | null;
  /** Negative below the high; positive above the low. */
  percentFromHigh52w: number | null;
  percentFromLow52w: number | null;
  atr14: number | null;
  /** ATR as a fraction of the current price — a volatility yardstick a stop can be judged against. */
  atrPercentOfPrice: number | null;
  /** Latest bar's volume against the average of the 20 before it. */
  relativeVolume: number | null;
  /** How much history this was computed from, so a caller can say "thin". */
  barsAvailable: number;
}

const TRADING_DAYS_IN_YEAR = 252;
const VOLUME_LOOKBACK = 20;
const ATR_PERIOD = 14;

function sma(bars: RawBar[], period: number): number | null {
  if (bars.length < period) return null;
  const window = bars.slice(-period);
  return window.reduce((sum, b) => sum + b.close, 0) / period;
}

function fraction(price: number, level: number | null): number | null {
  if (level === null || !(level > 0)) return null;
  return (price - level) / level;
}

export function computeIndicators(
  bars: RawBar[],
  currentPrice: number,
): IndicatorSet {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const year = sorted.slice(-TRADING_DAYS_IN_YEAR);

  const sma20 = sma(sorted, 20);
  const sma50 = sma(sorted, 50);
  const sma200 = sma(sorted, 200);

  const highs = year.map((b) => b.high).filter((h): h is number => h !== null);
  const lows = year.map((b) => b.low).filter((l): l is number => l !== null);
  const high52w = highs.length > 0 ? Math.max(...highs) : null;
  const low52w = lows.length > 0 ? Math.min(...lows) : null;

  const atr14 = computeAtr(sorted, ATR_PERIOD);

  return {
    sma20,
    sma50,
    sma200,
    percentFromSma20: fraction(currentPrice, sma20),
    percentFromSma50: fraction(currentPrice, sma50),
    percentFromSma200: fraction(currentPrice, sma200),
    high52w,
    low52w,
    percentFromHigh52w: fraction(currentPrice, high52w),
    percentFromLow52w: fraction(currentPrice, low52w),
    atr14,
    atrPercentOfPrice:
      atr14 !== null && currentPrice > 0 ? atr14 / currentPrice : null,
    relativeVolume: computeRelativeVolume(sorted),
    barsAvailable: sorted.length,
  };
}

/**
 * Average true range. True range is the widest of the bar's own range and its
 * gap from the previous close — which is why a stop placed inside one ATR of
 * entry is inside a single ordinary day's movement.
 */
function computeAtr(bars: RawBar[], period: number): number | null {
  if (bars.length < period + 1) return null;
  const ranges: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    if (b.high === null || b.low === null) return null;
    ranges.push(
      Math.max(
        b.high - b.low,
        Math.abs(b.high - prev.close),
        Math.abs(b.low - prev.close),
      ),
    );
  }
  return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
}

/** Latest bar's volume over the average of the `VOLUME_LOOKBACK` before it. */
function computeRelativeVolume(bars: RawBar[]): number | null {
  if (bars.length < VOLUME_LOOKBACK + 1) return null;
  const latest = bars[bars.length - 1].volume;
  if (latest === null || !(latest > 0)) return null;
  const priorBars = bars.slice(-(VOLUME_LOOKBACK + 1), -1);
  const priors = priorBars
    .map((b) => b.volume)
    .filter((v): v is number => v !== null && v > 0);
  if (priors.length < VOLUME_LOOKBACK) return null;
  const average = priors.reduce((sum, v) => sum + v, 0) / priors.length;
  return average > 0 ? latest / average : null;
}
```

- [x] **Step 4: Run the tests**

Run: `cd backend && npx vitest run src/market-data/indicators.spec.ts`
Expected: PASS, all 7.

- [x] **Step 5: Typecheck and commit**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
git add backend/src/market-data/indicators.ts backend/src/market-data/indicators.spec.ts
git commit -m "feat: chart indicators for any ticker, computed not guessed"
```

### Task 2: Ticker facts endpoint

**Files:**
- Create: `backend/src/market-data/ticker-facts.service.ts`
- Modify: `backend/src/market-data/market-data.controller.ts` (add the route; if no controller exists there, create `backend/src/market-data/market-data.controller.ts` and register it in `backend/src/market-data/market-data.module.ts`)
- Test: `backend/test/ticker-facts.e2e-spec.ts`

**Interfaces:**
- Consumes: `computeIndicators` from Task 1; `YahooClient.quote(symbol)` and `YahooClient.dailyBars(symbol, from)`.
- Produces:
  ```ts
  export interface TickerFacts {
    symbol: string;
    name: string | null;
    price: number;
    stale: boolean;
    session: string | null;
    extended: boolean;
    peRatio: number | null;
    indicators: IndicatorSet;
  }
  // TickerFactsService.get(symbol: string): Promise<TickerFacts>
  ```
  Throws `NotFoundException` for a symbol Yahoo does not recognise.

- [x] **Step 1: Write the failing e2e test**

Create `backend/test/ticker-facts.e2e-spec.ts`. Stub `YahooClient` via `overrideProvider` so no network call happens:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';

describe('Ticker facts (e2e)', () => {
  let app: INestApplication;
  let token: string;

  const bars = Array.from({ length: 220 }, (_, i) => ({
    date: `2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`,
    close: 100,
    adjClose: 100,
    open: 100,
    high: 101,
    low: 99,
    volume: 1_000_000,
  }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue({
        quote: async (symbol: string) =>
          symbol === 'NVDA'
            ? {
                symbol: 'NVDA',
                name: 'NVIDIA',
                price: 110,
                currency: 'USD',
                session: 'REGULAR',
                extended: false,
                regularPrice: 110,
                peRatio: 45.2,
              }
            : null,
        dailyBars: async () => bars,
        quoteMany: async () => [],
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a token', async () => {
    await request(app.getHttpServer()).get('/market-data/ticker-facts/NVDA').expect(401);
  });

  it('returns the quote and computed indicators for a known ticker', async () => {
    const res = await http(app, token)
      .get('/market-data/ticker-facts/NVDA')
      .expect(200);
    expect(res.body.symbol).toBe('NVDA');
    expect(res.body.price).toBe(110);
    expect(res.body.peRatio).toBe(45.2);
    expect(res.body.indicators.sma20).toBeCloseTo(100, 6);
    // 110 against a 100 average.
    expect(res.body.indicators.percentFromSma20).toBeCloseTo(0.1, 6);
    expect(res.body.indicators.barsAvailable).toBe(220);
  });

  it('404s a ticker Yahoo does not recognise', async () => {
    await http(app, token)
      .get('/market-data/ticker-facts/ZZZZNOTREAL')
      .expect(404);
  });

  it('writes nothing to instruments — a researched ticker is not a holding', async () => {
    await http(app, token).get('/market-data/ticker-facts/NVDA').expect(200);
    const res = await http(app, token).get('/portfolio').expect(200);
    expect(res.body.positions).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/ticker-facts.e2e-spec.ts`
Expected: FAIL — 404 on the route itself.

- [x] **Step 3: Implement the service**

Create `backend/src/market-data/ticker-facts.service.ts`:

```ts
import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { YahooClient } from './yahoo.client.js';
import { computeIndicators, type IndicatorSet } from './indicators.js';

/** How much history to ask for: enough for a 200-day average with room to spare. */
const LOOKBACK_DAYS = 500;

export interface TickerFacts {
  symbol: string;
  name: string | null;
  price: number;
  /** True when the quote could not be refreshed — an opinion about a price is only as good as the price. */
  stale: boolean;
  session: string | null;
  extended: boolean;
  peRatio: number | null;
  indicators: IndicatorSet;
}

/**
 * Everything the app can say about a ticker on its own, with no model
 * involved — the foundation the trade-idea opinion is built on, and useful by
 * itself.
 *
 * Deliberately writes NOTHING: `instruments` and `daily_closes` mean "things
 * the owner holds", and filling them with every name he merely looked at
 * would quietly change what those tables mean.
 */
@Injectable()
export class TickerFactsService {
  constructor(private readonly yahoo: YahooClient) {}

  async get(symbol: string): Promise<TickerFacts> {
    const upper = symbol.trim().toUpperCase();

    let quote: Awaited<ReturnType<YahooClient['quote']>>;
    try {
      quote = await this.yahoo.quote(upper);
    } catch {
      // The provider being down is not the same as the ticker not existing,
      // and must not read as "no such symbol". No partial answer is offered:
      // an opinion resting on half the facts is worse than none.
      throw new ServiceUnavailableException(
        'Market data is unavailable right now, so this ticker cannot be checked.',
      );
    }
    if (!quote) throw new NotFoundException(`Unknown ticker: ${upper}`);

    const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    let bars;
    try {
      bars = await this.yahoo.dailyBars(upper, from);
    } catch {
      throw new ServiceUnavailableException(
        'Price history is unavailable right now, so this ticker cannot be checked.',
      );
    }

    return {
      symbol: quote.symbol,
      name: quote.name,
      price: quote.price,
      // Always false, and deliberately so. The staleness rule elsewhere in
      // this app means "the provider failed, so serve the CACHED quote and
      // flag it" - but there is no cache for a ticker the owner does not
      // hold, so there is nothing stale to serve. A provider failure here
      // produces no facts at all (see the catch below), which is the honest
      // outcome. The field is kept so the shape does not change if this ever
      // reads through the quote cache.
      stale: false,
      session: quote.session ?? null,
      extended: quote.extended,
      peRatio: quote.peRatio,
      indicators: computeIndicators(bars, quote.price),
    };
  }
}
```

- [x] **Step 4: Add the route**

Add a `GET ticker-facts/:symbol` route on the market-data controller returning `this.tickerFacts.get(symbol)`, and register `TickerFactsService` as a provider in `market-data.module.ts`. Follow the auth guard pattern the other controllers use — every route in this app requires a token except `/health/ping` and `/auth/login`.

- [x] **Step 5: Run the tests**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run test:e2e
```
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add backend/src/market-data backend/test/ticker-facts.e2e-spec.ts
git commit -m "feat: ticker facts endpoint - what the app knows about any symbol"
```

---

## Slice 2 — The opinion

### Task 3: Parsing the model's proposed levels

**Files:**
- Create: `backend/src/llm/trade-idea-parse.ts`
- Test: `backend/src/llm/trade-idea-parse.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProposedLevels { stop: number; target: number }
  export function parseProposedLevels(text: string): ProposedLevels | null;
  export function stripLevelsBlock(text: string): string;
  ```

The model is asked to end its answer with a fenced block:

```
LEVELS
stop: 41.20
target: 58.00
```

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseProposedLevels, stripLevelsBlock } from './trade-idea-parse';

const body = 'Some prose about the trade.\n\n';

describe('parseProposedLevels', () => {
  it('reads the levels the model was asked to end with', () => {
    expect(parseProposedLevels(`${body}LEVELS\nstop: 41.20\ntarget: 58.00`)).toEqual({
      stop: 41.2,
      target: 58,
    });
  });

  it('tolerates a dollar sign, commas and stray whitespace', () => {
    expect(
      parseProposedLevels(`${body}LEVELS\n  stop:  $1,041.20 \n  target: $1,158 `),
    ).toEqual({ stop: 1041.2, target: 1158 });
  });

  it('returns null when the block is missing entirely', () => {
    expect(parseProposedLevels('Just prose, no levels.')).toBeNull();
  });

  it('returns null when only one level is present', () => {
    expect(parseProposedLevels(`${body}LEVELS\nstop: 41.20`)).toBeNull();
  });

  it('returns null for a non-numeric or non-positive level', () => {
    expect(parseProposedLevels(`${body}LEVELS\nstop: n/a\ntarget: 58`)).toBeNull();
    expect(parseProposedLevels(`${body}LEVELS\nstop: 0\ntarget: 58`)).toBeNull();
  });
});

describe('stripLevelsBlock', () => {
  it('removes the machine-readable block from what the owner reads', () => {
    expect(stripLevelsBlock(`${body}LEVELS\nstop: 41.20\ntarget: 58.00`).trim()).toBe(
      'Some prose about the trade.',
    );
  });

  it('leaves prose untouched when there is no block', () => {
    expect(stripLevelsBlock('Just prose.')).toBe('Just prose.');
  });
});
```

- [x] **Step 2: Run and watch fail**

Run: `cd backend && npx vitest run src/llm/trade-idea-parse.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
/**
 * The model ends its answer with a small machine-readable block so the app can
 * do the arithmetic itself:
 *
 *     LEVELS
 *     stop: 41.20
 *     target: 58.00
 *
 * Parsing is deliberately forgiving about presentation ($ signs, commas,
 * whitespace) and completely unforgiving about substance: anything that is not
 * two positive numbers returns null, and the caller then shows the prose with
 * no derived figures at all. A missing risk/reward is honest; one computed
 * from a half-read number is the exact failure this app exists to avoid.
 */
export interface ProposedLevels {
  stop: number;
  target: number;
}

const LEVELS_BLOCK = /LEVELS\s*\n([\s\S]*)$/i;

function readNumber(source: string, label: 'stop' | 'target'): number | null {
  const match = new RegExp(`${label}\\s*:\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)`, 'i').exec(source);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseProposedLevels(text: string): ProposedLevels | null {
  const block = LEVELS_BLOCK.exec(text);
  if (!block) return null;
  const stop = readNumber(block[1], 'stop');
  const target = readNumber(block[1], 'target');
  if (stop === null || target === null) return null;
  return { stop, target };
}

/** The prose without the block — what the owner actually reads. */
export function stripLevelsBlock(text: string): string {
  return text.replace(LEVELS_BLOCK, '');
}
```

- [x] **Step 4: Run and commit**

```bash
cd backend && npx vitest run src/llm/trade-idea-parse.spec.ts
git add backend/src/llm/trade-idea-parse.ts backend/src/llm/trade-idea-parse.spec.ts
git commit -m "feat: parse the model's proposed levels, or refuse them"
```

### Task 4: Risk and reward arithmetic

**Files:**
- Create: `backend/src/portfolio/trade-risk.ts`
- Test: `backend/src/portfolio/trade-risk.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TradeRiskInput {
    entryPrice: number;
    stop: number;
    target: number;
    /** The owner's own average risk per trade, from his recorded history. Null when he has none yet. */
    usualRisk: number | null;
  }
  export interface TradeRiskResult {
    direction: 'LONG' | 'SHORT';
    riskPerShare: number;
    rewardPerShare: number;
    riskReward: number | null;
    sharesAtUsualRisk: number | null;
    positionValueAtUsualRisk: number | null;
  }
  export function computeTradeRisk(input: TradeRiskInput): TradeRiskResult | null;
  ```
  Returns null when the levels are incoherent (stop on the same side as the target).

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { computeTradeRisk } from './trade-risk';

describe('computeTradeRisk', () => {
  it('reads a stop below and a target above as a long', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 45, target: 65, usualRisk: 1500 })!;
    expect(r.direction).toBe('LONG');
    expect(r.riskPerShare).toBeCloseTo(5, 6);
    expect(r.rewardPerShare).toBeCloseTo(15, 6);
    expect(r.riskReward).toBeCloseTo(3, 6);
  });

  it('reads a stop above and a target below as a short', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 55, target: 40, usualRisk: null })!;
    expect(r.direction).toBe('SHORT');
    expect(r.riskPerShare).toBeCloseTo(5, 6);
    expect(r.rewardPerShare).toBeCloseTo(10, 6);
    expect(r.riskReward).toBeCloseTo(2, 6);
  });

  it('sizes the position from the owner’s own average risk', () => {
    // $1,500 of risk at $5 a share is 300 shares, worth $15,000 at $50.
    const r = computeTradeRisk({ entryPrice: 50, stop: 45, target: 65, usualRisk: 1500 })!;
    expect(r.sharesAtUsualRisk).toBe(300);
    expect(r.positionValueAtUsualRisk).toBeCloseTo(15000, 6);
  });

  it('offers no size when there is no recorded average risk to size against', () => {
    const r = computeTradeRisk({ entryPrice: 50, stop: 45, target: 65, usualRisk: null })!;
    expect(r.sharesAtUsualRisk).toBeNull();
    expect(r.positionValueAtUsualRisk).toBeNull();
  });

  it('refuses incoherent levels rather than inventing a direction', () => {
    // Both below entry: this is not a trade, it is a typo.
    expect(
      computeTradeRisk({ entryPrice: 50, stop: 45, target: 40, usualRisk: 1500 }),
    ).toBeNull();
    // A stop AT the entry has no risk to divide by.
    expect(
      computeTradeRisk({ entryPrice: 50, stop: 50, target: 65, usualRisk: 1500 }),
    ).toBeNull();
  });
});
```

- [x] **Step 2: Run and watch fail**

Run: `cd backend && npx vitest run src/portfolio/trade-risk.spec.ts`
Expected: FAIL.

- [x] **Step 3: Implement**

```ts
/**
 * What the model's two proposed levels actually imply, in the owner's own
 * terms. The model proposes WHERE; every number here is the app's, because a
 * ratio worked out by a language model is exactly the kind of plausible wrong
 * number this codebase refuses to display.
 *
 * Pure: no database, no network.
 */
export interface TradeRiskInput {
  entryPrice: number;
  stop: number;
  target: number;
  /** The owner's average risk per trade, from his own closed history. Null when he has none. */
  usualRisk: number | null;
}

export interface TradeRiskResult {
  direction: 'LONG' | 'SHORT';
  riskPerShare: number;
  rewardPerShare: number;
  riskReward: number | null;
  /** Shares that would risk exactly `usualRisk` with this stop. Null without one. */
  sharesAtUsualRisk: number | null;
  positionValueAtUsualRisk: number | null;
}

const EPSILON = 1e-9;

export function computeTradeRisk(input: TradeRiskInput): TradeRiskResult | null {
  const { entryPrice, stop, target, usualRisk } = input;
  if (!(entryPrice > 0) || !(stop > 0) || !(target > 0)) return null;

  // Direction is inferred from the levels rather than asked for: a stop below
  // and a target above is a long, and the reverse is a short. Anything else -
  // both on the same side, or a stop at the entry - is not a trade with a
  // direction, so it gets no numbers at all.
  const long = stop < entryPrice && target > entryPrice;
  const short = stop > entryPrice && target < entryPrice;
  if (!long && !short) return null;

  const riskPerShare = Math.abs(entryPrice - stop);
  const rewardPerShare = Math.abs(target - entryPrice);
  if (riskPerShare < EPSILON) return null;

  const shares =
    usualRisk !== null && usualRisk > 0
      ? Math.floor(usualRisk / riskPerShare)
      : null;

  return {
    direction: long ? 'LONG' : 'SHORT',
    riskPerShare: round(riskPerShare),
    rewardPerShare: round(rewardPerShare),
    riskReward: round(rewardPerShare / riskPerShare),
    sharesAtUsualRisk: shares,
    positionValueAtUsualRisk: shares !== null ? round(shares * entryPrice) : null,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
```

- [x] **Step 4: Run and commit**

```bash
cd backend && npx vitest run src/portfolio/trade-risk.spec.ts
git add backend/src/portfolio/trade-risk.ts backend/src/portfolio/trade-risk.spec.ts
git commit -m "feat: risk and reward from proposed levels, sized to his own risk"
```

### Task 5: The trade-idea endpoint

**Files:**
- Create: `backend/src/llm/trade-idea.service.ts`
- Create: `backend/src/llm/trade-idea-prompt.ts`
- Modify: `backend/src/llm/llm.controller.ts` (add `POST ai/trade-idea`)
- Modify: `backend/src/llm/llm.module.ts` (register the new service)
- Test: `backend/test/trade-idea.e2e-spec.ts`

**Interfaces:**
- Consumes: `TickerFactsService.get` (Task 2), `parseProposedLevels`/`stripLevelsBlock` (Task 3), `computeTradeRisk` (Task 4), the existing `LlmClient.complete({ system, user, grounded })` and `buildSystemPrompt(profile)` from `prompts.ts`, and `PortfolioService.getStats()` for `avgRisk`.
- Produces: `POST /ai/trade-idea { symbol: string }` returning
  ```ts
  {
    configured: boolean;
    symbol: string;
    facts: TickerFacts | null;
    opinion: string | null;
    levels: { stop: number; target: number } | null;
    risk: TradeRiskResult | null;
    /** Set when the model answered but its levels could not be read. */
    levelsUnreadable: boolean;
    error: string | null;
    errorKind: LlmFailureKind | null;
  }
  ```

- [x] **Step 1: Write the prompt builder**

Create `backend/src/llm/trade-idea-prompt.ts` with `buildTradeIdeaPrompt(facts: TickerFacts, usualRisk: number | null): string`. It renders the indicator block as plain lines (reuse the tone of `portfolio-context.ts`: whole dollars for amounts, two decimals for prices), then the instruction. The instruction must say, in the app's own voice:

- answer three things, in this order: does this fit the way I trade, is the stock worth buying now, and is the risk/reward worth taking
- you may use your own knowledge of the business and sector; mark clearly anything not in the facts above, and say when your knowledge may be out of date
- state no figure about price, volume or valuation that is not in the facts above
- do not compute a risk/reward ratio, a position size, or any dollar figure — the app does that from your levels
- end with exactly this block and nothing after it:

```
LEVELS
stop: <price>
target: <price>
```

- [x] **Step 2: Write the failing e2e test**

Create `backend/test/trade-idea.e2e-spec.ts`, overriding BOTH `YahooClient` (as in Task 2) and `LlmClient` with a stub whose `complete()` returns a fixed answer ending in a LEVELS block, and `isConfigured()` returns true:

```ts
it('returns the opinion, the parsed levels, and risk the APP computed', async () => {
  const res = await http(app, token)
    .post('/ai/trade-idea')
    .send({ symbol: 'NVDA' })
    .expect(201);

  expect(res.body.symbol).toBe('NVDA');
  expect(res.body.opinion).toContain('prose');
  // The machine-readable block is not shown to the owner.
  expect(res.body.opinion).not.toContain('LEVELS');
  expect(res.body.levels).toEqual({ stop: 99, target: 130 });
  // Entry 110, stop 99, target 130 -> risk 11, reward 20.
  expect(res.body.risk.direction).toBe('LONG');
  expect(res.body.risk.riskPerShare).toBeCloseTo(11, 6);
  expect(res.body.risk.riskReward).toBeCloseTo(20 / 11, 6);
  expect(res.body.levelsUnreadable).toBe(false);
});

it('shows the prose and NO derived numbers when the levels cannot be read', async () => {
  // Stub returns prose with no LEVELS block for this symbol.
  const res = await http(app, token)
    .post('/ai/trade-idea')
    .send({ symbol: 'NOLEVELS' })
    .expect(201);

  expect(res.body.opinion).toBeTruthy();
  expect(res.body.levels).toBeNull();
  expect(res.body.risk).toBeNull();
  expect(res.body.levelsUnreadable).toBe(true);
});

it('404s an unknown ticker without calling the model', async () => {
  await http(app, token)
    .post('/ai/trade-idea')
    .send({ symbol: 'ZZZZNOTREAL' })
    .expect(404);
});

it('reports unconfigured without calling Yahoo when there is no key', async () => {
  // Build a second app whose LlmClient reports itself unconfigured, and whose
  // YahooClient throws if touched - proving the short-circuit really happens
  // before any market data is fetched.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LlmClient)
    .useValue({
      isConfigured: () => false,
      complete: async () => { throw new Error('must not be called'); },
      modelName: () => 'none',
    })
    .overrideProvider(YahooClient)
    .useValue({
      quote: async () => { throw new Error('Yahoo must not be called'); },
      dailyBars: async () => { throw new Error('Yahoo must not be called'); },
      quoteMany: async () => [],
    })
    .compile();
  const unconfigured = moduleRef.createNestApplication();
  unconfigured.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await unconfigured.init();
  const unconfiguredToken = await login(unconfigured);

  const res = await http(unconfigured, unconfiguredToken)
    .post('/ai/trade-idea')
    .send({ symbol: 'NVDA' })
    .expect(201);

  expect(res.body.configured).toBe(false);
  expect(res.body.facts).toBeNull();
  expect(res.body.opinion).toBeNull();

  await unconfigured.close();
});
```

- [x] **Step 3: Run and watch fail**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/trade-idea.e2e-spec.ts`
Expected: FAIL — route missing.

- [x] **Step 4: Implement the service**

`TradeIdeaService.analyse(symbol)`:
1. If `!llm.isConfigured()`, return the unconfigured shape immediately — no Yahoo call, mirroring `LlmService.portfolioSummary`.
2. `facts = await tickerFacts.get(symbol)` — a `NotFoundException` propagates as a 404.
3. `usualRisk = (await portfolio.getStats()).avgRisk`.
4. Build system prompt with the trader profile (reuse `LlmService`'s profile reading — extract it to a shared helper rather than duplicating the file read) and the user prompt from Task 1 of this slice.
5. `complete()`, wrapped in the same try/catch and `ERROR_COPY` mapping `LlmService` uses, so a busy model reads identically here.
6. `levels = parseProposedLevels(raw)`; `opinion = stripLevelsBlock(raw).trim()`.
7. `risk = levels ? computeTradeRisk({ entryPrice: facts.price, ...levels, usualRisk }) : null`.
8. `levelsUnreadable = levels === null`.

- [x] **Step 5: Add the route and register the service**

`@Post('trade-idea')` on `LlmController` with a DTO carrying `@IsString() @Length(1, 10) symbol`. Register `TradeIdeaService` and `TickerFactsService` in `llm.module.ts` (importing the market-data module rather than re-declaring the provider).

- [x] **Step 6: Run everything and commit**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run test:e2e
git add backend/src/llm backend/test/trade-idea.e2e-spec.ts
git commit -m "feat: the trade-idea opinion, with the app doing the arithmetic"
```

---

## Slice 3 — Persistence

### Task 6: Store each idea

**Files:**
- Create: `backend/src/database/migrations/1788739200000-AddTradeIdeas.ts`
- Create: `backend/src/llm/trade-idea.entity.ts`
- Modify: `backend/src/database/data-source.ts` (register the migration — it will silently never run otherwise)
- Modify: `backend/src/llm/trade-idea.service.ts` (save on success)
- Test: extend `backend/test/trade-idea.e2e-spec.ts`

**Interfaces:**
- Produces: table `trade_ideas` and entity `TradeIdea` with `id`, `userId`, `symbol`, `entryPrice`, `priceStale`, `stop`, `target`, `riskReward`, `opinion`, `factsSnapshot`, `model`, `createdAt`.

- [ ] **Step 1: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The opinions themselves are kept, though nothing about the researched
 * ticker is: `instruments` and `daily_closes` mean "things he owns", while
 * "what did the app say before I bought LMND" is a question that only gets
 * more valuable with time.
 *
 * `stop`, `target` and `riskReward` are nullable because an answer whose
 * levels could not be parsed is still worth keeping - it is a record of what
 * was said, minus the numbers the app refused to derive.
 */
export class AddTradeIdeas1788739200000 implements MigrationInterface {
  name = 'AddTradeIdeas1788739200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.trade_ideas (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        symbol varchar NOT NULL,
        "entryPrice" numeric(20,8) NOT NULL,
        "priceStale" boolean NOT NULL DEFAULT false,
        stop numeric(20,8),
        target numeric(20,8),
        "riskReward" numeric(20,8),
        opinion text NOT NULL,
        "factsSnapshot" text NOT NULL,
        model varchar NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trade_ideas_userId_createdAt"
        ON public.trade_ideas ("userId", "createdAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.trade_ideas;`);
  }
}
```

- [ ] **Step 2: Register it in `data-source.ts`**

Add the import and append the class to the migrations array, after the most recent one. Skipping this is the single most likely way to break this task: the array is hand-maintained on purpose and a glob is not used.

- [ ] **Step 3: Create the entity**

Mirror `ai-summary.entity.ts`: `@Entity('trade_ideas')`, `numericTransformer` on every numeric column, `stop`/`target`/`riskReward` nullable.

- [ ] **Step 4: Save on success, and test it**

In `TradeIdeaService.analyse`, after computing `risk`, persist the row inside the success path only — an unconfigured provider or a failed model call saves nothing, exactly as `LlmService` does for summaries. Add to the e2e spec:

```ts
it('persists the idea, including one whose levels could not be read', async () => {
  await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);
  await http(app, token).post('/ai/trade-idea').send({ symbol: 'NOLEVELS' }).expect(201);

  const rows = (await dataSource.query(
    `SELECT symbol, stop, "riskReward" FROM trade_ideas ORDER BY symbol`,
  )) as Array<{ symbol: string; stop: string | null; riskReward: string | null }>;
  expect(rows).toHaveLength(2);
  const noLevels = rows.find((r) => r.symbol === 'NOLEVELS')!;
  expect(noLevels.stop).toBeNull();
  expect(noLevels.riskReward).toBeNull();
});
```

- [ ] **Step 5: Run the migration and the suites**

```bash
cd backend && npm run migration:run   # local `trader`
npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run test:e2e
git add backend/src/database backend/src/llm backend/test/trade-idea.e2e-spec.ts
git commit -m "feat: persist trade ideas"
```

### Task 7: History endpoints

**Files:**
- Create: `backend/src/llm/trade-idea-history.service.ts`
- Modify: `backend/src/llm/llm.controller.ts`
- Test: extend `backend/test/trade-idea.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /ai/trade-ideas` (newest first, with a preview rather than the full opinion), `GET /ai/trade-ideas/:id`, `DELETE /ai/trade-ideas/:id`.

- [ ] **Step 1: Write the failing tests**

Assert: the list is newest first and omits `factsSnapshot`; an unknown id 404s on both GET and DELETE; a deleted idea is gone from the list. Mirror the assertions already in `test/ai-summaries.e2e-spec.ts`.

- [ ] **Step 2: Implement**

Copy the shape of `AiSummaryService` (`list`/`findOne`/`remove`), including its deliberate exclusion of the large snapshot column from the list query.

- [ ] **Step 3: Run and commit**

```bash
cd backend && npx vitest run && npm run test:e2e
git add backend/src/llm backend/test/trade-idea.e2e-spec.ts
git commit -m "feat: trade idea history"
```

---

## Slice 4 — The screen

### Task 8: The Ideas tab

**Files:**
- Create: `frontend/src/routes/Ideas.tsx`
- Modify: `frontend/src/main.tsx` (add `<Route path="ideas" element={<Ideas />} />`)
- Modify: `frontend/src/components/AppShell.tsx` (a fourth `NavLink` to `/ideas`)

- [ ] **Step 1: Build the screen**

A single text input for the ticker (uppercase on submit, no price field — the price is always the live quote), an "Ask" button using the same treatment as the AI summary's button, and a result card showing, in this order:

1. the opinion prose, rendered through the existing `Markdown` component
2. the proposed stop and target
3. the app-computed risk/reward and, when available, the sizing line: "To risk your usual $1,489, this stop implies 84 shares — $12,400."
4. the facts the opinion rests on (price, P/E, distance from the moving averages and the 52-week high, ATR, relative volume), collapsed by default

When `levelsUnreadable` is true, show the prose and a single line saying the model's levels could not be read, so no risk figures are shown. Never render a risk section with blanks in it.

Below the result, the history list from `GET /ai/trade-ideas`, each row expandable, with delete — mirroring the AI summary history already in `AiSummary.tsx`.

- [ ] **Step 2: Verify on the phone**

Run `npm run dev` from the repo root. On the phone:
- a real ticker returns an opinion, and the numbers below it match the facts panel
- an unknown ticker shows a clear "unknown ticker" message, not a crash
- the fourth tab does not crowd the other three at iPhone width
- history rows expand and delete

STOP here for the owner.

- [ ] **Step 3: Commit**

```bash
npm run build   # from the repo root - tsc -b enforces noUnusedLocals
git add frontend/src
git commit -m "feat: the Ideas tab"
```

---

---

## Slice 5 — Make the existing suite hermetic

### Task 9: No test reaches the network

**Files:**
- Create: `backend/test/yahoo-stub.ts`
- Modify: every e2e spec that boots `AppModule` — `portfolio`, `journal`, `trades`, `instruments`, `history`, `ai-summaries`, `health`, `auth`

**Why:** the specs written before this rule call Yahoo for real. They validate
`NVDA` against the live API and expect a genuine 404 for `ZZZZNOTREAL`, and
`portfolio.e2e-spec.ts:303` works around "ONDS's real, live-fetched quote".
That makes the suite fail offline, fail in CI without network, and quietly
assert something different each day as prices move.

- [x] **Step 1: Write the shared stub**

`backend/test/yahoo-stub.ts` exports `yahooStub()` returning an object with
`quote`, `quoteMany` and `dailyBars`. It answers for a fixed set of symbols
the specs already use and returns `null` from `quote` for anything else, so
`ZZZZNOTREAL` still 404s — for a deterministic reason rather than a network
one. Prices are fixed constants. `dailyBars` returns a generated flat series
with strictly increasing dates.

- [x] **Step 2: Apply it to one spec and prove it works offline**

Wire it into `instruments.e2e-spec.ts` first — the smallest surface. Then run
that spec with the network disabled (`sudo ifconfig en0 down`, or simply
disconnect Wi-Fi) and confirm it passes. Re-enable afterwards.

- [x] **Step 3: Apply it to the remaining specs**

One spec at a time, running each after wiring it. Where an assertion depends
on a live price, change the assertion to the stub's fixed value rather than
loosening it — a test that stops asserting a number is worse than one that
needed the network.

- [x] **Step 4: Verify the whole suite offline**

Disconnect the network entirely and run `cd backend && npm run test:e2e`.
Expected: every test passes. Reconnect. Note the runtime before and after in
the commit message — most of the current ~23s is network.

- [x] **Step 5: Commit**

```bash
git add backend/test
git commit -m "test: no e2e test reaches the network"
```

**Deviations:**

- **Offline was simulated in-process, not by pulling the Wi-Fi.** Step 2 and
  Step 4 called for disconnecting the network. Instead the suite ran with a
  preloaded guard that throws on any `net`/`tls`/`dns` call to a non-localhost
  host, leaving Postgres reachable. It is stricter than unplugging — it names
  the offending host and API — and it does not interrupt whatever else is using
  the connection. It was proved live with a deliberately network-touching spec
  that failed under it, so a pass means the guard was actually loaded in the
  vitest workers rather than silently absent.
- **`quote` resolves every symbol except `ZZZZ*`, rather than enumerating the
  specs' symbols.** Step 1 said unknown symbols return `null`. Enumerating would
  mean any future test introducing a symbol fails with a confusing 404 instead
  of doing what it says. The one behaviour the specs depend on is that
  `ZZZZNOTREAL` is not real, so that is what the stub encodes; unnamed symbols
  get a default price, since a test that cares about a price names it.
- **`dailyBars` is empty unless asked.** Several specs insert precise
  `daily_closes` rows to build a scenario — a high-water mark, a trade with no
  history at all — and a stub volunteering bars for every symbol would give "no
  history" a history. Only `history.e2e-spec.ts`, which exercises the backfill,
  passes `{ withBars: true }`.
- **The trailing-stop test got realistic prices.** `portfolio.e2e-spec.ts` used
  a bar high of 1000 solely to dominate ONDS's live quote. With the quote
  stubbed the bars are ordinary numbers (high 10.00, stop 9.15) — the point of
  the stub is that tests no longer need absurd values to defend against live
  data.
- **Runtime: ~23s to ~6s** for `test:e2e` (89 tests, 10 files), confirming most
  of the old duration was network.

## Done when

- A ticker can be typed and returns an opinion grounded in computed indicators
- The proposed stop and target come from the model; every derived figure comes from the app
- Unreadable levels produce prose and no numbers, with the reason stated
- Ideas are persisted and browsable, including ones whose levels failed to parse
- Nothing about a researched ticker appears in `instruments` or `daily_closes`
- A provider outage says so, distinctly from an unknown ticker, and yields no partial answer
