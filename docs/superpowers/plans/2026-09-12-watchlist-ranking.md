# Watchlist Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank the owner's watchlist best-to-worst for "what should I buy next", by reconciling an analyst consensus we fetch, the technicals we compute, and his own trading record.

**Architecture:** Four layers, built bottom-up. A new `quoteSummary` fetch in `yahoo.client.ts` (the only file allowed to import the provider) supplies the analyst view. A pure prompt builder assembles three views per ticker. A service gathers everything, makes ONE model call for the whole list, parses the ranked result, and caches it in a new table. The Watch tab renders the order with collapsible reasoning.

**Tech Stack:** NestJS 12, TypeORM, PostgreSQL 18, `yahoo-finance2` v4, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-09-12-watchlist-ranking-design.md`

## Global Constraints

- **`yahoo.client.ts` is the only file that may import `yahoo-finance2`** (CLAUDE.md invariant 6). The new consensus fetch goes there and nowhere else.
- **No test may reach the network.** `test/offline-guard.ts` throws on any non-localhost connection. `YahooClient` is stubbed via `overrideProvider` with `test/yahoo-stub.ts` in every e2e spec that boots `AppModule`.
- **Every service resolves `usersService.currentUser()`, never `ensureDefaultUser()`** (invariant 9). Serving the owner's data to whoever asked is a data leak no type checker catches.
- **The frontend displays; the backend computes** (invariant 5). No ranking arithmetic, no score derivation, no re-deriving anything in `frontend/`.
- **Schema changes go through a migration** in `backend/src/database/migrations/`, registered by hand in `data-source.ts`. Never `synchronize: true`.
- **Percent-style fields are FRACTIONS**, matching `unrealizedPct` and `stop-distance.ts`. `formatPercent` multiplies by 100 on the way out.
- **Watchlist cap: 50 tickers.** Enforced as a refusal on the 51st, never a silent truncation.
- **No numeric score reaches the screen.** The order carries the comparison.
- **Money/percent formatting** uses `frontend/src/components/format.ts` (`formatMoney`, `formatPercent`).
- Run `npm run migration:run` from `backend/` after adding a migration. Do NOT run `nest build` while a watcher is running — use `npx tsc --noEmit -p tsconfig.json`.

---

### Task 1: Analyst consensus from Yahoo

**Files:**
- Modify: `backend/src/market-data/yahoo.client.ts`
- Modify: `backend/test/yahoo-stub.ts`
- Test: `backend/src/market-data/yahoo.client.spec.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `RawConsensus` and `YahooClient.consensus(symbol: string): Promise<RawConsensus | null>`, plus `yahooStub({ withConsensus?: boolean })`.

```ts
export interface RawConsensus {
  /** 1 = strong buy … 5 = sell. Null when no analyst covers it. */
  recommendationMean: number | null;
  /** e.g. 'strong_buy', 'buy', 'hold'. */
  recommendationKey: string | null;
  analystCount: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  /** Fractions, like every other percent in this codebase. 1.059 = +105.9%. */
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  profitMargin: number | null;
  returnOnEquity: number | null;
  /** Most recent month first: how many analysts sit in each bucket. */
  trend: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[];
}
```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/market-data/yahoo.client.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { YahooClient } from './yahoo.client.js';

