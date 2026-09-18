# AI Outcome Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically grade every AI trade-idea, symbol-pattern and trade-review opinion against what actually happened, without any human rating, so the app can eventually answer "is this AI feature actually any good."

**Architecture:** One new table, `ai_outcomes`, gets a `pending` row the moment each of the three opinion services persists its own row. A new `AiOutcomeService.resolvePending()` walks a user's pending rows on read (no scheduler exists in this app) and grades each one: trade-idea against live-fetched daily bars vs. its stop/target, symbol-pattern/trade-review against whether the mistake tag they named recurs in the trader's next closed trade in that symbol.

**Tech Stack:** NestJS, TypeORM/Postgres, Vitest, class-validator, the existing `YahooClient`/`HistoryService` market-data stack.

**Spec:** `docs/superpowers/specs/2026-09-18-ai-outcome-tracking-design.md`

## Global Constraints

- Every service resolves identity via `UsersService.currentUser()` — never `ensureDefaultUser()`.
- Any schema change needs a TypeORM migration registered by hand in `backend/src/database/data-source.ts` (no glob discovery).
- No test may reach the network or a real provider — `LLM_API_KEY`/`FINNHUB_API_KEY` are forced empty in the test env, and `YahooClient` is always stubbed/overridden in e2e tests, never called for real.
- `daily_closes` must never gain a row for a ticker that was only researched, never held/watched — trade-idea outcome grading fetches bars live and does not persist them (see Task 1).
- TDD throughout: write the failing test, run it, confirm it fails for the right reason, then implement, then run again to confirm green.
- e2e tests run against `trader_test` only, via `backend/test/setup-database.ts`, which drops and recreates it fresh with every registered migration on every run.

---

### Task 1: `HistoryService.liveDailyBars` — bars for a ticker, never persisted

**Files:**
- Modify: `backend/src/market-data/history.service.ts`
- Test: `backend/src/market-data/history.service.spec.ts`