describe('YahooClient.consensus', () => {
  it('maps the provider payload to our own shape', async () => {
    const client = new YahooClient();
    // The provider is injected for the test; see the `yf` note in the class.
    (client as unknown as { yf: unknown }).yf = {
      quoteSummary: vi.fn().mockResolvedValue({
        financialData: {
          recommendationMean: 1.28,
          recommendationKey: 'strong_buy',
          numberOfAnalystOpinions: 57,
          targetMeanPrice: 327.65,
          targetHighPrice: 515,
          targetLowPrice: 180,
          revenueGrowth: 1.059,
          earningsGrowth: 1.278,
          profitMargins: 0.63663,
          returnOnEquity: 1.17211,
        },
        recommendationTrend: {
          trend: [{ period: '0m', strongBuy: 9, buy: 48, hold: 2, sell: 1, strongSell: 0 }],
        },
      }),
    };

    const c = await client.consensus('NVDA');

    expect(c).not.toBeNull();
    expect(c!.recommendationMean).toBeCloseTo(1.28, 2);
    expect(c!.analystCount).toBe(57);
    expect(c!.targetMean).toBeCloseTo(327.65, 2);
    expect(c!.trend[0].buy).toBe(48);
  });

  /**
   * ETFs and thin names genuinely have no coverage. Null, never zero: a zero
   * recommendationMean would read as "strong buy" on a 1..5 scale, which is
   * the worst possible way to be wrong.
   */
  it('returns null when nothing covers the ticker', async () => {
    const client = new YahooClient();
    (client as unknown as { yf: unknown }).yf = {
      quoteSummary: vi.fn().mockResolvedValue({ financialData: {} }),
    };
    expect(await client.consensus('SPY')).toBeNull();
  });

  /** A provider outage must not fail the ranking; the view goes missing. */
  it('returns null rather than throwing when the provider fails', async () => {
    const client = new YahooClient();
    (client as unknown as { yf: unknown }).yf = {
      quoteSummary: vi.fn().mockRejectedValue(new Error('network down')),
    };
    expect(await client.consensus('NVDA')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/market-data/yahoo.client.spec.ts`
Expected: FAIL — `client.consensus is not a function`.

- [ ] **Step 3: Implement `consensus`**

Add to `backend/src/market-data/yahoo.client.ts`, beside `quote` and `dailyBars`:

```ts
export interface RawConsensus {
  recommendationMean: number | null;
  recommendationKey: string | null;
  analystCount: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  profitMargin: number | null;
  returnOnEquity: number | null;
  trend: {
    period: string;
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  }[];
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
```

```ts
  /**
   * What the street thinks: analyst consensus, price targets, growth and
   * margins.
   *
   * Bought in rather than computed. The app does not try to out-analyse
   * fifty-seven analysts, and this is free from the provider already in use —
   * no new vendor, no API key, and invariant 6 intact because the import
   * stays in this file.
   *
   * Null, never a zero or a default, when nothing covers the ticker. On a
   * 1..5 scale where 1 is "strong buy", a zero would read as the strongest
   * possible recommendation — the worst available way to be wrong. ETFs and
   * thin names legitimately have no coverage.
   */
  async consensus(symbol: string): Promise<RawConsensus | null> {
    try {
      const r = await this.provider().quoteSummary(symbol, {
        modules: ['financialData', 'recommendationTrend'],
      });
      const f = (r?.financialData ?? {}) as Record<string, unknown>;
      const mean = num(f.recommendationMean);
      const analysts = num(f.numberOfAnalystOpinions);
      // No mean and no analysts means no coverage, not a quiet zero.
      if (mean === null && analysts === null) return null;
      const trendRows = (r?.recommendationTrend?.trend ?? []) as Record<string, number>[];
      return {
        recommendationMean: mean,
        recommendationKey:
          typeof f.recommendationKey === 'string' ? f.recommendationKey : null,
        analystCount: analysts,
        targetMean: num(f.targetMeanPrice),
        targetHigh: num(f.targetHighPrice),
        targetLow: num(f.targetLowPrice),
        revenueGrowth: num(f.revenueGrowth),
        earningsGrowth: num(f.earningsGrowth),
        profitMargin: num(f.profitMargins),
        returnOnEquity: num(f.returnOnEquity),
        trend: trendRows.map((t) => ({
          period: String(t.period ?? ''),
          strongBuy: Number(t.strongBuy ?? 0),
          buy: Number(t.buy ?? 0),
          hold: Number(t.hold ?? 0),
          sell: Number(t.sell ?? 0),
          strongSell: Number(t.strongSell ?? 0),
        })),
      };
    } catch (err) {
      this.log.warn(`consensus unavailable for ${symbol}: ${String(err)}`);
      return null;
    }
  }
```

If the class has no `provider()` helper, use whatever accessor `quote()` already uses to reach the library instance, and mirror its lazy-construction comment. Do not introduce a second way of reaching the provider.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/market-data/yahoo.client.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Teach the stub about consensus**

In `backend/test/yahoo-stub.ts`, add to the options and the returned object:

```ts
/**
 * Fixed, obviously synthetic consensus. Opt-in like `withBars`, so specs that
 * do not care are not handed data they then have to ignore. SPY returns null
 * on purpose — it is the suite's "no analyst coverage" case, which the
 * ranking must handle as neutral rather than as a penalty.
 */
consensus: async (symbol: string) =>
  !options.withConsensus || symbol.toUpperCase() === 'SPY'
    ? null
    : {
        recommendationMean: 2,
        recommendationKey: 'buy',
        analystCount: 10,
        targetMean: (STUB_PRICES[symbol.toUpperCase()] ?? 100) * 1.2,
        targetHigh: (STUB_PRICES[symbol.toUpperCase()] ?? 100) * 1.5,
        targetLow: (STUB_PRICES[symbol.toUpperCase()] ?? 100) * 0.9,
        revenueGrowth: 0.2,
        earningsGrowth: 0.3,
        profitMargin: 0.25,
        returnOnEquity: 0.4,
        trend: [{ period: '0m', strongBuy: 2, buy: 6, hold: 2, sell: 0, strongSell: 0 }],
      },
```

Add `withConsensus?: boolean;` to the stub's options interface.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && npx vitest run && npm run test:e2e`
Expected: all pass. The stub change is additive; nothing existing reads `consensus` yet.

- [ ] **Step 7: Commit**

```bash
git add backend/src/market-data/yahoo.client.ts backend/src/market-data/yahoo.client.spec.ts backend/test/yahoo-stub.ts
git commit -m "feat: fetch analyst consensus, the rating we buy in rather than invent"
```

---

### Task 2: The cached ranking table

**Files:**
- Create: `backend/src/watchlist/watchlist-ranking.entity.ts`
- Create: `backend/src/database/migrations/1789344000000-AddWatchlistRankings.ts`
- Modify: `backend/src/database/data-source.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: entity `WatchlistRanking` with fields `id`, `userId`, `rankedAt`, `model`, `payload` (JSON string), `factsSnapshot` (JSON string).

- [ ] **Step 1: Write the entity**

```ts
// backend/src/watchlist/watchlist-ranking.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One computed ranking of the whole watchlist, kept so the Watch tab opens
 * instantly and a model call happens once a day rather than once a visit.
 *
 * `factsSnapshot` is not optional, for the same reason `ai_summaries` keeps
 * one: an answer whose inputs are gone cannot be audited, and "why did it say
 * that" is a question he will ask. The facts are what the model actually read.
 */
@Entity('watchlist_rankings')
export class WatchlistRanking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  /** When the ranking was computed — shown in the UI, never hidden. */
  @Index()
  @Column({ type: 'timestamptz' })
  rankedAt: Date;

  /** Which model produced it, recorded alongside the answer. */
  @Column()
  model: string;

  /** The ranked rows, as JSON. See RankedTicker in watchlist-ranking.types.ts. */
  @Column('text')
  payload: string;

  /** The three views the model was given, as JSON. */
  @Column('text')
  factsSnapshot: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: Write the migration**

```ts
// backend/src/database/migrations/1789344000000-AddWatchlistRankings.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The cached watchlist ranking.
 *
 * Rows accumulate rather than being overwritten: what the model said last
 * week, and the facts it said it from, are worth keeping for the same reason
 * ai_summaries are. The read path takes the newest row per user.
 */
export class AddWatchlistRankings1789344000000 implements MigrationInterface {
  name = 'AddWatchlistRankings1789344000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.watchlist_rankings (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "rankedAt" timestamptz NOT NULL,
        model varchar NOT NULL,
        payload text NOT NULL,
        "factsSnapshot" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_watchlist_rankings_user_ranked"
        ON public.watchlist_rankings ("userId", "rankedAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.watchlist_rankings;`);
  }
}
```

- [ ] **Step 3: Register the migration**

In `backend/src/database/data-source.ts`, add the import beside the others and append `AddWatchlistRankings1789344000000` to the `migrations` array, in order. The array is hand-maintained on purpose — a glob silently matched nothing in a sibling project.

- [ ] **Step 4: Run the migration and verify the table**

Run:
```bash
cd backend && npm run migration:run
psql -d trader -c '\d watchlist_rankings'
```
Expected: the table exists with the seven columns above.

- [ ] **Step 5: Run the suites**

Run: `cd backend && npx vitest run && npm run test:e2e`
Expected: all pass. `trader_test` is dropped and recreated per run, so the new migration runs there automatically.

- [ ] **Step 6: Commit**

```bash
git add backend/src/watchlist/watchlist-ranking.entity.ts backend/src/database/migrations/1789344000000-AddWatchlistRankings.ts backend/src/database/data-source.ts
git commit -m "feat: a table for the cached watchlist ranking, facts included"
```

---

### Task 3: The 50-ticker cap

**Files:**
- Modify: `backend/src/watchlist/watchlist.service.ts`
- Test: `backend/test/watchlist.e2e-spec.ts`

**Interfaces:**
- Consumes: `WatchlistService.upsert` from the existing code.
- Produces: exported `WATCHLIST_LIMIT = 50`.

- [ ] **Step 1: Write the failing test**

Add inside the existing top-level `describe` in `backend/test/watchlist.e2e-spec.ts`:

```ts
  /**
   * A cap, refused loudly. A ranking that quietly covers part of a list is
   * worse than a list that refuses to grow, and the cap is also what makes
   * one model call for the whole watchlist viable.
   */
  it('refuses the fifty-first ticker, naming the limit', async () => {
    const symbols = Object.keys(STUB_PRICES).slice(0, 50);
    // The stub prices fewer than fifty symbols; top up with synthetic ones it
    // also knows. If the stub has fewer than 50, this test documents the cap
    // with whatever it has plus a direct insert.
    for (const s of symbols) {
      await add({ symbol: s }).expect(201);
    }
    const res = await add({ symbol: 'ZZZZ_OVER_LIMIT' });
    expect([400, 404]).toContain(res.status);
  });
```

If `STUB_PRICES` has fewer than 50 entries, extend `test/yahoo-stub.ts` with enough obviously-synthetic symbols (`E2E1`…`E2E60`, all priced 100) rather than weakening the assertion. Import `STUB_PRICES` from `./yahoo-stub.js`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/watchlist.e2e-spec.ts -t 'fifty-first'`
Expected: FAIL — the 51st is accepted with 201.

- [ ] **Step 3: Enforce the cap**

In `backend/src/watchlist/watchlist.service.ts`, above the class:

```ts
/**
 * How many tickers may be watched at once.
 *
 * Fifty is a product decision, not a technical one, and it does two jobs: it
 * keeps the list readable, and it bounds the ranking prompt, which is what
 * makes one model call for the whole watchlist possible. Enforced as a
 * refusal rather than a truncation — a ranking that silently covers part of a
 * list is worse than a list that will not grow.
 */
export const WATCHLIST_LIMIT = 50;
```

In `upsert`, after resolving the instrument and before creating a NEW item (the existing-item branch must stay editable at any size):

```ts
    if (!item) {
      const count = await this.items.count({ where: { userId: user.id } });
      if (count >= WATCHLIST_LIMIT) {
        throw new BadRequestException(
          `The watchlist holds ${WATCHLIST_LIMIT} tickers at most. Remove one before adding another.`,
        );
      }
      item = this.items.create({ ... });   // existing creation, unchanged
    }
```

Import `BadRequestException` from `@nestjs/common` if it is not already imported.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/watchlist.e2e-spec.ts`
Expected: PASS, all watchlist specs.

- [ ] **Step 5: Commit**

```bash
git add backend/src/watchlist/watchlist.service.ts backend/test/watchlist.e2e-spec.ts backend/test/yahoo-stub.ts
git commit -m "feat: cap the watchlist at fifty, refused rather than truncated"
```

---

### Task 4: The prompt — three views per ticker

**Files:**
- Create: `backend/src/llm/watchlist-ranking-prompt.ts`
- Test: `backend/src/llm/watchlist-ranking-prompt.spec.ts`

**Interfaces:**
- Consumes: `RawConsensus` (Task 1); `buildBookSection(book, symbol)` and `buildRecordSection(rec, symbol)` from `trade-idea-context.ts`; `IndicatorSet` from `market-data/indicators.ts`.
- Produces:

```ts
export interface RankingCandidate {
  symbol: string;
  name: string | null;
  price: number | null;
  /** The tape. */
  indicators: IndicatorSet;
  /** The street. Null means no analyst covers it. */
  consensus: RawConsensus | null;
  /** His own target, if he set one, and how far away it is (a fraction). */
  targetPrice: number | null;
  distanceToTarget: number | null;
  /** His tags on the item — sector, style, whatever he chose. */
  tags: string[];
  note: string;
}

export function buildRankingUserPrompt(
  candidates: RankingCandidate[],
  bookSection: string,
  recordSection: string,
  profile: string,
): string;

export const RANKING_SYSTEM_PROMPT: string;
```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/llm/watchlist-ranking-prompt.spec.ts
import { describe, expect, it } from 'vitest';
import {
  buildRankingUserPrompt,
  RANKING_SYSTEM_PROMPT,
  type RankingCandidate,
} from './watchlist-ranking-prompt.js';

const indicators = {
  sma20: 100, sma50: 98, sma150: 95, sma200: 90,
  percentFromSma20: 0.05, percentFromSma50: 0.07,
  percentFromSma150: 0.08, percentFromSma200: 0.12,
  high52w: 120, low52w: 60,
  percentFromHigh52w: -0.1, percentFromLow52w: 0.8,
  atr14: 3, atrPercentOfPrice: 0.03,
  relativeVolume: 1.4, barsAvailable: 345,
};

const covered: RankingCandidate = {
  symbol: 'NVDA', name: 'NVIDIA', price: 108, indicators,
  consensus: {
    recommendationMean: 1.3, recommendationKey: 'strong_buy', analystCount: 57,
    targetMean: 160, targetHigh: 200, targetLow: 90,
    revenueGrowth: 1.05, earningsGrowth: 1.2, profitMargin: 0.6, returnOnEquity: 1.1,
    trend: [{ period: '0m', strongBuy: 9, buy: 48, hold: 2, sell: 1, strongSell: 0 }],
  },
  targetPrice: 130, distanceToTarget: 0.2, tags: ['semis'], note: 'breakout watch',
};

const uncovered: RankingCandidate = {
  ...covered, symbol: 'SPY', name: 'S&P 500 ETF', consensus: null,
  targetPrice: null, distanceToTarget: null, tags: [], note: '',
};

describe('buildRankingUserPrompt', () => {
  it('carries all three views for a covered ticker', () => {
    const p = buildRankingUserPrompt([covered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toContain('NVDA');
    expect(p).toContain('57');            // the street
    expect(p).toContain('150-day');       // the tape, named as his indicator
    expect(p).toContain('BOOK');          // him
    expect(p).toContain('RECORD');
    expect(p).toContain('PROFILE');
  });

  /**
   * The missing view is neutral, and SAID to be missing. A ticker ranked on
   * two views beside one ranked on three, with nothing to tell them apart, is
   * a judgement wearing confidence it has not earned.
   */
  it('says plainly when a ticker has no analyst coverage', () => {
    const p = buildRankingUserPrompt([uncovered], 'BOOK', 'RECORD', 'PROFILE');
    expect(p).toMatch(/no analyst coverage/i);
  });

  it('tells the model to treat a missing view as mid-range, not as zero', () => {
    expect(RANKING_SYSTEM_PROMPT).toMatch(/middle of the range|neutral/i);
    expect(RANKING_SYSTEM_PROMPT).toMatch(/not.*zero|never.*penalis/i);
  });

  it('forbids a numeric score in the output', () => {
    expect(RANKING_SYSTEM_PROMPT).toMatch(/do not .*score|no numeric/i);
  });

  it('lists every candidate given to it', () => {
    const p = buildRankingUserPrompt([covered, uncovered], 'B', 'R', 'P');
    expect(p).toContain('NVDA');
    expect(p).toContain('SPY');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/llm/watchlist-ranking-prompt.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the prompt builder**

Create `backend/src/llm/watchlist-ranking-prompt.ts`. Model it on `trade-idea-prompt.ts` — same formatting helpers, same house voice. The system prompt must state, in its own words:

- rank the candidates best to worst for "what should I buy next"
- three views: the street (bought in), the tape (computed), and his record
- reconcile them, and say so when they disagree — that is the point
- a missing view is treated as the MIDDLE of its range, never as zero, and never as a penalty
- name the missing view in that ticker's line
- output one line of verdict per ticker plus a paragraph of reasoning
- **no numeric score, no position size, no dollar figure** — the app derives size from a stop, and the order carries the comparison
- return every candidate exactly once

Define the output contract explicitly so Task 5 can parse it — a fenced block per ticker:

```
[RANK]
SYMBOL: NVDA
VERDICT: one line, under 120 characters
COVERAGE: full | no-analyst-coverage
[/RANK]
...reasoning paragraphs, referencing tickers by symbol...
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/llm/watchlist-ranking-prompt.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/watchlist-ranking-prompt.ts backend/src/llm/watchlist-ranking-prompt.spec.ts
git commit -m "feat: the ranking prompt — the street, the tape, and his record"
```

---

### Task 5: Parsing the ranked answer

**Files:**
- Create: `backend/src/llm/watchlist-ranking-parse.ts`
- Test: `backend/src/llm/watchlist-ranking-parse.spec.ts`

**Interfaces:**
- Consumes: the output contract from Task 4.
- Produces:

```ts
export interface RankedTicker {
  symbol: string;
  verdict: string;
  /** True when the model was told this ticker has no analyst coverage. */
  noAnalystCoverage: boolean;
}

export interface ParsedRanking {
  order: RankedTicker[];
  /** Everything outside the [RANK] blocks — the reasoning, verbatim. */
  reasoning: string;
  /** Candidates the model failed to rank. Never silently dropped. */
  missing: string[];
}

export function parseRanking(text: string, expected: string[]): ParsedRanking;
```

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/llm/watchlist-ranking-parse.spec.ts
import { describe, expect, it } from 'vitest';
import { parseRanking } from './watchlist-ranking-parse.js';

const answer = `
[RANK]
SYMBOL: PLTR
VERDICT: Nearest a breakout with the street behind it.
COVERAGE: full
[/RANK]
[RANK]
SYMBOL: SPY
VERDICT: Steady, but nothing here is a setup you trade.
COVERAGE: no-analyst-coverage
[/RANK]

### Why
PLTR sits 3% under its high while you are already long two semis.
`;

describe('parseRanking', () => {
  it('reads the order the model gave, not alphabetical or input order', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.order.map((t) => t.symbol)).toEqual(['PLTR', 'SPY']);
  });

  it('keeps each verdict', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.order[0].verdict).toContain('breakout');
  });

  it('flags the ticker the model was told has no coverage', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.order[1].noAnalystCoverage).toBe(true);
    expect(r.order[0].noAnalystCoverage).toBe(false);
  });

  it('keeps the reasoning outside the blocks, verbatim', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR']);
    expect(r.reasoning).toContain('already long two semis');
    expect(r.reasoning).not.toContain('[RANK]');
  });

  /**
   * A candidate the model dropped is REPORTED, not quietly absent. A ranking
   * that silently covers part of the list is the failure the fifty-ticker cap
   * exists to prevent; it must not reappear here.
   */
  it('reports a candidate the model failed to rank', () => {
    const r = parseRanking(answer, ['SPY', 'PLTR', 'AMD']);
    expect(r.missing).toEqual(['AMD']);
  });

  it('ignores a symbol the model invented', () => {
    const r = parseRanking(answer, ['PLTR']);
    expect(r.order.map((t) => t.symbol)).toEqual(['PLTR']);
  });

  it('returns an empty order rather than throwing on unparseable text', () => {
    const r = parseRanking('the model rambled', ['NVDA']);
    expect(r.order).toEqual([]);
    expect(r.missing).toEqual(['NVDA']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/llm/watchlist-ranking-parse.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser**

Create `backend/src/llm/watchlist-ranking-parse.ts`, modelled on `trade-idea-parse.ts`. Requirements the tests pin: preserve the model's order; strip `[RANK]` blocks from the reasoning; drop symbols not in `expected`; report expected symbols with no block in `missing`; never throw.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/llm/watchlist-ranking-parse.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/watchlist-ranking-parse.ts backend/src/llm/watchlist-ranking-parse.spec.ts
git commit -m "feat: parse the ranked answer, reporting anything the model dropped"
```

---

### Task 6: The ranking service, cached daily

**Files:**
- Create: `backend/src/watchlist/watchlist-ranking.service.ts`
- Modify: `backend/src/watchlist/watchlist.module.ts`
- Modify: `backend/src/watchlist/watchlist.controller.ts`
- Modify: `backend/src/market-data/market-data.service.ts` (expose `getConsensus`)
- Test: `backend/test/watchlist-ranking.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5; `WatchlistService.list()`; `TradesService.getStats()`; `PortfolioService.getPortfolio()`; `LlmClient.complete({ system, user })`, `LlmClient.isConfigured()`, `LlmClient.modelName()`.
- Produces: `GET /watchlist/ranking` and `POST /watchlist/ranking/refresh`, both returning:

```ts
interface RankingResponse {
  configured: boolean;        // false when no LLM key
  rankedAt: string | null;    // ISO; null when never computed
  model: string | null;
  order: RankedTicker[];
  reasoning: string | null;
  missing: string[];
  stale: boolean;             // older than 24h
}
```

- [ ] **Step 1: Write the failing e2e test**

```ts
// backend/test/watchlist-ranking.e2e-spec.ts
// Boot AppModule with yahooStub({ withBars: true, withConsensus: true }) and a
// stubbed LlmClient whose complete() returns a fixed [RANK] answer, exactly
// as ai-summaries.e2e-spec.ts stubs the LLM today. Copy that spec's setup.
```

Tests to write:

```ts
  it('has no ranking before one is asked for', async () => {
    const res = await http(app, token).get('/watchlist/ranking').expect(200);
    expect(res.body.rankedAt).toBeNull();
    expect(res.body.order).toEqual([]);
  });

  it('ranks the watchlist on refresh and stores it', async () => {
    await add({ symbol: 'NVDA' }).expect(201);
    await add({ symbol: 'PLTR' }).expect(201);
    const res = await http(app, token).post('/watchlist/ranking/refresh').expect(201);
    expect(res.body.order.map((t: { symbol: string }) => t.symbol)).toEqual(['PLTR', 'NVDA']);
    expect(res.body.rankedAt).toBeTruthy();
    expect(res.body.model).toBeTruthy();
  });

  it('serves the stored ranking without calling the model again', async () => {
    await add({ symbol: 'NVDA' }).expect(201);
    await http(app, token).post('/watchlist/ranking/refresh').expect(201);
    const calls = llmStub.complete.mock.calls.length;
    await http(app, token).get('/watchlist/ranking').expect(200);
    expect(llmStub.complete.mock.calls.length).toBe(calls);
  });

  /** Invariant 9: one user's ranking is never another's. */
  it('keeps two users rankings apart', async () => { /* sign up a second user, GET, expect empty */ });

  it('says so plainly when no model is configured', async () => { /* isConfigured false → configured:false, no throw */ });

  it('reports a ticker the model dropped rather than hiding it', async () => { /* stub answer omitting one symbol → missing: [symbol] */ });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/watchlist-ranking.e2e-spec.ts`
Expected: FAIL — 404, the routes do not exist.

- [ ] **Step 3: Expose consensus through MarketDataService**

Add a `getConsensus(symbol: string): Promise<RawConsensus | null>` that delegates to `YahooClient.consensus`, with the same in-memory cache treatment `getQuote` uses but a longer TTL — analyst consensus moves over weeks, not seconds. Nothing outside `market-data/` may call the client directly.

- [ ] **Step 4: Write the service**

`WatchlistRankingService` with:

- `current(): Promise<RankingResponse>` — newest row for `currentUser()`, `stale` when `rankedAt` is over 24h old. No model call, ever.
- `refresh(): Promise<RankingResponse>` — gathers candidates from `WatchlistService.list()`, fetches consensus for each (`Promise.allSettled`, a null consensus is a missing view, never a failure), gathers book/record/profile the way `TradeIdeaService.analyse` does, builds ONE prompt, makes ONE `complete()` call, parses, stores, returns.
- Short-circuit `isConfigured()` before any fetching, as `TradeIdeaService` does — with no key there is no answer to produce and the provider calls would be wasted.
- Refuse with a clear error if `candidates.length > WATCHLIST_LIMIT`, rather than truncating.

- [ ] **Step 5: Wire the routes and the module**

`GET /watchlist/ranking` → `current()`. `POST /watchlist/ranking/refresh` → `refresh()`. Both before the `:id` routes in the controller, so "ranking" is never matched as an id — the same ordering `tags` already needs. Register `WatchlistRanking` in `TypeOrmModule.forFeature` and the service in providers.

- [ ] **Step 6: Run the tests**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/watchlist-ranking.e2e-spec.ts && npm run test:e2e && npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/watchlist backend/src/market-data/market-data.service.ts backend/test/watchlist-ranking.e2e-spec.ts
git commit -m "feat: rank the watchlist in one call, cached daily"
```

---

### Task 7: The ranking on the Watch tab

**Files:**
- Modify: `frontend/src/routes/Watchlist.tsx`
- Test: `frontend/src/routes/Watchlist.spec.tsx`

**Interfaces:**
- Consumes: `GET /watchlist/ranking`, `POST /watchlist/ranking/refresh` (Task 6).
- Produces: no exports; UI only.

- [ ] **Step 1: Write the failing tests**

```tsx
  it('shows the ranked order, best first', async () => { /* stub /watchlist/ranking → assert row order */ });

  it('says when a ticker was ranked without analyst coverage', async () => {
    // noAnalystCoverage: true → the row says so, so two views are never
    // mistaken for three.
  });

  it('says how old the ranking is', async () => { /* rankedAt → "ranked 3 hours ago" or similar */ });

  it('hides the reasoning behind the app-wide collapsible card', async () => {
    // CollapsibleCard: collapsed shows one header line; the reasoning is not
    // in the document until opened.
  });

  it('asks for a fresh ranking on demand', async () => { /* click refresh → POST fired */ });

  it('says plainly when no ranking has been computed yet', async () => { /* rankedAt null → prompt, no empty list */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/routes/Watchlist.spec.tsx`
Expected: FAIL — nothing renders a ranking.

- [ ] **Step 3: Render it**

Above the "Watching" list: the ranked order, each row showing position, symbol and the one-line verdict, with `noAnalystCoverage` rows carrying a short muted note. The reasoning goes inside `CollapsibleCard` (`label="ranking"`), per the app-wide rule that any AI answer is collapsible and collapsed means one header line. The header carries the age and the refresh control — never hidden, because a ranking whose age is hidden is a stale price wearing a fresh face.

Display only: no sorting, no scoring, no re-deriving. The order arrives ranked.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run && npx tsc -b --force && npm run build`
Expected: all pass, typecheck and build clean. Note `tsc -b`, not `-p tsconfig.json` — the latter checks zero files in `frontend/`.

- [ ] **Step 5: Look at it in a browser**

Per CLAUDE.md's "Look at it before handing it over": write a throwaway `probe-ranking.html` + `src/probe-ranking.tsx` rendering the page with a fixture ranking, open it at phone width, confirm the order reads clearly, the coverage note is legible, and the collapsed card is one line. Delete both files in the same commit.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/Watchlist.tsx frontend/src/routes/Watchlist.spec.tsx
git commit -m "feat: the watchlist ranking on screen, reasoning collapsible"
```

---

### Task 8: A browser test, and the docs

**Files:**
- Modify: `e2e/watchlist.spec.ts`
- Modify: `CLAUDE.md`
- Modify: `docs/api.md`

- [ ] **Step 1: Add the browser test**

In `e2e/watchlist.spec.ts`, one spec: sign up, add two tickers, click refresh, assert the ranked list appears in the model's order and that the reasoning is hidden until the card is opened. The e2e server stubs the LLM the same way it stubs Yahoo — extend `backend/src/main.e2e.ts` with an `LlmClient` override returning a fixed `[RANK]` answer, mirroring how `YahooClient` is overridden there. Do not let the browser suite reach a real model.

- [ ] **Step 2: Run the browser suite**

Run: `npm run test:browser`
Expected: all pass, including the new spec.

- [ ] **Step 3: Update the docs**

- `docs/api.md`: add `GET /watchlist/ranking` and `POST /watchlist/ranking/refresh` to the route table, noting which writes.
- `CLAUDE.md`: add `watchlist_rankings` to the Layout section's `backend/src/watchlist/` line, and add the ranking to the Phase status "Since the phases" bullet.

- [ ] **Step 4: Full verification**

Run:
```bash
cd backend && npx vitest run && npm run test:e2e && npx tsc -p tsconfig.build.json --noEmit
cd ../frontend && npx vitest run && npx tsc -b --force && npm run build
cd .. && npm run test:browser
```
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add e2e/watchlist.spec.ts backend/src/main.e2e.ts CLAUDE.md docs/api.md
git commit -m "test: the ranking end to end, and the docs that point at it"
```

---

## Notes for the executor

**Deploying.** `main` deploys automatically: Cloudflare Pages for `frontend/**`, Render for everything (it runs `node dist/database/migrate.js && node dist/main`, so the migration lands before the new code boots). The owner's production database already holds real data — never run seed or reset against it.

**The owner reviews on a phone.** A clean typecheck proves very little about a mobile UI; several bugs have existed only there.

**If something breaks, follow the four-step rule** in CLAUDE.md: fix, cover with a test, post-mortem why the tests missed it, then sweep for the same shape elsewhere.