**Interfaces:**
- Produces: `HistoryService.liveDailyBars(symbol: string, from: Date): Promise<RawBar[]>` — used by `AiOutcomeService` in Task 7. Never throws; returns `[]` on any provider failure.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/market-data/history.service.spec.ts`, after the existing `describe('HistoryService.ensurePriced', ...)` block:

```typescript
describe('HistoryService.liveDailyBars', () => {
  it('returns whatever the provider hands back, without touching daily_closes', async () => {
    const { service, closes, yahoo } = makeService({
      existingBarCount: 0,
      bars: [
        {
          date: '2026-09-01',
          close: 163.88,
          adjClose: 163.88,
          open: 160,
          high: 165,
          low: 159,
          volume: 1_000_000,
        },
      ],
    });

    const bars = await service.liveDailyBars('CRWV', new Date('2026-08-01'));

    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(163.88);
    expect(yahoo.dailyBars).toHaveBeenCalledWith('CRWV', new Date('2026-08-01'));
    expect(closes.upsert).not.toHaveBeenCalled();
  });

  it('returns an empty array, not a throw, when the provider fails', async () => {
    const { service } = makeService({
      existingBarCount: 0,
      yahooError: new Error('provider down'),
    });

    const bars = await service.liveDailyBars('CRWV', new Date('2026-08-01'));

    expect(bars).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- history.service.spec.ts` (from `backend/`)
Expected: FAIL — `service.liveDailyBars is not a function`

- [ ] **Step 3: Write minimal implementation**

In `backend/src/market-data/history.service.ts`, change the import line:

```typescript
import { YahooClient, type RawBar } from './yahoo.client.js';
```

Add this method to the `HistoryService` class, after `ensureFresh` and before the private `fetchAndStore`:

```typescript
  /**
   * Bars for a symbol over a window, fetched live and never persisted —
   * every other method here exists to keep `daily_closes` current for a
   * symbol the owner holds or watches, and writing a row there for a
   * merely-researched ticker would quietly change what that table means
   * (see `TickerFactsService`'s own doc comment for the same rule). A
   * caller that wants bars for a ticker that was only ever looked at —
   * `AiOutcomeService` grading a trade idea — uses this instead.
   */
  async liveDailyBars(symbol: string, from: Date): Promise<RawBar[]> {
    try {
      return await this.yahoo.dailyBars(symbol, from);
    } catch (err) {
      this.log.warn(`live daily bars failed for ${symbol}: ${String(err)}`);
      return [];
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- history.service.spec.ts` (from `backend/`)
Expected: PASS, all tests in the file green

- [ ] **Step 5: Commit**

```bash
git add backend/src/market-data/history.service.ts backend/src/market-data/history.service.spec.ts
git commit -m "feat: add HistoryService.liveDailyBars for un-persisted bar reads"
```

---

### Task 2: `AiOutcome` entity and migration

**Files:**
- Create: `backend/src/llm/ai-outcome.entity.ts`
- Create: `backend/src/database/migrations/1789603200000-AddAiOutcomes.ts`
- Modify: `backend/src/database/data-source.ts`

**Interfaces:**
- Produces: `AiOutcome` entity, `AiOutcomeFeature = 'trade_idea' | 'symbol_pattern' | 'trade_review'`, `AiOutcomeStatus = 'pending' | 'target_hit' | 'stop_hit' | 'repeated' | 'improved' | 'expired'` — used by every later task.

This task has no unit test of its own (an entity/migration pair is verified by the e2e suite standing up `trader_test` from every registered migration in Task 10, and by every later task's specs exercising the repository). Write the files directly, then verify the migration runs cleanly.

- [ ] **Step 1: Write the entity**

Create `backend/src/llm/ai-outcome.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AiOutcomeFeature = 'trade_idea' | 'symbol_pattern' | 'trade_review';

export type AiOutcomeStatus =
  | 'pending'
  | 'target_hit'
  | 'stop_hit'
  | 'repeated'
  | 'improved'
  | 'expired';

/**
 * One AI opinion's ledger row: does what it said turn out to be right.
 * Written automatically the moment a `TradeIdea`, `SymbolPatternRead` or
 * `TradeReview` row is persisted, then updated in place by
 * `AiOutcomeService.resolvePending` once there's something to compare it
 * against — see that service for the grading rules.
 *
 * This is deliberately the one AI table in this app that is NOT
 * create/read/delete only: every other one (`ai_summaries`, `trade_ideas`,
 * `symbol_pattern_reads`, `trade_reviews`) is an immutable record of what
 * the model said, and mutating it would misrepresent history. This table
 * is not a record of what the model said — it's a record of whether the
 * model turned out to be right, which is only knowable after the fact and
 * needs to be written down after the fact.
 */
@Entity('ai_outcomes')
export class AiOutcome {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  feature: AiOutcomeFeature;

  /** The `TradeIdea` / `SymbolPatternRead` / `TradeReview` row this grades. */
  @Column('uuid')
  entityId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: AiOutcomeStatus;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: Write the migration**

Create `backend/src/database/migrations/1789603200000-AddAiOutcomes.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiOutcomes1789603200000 implements MigrationInterface {
  name = 'AddAiOutcomes1789603200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.ai_outcomes (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        feature varchar NOT NULL,
        "entityId" uuid NOT NULL,
        status varchar NOT NULL DEFAULT 'pending',
        "resolvedAt" timestamptz NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_ai_outcomes_feature_entityId" UNIQUE (feature, "entityId")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_outcomes_userId"
        ON public.ai_outcomes ("userId");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_outcomes_userId_status"
        ON public.ai_outcomes ("userId", status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.ai_outcomes;`);
  }
}
```

- [ ] **Step 3: Register the migration**

In `backend/src/database/data-source.ts`, add the import alongside the other migration imports:

```typescript
import { AddAiOutcomes1789603200000 } from './migrations/1789603200000-AddAiOutcomes.js';
```

Add `AddAiOutcomes1789603200000,` as the last entry in the `migrations` array (after `AddEarningsCache1789516800000,`).

- [ ] **Step 4: Verify the migration runs cleanly**

Run: `npm run test:e2e -- health.e2e-spec.ts` (from `backend/`)
Expected: PASS — `test/setup-database.ts` drops and recreates `trader_test`, running every registered migration fresh; a failure here means the migration SQL itself is broken, not a health-spec assertion.

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/ai-outcome.entity.ts backend/src/database/migrations/1789603200000-AddAiOutcomes.ts backend/src/database/data-source.ts
git commit -m "feat: add ai_outcomes table and entity"
```

---

### Task 3: `AiOutcomeService` — record and list, wired into `LlmModule`

**Files:**
- Create: `backend/src/llm/ai-outcome.service.ts`
- Create: `backend/src/llm/ai-outcome.service.spec.ts`
- Modify: `backend/src/llm/llm.module.ts`

**Interfaces:**
- Consumes: `UsersService.currentUser(): Promise<User>` (`user.id: string`).
- Produces: `AiOutcomeService.recordPending(feature: AiOutcomeFeature, entityId: string): Promise<void>`, `AiOutcomeService.list(): Promise<AiOutcome[]>` — `list` also triggers resolution (added in Task 8, a no-op until then). Both used by Tasks 4-6 and 9.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/llm/ai-outcome.service.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { AiOutcomeService } from './ai-outcome.service.js';
import type { UsersService } from '../users/users.service.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { HistoryService } from '../market-data/history.service.js';
import type { Repository } from 'typeorm';
import type { AiOutcome } from './ai-outcome.entity.js';
import type { TradeIdea } from './trade-idea.entity.js';
import type { SymbolPatternRead } from './symbol-pattern.entity.js';
import type { TradeReview } from './trade-review.entity.js';

function makeService() {
  const outcomes = {
    create: vi.fn().mockImplementation((data) => ({ ...data })),
    save: vi.fn().mockImplementation(async (r) => r),
    find: vi.fn().mockResolvedValue([]),
  };
  const ideas = { findOne: vi.fn() };
  const reads = { findOne: vi.fn() };
  const reviews = { findOne: vi.fn() };
  const users = {
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const trades = {} as unknown as TradesService;
  const history = {} as unknown as HistoryService;

  return {
    service: new AiOutcomeService(
      outcomes as unknown as Repository<AiOutcome>,
      ideas as unknown as Repository<TradeIdea>,
      reads as unknown as Repository<SymbolPatternRead>,
      reviews as unknown as Repository<TradeReview>,
      users,
      trades,
      history,
    ),
    outcomes,
  };
}

describe('AiOutcomeService.recordPending', () => {
  it('creates a pending row for the current user, feature and entity', async () => {
    const { service, outcomes } = makeService();

    await service.recordPending('trade_idea', 'idea-1');

    expect(outcomes.create).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'trade_idea',
      entityId: 'idea-1',
      status: 'pending',
    });
    expect(outcomes.save).toHaveBeenCalled();
  });
});

describe('AiOutcomeService.list', () => {
  it("returns the current user's outcome rows, newest first", async () => {
    const { service, outcomes } = makeService();
    outcomes.find.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);

    const result = await service.list();

    expect(result).toEqual([{ id: 'o1' }, { id: 'o2' }]);
    expect(outcomes.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { createdAt: 'DESC' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ai-outcome.service.spec.ts` (from `backend/`)
Expected: FAIL — cannot find module `./ai-outcome.service.js`

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/llm/ai-outcome.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiOutcome, type AiOutcomeFeature } from './ai-outcome.entity.js';
import { TradeIdea } from './trade-idea.entity.js';
import { SymbolPatternRead } from './symbol-pattern.entity.js';
import { TradeReview } from './trade-review.entity.js';
import { UsersService } from '../users/users.service.js';
import { TradesService } from '../portfolio/trades.service.js';
import { HistoryService } from '../market-data/history.service.js';

/**
 * The automated feedback loop: grades each AI opinion against what actually
 * happened, with no human rating involved. See
 * docs/superpowers/specs/2026-09-18-ai-outcome-tracking-design.md for why.
 */
@Injectable()
export class AiOutcomeService {
  private readonly logger = new Logger(AiOutcomeService.name);

  constructor(
    @InjectRepository(AiOutcome)
    private readonly outcomes: Repository<AiOutcome>,
    @InjectRepository(TradeIdea)
    private readonly ideas: Repository<TradeIdea>,
    @InjectRepository(SymbolPatternRead)
    private readonly reads: Repository<SymbolPatternRead>,
    @InjectRepository(TradeReview)
    private readonly reviews: Repository<TradeReview>,
    private readonly users: UsersService,
    private readonly trades: TradesService,
    private readonly history: HistoryService,
  ) {}

  /** Called by each opinion service right after it persists its own row. */
  async recordPending(feature: AiOutcomeFeature, entityId: string): Promise<void> {
    const user = await this.users.currentUser();
    await this.outcomes.save(
      this.outcomes.create({
        userId: user.id,
        feature,
        entityId,
        status: 'pending',
      }),
    );
  }

  /** Resolves what can be resolved, then returns every outcome row. */
  async list(): Promise<AiOutcome[]> {
    await this.resolvePending();
    const user = await this.users.currentUser();
    return this.outcomes.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Read-triggered rather than scheduled, same reasoning as
   * `HistoryService.ensureFresh`: no scheduler exists in this app, so
   * freshness is a property of asking, not of a background job having run.
   * Filled in by Task 8.
   */
  async resolvePending(): Promise<void> {
    // Implemented in Task 8.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ai-outcome.service.spec.ts` (from `backend/`)
Expected: PASS

- [ ] **Step 5: Wire into `LlmModule`**

In `backend/src/llm/llm.module.ts`, add the import:

```typescript
import { AiOutcome } from './ai-outcome.entity.js';
import { AiOutcomeService } from './ai-outcome.service.js';
```

Add `AiOutcome` to the `TypeOrmModule.forFeature([...])` array (alongside `AiSummary`, `TradeIdea`, `TradeReview`, `SymbolPatternRead`, `JournalEntry`).

Add `AiOutcomeService` to the `providers` array (alongside the other services).

- [ ] **Step 6: Run the full backend unit suite to confirm nothing else broke**

Run: `npm test` (from `backend/`)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/llm/ai-outcome.service.ts backend/src/llm/ai-outcome.service.spec.ts backend/src/llm/llm.module.ts
git commit -m "feat: add AiOutcomeService with recordPending and list"
```

---

### Task 4: Thread `id` through `TradeIdeaService` and record its outcome

**Files:**
- Modify: `backend/src/llm/trade-idea.service.ts`
- Modify: `backend/src/llm/trade-idea.service.spec.ts`

**Interfaces:**
- Consumes: `AiOutcomeService.recordPending('trade_idea', entityId: string): Promise<void>` (Task 3).
- Produces: `TradeIdeaResult.id: string | null` — used by Task 9's controller response and (implicitly) by `AiOutcome.entityId`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/llm/trade-idea.service.spec.ts`, add the import:

```typescript
import type { AiOutcomeService } from './ai-outcome.service.js';
```

Change `makeService`'s signature and body to accept and wire an `outcomes` fake, and to pass it as the 7th constructor argument:

```typescript
function makeService(opts: {
  facts?: () => unknown;
  stats?: () => unknown;
  portfolio?: () => unknown;
  llmAnswer?: string;
  llmCompleteStream?: () => AsyncIterable<string>;
  ideas?: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  outcomes?: { recordPending: ReturnType<typeof vi.fn> };
}) {
  const tickerFacts = {
    get: vi.fn().mockImplementation(opts.facts ?? (async () => ({ symbol: 'NVDA' }))),
  } as unknown as TickerFactsService;
  const trades = {
    getStats: vi
      .fn()
      .mockImplementation(opts.stats ?? (async () => ({ avgRisk: null, trades: [] }))),
  } as unknown as TradesService;
  const portfolio = {
    getPortfolio: vi
      .fn()
      .mockImplementation(opts.portfolio ?? (async () => ({ positions: [] }))),
  } as unknown as PortfolioService;
  async function* defaultStream() {
    yield opts.llmAnswer ?? 'an opinion';
  }
  const llm = {
    complete: vi.fn().mockResolvedValue(opts.llmAnswer ?? 'an opinion'),
    completeStream: opts.llmCompleteStream ?? (() => defaultStream()),
    isConfigured: () => true,
    modelName: () => 'test-model',
  } as unknown as LlmClient;
  const users = {
    ensureDefaultUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const ideas = (opts.ideas ?? {
    create: vi.fn((data: unknown) => data),
    save: vi.fn().mockImplementation(async (r: Record<string, unknown>) => ({
      ...r,
      id: 'idea-1',
    })),
  }) as never;
  const outcomes = (opts.outcomes ?? {
    recordPending: vi.fn(),
  }) as unknown as AiOutcomeService;

  return new TradeIdeaService(llm, tickerFacts, portfolio, trades, ideas, users, outcomes);
}
```

Every other `new TradeIdeaService(llm, tickerFacts, portfolio, trades, { create: vi.fn(), save: vi.fn() } as never, users)` call site in this file (there are four: two in `describe('TradeIdeaService.analyse — gathering')`'s "minimal thinking budget" test, and two in `describe('TradeIdeaService.analyseStream')`) needs an 8th... no, 7th argument appended. For each, change:

```typescript
    const service = new TradeIdeaService(
      llm, tickerFacts, portfolio, trades, { create: vi.fn(), save: vi.fn() } as never, users,
    );
```

to:

```typescript
    const service = new TradeIdeaService(
      llm, tickerFacts, portfolio, trades, { create: vi.fn(), save: vi.fn() } as never, users,
      { recordPending: vi.fn() } as unknown as AiOutcomeService,
    );
```

(all four occurrences — the "minimal thinking budget" test in the gathering block, the "unconfigured" test, the placeholder-substitution test in `analyseStream`, the final-done-line test, the minimal-thinking-budget-on-stream test, and the stream-failure test all construct inline; update every `new TradeIdeaService(` call site in the file the same way. The `makeService` helper itself is also used by several of these via `makeService({...})`, which already gets the new default from Step 1's edit above and needs no per-call change.)

Now add the new assertions. Change the placeholder-substitution test's assertion block (in `describe('TradeIdeaService.analyse — book placeholders')`):

```typescript
    const result = await service.analyse('NVDA');

    expect(result.id).toBe('idea-1');
    expect(result.opinion).toBe('LMND is already 22.1% of your account.');
    expect(ideas.save).toHaveBeenCalledWith(
      expect.objectContaining({ opinion: 'LMND is already 22.1% of your account.' }),
    );
```

(`ideas` in that test already does `create: vi.fn((data: unknown) => data), save: vi.fn()` with no id — give it an id-returning `save` too: change `save: vi.fn(),` to `save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-1' })),` in that test's own `ideas` object.)

Add two new tests, at the end of `describe('TradeIdeaService.analyse — book placeholders')`:

```typescript
  it("returns the saved row's own id", async () => {
    const ideas = {
      create: vi.fn((data: unknown) => data),
      save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-42' })),
    };
    const service = makeService({
      llmAnswer: 'An opinion.\n\nLEVELS\nstop: 10\ntarget: 20',
      ideas,
    });

    const result = await service.analyse('NVDA');

    expect(result.id).toBe('idea-42');
  });

  it('is null when nothing was saved — unconfigured', async () => {
    const llm = {
      isConfigured: () => false,
      complete: vi.fn(),
      completeStream: vi.fn(),
      modelName: () => 'test-model',
    } as unknown as LlmClient;
    const tickerFacts = { get: vi.fn() } as unknown as TickerFactsService;
    const portfolio = { getPortfolio: vi.fn() } as unknown as PortfolioService;
    const trades = { getStats: vi.fn() } as unknown as TradesService;
    const users = { currentUser: vi.fn() } as unknown as UsersService;
    const service = new TradeIdeaService(
      llm, tickerFacts, portfolio, trades, { create: vi.fn(), save: vi.fn() } as never, users,
      { recordPending: vi.fn() } as unknown as AiOutcomeService,
    );

    const result = await service.analyse('NVDA');

    expect(result.id).toBeNull();
  });

  it('records a pending outcome only when levels were read', async () => {
    const outcomes = { recordPending: vi.fn() };
    const withLevels = makeService({
      llmAnswer: 'An opinion.\n\nLEVELS\nstop: 10\ntarget: 20',
      outcomes,
    });
    await withLevels.analyse('NVDA');
    expect(outcomes.recordPending).toHaveBeenCalledWith('trade_idea', 'idea-1');

    const outcomesUnreadable = { recordPending: vi.fn() };
    const withoutLevels = makeService({
      llmAnswer: 'Prose with no LEVELS block at all.',
      outcomes: outcomesUnreadable,
    });
    await withoutLevels.analyse('NVDA');
    expect(outcomesUnreadable.recordPending).not.toHaveBeenCalled();
  });
```

Finally, in `describe('TradeIdeaService.analyseStream')`, extend the "final done line" test's assertions to also check `id`, and extend `describe('TradeIdeaService.analyseStream')`'s "unconfigured" test's expected object to include `id: null`:

```typescript
    expect(lines).toEqual([
      {
        done: true,
        configured: false,
        symbol: 'NVDA',
        facts: null,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: null,
        errorKind: null,
        id: null,
      },
    ]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- trade-idea.service.spec.ts` (from `backend/`)
Expected: FAIL — `Expected 7 arguments, but got 6` (constructor arity) and/or `result.id` assertions failing since `TradeIdeaResult` has no `id` field yet.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/llm/trade-idea.service.ts`:

Add the import:

```typescript
import { AiOutcomeService } from './ai-outcome.service.js';
```

Add `id: string | null;` as the first field of `TradeIdeaResult`:

```typescript
export interface TradeIdeaResult {
  id: string | null;
  configured: boolean;
  symbol: string;
  ...
```

Add the constructor param, after `users`:

```typescript
  constructor(
    private readonly llm: LlmClient,
    private readonly tickerFacts: TickerFactsService,
    private readonly portfolio: PortfolioService,
    private readonly trades: TradesService,
    @InjectRepository(TradeIdea)
    private readonly ideas: Repository<TradeIdea>,
    private readonly users: UsersService,
    private readonly outcomes: AiOutcomeService,
  ) {}
```

In `analyse()`, add `id: null,` to both early returns (the unconfigured return and the catch block's return). In the success path, capture the save and record the outcome conditionally:

```typescript
    const owner = await this.users.currentUser();
    const saved = await this.ideas.save(
      this.ideas.create({
        userId: owner.id,
        symbol: upper,
        entryPrice: facts.price,
        priceStale: facts.stale,
        stop: levels?.stop ?? null,
        target: levels?.target ?? null,
        riskReward: risk?.riskReward ?? null,
        opinion,
        factsSnapshot: user,
        model: this.llm.modelName(),
      }),
    );

    // Only a readable idea has anything to grade — see the entity's own
    // doc comment on why an unreadable one is still saved.
    if (levels) {
      await this.outcomes.recordPending('trade_idea', saved.id);
    }

    return {
      id: saved.id,
      configured: true,
      symbol: upper,
      facts,
      opinion,
      levels,
      risk,
      levelsUnreadable: levels === null,
      error: null,
      errorKind: null,
    };
```

Apply the identical pattern to `analyseStream()`: add `id: null,` to the `TradeIdeaStreamDone` emit in the unconfigured branch and in the catch block; capture `saved` from the persistence call, conditionally call `recordPending`, and add `id: saved.id` to the final `emit({...})` call:

```typescript
      const owner = await this.users.currentUser();
      const saved = await this.ideas.save(
        this.ideas.create({
          userId: owner.id,
          symbol: upper,
          entryPrice: facts.price,
          priceStale: facts.stale,
          stop: levels?.stop ?? null,
          target: levels?.target ?? null,
          riskReward: risk?.riskReward ?? null,
          opinion,
          factsSnapshot: user,
          model: this.llm.modelName(),
        }),
      );

      if (levels) {
        await this.outcomes.recordPending('trade_idea', saved.id);
      }

      yield emit({
        done: true,
        configured: true,
        symbol: upper,
        facts,
        levels,
        risk,
        levelsUnreadable: levels === null,
        error: null,
        errorKind: null,
        id: saved.id,
      });
```

And in the catch block:

```typescript
      yield emit({
        done: true,
        configured: true,
        symbol: upper,
        facts,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: ERROR_COPY[kind],
        errorKind: kind,
        id: null,
      });
```

And in the unconfigured early return:

```typescript
      yield emit({
        done: true,
        configured: false,
        symbol: upper,
        facts: null,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: null,
        errorKind: null,
        id: null,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- trade-idea.service.spec.ts` (from `backend/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/trade-idea.service.ts backend/src/llm/trade-idea.service.spec.ts
git commit -m "feat: thread trade-idea id through and record its ai_outcomes row"
```

---

### Task 5: Thread `id` through `SymbolPatternService` and record its outcome

**Files:**
- Modify: `backend/src/llm/symbol-pattern.service.ts`
- Modify: `backend/src/llm/symbol-pattern.service.spec.ts`

**Interfaces:**
- Consumes: `AiOutcomeService.recordPending('symbol_pattern', entityId: string): Promise<void>` (Task 3).
- Produces: `SymbolPatternResult.id: string | null`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/llm/symbol-pattern.service.spec.ts`, add the import:

```typescript
import type { AiOutcomeService } from './ai-outcome.service.js';
```

In `makeService`, add an `outcomes` fake and pass it as the 6th constructor argument:

```typescript
function makeService(opts: {
  isConfigured?: boolean;
  llmComplete?: () => Promise<string>;
  llmCompleteStream?: () => AsyncIterable<string>;
  savedRead?: any;
  outcomes?: { recordPending: ReturnType<typeof vi.fn> };
}) {
  ...
  const outcomes = (opts.outcomes ?? {
    recordPending: vi.fn(),
  }) as unknown as AiOutcomeService;

  return {
    service: new SymbolPatternService(
      llm,
      trades,
      users,
      reads as unknown as Repository<SymbolPatternRead>,
      entries as unknown as Repository<JournalEntry>,
      outcomes,
    ),
    trades,
    reads,
    entries,
    llm,
    outcomes,
  };
}
```

Add `id` assertions to the two existing generation tests:

```typescript
  it('generates and persists a read when the LLM answers', async () => {
    const { service, reads } = makeService({ isConfigured: true });
    const result = await service.generate('nvda', 'ALL');
    expect(result.id).toBe('read-1');
    expect(result.configured).toBe(true);
    expect(result.headline).toBe('You hold winners here longer than your average');
    expect(result.read).toContain('You tend to let NVDA winners run');
    expect(reads.save).toHaveBeenCalled();
  });

  it('retrieves an existing saved read without calling the model', async () => {
    const { service, trades } = makeService({
      savedRead: {
        id: 'read-99',
        symbol: 'NVDA',
        range: 'ALL',
        headline: 'Saved headline',
        read: 'Saved read',
        factsSnapshot: JSON.stringify({ symbol: 'NVDA' }),
        createdAt: new Date(),
      },
    });

    const result = await service.getLatest('NVDA', 'ALL');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('read-99');
    expect(result?.headline).toBe('Saved headline');
    expect(trades.getSymbolSummary).not.toHaveBeenCalled();
  });
```

Add a new test at the end of `describe('SymbolPatternService', ...)`, right before its closing brace:

```typescript
  it('records a pending outcome only when the read names at least one mistake', async () => {
    const outcomes = { recordPending: vi.fn() };
    await makeService({ isConfigured: true, outcomes }).service.generate('nvda', 'ALL');
    // The shared `summary.trades` fixture at the top of this file has an
    // empty `mistakes: []` — nothing to grade, so nothing should be recorded.
    expect(outcomes.recordPending).not.toHaveBeenCalled();
  });
```

And extend `generateStream`'s "unconfigured" and "final done line" tests:

```typescript
  it('yields a single done line, unconfigured, without calling the model', async () => {
    const { service } = makeService({ isConfigured: false });
    const lines = await collectLines(service.generateStream('nvda', 'ALL'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ done: true, configured: false, headline: null, id: null });
  });
```

```typescript
  it('yields a final done line with the parsed headline and persists the clean read', async () => {
    const { service, reads } = makeService({ isConfigured: true });
    const lines = await collectLines(service.generateStream('nvda', 'ALL'));

    const done = lines.at(-1) as Record<string, unknown>;
    expect(done).toMatchObject({
      done: true,
      configured: true,
      symbol: 'NVDA',
      headline: 'You hold winners here longer than your average',
      error: null,
      id: 'read-1',
    });
    expect(reads.save).toHaveBeenCalled();
    const saved = (reads.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.read).not.toContain('PATTERN_META');
    expect(saved.read).toContain('You tend to let NVDA winners run');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- symbol-pattern.service.spec.ts` (from `backend/`)
Expected: FAIL — `Expected 5 arguments, but got 6` and/or missing `id` on the result

- [ ] **Step 3: Write minimal implementation**

In `backend/src/llm/symbol-pattern.service.ts`:

Add the import:

```typescript
import { AiOutcomeService } from './ai-outcome.service.js';
```

Add `id: string | null;` as the first field of `SymbolPatternResult`.

Add the constructor param, after `entries`:

```typescript
  constructor(
    private readonly llm: LlmClient,
    private readonly trades: TradesService,
    private readonly users: UsersService,
    @InjectRepository(SymbolPatternRead)
    private readonly reads: Repository<SymbolPatternRead>,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    private readonly outcomes: AiOutcomeService,
  ) {}
```

In `getLatest()`, add `id: existing.id,` to the returned object.

In `generate()`: add `id: null,` to the unconfigured return and the catch-block return. In the success path, after `await this.reads.save(record);`, add:

```typescript
    // Only worth grading if the read actually named a mistake — an empty
    // set can never "recur", so recording a pending row for it would
    // resolve trivially the moment any next trade closed.
    const namedMistakes = new Set(facts.trades.flatMap((t) => t.mistakes ?? []));
    if (namedMistakes.size > 0) {
      await this.outcomes.recordPending('symbol_pattern', record.id);
    }
```

and add `id: record.id,` to the returned object.

Apply the identical pattern to `generateStream()`: add `id: null,` to the unconfigured `emit` and the catch-block `emit`; add the same `namedMistakes`/`recordPending` block after `await this.reads.save(record);`, then add `id: record.id,` to the final `emit({...})`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- symbol-pattern.service.spec.ts` (from `backend/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/symbol-pattern.service.ts backend/src/llm/symbol-pattern.service.spec.ts
git commit -m "feat: thread symbol-pattern id through and record its ai_outcomes row"
```

---

### Task 6: Thread `id` through `TradeReviewService` and record its outcome

**Files:**
- Modify: `backend/src/llm/trade-review.service.ts`
- Modify: `backend/src/llm/trade-review.service.spec.ts`

**Interfaces:**
- Consumes: `AiOutcomeService.recordPending('trade_review', entityId: string): Promise<void>` (Task 3).
- Produces: `TradeReviewResult.id: string | null`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/llm/trade-review.service.spec.ts`, add the import:

```typescript
import type { AiOutcomeService } from './ai-outcome.service.js';
```

In `makeService`, add an `outcomes` option and pass it as the constructor's 6th argument:

```typescript
function makeService(opts: {
  isConfigured?: boolean;
  tradeData?: any;
  llmComplete?: () => Promise<string>;
  llmCompleteStream?: () => AsyncIterable<string>;
  savedReview?: any;
  outcomes?: { recordPending: ReturnType<typeof vi.fn> };
}) {
  ...
  const outcomes = (opts.outcomes ?? {
    recordPending: vi.fn(),
  }) as unknown as AiOutcomeService;

  return {
    service: new TradeReviewService(
      llm,
      trades,
      users,
      reviews as unknown as Repository<TradeReview>,
      entries as unknown as Repository<JournalEntry>,
      outcomes,
    ),
    trades,
    reviews,
    outcomes,
  };
}
```

Add `id` assertions:

```typescript
  it('generates and persists review when LLM answers', async () => {
    const { service, reviews } = makeService({ isConfigured: true });
    const result = await service.reviewTrade('trade-1');
    expect(result.id).toBe('rev-1');
    expect(result.configured).toBe(true);
    expect(result.score).toBe('A');
    expect(result.verdict).toBe('Disciplined Target Exit');
    expect(result.review).toContain('### Process vs Outcome');
    expect(reviews.save).toHaveBeenCalled();
  });

  it('retrieves existing review if already saved', async () => {
    const { service } = makeService({
      savedReview: {
        tradeId: 'trade-1',
        symbol: 'NVDA',
        score: 'A',
        verdict: 'Disciplined Target Exit',
        review: 'Great trade execution',
        factsSnapshot: JSON.stringify({ symbol: 'NVDA', mistakes: [] }),
        createdAt: new Date(),
        id: 'rev-99',
      },
    });

    const result = await service.getReview('trade-1');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('rev-99');
    expect(result?.score).toBe('A');
    expect(result?.verdict).toBe('Disciplined Target Exit');
  });
```

Add a new test at the end of `describe('TradeReviewService', ...)`, right before its closing brace:

```typescript
  it('records a pending outcome only when the review names at least one mistake', async () => {
    const outcomes = { recordPending: vi.fn() };
    await makeService({ isConfigured: true, outcomes }).service.reviewTrade('trade-1');
    // buildTradeReviewFacts is fed `tagsByEntryId: vi.fn().mockResolvedValue(new Map())`
    // in this file's fixture — no tags means no mistakes, nothing to grade.
    expect(outcomes.recordPending).not.toHaveBeenCalled();
  });
```

Extend `reviewTradeStream`'s "unconfigured" and "final done line" tests:

```typescript
  it('yields a single done line, unconfigured, with facts but no score/verdict', async () => {
    const { service } = makeService({ isConfigured: false });
    const lines = await collectLines(service.reviewTradeStream('trade-1'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ done: true, configured: false, score: null, verdict: null, id: null });
    expect((lines[0] as { facts: { symbol: string } }).facts.symbol).toBe('NVDA');
  });
```

```typescript
  it('yields a final done line with the parsed score/verdict and the saved createdAt', async () => {
    const { service, reviews } = makeService({ isConfigured: true });
    const lines = await collectLines(service.reviewTradeStream('trade-1'));

    const done = lines.at(-1) as Record<string, unknown>;
    expect(done).toMatchObject({
      done: true,
      configured: true,
      score: 'A',
      verdict: 'Disciplined Target Exit',
      symbol: 'NVDA',
      error: null,
      id: 'rev-1',
    });
    expect(reviews.save).toHaveBeenCalled();
    const saved = (reviews.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.review).not.toContain('REVIEW_META');
    expect(saved.review).toContain('Exemplary adherence');
  });
```

And the exact-literal "stream fails before any text" test needs `id: null` added to its `toEqual`:

```typescript
    expect(lines).toEqual([
      {
        done: true,
        configured: true,
        tradeId: 'trade-1',
        symbol: 'NVDA',
        score: null,
        verdict: null,
        facts: expect.objectContaining({ symbol: 'NVDA' }),
        createdAt: null,
        error: 'The AI model is busy right now. Worth another tap in a moment.',
        errorKind: 'busy',
        id: null,
      },
    ]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- trade-review.service.spec.ts` (from `backend/`)
Expected: FAIL — `Expected 5 arguments, but got 6` and/or missing `id` on the result

- [ ] **Step 3: Write minimal implementation**

In `backend/src/llm/trade-review.service.ts`:

Add the import:

```typescript
import { AiOutcomeService } from './ai-outcome.service.js';
```

Add `id: string | null;` as the first field of `TradeReviewResult`.

Add the constructor param, after `entries`:

```typescript
  constructor(
    private readonly llm: LlmClient,
    private readonly trades: TradesService,
    private readonly users: UsersService,
    @InjectRepository(TradeReview)
    private readonly reviews: Repository<TradeReview>,
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    private readonly outcomes: AiOutcomeService,
  ) {}
```

In `getReview()`, add `id: existing.id,` to the returned object.

In `reviewTrade()`: add `id: null,` to the unconfigured return and the catch-block return. In the success path, after `await this.reviews.save(record);`, add:

```typescript
    // Only worth grading if the review actually named a mistake — see the
    // identical reasoning in SymbolPatternService.generate.
    if (facts.mistakes.length > 0) {
      await this.outcomes.recordPending('trade_review', record.id);
    }
```

and add `id: record.id,` to the returned object.

Apply the identical pattern to `reviewTradeStream()`: add `id: null,` to the unconfigured `emit` and the catch-block `emit`; add the same `facts.mistakes.length > 0` / `recordPending` block after `await this.reviews.save(record);`, then add `id: record.id,` to the final `emit({...})`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- trade-review.service.spec.ts` (from `backend/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/trade-review.service.ts backend/src/llm/trade-review.service.spec.ts
git commit -m "feat: thread trade-review id through and record its ai_outcomes row"
```

---

### Task 7: Grade trade-idea outcomes against live daily bars

**Files:**
- Modify: `backend/src/llm/ai-outcome.service.ts`
- Modify: `backend/src/llm/ai-outcome.service.spec.ts`

**Interfaces:**
- Consumes: `HistoryService.liveDailyBars(symbol, from): Promise<RawBar[]>` (Task 1); `TradeIdea.{stop,target,entryPrice,symbol,createdAt}` (existing entity).
- Produces: `AiOutcomeService.resolvePending()` now actually resolves `trade_idea` rows — no new exported surface, but this is what Task 9's `GET /ai/outcomes` depends on end to end.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/llm/ai-outcome.service.spec.ts`. First, extend `makeService` so its fakes can be configured per test — replace the whole file's `makeService` with:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { AiOutcomeService } from './ai-outcome.service.js';
import type { UsersService } from '../users/users.service.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { HistoryService } from '../market-data/history.service.js';
import type { Repository } from 'typeorm';
import type { AiOutcome } from './ai-outcome.entity.js';
import type { TradeIdea } from './trade-idea.entity.js';
import type { SymbolPatternRead } from './symbol-pattern.entity.js';
import type { TradeReview } from './trade-review.entity.js';
import type { RawBar } from '../market-data/yahoo.client.js';

function makeService(opts: {
  pendingRows?: Partial<AiOutcome>[];
  findIdea?: (id: string) => Partial<TradeIdea> | null;
  liveDailyBars?: (symbol: string, from: Date) => Promise<RawBar[]>;
} = {}) {
  const outcomes = {
    create: vi.fn().mockImplementation((data) => ({ ...data })),
    save: vi.fn().mockImplementation(async (r) => r),
    find: vi.fn().mockResolvedValue(opts.pendingRows ?? []),
  };
  const ideas = {
    findOne: vi
      .fn()
      .mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
        opts.findIdea ? opts.findIdea(id) : null,
      ),
  };
  const reads = { findOne: vi.fn().mockResolvedValue(null) };
  const reviews = { findOne: vi.fn().mockResolvedValue(null) };
  const users = {
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const trades = {} as unknown as TradesService;
  const history = {
    liveDailyBars: opts.liveDailyBars ?? (async () => []),
  } as unknown as HistoryService;

  return {
    service: new AiOutcomeService(
      outcomes as unknown as Repository<AiOutcome>,
      ideas as unknown as Repository<TradeIdea>,
      reads as unknown as Repository<SymbolPatternRead>,
      reviews as unknown as Repository<TradeReview>,
      users,
      trades,
      history,
    ),
    outcomes,
    ideas,
  };
}

describe('AiOutcomeService.recordPending', () => {
  it('creates a pending row for the current user, feature and entity', async () => {
    const { service, outcomes } = makeService();

    await service.recordPending('trade_idea', 'idea-1');

    expect(outcomes.create).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'trade_idea',
      entityId: 'idea-1',
      status: 'pending',
    });
    expect(outcomes.save).toHaveBeenCalled();
  });
});

describe('AiOutcomeService.list', () => {
  it("returns the current user's outcome rows, newest first", async () => {
    const { service, outcomes } = makeService({ pendingRows: [] });
    outcomes.find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'o1' }, { id: 'o2' }]);

    const result = await service.list();

    expect(result).toEqual([{ id: 'o1' }, { id: 'o2' }]);
  });
});

describe('AiOutcomeService.resolvePending — trade_idea', () => {
  const LONG_IDEA: Partial<TradeIdea> = {
    id: 'idea-1',
    symbol: 'NVDA',
    entryPrice: 100,
    stop: 90,
    target: 120,
    createdAt: new Date('2026-08-01T00:00:00Z'),
  };

  function bar(date: string, low: number, high: number): RawBar {
    return { date, close: (low + high) / 2, adjClose: (low + high) / 2, open: low, high, low, volume: 1_000 };
  }

  it("resolves target_hit when a LONG idea's target is crossed before its stop", async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: (id) => (id === 'idea-1' ? LONG_IDEA : null),
      liveDailyBars: async () => [
        bar('2026-08-05', 95, 105),
        bar('2026-08-10', 98, 121),
      ],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'target_hit' }),
    );
  });

  it("resolves stop_hit when a LONG idea's stop is crossed before its target", async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => LONG_IDEA,
      liveDailyBars: async () => [bar('2026-08-05', 89, 101)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'stop_hit' }),
    );
  });

  it('resolves stop_hit — the conservative read — when one bar crosses both levels', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => LONG_IDEA,
      liveDailyBars: async () => [bar('2026-08-05', 85, 125)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'stop_hit' }),
    );
  });

  it('stays pending when neither level has been crossed and 30 days have not passed', async () => {
    const recentIdea = { ...LONG_IDEA, createdAt: new Date() };
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => recentIdea,
      liveDailyBars: async () => [bar('2026-08-05', 95, 105)],
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
  });

  it('expires when neither level has been crossed within 30 days', async () => {
    const oldIdea = { ...LONG_IDEA, createdAt: new Date(Date.now() - 31 * 86_400_000) };
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => oldIdea,
      liveDailyBars: async () => [bar('2026-08-05', 95, 105)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'expired' }),
    );
  });

  it("resolves against a SHORT idea's levels the same way, mirrored", async () => {
    const shortIdea: Partial<TradeIdea> = {
      id: 'idea-2',
      symbol: 'BITX',
      entryPrice: 20,
      stop: 22,
      target: 15,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    };
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o2', feature: 'trade_idea', entityId: 'idea-2', status: 'pending' }],
      findIdea: () => shortIdea,
      liveDailyBars: async () => [bar('2026-08-05', 14, 19)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o2', status: 'target_hit' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ai-outcome.service.spec.ts` (from `backend/`)
Expected: FAIL — the `resolvePending — trade_idea` tests fail because `resolvePending` is still a no-op (`outcomes.save` never called)

- [ ] **Step 3: Write minimal implementation**

Replace the placeholder `resolvePending` body in `backend/src/llm/ai-outcome.service.ts` and add the private trade-idea resolver:

```typescript
  async resolvePending(): Promise<void> {
    const user = await this.users.currentUser();
    const pending = await this.outcomes.find({
      where: { userId: user.id, status: 'pending' },
    });

    for (const row of pending) {
      const status =
        row.feature === 'trade_idea' ? await this.resolveTradeIdea(row) : null;
      if (status) {
        row.status = status;
        row.resolvedAt = new Date();
        await this.outcomes.save(row);
      }
    }
  }

  /** 30 days: matches the swing-trade holding period already implied
   * elsewhere in the app (see the spec doc). */
  private static readonly TRADE_IDEA_EXPIRY_DAYS = 30;

  private async resolveTradeIdea(row: AiOutcome): Promise<AiOutcomeStatus | null> {
    const idea = await this.ideas.findOne({ where: { id: row.entityId } });
    if (!idea || idea.stop === null || idea.target === null) return 'expired';

    // Direction isn't stored on TradeIdea — re-derived the same way
    // `computeTradeRisk` does at generation time, rather than storing it
    // twice.
    const isLong = idea.stop < idea.entryPrice && idea.target > idea.entryPrice;

    const bars = await this.history.liveDailyBars(idea.symbol, idea.createdAt);
    for (const bar of bars) {
      if (bar.low === null || bar.high === null) continue;
      const stopCrossed = isLong ? bar.low <= idea.stop : bar.high >= idea.stop;
      const targetCrossed = isLong ? bar.high >= idea.target : bar.low <= idea.target;
      // Both crossed the same bar: read it as the stop filling first — the
      // conservative assumption, matching how a real stop order behaves
      // when price gaps through both levels.
      if (stopCrossed) return 'stop_hit';
      if (targetCrossed) return 'target_hit';
    }

    const ageDays = (Date.now() - idea.createdAt.getTime()) / 86_400_000;
    return ageDays > AiOutcomeService.TRADE_IDEA_EXPIRY_DAYS ? 'expired' : null;
  }
```

Add `type AiOutcomeStatus` to the existing `ai-outcome.entity.js` import line at the top of the file:

```typescript
import { AiOutcome, type AiOutcomeFeature, type AiOutcomeStatus } from './ai-outcome.entity.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ai-outcome.service.spec.ts` (from `backend/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/ai-outcome.service.ts backend/src/llm/ai-outcome.service.spec.ts
git commit -m "feat: grade trade-idea outcomes against live daily bars"
```

---

### Task 8: Grade symbol-pattern and trade-review outcomes by mistake recurrence

**Files:**
- Modify: `backend/src/llm/ai-outcome.service.ts`
- Modify: `backend/src/llm/ai-outcome.service.spec.ts`

**Interfaces:**
- Consumes: `TradesService.deriveAllTrades(): Promise<DerivedTrade[]>`, `TradesService.tagsByEntryId(): Promise<Map<string, {setups: string[]; mistakes: string[]}>>` (existing).
- Produces: `AiOutcomeService.resolvePending()` now resolves all three features.

- [ ] **Step 1: Write the failing tests**

Add to `backend/src/llm/ai-outcome.service.spec.ts`. Extend `makeService`'s options and the `trades` fake so tests can configure `deriveAllTrades`/`tagsByEntryId`, and so `reads`/`reviews` can be configured like `ideas` already is:

```typescript
function makeService(opts: {
  pendingRows?: Partial<AiOutcome>[];
  findIdea?: (id: string) => Partial<TradeIdea> | null;
  findRead?: (id: string) => Partial<SymbolPatternRead> | null;
  findReview?: (id: string) => Partial<TradeReview> | null;
  liveDailyBars?: (symbol: string, from: Date) => Promise<RawBar[]>;
  deriveAllTrades?: () => Promise<unknown[]>;
  tagsByEntryId?: () => Promise<Map<string, { setups: string[]; mistakes: string[] }>>;
} = {}) {
  const outcomes = {
    create: vi.fn().mockImplementation((data) => ({ ...data })),
    save: vi.fn().mockImplementation(async (r) => r),
    find: vi.fn().mockResolvedValue(opts.pendingRows ?? []),
  };
  const ideas = {
    findOne: vi
      .fn()
      .mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
        opts.findIdea ? opts.findIdea(id) : null,
      ),
  };
  const reads = {
    findOne: vi
      .fn()
      .mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
        opts.findRead ? opts.findRead(id) : null,
      ),
  };
  const reviews = {
    findOne: vi
      .fn()
      .mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
        opts.findReview ? opts.findReview(id) : null,
      ),
  };
  const users = {
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const trades = {
    deriveAllTrades: opts.deriveAllTrades ?? (async () => []),
    tagsByEntryId: opts.tagsByEntryId ?? (async () => new Map()),
  } as unknown as TradesService;
  const history = {
    liveDailyBars: opts.liveDailyBars ?? (async () => []),
  } as unknown as HistoryService;

  return {
    service: new AiOutcomeService(
      outcomes as unknown as Repository<AiOutcome>,
      ideas as unknown as Repository<TradeIdea>,
      reads as unknown as Repository<SymbolPatternRead>,
      reviews as unknown as Repository<TradeReview>,
      users,
      trades,
      history,
    ),
    outcomes,
    ideas,
  };
}
```

Add a new describe block:

```typescript
describe('AiOutcomeService.resolvePending — symbol_pattern and trade_review', () => {
  const READ: Partial<SymbolPatternRead> = {
    id: 'read-1',
    symbol: 'NVDA',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    factsSnapshot: JSON.stringify({
      symbol: 'NVDA',
      trades: [{ symbol: 'NVDA', mistakes: ['cut winner short'] }],
    }),
  };

  const REVIEW: Partial<TradeReview> = {
    id: 'rev-1',
    symbol: 'NVDA',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    factsSnapshot: JSON.stringify({ symbol: 'NVDA', mistakes: ['cut winner short'] }),
  };

  function closedTrade(entryId: string, enteredAt: string) {
    return {
      symbol: 'NVDA',
      isOpen: false,
      enteredAt: new Date(enteredAt),
      exitedAt: new Date(enteredAt),
      fills: [{ entryId, executedAt: new Date(enteredAt), side: 'BUY', quantity: 1, price: 1, fee: 0 }],
    };
  }

  it('resolves repeated when the next closed trade in that symbol carries the same mistake tag', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'symbol_pattern', entityId: 'read-1', status: 'pending' }],
      findRead: () => READ,
      deriveAllTrades: async () => [closedTrade('e1', '2026-08-10')],
      tagsByEntryId: async () =>
        new Map([['e1', { setups: [], mistakes: ['cut winner short'] }]]),
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'repeated' }),
    );
  });

  it('resolves improved when the next closed trade shares none of the named mistakes', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_review', entityId: 'rev-1', status: 'pending' }],
      findReview: () => REVIEW,
      deriveAllTrades: async () => [closedTrade('e1', '2026-08-10')],
      tagsByEntryId: async () => new Map([['e1', { setups: [], mistakes: [] }]]),
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'improved' }),
    );
  });

  it('stays pending with no qualifying next trade and 90 days have not passed', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_review', entityId: 'rev-1', status: 'pending' }],
      findReview: () => ({ ...REVIEW, createdAt: new Date() }),
      deriveAllTrades: async () => [],
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
  });

  it('expires with no qualifying next trade after 90 days', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_review', entityId: 'rev-1', status: 'pending' }],
      findReview: () => ({ ...REVIEW, createdAt: new Date(Date.now() - 91 * 86_400_000) }),
      deriveAllTrades: async () => [],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'expired' }),
    );
  });

  it('ignores a closed trade in the same symbol that closed BEFORE the opinion was made', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'symbol_pattern', entityId: 'read-1', status: 'pending' }],
      findRead: () => READ,
      deriveAllTrades: async () => [closedTrade('e0', '2026-07-01')],
      tagsByEntryId: async () =>
        new Map([['e0', { setups: [], mistakes: ['cut winner short'] }]]),
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ai-outcome.service.spec.ts` (from `backend/`)
Expected: FAIL — the new `symbol_pattern and trade_review` tests fail because `resolvePending` only handles `trade_idea`

- [ ] **Step 3: Write minimal implementation**

In `backend/src/llm/ai-outcome.service.ts`, update the dispatch in `resolvePending()`:

```typescript
    for (const row of pending) {
      const status =
        row.feature === 'trade_idea'
          ? await this.resolveTradeIdea(row)
          : await this.resolveBehavioral(row);
      if (status) {
        row.status = status;
        row.resolvedAt = new Date();
        await this.outcomes.save(row);
      }
    }
```

Add the constant and the private resolver, after `resolveTradeIdea`:

```typescript
  /** Longer than trade-idea's 30 days: a behavior change is slower to
   * observe than a price move — the trader has to make and close another
   * trade in the name, not just wait for a quote to move. */
  private static readonly BEHAVIORAL_EXPIRY_DAYS = 90;

  private async resolveBehavioral(row: AiOutcome): Promise<AiOutcomeStatus | null> {
    const opinion =
      row.feature === 'symbol_pattern'
        ? await this.reads.findOne({ where: { id: row.entityId } })
        : await this.reviews.findOne({ where: { id: row.entityId } });
    if (!opinion) return 'expired';

    const namedMistakes =
      row.feature === 'symbol_pattern'
        ? new Set(
            (JSON.parse(opinion.factsSnapshot) as { trades: { mistakes?: string[] }[] }).trades
              .flatMap((t) => t.mistakes ?? []),
          )
        : new Set((JSON.parse(opinion.factsSnapshot) as { mistakes: string[] }).mistakes);

    const allTrades = await this.trades.deriveAllTrades();
    const nextTrade = allTrades
      .filter(
        (t) =>
          t.symbol.toUpperCase() === opinion.symbol.toUpperCase() &&
          !t.isOpen &&
          t.enteredAt > opinion.createdAt,
      )
      .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime())[0];

    if (!nextTrade) {
      const ageDays = (Date.now() - opinion.createdAt.getTime()) / 86_400_000;
      return ageDays > AiOutcomeService.BEHAVIORAL_EXPIRY_DAYS ? 'expired' : null;
    }

    const tagsByEntryId = await this.trades.tagsByEntryId();
    const tradeMistakes = new Set(
      nextTrade.fills
        .map((f) => f.entryId)
        .filter((id): id is string => Boolean(id))
        .flatMap((id) => tagsByEntryId.get(id)?.mistakes ?? []),
    );

    const repeated = [...namedMistakes].some((m) => tradeMistakes.has(m));
    return repeated ? 'repeated' : 'improved';
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ai-outcome.service.spec.ts` (from `backend/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/llm/ai-outcome.service.ts backend/src/llm/ai-outcome.service.spec.ts
git commit -m "feat: grade symbol-pattern and trade-review outcomes by mistake recurrence"
```

---

### Task 9: `GET /ai/outcomes`

**Files:**
- Modify: `backend/src/llm/llm.controller.ts`
- Modify: `backend/src/llm/llm.controller.spec.ts`

**Interfaces:**
- Consumes: `AiOutcomeService.list(): Promise<AiOutcome[]>` (Task 3/8).

- [ ] **Step 1: Write the failing test**

In `backend/src/llm/llm.controller.spec.ts`, add the import:

```typescript
import type { AiOutcomeService } from './ai-outcome.service.js';
```

Add a `fakeOutcomes()` helper, alongside `fakeSummaries()`:

```typescript
/** Unused by most of these tests; present only so the constructor is satisfied. */
function fakeOutcomes(): AiOutcomeService {
  return { recordPending: vi.fn(), list: vi.fn(), resolvePending: vi.fn() } as unknown as AiOutcomeService;
}
```

Append `fakeOutcomes(),` as the 7th argument to every existing `new LlmController(...)` call site in the file (there are five — one per `it` block).

Add a new test:

```typescript
  it('GET /ai/outcomes returns whatever the service lists', async () => {
    const rows = [{ id: 'o1', feature: 'trade_idea', status: 'pending' }];
    const outcomes = { list: vi.fn().mockResolvedValue(rows) } as unknown as AiOutcomeService;
    const controller = new LlmController(
      {} as LlmService,
      fakeSummaries(),
      fakeTradeIdeas(),
      fakeTradeIdeaHistory(),
      fakeTradeReviews(),
      fakeSymbolPatterns(),
      outcomes,
    );

    const result = await controller.listOutcomes();

    expect(result).toBe(rows);
    expect(outcomes.list).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- llm.controller.spec.ts` (from `backend/`)
Expected: FAIL — `Expected 6 arguments, but got 7` (once the fake is appended everywhere) and `controller.listOutcomes is not a function`

- [ ] **Step 3: Write minimal implementation**

In `backend/src/llm/llm.controller.ts`, add the import:

```typescript
import { AiOutcomeService } from './ai-outcome.service.js';
```

Add the constructor param, after `symbolPatterns`:

```typescript
  constructor(
    private readonly llm: LlmService,
    private readonly summaries: AiSummaryService,
    private readonly tradeIdeas: TradeIdeaService,
    private readonly tradeIdeaHistory: TradeIdeaHistoryService,
    private readonly tradeReviews: TradeReviewService,
    private readonly symbolPatterns: SymbolPatternService,
    private readonly outcomes: AiOutcomeService,
  ) {}
```

Add the endpoint, after `removeTradeIdea`:

```typescript
  @Get('outcomes')
  listOutcomes() {
    return this.outcomes.list();
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- llm.controller.spec.ts` (from `backend/`)
Expected: PASS

- [ ] **Step 5: Run the full backend unit suite**

Run: `npm test` (from `backend/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/llm/llm.controller.ts backend/src/llm/llm.controller.spec.ts
git commit -m "feat: add GET /ai/outcomes"
```

---

### Task 10: e2e — the whole wiring, end to end

**Files:**
- Create: `backend/test/ai-outcomes.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /ai/trade-idea`, `GET /ai/outcomes` (both now exist).

This is scoped to the trade-idea path, which is the one feature whose HTTP flow can be exercised deterministically end to end (a real, overridden `LlmClient` returns a fixed LEVELS block; a real, overridden `YahooClient` returns fixed bars). The symbol-pattern/trade-review "repeated vs. improved" branch logic is already exhaustively covered at the unit level in Task 8 — building the trade history and journal tags needed to exercise that same branch again through raw HTTP would duplicate that coverage without adding confidence, the same boundary this codebase already draws elsewhere (e.g. `HistoryService`'s catch-up window logic is unit-tested, not re-derived in an e2e spec). This e2e spec instead confirms: the row is created at generation time, `GET /ai/outcomes` triggers resolution, and a real request/response round-trips correctly.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/ai-outcomes.e2e-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { LlmClient } from '../src/llm/llm.client.js';

/** 220 flat bars, then a run that pushes straight through the target. */
function bars(targetCrossingDate: string) {
  const flat = Array.from({ length: 220 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
    return {
      date: day.toISOString().slice(0, 10),
      close: 100,
      adjClose: 100,
      open: 100,
      high: 101,
      low: 99,
      volume: 1_000_000,
    };
  });
  return [
    ...flat,
    {
      date: targetCrossingDate,
      close: 132,
      adjClose: 132,
      open: 128,
      high: 132,
      low: 127,
      volume: 1_000_000,
    },
  ];
}

describe('AI outcomes (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let dataSource: DataSource;
  let yahooBars: ReturnType<typeof bars>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue({
        quote: async (symbol: string) => ({
          symbol,
          name: `${symbol} Inc`,
          price: 100,
          currency: 'USD',
          session: 'REGULAR',
          extended: false,
          regularPrice: 100,
          peRatio: 30,
        }),
        quoteMany: async () => [],
        dailyBars: async () => yahooBars,
      })
      .overrideProvider(LlmClient)
      .useValue({
        isConfigured: () => true,
        modelName: () => 'stub-model',
        complete: async () => 'Real prose about the trade.\n\nLEVELS\nstop: 90\ntarget: 130',
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    token = await login(app);
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    yahooBars = bars('2026-09-05');
    await dataSource.query('TRUNCATE trade_ideas, ai_outcomes RESTART IDENTITY CASCADE');
    await dataSource.query(
      'TRUNCATE stop_levels, stop_executions, transactions, cash_flows, dividends, journal_entries, entry_tags, tags, daily_closes RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a pending outcome row when a trade idea is generated with readable levels', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);

    const rows = await dataSource.query(
      `SELECT feature, "entityId", status FROM ai_outcomes`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].feature).toBe('trade_idea');
    expect(rows[0].status).toBe('pending');
  });

  it('resolves a pending trade-idea outcome to target_hit on GET /ai/outcomes', async () => {
    await http(app, token).post('/ai/trade-idea').send({ symbol: 'NVDA' }).expect(201);

    const res = await http(app, token).get('/ai/outcomes').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('target_hit');
  });

  it('blocks the route without a token', async () => {
    await request(app.getHttpServer()).get('/ai/outcomes').expect(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e -- ai-outcomes.e2e-spec.ts` (from `backend/`)
Expected: FAIL if any wiring from Tasks 1-9 is incomplete; if all prior tasks are done correctly, this should already PASS on first run — in which case skip to Step 4, since there is no implementation gap left to close. (Unlike a unit test, this e2e spec is a integration check of already-implemented behavior, not new behavior of its own.)

- [ ] **Step 3: Fix any wiring gap the failure reveals**

If the test fails, the failure will point at one specific seam (module wiring, an endpoint path, a response shape) — fix that seam in the relevant file from Tasks 1-9, not by changing this test's expectations.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e -- ai-outcomes.e2e-spec.ts` (from `backend/`)
Expected: PASS, all three tests green

- [ ] **Step 5: Run the full e2e suite to confirm nothing else broke**

Run: `npm run test:e2e` (from `backend/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/test/ai-outcomes.e2e-spec.ts
git commit -m "test: e2e coverage for the ai_outcomes wiring end to end"
```

---

## Self-Review Notes

**Spec coverage:** every section of the design doc has a task — data-source correction (Task 1), `ai_outcomes` table (Task 2), id-threading (Tasks 4-6), trade-idea grading (Task 7), behavioral grading (Task 8), `GET /ai/outcomes` (Task 9), and the "no UI, no scheduler, no cross-feature scope creep" boundaries are respected by simply not building them. The two "open questions for the plan" in the spec were both resolved with a concrete, stated default: resolution runs from `list()` only (not opportunistically after generation), and the response shape is the raw `AiOutcome[]` row list.

**Type consistency:** `AiOutcomeFeature`/`AiOutcomeStatus` (Task 2) are used identically by `AiOutcomeService` (Tasks 3, 7, 8), by every `recordPending` call site (Tasks 4-6), and by the controller (Task 9). `recordPending(feature, entityId)` and `list()` signatures are introduced in Task 3 and never change shape afterward. `HistoryService.liveDailyBars(symbol, from)` (Task 1) is called with the same argument order in Task 7.
