# Trader Phase 2 — "The Diary" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the diary the thing that maintains the portfolio — log a trade and the position moves, write a note and nothing moves, record a deposit and cash moves. All on one timeline, all editable.

**Architecture:** A new `journal` module owns the only write path into `transactions` and `cash_flows`, exactly as seeding already does. Positions stay derived, so editing or deleting an entry recomputes the portfolio for free. The frontend gains a timeline, a bottom-sheet composer, and a position detail page.

**Tech Stack:** Unchanged — NestJS 12 + TypeORM + PostgreSQL, React 19 + Vite + Tailwind v4 + TanStack Query. See `CLAUDE.md`.

---

## Scope

**Phase 2 delivers:**

- Trade entries that move the portfolio (buy / sell, with fee)
- **Tiered stop levels captured at entry** — fixed prices and/or percentage trails, optional but prompted
- **A one-time catch-up screen** to set stops on already-open positions
- **Round-trip trades derived from the transaction log**
- **Header stats: win rate, average dollar risk, expectancy**
- Note entries that move nothing
- Cash entries (deposit / withdraw) that move cash
- Setup and mistake tags, created on the fly
- One chronological timeline, filterable
- Full edit and delete of any entry, with the portfolio recomputing
- Position detail: every entry that ever touched a ticker
- Settings: default fee

**Phase 2 does NOT deliver:** price history backfill, the benchmark chart, trade replay, or any AI.

**Trade replay is deliberately Phase 3.** It needs daily price history, which is
exactly the backfill Phase 3 builds for the benchmark chart. Building it here
would mean writing that backfill twice. What Phase 2 *must* do is capture the
data replay and the stats depend on — stop, target, and the trade groupings —
because those cannot be reconstructed later.

## Decisions carried in from review

| Decision | Rationale |
|---|---|
| **Notes optional but prompted** | A trade saves in two taps when busy, but an entry with no thesis is visibly marked in the timeline and can be annotated later. Requiring a note risks the worse failure: skipping logging entirely and letting the portfolio drift. |
| **Full edit and delete** | Positions are derived, so recomputation is free. This becomes the real "edit a position" mechanism and retires reset-and-re-seed as the only correction tool. |
| **Seeded entries are ordinary entries** | They already exist as `TRADE`/`CASH` entries from Phase 1. They appear in the timeline and are editable like anything else — which is what finally lets a seeding typo be fixed properly. |
| **Stop and target optional but prompted** | The owner sets a stop on most trades but not all. Requiring one would push him to skip logging; omitting the field entirely would make R-based expectancy impossible forever. |
| **Stops are tiered: a list of levels, not one price** | The owner scales out — part of the position exits at one level, the rest lower. A `stop_levels` table with one row per tier covers a single stop as the one-row case, and never needs a migration for a third tier. |
| **A level is FIXED or TRAILING, and tiers may mix** | The owner sometimes trails by percentage. A percentage trail is a *rule* fixed at entry, so it does not violate immutability — the level moves, the plan does not. |
| **Stops never move discretionarily** | There is no trailing-stop control anywhere in the UI. Stops are correctable only by editing the journal entry, which is deliberate friction: fixing a typo is a few taps, moving a stop has no fast path. This is what keeps R honest. |
| **Risk is only counted for shares a stop actually covers** | Tiers may cover fewer shares than the position. The UI reports "covers 100 of 150 sh" rather than quietly understating risk. |
| **Live trailing levels are Phase 3** | Knowing where a trailing stop sits today needs the high-water mark since entry, which needs daily price history. Initial risk — the number expectancy needs — is knowable at entry and captured now. |
| **Header shows win rate, average dollar risk, expectancy** | Replaces R:R at the owner's request. Average risk answers a sizing-discipline question — "what do I typically put on the line" — and reads straight off data already computed. |
| **Average risk includes open trades; win rate and expectancy do not** | Risk is fixed at entry and does not depend on the outcome, so an open position is just as informative. Win rate and expectancy need a result, so they cover closed trades only. Each stat states its own sample size. |
| **Expectancy in R only over trades with a stop** | R genuinely requires risk per trade. The UI states how many trades were excluded rather than quietly averaging a smaller set. |
| **A trade is derived, not stored** | Same reasoning as positions: a round trip is the span from flat → open → flat in the transaction log. Deriving it means it can never disagree with the journal. |
| **Replay uses daily bars only** | The owner's decision. Free Yahoo serves daily history indefinitely, so nothing decays and no snapshotting is needed. Trade-offs: an intraday trade is a single candle and cannot meaningfully animate. |

## Test checkpoints

| After Task | You can test |
|---|---|
| 4 | The timeline shows your seeded entries, filterable |
| 8 | Log a real trade and watch the dashboard move |
| 11 | Notes, cash entries, and tags |
| 13 | Edit and delete — fix a seeding typo properly |
| 12 | Position detail: the story of one ticker |
| 15 | Win rate, average risk and expectancy over your real trades |

## File structure

```
backend/src/
  journal/
    journal-entry.entity.ts     (exists)
    tag.entity.ts               NEW  setups and mistakes
    entry-tag.entity.ts         NEW  join
    journal.service.ts          NEW  the only write path into txns/flows
    journal.service.spec.ts     NEW
    journal.controller.ts       NEW  REST for entries and tags
    journal.dto.ts              NEW  validation
    journal.module.ts           NEW
  portfolio/
    portfolio.service.ts        MODIFY  expose per-symbol history + settings
frontend/src/
  lib/
    entryDraft.ts               NEW  composer draft persistence
  components/
    EntrySheet.tsx              NEW  the bottom-sheet composer
    EntryCard.tsx               NEW  one timeline row
    TagPicker.tsx               NEW
  routes/
    Journal.tsx                 NEW  the timeline
    Position.tsx                NEW  /positions/:symbol
    Settings.tsx                NEW  default fee
```

`journal.service.ts` is the heart of this phase. It must stay the sole writer of
`transactions` and `cash_flows` — `PortfolioService.seed` should be refactored to
call it rather than writing rows itself, so there is genuinely one code path.

---

## Task 1: Tag entities and planned stop/target

**Files:**
- Create: `backend/src/journal/tag.entity.ts`
- Create: `backend/src/journal/entry-tag.entity.ts`
- Modify: `backend/src/transactions/transaction.entity.ts`

- [ ] **Step 1: Write the tag entity**

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type TagType = 'SETUP' | 'MISTAKE';

/** Reusable across entries, created on the fly from the composer. */
@Entity('tags')
@Unique(['userId', 'type', 'label'])
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  type: TagType;

  @Column()
  label: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: Write the join entity**

```ts
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('entry_tags')
@Unique(['entryId', 'tagId'])
export class EntryTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  entryId: string;

  @Index()
  @Column('uuid')
  tagId: string;
}
```

- [ ] **Step 3: Add the planned target to transactions**

Append to `backend/src/transactions/transaction.entity.ts`, inside the class:

```ts
  /**
   * The profit target planned at entry. Nullable — optional like the stop.
   * Captured from Phase 2 onward so a planned R:R can be displayed later
   * without a backfill, even though nothing renders it yet.
   */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  plannedTarget: number | null;
```

- [ ] **Step 4: Add the stop level entity**

Create `backend/src/transactions/stop-level.entity.ts`:

```ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

export type StopKind = 'FIXED' | 'TRAILING';

/**
 * One tier of a stop plan, attached to the opening fill. The owner scales out:
 * part of the position exits at one level, the rest lower. A single stop is
 * simply the one-row case.
 *
 * These are IMMUTABLE in normal use — there is no trailing-stop control in the
 * UI, because a discretionary trail rewrites risk retroactively and inflates
 * expectancy. A percentage TRAILING level is different: the rule is fixed at
 * entry, so only the level moves, and risk at entry stays knowable.
 */
@Entity('stop_levels')
export class StopLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  transactionId: string;

  @Column({ type: 'varchar' })
  kind: StopKind;

  /** FIXED only: the price. Null for a trailing level. */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  price: number | null;

  /** TRAILING only: percent below the high, e.g. 8 means 8%. */
  @Column('numeric', {
    precision: 8,
    scale: 4,
    nullable: true,
    transformer: numericTransformer,
  })
  trailPercent: number | null;

  /** Shares exiting at this level. May total less than the position. */
  @Column('numeric', {
    precision: 20,
    scale: 8,
    transformer: numericTransformer,
  })
  quantity: number;

  @Column('int', { default: 0 })
  ordinal: number;
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build --prefix backend`
Expected: build succeeds. `synchronize: true` creates `stop_levels` and adds
`plannedTarget` as nullable, so existing rows are unaffected.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: tag entities, stop levels and planned target"
```

---

## Task 1b: Risk from stop levels

A pure module, because every stat in the header is built on this number.

**Files:**
- Create: `backend/src/portfolio/risk.ts`
- Create: `backend/src/portfolio/risk.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/portfolio/risk.spec.ts`:

```ts
import { computeRisk, type StopLevelInput } from './risk.js';

const fixed = (price: number, quantity: number): StopLevelInput => ({
  kind: 'FIXED',
  price,
  trailPercent: null,
  quantity,
});
const trailing = (
  trailPercent: number,
  quantity: number,
): StopLevelInput => ({
  kind: 'TRAILING',
  price: null,
  trailPercent,
  quantity,
});

describe('computeRisk', () => {
  it('is null with no stop levels', () => {
    const r = computeRisk({ avgEntry: 217, quantity: 100, levels: [] });
    expect(r.amount).toBeNull();
    expect(r.coveredQuantity).toBe(0);
  });

  it('computes a single fixed stop on a long', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBe(1200);
    expect(r.coveredQuantity).toBe(100);
    expect(r.fullyCovered).toBe(true);
  });

  it('sums a tiered exit', () => {
    // 50 out at 205 (-12) and 50 at 195 (-22)
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 50), fixed(195, 50)],
    });
    expect(r.amount).toBe(600 + 1100);
  });

  it('computes a percentage trail from the entry price', () => {
    // A trailing stop starts trailPercent below entry, so risk at entry is known.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [trailing(8, 100)],
    });
    expect(r.amount).toBe(1736); // 217 * 0.08 * 100
  });

  it('mixes fixed and trailing tiers', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 50), trailing(8, 50)],
    });
    expect(r.amount).toBe(600 + 868);
  });

  it('reports partial coverage rather than understating risk silently', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 150,
      levels: [fixed(205, 100)],
    });
    expect(r.amount).toBe(1200);
    expect(r.coveredQuantity).toBe(100);
    expect(r.fullyCovered).toBe(false);
  });

  it('works for a short, where the stop sits above the entry', () => {
    const r = computeRisk({
      avgEntry: 300,
      quantity: 10,
      levels: [fixed(320, 10)],
      direction: 'SHORT',
    });
    expect(r.amount).toBe(200);
  });

  it('trails a short upward from entry', () => {
    const r = computeRisk({
      avgEntry: 300,
      quantity: 10,
      levels: [trailing(10, 10)],
      direction: 'SHORT',
    });
    expect(r.amount).toBe(300); // 300 * 0.10 * 10
  });

  it('ignores a fixed level on the wrong side of the entry', () => {
    // A "stop" above entry on a long is a typo, not a stop. Counting it would
    // report negative risk, which is nonsense.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(230, 100)],
    });
    expect(r.amount).toBeNull();
    expect(r.invalidLevels).toBe(1);
  });

  it('ignores a level with no usable price or percent', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [{ kind: 'FIXED', price: null, trailPercent: null, quantity: 100 }],
    });
    expect(r.amount).toBeNull();
    expect(r.invalidLevels).toBe(1);
  });

  it('ignores a zero or negative trail percent', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [trailing(0, 100)],
    });
    expect(r.amount).toBeNull();
  });

  it('ignores a level with zero quantity', () => {
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 0)],
    });
    expect(r.amount).toBeNull();
    expect(r.coveredQuantity).toBe(0);
  });

  it('caps coverage at the position size when tiers overshoot', () => {
    // Over-covering is a data error; risk still counts only real shares.
    const r = computeRisk({
      avgEntry: 217,
      quantity: 100,
      levels: [fixed(205, 80), fixed(195, 80)],
    });
    expect(r.coveredQuantity).toBe(100);
    expect(r.overCovered).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --prefix backend -- risk`
Expected: FAIL — `Cannot find module './risk.js'`.

- [ ] **Step 3: Implement**

Create `backend/src/portfolio/risk.ts`:

```ts
export type StopKind = 'FIXED' | 'TRAILING';

export interface StopLevelInput {
  kind: StopKind;
  price: number | null;
  trailPercent: number | null;
  quantity: number;
}

export interface RiskInput {
  avgEntry: number;
  /** Position size, used to report coverage. */
  quantity: number;
  levels: StopLevelInput[];
  direction?: 'LONG' | 'SHORT';
}

export interface RiskResult {
  /** Dollars at risk across covered shares. Null when nothing is covered. */
  amount: number | null;
  coveredQuantity: number;
  fullyCovered: boolean;
  /** Tiers covering more shares than are held — a data error worth surfacing. */
  overCovered: boolean;
  /** Levels skipped as unusable, so the UI can say why risk looks wrong. */
  invalidLevels: number;
}

const EPSILON = 1e-9;

/**
 * Risk at entry, summed across stop tiers.
 *
 * A TRAILING level starts exactly `trailPercent` below the entry (above, for a
 * short), so risk at entry is knowable and fixed even though the level later
 * moves with the price. That is what lets a percentage trail coexist with
 * immutable, honest R.
 *
 * Levels on the wrong side of the entry are skipped rather than counted: a
 * "stop" above entry on a long is a typo, and counting it would report
 * negative risk.
 */
export function computeRisk(input: RiskInput): RiskResult {
  const direction = input.direction ?? 'LONG';
  const long = direction === 'LONG';

  let amount = 0;
  let covered = 0;
  let invalid = 0;

  for (const level of input.levels) {
    if (!(level.quantity > EPSILON)) {
      invalid += 1;
      continue;
    }

    let perShare: number | null = null;

    if (level.kind === 'FIXED' && level.price !== null && level.price > 0) {
      const distance = long
        ? input.avgEntry - level.price
        : level.price - input.avgEntry;
      perShare = distance > EPSILON ? distance : null;
    } else if (
      level.kind === 'TRAILING' &&
      level.trailPercent !== null &&
      level.trailPercent > EPSILON
    ) {
      perShare = input.avgEntry * (level.trailPercent / 100);
    }

    if (perShare === null) {
      invalid += 1;
      continue;
    }

    amount += perShare * level.quantity;
    covered += level.quantity;
  }

  const overCovered = covered > input.quantity + EPSILON;
  const cappedCover = Math.min(covered, input.quantity);

  return {
    amount: covered > EPSILON ? round(amount) : null,
    coveredQuantity: round(cappedCover),
    fullyCovered:
      covered > EPSILON && Math.abs(cappedCover - input.quantity) < EPSILON,
    overCovered,
    invalidLevels: invalid,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --prefix backend -- risk`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: risk calculation across tiered fixed and trailing stops"
```

---

## Task 2: Journal service — read side

**Files:**
- Create: `backend/src/journal/journal.service.ts`
- Create: `backend/src/journal/journal.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write the service with list only**

Create `backend/src/journal/journal.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { JournalEntry } from './journal-entry.entity.js';
import { Tag } from './tag.entity.js';
import { EntryTag } from './entry-tag.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { UsersService } from '../users/users.service.js';

export interface EntryView {
  id: string;
  kind: 'TRADE' | 'NOTE' | 'CASH';
  body: string;
  occurredAt: string;
  trade: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    fee: number;
    plannedTarget: number | null;
    stopLevels: StopLevelSpec[];
    /** Dollars at risk from the tiers, computed for display. */
    riskAmount: number | null;
  } | null;
  cash: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: number } | null;
  tags: { id: string; type: 'SETUP' | 'MISTAKE'; label: string }[];
}

export interface ListFilters {
  symbol?: string;
  kind?: 'TRADE' | 'NOTE' | 'CASH';
  tagId?: string;
}

@Injectable()
export class JournalService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(Transaction)
    private readonly txns: Repository<Transaction>,
    @InjectRepository(CashFlow)
    private readonly flows: Repository<CashFlow>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(EntryTag)
    private readonly entryTags: Repository<EntryTag>,
    @InjectRepository(Instrument)
    private readonly instruments: Repository<Instrument>,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async list(filters: ListFilters = {}): Promise<EntryView[]> {
    const user = await this.users.ensureDefaultUser();
    const [entries, txns, flows, instruments, allTags, joins] =
      await Promise.all([
        this.entries.find({
          where: { userId: user.id },
          order: { occurredAt: 'DESC', createdAt: 'DESC' },
        }),
        this.txns.find({ where: { userId: user.id } }),
        this.flows.find({ where: { userId: user.id } }),
        this.instruments.find(),
        this.tags.find({ where: { userId: user.id } }),
        this.entryTags.find(),
      ]);

    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const txnByEntry = new Map(txns.map((t) => [t.entryId, t]));
    const flowByEntry = new Map(flows.map((f) => [f.entryId, f]));
    const tagById = new Map(allTags.map((t) => [t.id, t]));
    const tagIdsByEntry = new Map<string, string[]>();
    for (const j of joins) {
      tagIdsByEntry.set(j.entryId, [
        ...(tagIdsByEntry.get(j.entryId) ?? []),
        j.tagId,
      ]);
    }

    const views = entries.map((e) => {
      const t = txnByEntry.get(e.id);
      const f = flowByEntry.get(e.id);
      return {
        id: e.id,
        kind: e.kind,
        body: e.body,
        occurredAt: e.occurredAt.toISOString(),
        trade: t
          ? {
              symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
              side: t.side,
              quantity: t.quantity,
              price: t.price,
              fee: t.fee,
            }
          : null,
        cash: f ? { direction: f.direction, amount: f.amount } : null,
        tags: (tagIdsByEntry.get(e.id) ?? [])
          .map((id) => tagById.get(id))
          .filter((t): t is Tag => t !== undefined)
          .map((t) => ({ id: t.id, type: t.type, label: t.label })),
      };
    });

    return views.filter((v) => {
      if (filters.kind && v.kind !== filters.kind) return false;
      if (filters.symbol && v.trade?.symbol !== filters.symbol.toUpperCase()) {
        return false;
      }
      if (filters.tagId && !v.tags.some((t) => t.id === filters.tagId)) {
        return false;
      }
      return true;
    });
  }

  async listTags() {
    const user = await this.users.ensureDefaultUser();
    return this.tags.find({
      where: { userId: user.id },
      order: { type: 'ASC', label: 'ASC' },
    });
  }
}
```

- [ ] **Step 2: Write the module**

Create `backend/src/journal/journal.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './journal-entry.entity.js';
import { Tag } from './tag.entity.js';
import { EntryTag } from './entry-tag.entity.js';
import { Transaction } from '../transactions/transaction.entity.js';
import { CashFlow } from '../transactions/cash-flow.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { JournalService } from './journal.service.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntry,
      Tag,
      EntryTag,
      Transaction,
      CashFlow,
      Instrument,
    ]),
    InstrumentsModule,
    UsersModule,
  ],
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
```

Register `JournalModule` in `backend/src/app.module.ts` imports, with:

```ts
import { JournalModule } from './journal/journal.module.js';
```

- [ ] **Step 3: Verify**

Run: `npm run build --prefix backend`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: journal service read side"
```

---

## Task 3: Journal list endpoint

**Files:**
- Create: `backend/src/journal/journal.controller.ts`
- Create: `backend/test/journal.e2e-spec.ts`
- Modify: `backend/src/journal/journal.module.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/test/journal.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Journal (e2e)', () => {
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
      'TRUNCATE transactions, cash_flows, journal_entries, entry_tags, tags RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an empty timeline before anything is logged', async () => {
    const res = await request(app.getHttpServer()).get('/journal').expect(200);
    expect(res.body).toEqual([]);
  });

  it('shows seeded entries on the timeline', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/journal').expect(200);
    // One CASH entry for opening capital, one TRADE entry for the holding.
    expect(res.body).toHaveLength(2);
    const trade = res.body.find((e: { kind: string }) => e.kind === 'TRADE');
    expect(trade.trade).toMatchObject({
      symbol: 'NVDA',
      side: 'BUY',
      quantity: 10,
      price: 100,
    });
    const cash = res.body.find((e: { kind: string }) => e.kind === 'CASH');
    expect(cash.cash).toMatchObject({ direction: 'DEPOSIT', amount: 11000 });
  });

  it('filters by kind', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/journal?kind=TRADE')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].kind).toBe('TRADE');
  });

  it('filters by symbol', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [
          { symbol: 'NVDA', quantity: 10, avgCost: 100 },
          { symbol: 'AAPL', quantity: 5, avgCost: 200 },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/journal?symbol=nvda')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].trade.symbol).toBe('NVDA');
  });

  it('returns an empty tag list initially', async () => {
    const res = await request(app.getHttpServer())
      .get('/journal/tags')
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e --prefix backend -- journal`
Expected: FAIL — 404 on `/journal`.

- [ ] **Step 3: Write the controller**

Create `backend/src/journal/journal.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { JournalService } from './journal.service.js';

@Controller('journal')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('kind') kind?: 'TRADE' | 'NOTE' | 'CASH',
    @Query('tagId') tagId?: string,
  ) {
    return this.journal.list({ symbol, kind, tagId });
  }

  @Get('tags')
  tags() {
    return this.journal.listTags();
  }
}
```

Add `controllers: [JournalController]` to `journal.module.ts` and import it.

**Note:** `@Get('tags')` must be declared before any `@Get(':id')` route added
later, or Nest will match `tags` as an id.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:e2e --prefix backend -- journal`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: journal list endpoint with filters"
```

---

## Task 4: The timeline screen

**Files:**
- Create: `frontend/src/components/EntryCard.tsx`
- Create: `frontend/src/routes/Journal.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Write the entry card**

Create `frontend/src/components/EntryCard.tsx`:

```tsx
import { Money } from './Money';
import { formatQuantity } from './format';

export interface Entry {
  id: string;
  kind: 'TRADE' | 'NOTE' | 'CASH';
  body: string;
  occurredAt: string;
  trade: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    fee: number;
    plannedTarget: number | null;
    stopLevels: StopLevelSpec[];
    /** Dollars at risk from the tiers, computed for display. */
    riskAmount: number | null;
  } | null;
  cash: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: number } | null;
  tags: { id: string; type: 'SETUP' | 'MISTAKE'; label: string }[];
}

function TradeHeader({ trade }: { trade: NonNullable<Entry['trade']> }) {
  const buying = trade.side === 'BUY';
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
          buying ? 'bg-up/15 text-up' : 'bg-down/15 text-down'
        }`}
      >
        {trade.side}
      </span>
      <span className="text-[15px] font-semibold">{trade.symbol}</span>
      <span className="text-xs text-muted">
        {formatQuantity(trade.quantity)} @ <Money value={trade.price} />
      </span>
    </div>
  );
}

export function EntryCard({
  entry,
  onOpen,
}: {
  entry: Entry;
  onOpen: (entry: Entry) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="w-full space-y-1.5 border-b border-border py-3 text-left last:border-0"
      >
        {entry.trade && <TradeHeader trade={entry.trade} />}

        {entry.cash && (
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted">
              {entry.cash.direction === 'DEPOSIT' ? 'Deposit' : 'Withdraw'}
            </span>
            <Money value={entry.cash.amount} />
          </div>
        )}

        {entry.body ? (
          <p className="text-sm leading-snug text-text">{entry.body}</p>
        ) : (
          entry.kind === 'TRADE' && (
            // Notes are optional but never silently absent — an unannotated
            // trade is exactly the thing this product exists to prevent.
            <p className="text-xs text-muted italic">No thesis recorded — tap to add</p>
          )
        )}

        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <span
                key={t.id}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  t.type === 'SETUP'
                    ? 'bg-surface-2 text-muted'
                    : 'bg-down/10 text-down'
                }`}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}
```

- [ ] **Step 2: Write the timeline route**

Create `frontend/src/routes/Journal.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { EntryCard, type Entry } from '../components/EntryCard';

type KindFilter = 'ALL' | 'TRADE' | 'NOTE' | 'CASH';

const FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'TRADE', label: 'Trades' },
  { value: 'NOTE', label: 'Notes' },
  { value: 'CASH', label: 'Cash' },
];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function Journal() {
  const [kind, setKind] = useState<KindFilter>('ALL');

  const { data, isLoading, error } = useQuery({
    queryKey: ['journal', kind],
    queryFn: () =>
      api<Entry[]>(`/journal${kind === 'ALL' ? '' : `?kind=${kind}`}`),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (error)
    return <p className="text-sm text-down">{(error as Error).message}</p>;

  const entries = data ?? [];

  // Group by calendar day so the timeline reads as days, not a flat list.
  const groups: { day: string; entries: Entry[] }[] = [];
  for (const e of entries) {
    const day = dayLabel(e.occurredAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.entries.push(e);
    else groups.push({ day, entries: [e] });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={kind === f.value}
            onClick={() => setKind(f.value)}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              kind === f.value
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-muted">Nothing logged yet.</p>
      )}

      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-1 text-[11px] uppercase tracking-wide text-muted">
            {g.day}
          </h2>
          <ul>
            {g.entries.map((e) => (
              <EntryCard key={e.id} entry={e} onOpen={() => {}} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add the route and nav link**

In `frontend/src/main.tsx` add:

```tsx
import { Journal } from './routes/Journal';
```

```tsx
<Route path="journal" element={<Journal />} />
```

In `frontend/src/components/AppShell.tsx`, add a second nav link after Portfolio:

```tsx
<NavLink to="/journal" className={linkClass}>
  Journal
</NavLink>
```

- [ ] **Step 4: Verify**

Run: `npm run dev`, open `/journal`.
Expected: your seeded entries appear, grouped by day, with BUY badges and
"No thesis recorded" on the seeded trades. Filters switch between kinds.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: journal timeline screen"
```

### ✋ TEST CHECKPOINT 1 — stop here

Open `/journal` on your phone. Your seeded portfolio should appear as a list of
entries: one deposit, one BUY per holding. Check the filters, and that the day
grouping reads well. **This is the screen you will look at most after the
dashboard, so say now if the density or grouping is wrong.**

---

## Task 5: Journal service — create a trade

**Files:**
- Modify: `backend/src/journal/journal.service.ts`
- Create: `backend/src/journal/journal.service.spec.ts`

- [ ] **Step 1: Write the failing unit test for validation logic**

Create `backend/src/journal/journal.service.spec.ts`:

```ts
import { resolveTradeSide, normaliseTagLabel } from './journal.service.js';

describe('resolveTradeSide', () => {
  it('maps a positive quantity to BUY', () => {
    expect(resolveTradeSide(10)).toEqual({ side: 'BUY', quantity: 10 });
  });

  it('maps a negative quantity to SELL', () => {
    expect(resolveTradeSide(-10)).toEqual({ side: 'SELL', quantity: 10 });
  });

  it('rejects a zero quantity', () => {
    expect(() => resolveTradeSide(0)).toThrow();
  });
});

describe('normaliseTagLabel', () => {
  it('trims whitespace', () => {
    expect(normaliseTagLabel('  pullback  ')).toBe('pullback');
  });

  it('collapses internal whitespace', () => {
    expect(normaliseTagLabel('broke  the   plan')).toBe('broke the plan');
  });

  it('lowercases so tags do not fragment by capitalisation', () => {
    expect(normaliseTagLabel('Pullback')).toBe('pullback');
  });

  it('rejects an empty label', () => {
    expect(() => normaliseTagLabel('   ')).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --prefix backend -- journal.service`
Expected: FAIL — exports not found.

- [ ] **Step 3: Add the helpers and the create method**

Add to the top of `backend/src/journal/journal.service.ts`, outside the class:

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * The UI sends a signed quantity; storage keeps side and magnitude separate.
 * Zero is always a mistake, never a valid trade.
 */
export function resolveTradeSide(signedQuantity: number): {
  side: 'BUY' | 'SELL';
  quantity: number;
} {
  if (!Number.isFinite(signedQuantity) || signedQuantity === 0) {
    throw new BadRequestException('Quantity must be a non-zero number');
  }
  return {
    side: signedQuantity > 0 ? 'BUY' : 'SELL',
    quantity: Math.abs(signedQuantity),
  };
}

/** Tags fragment badly if "Pullback" and "pullback" are different rows. */
export function normaliseTagLabel(label: string): string {
  const clean = label.trim().replace(/\s+/g, ' ').toLowerCase();
  if (clean === '') throw new BadRequestException('Tag label cannot be empty');
  return clean;
}
```

Add these interfaces above the class:

```ts
export interface StopLevelSpec {
  kind: 'FIXED' | 'TRAILING';
  price?: number | null;
  trailPercent?: number | null;
  quantity: number;
}

export interface CreateEntryInput {
  kind: 'TRADE' | 'NOTE' | 'CASH';
  body: string;
  occurredAt: string;
  trade?: {
    symbol: string;
    quantity: number;
    price: number;
    fee: number;
    plannedTarget?: number | null;
    stopLevels?: StopLevelSpec[];
  };
  cash?: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: number };
  tags?: { type: 'SETUP' | 'MISTAKE'; label: string }[];
}
```

Add these methods to `JournalService`:

```ts
  /**
   * The ONLY write path into transactions and cash flows. Everything — the
   * composer, and seeding — goes through here, so the invariant that a
   * transaction always belongs to an entry cannot be bypassed.
   */
  async create(input: CreateEntryInput): Promise<EntryView> {
    const user = await this.users.ensureDefaultUser();

    // Resolve the instrument before opening a transaction, so an unknown
    // ticker fails without leaving a partial entry behind.
    let instrumentId: string | null = null;
    let side: 'BUY' | 'SELL' = 'BUY';
    let quantity = 0;
    if (input.kind === 'TRADE') {
      if (!input.trade) {
        throw new BadRequestException('A trade entry needs trade details');
      }
      const resolved = resolveTradeSide(input.trade.quantity);
      side = resolved.side;
      quantity = resolved.quantity;
      const instrument = await this.instrumentsService.findOrCreate(
        input.trade.symbol,
      );
      instrumentId = instrument.id;
    }
    if (input.kind === 'CASH' && !input.cash) {
      throw new BadRequestException('A cash entry needs an amount');
    }

    const entryId = await this.dataSource.transaction(async (manager) => {
      const entry = await manager.save(
        manager.create(JournalEntry, {
          userId: user.id,
          kind: input.kind,
          body: input.body ?? '',
          occurredAt: new Date(input.occurredAt),
        }),
      );

      if (input.kind === 'TRADE' && input.trade && instrumentId) {
        const txn = await manager.save(
          manager.create(Transaction, {
            userId: user.id,
            entryId: entry.id,
            instrumentId,
            side,
            quantity,
            price: Math.abs(input.trade.price),
            fee: Math.abs(input.trade.fee ?? 0),
            plannedTarget: input.trade.plannedTarget ?? null,
            executedAt: new Date(input.occurredAt),
          }),
        );
        await this.writeStopLevels(manager, txn.id, input.trade.stopLevels);
      }

      if (input.kind === 'CASH' && input.cash) {
        await manager.save(
          manager.create(CashFlow, {
            userId: user.id,
            entryId: entry.id,
            direction: input.cash.direction,
            amount: Math.abs(input.cash.amount),
            occurredAt: new Date(input.occurredAt),
          }),
        );
      }

      await this.applyTags(manager, user.id, entry.id, input.tags ?? []);
      return entry.id;
    });

    const [view] = (await this.list()).filter((e) => e.id === entryId);
    return view;
  }

  /**
   * Replaces this transaction's stop tiers with exactly the ones given. Called
   * on create and on edit, so a corrected stop never leaves an orphan tier.
   */
  private async writeStopLevels(
    manager: EntityManager,
    transactionId: string,
    levels: StopLevelSpec[] | undefined,
  ): Promise<void> {
    await manager.delete(StopLevel, { transactionId });
    let ordinal = 0;
    for (const level of levels ?? []) {
      await manager.save(
        manager.create(StopLevel, {
          transactionId,
          kind: level.kind,
          price: level.kind === 'FIXED' ? (level.price ?? null) : null,
          trailPercent:
            level.kind === 'TRAILING' ? (level.trailPercent ?? null) : null,
          quantity: Math.abs(level.quantity),
          ordinal: ordinal++,
        }),
      );
    }
  }

  /** Find-or-create each tag, then replace the entry's joins with exactly these. */
  private async applyTags(
    manager: EntityManager,
    userId: string,
    entryId: string,
    tags: { type: 'SETUP' | 'MISTAKE'; label: string }[],
  ): Promise<void> {
    await manager.delete(EntryTag, { entryId });
    for (const t of tags) {
      const label = normaliseTagLabel(t.label);
      let tag = await manager.findOne(Tag, {
        where: { userId, type: t.type, label },
      });
      if (!tag) {
        tag = await manager.save(
          manager.create(Tag, { userId, type: t.type, label }),
        );
      }
      await manager.save(manager.create(EntryTag, { entryId, tagId: tag.id }));
    }
  }
```

Add `EntityManager` to the TypeORM import, and inject `InstrumentsService`:

```ts
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { InstrumentsService } from '../instruments/instruments.service.js';
```

and add to the constructor:

```ts
    private readonly instrumentsService: InstrumentsService,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --prefix backend -- journal.service`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: create journal entries with trades, cash and tags"
```

---

## Task 6: Create endpoint

**Files:**
- Create: `backend/src/journal/journal.dto.ts`
- Modify: `backend/src/journal/journal.controller.ts`
- Modify: `backend/test/journal.e2e-spec.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block in `backend/test/journal.e2e-spec.ts`:

```ts
  it('logs a buy and moves the portfolio', async () => {
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'Pullback to the 50 day, adding.',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 4 },
        tags: [{ type: 'SETUP', label: 'Pullback' }],
      })
      .expect(201);

    const portfolio = await request(app.getHttpServer())
      .get('/portfolio')
      .expect(200);
    const nvda = portfolio.body.positions.find(
      (p: { symbol: string }) => p.symbol === 'NVDA',
    );
    expect(nvda.quantity).toBe(10);
    expect(nvda.avgCost).toBe(200);
    // Cash: no deposits, so a buy drives it negative by cost plus fee.
    expect(portfolio.body.cash).toBe(-2004);
  });

  it('logs a sell that reduces a position', async () => {
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'open',
        occurredAt: '2026-08-01T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 4 },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'took half off',
        occurredAt: '2026-08-15T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: -5, price: 250, fee: 4 },
      })
      .expect(201);

    const portfolio = await request(app.getHttpServer())
      .get('/portfolio')
      .expect(200);
    const nvda = portfolio.body.positions.find(
      (p: { symbol: string }) => p.symbol === 'NVDA',
    );
    expect(nvda.quantity).toBe(5);
    expect(nvda.realizedPnl).toBe(250 - 8); // (250-200)*5 minus both fees
  });

  it('logs a note that moves nothing', async () => {
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'NOTE',
        body: 'Market feels toppy. Sitting on hands.',
        occurredAt: '2026-08-29T14:30:00.000Z',
      })
      .expect(201);

    const portfolio = await request(app.getHttpServer())
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.positions).toEqual([]);
    expect(portfolio.body.cash).toBe(0);
  });

  it('logs a deposit that moves only cash', async () => {
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'CASH',
        body: 'monthly transfer',
        occurredAt: '2026-08-29T14:30:00.000Z',
        cash: { direction: 'DEPOSIT', amount: 5000 },
      })
      .expect(201);

    const portfolio = await request(app.getHttpServer())
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.cash).toBe(5000);
    expect(portfolio.body.positions).toEqual([]);
  });

  it('reuses a tag regardless of capitalisation', async () => {
    const base = {
      kind: 'TRADE',
      body: 'x',
      occurredAt: '2026-08-29T14:30:00.000Z',
      trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
    };
    await request(app.getHttpServer())
      .post('/journal')
      .send({ ...base, tags: [{ type: 'SETUP', label: 'Pullback' }] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/journal')
      .send({ ...base, tags: [{ type: 'SETUP', label: 'pullback' }] })
      .expect(201);

    const tags = await request(app.getHttpServer())
      .get('/journal/tags')
      .expect(200);
    expect(tags.body).toHaveLength(1);
    expect(tags.body[0].label).toBe('pullback');
  });

  it('rejects a trade on an unknown ticker without writing anything', async () => {
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'x',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'ZZZZNOTREAL', quantity: 1, price: 1, fee: 0 },
      })
      .expect(404);

    const res = await request(app.getHttpServer()).get('/journal').expect(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a zero-quantity trade', async () => {
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'x',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 0, price: 200, fee: 0 },
      })
      .expect(400);
  });

  it('accepts a trade with an empty note', async () => {
    // Notes are optional by design; the UI marks them, the API allows them.
    await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: '',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
      })
      .expect(201);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:e2e --prefix backend -- journal`
Expected: FAIL — 404 on `POST /journal`.

- [ ] **Step 3: Write the DTOs**

Create `backend/src/journal/journal.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TradeDto {
  @IsString()
  @Length(1, 12)
  symbol: string;

  /** Signed: positive buys, negative sells. */
  @IsNumber()
  quantity: number;

  @IsNumber()
  price: number;

  @IsOptional()
  @IsNumber()
  fee?: number;

  /** The plan at entry. Optional — see the decisions table. */
  @IsOptional()
  @IsNumber()
  plannedTarget?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => StopLevelDto)
  stopLevels?: StopLevelDto[];
}

export class StopLevelDto {
  @IsIn(['FIXED', 'TRAILING'])
  kind: 'FIXED' | 'TRAILING';

  /** Required for FIXED, ignored for TRAILING. */
  @IsOptional()
  @IsNumber()
  price?: number;

  /** Required for TRAILING, ignored for FIXED. Percent, e.g. 8 means 8%. */
  @IsOptional()
  @IsNumber()
  trailPercent?: number;

  @IsNumber()
  quantity: number;
}

export class CashDto {
  @IsIn(['DEPOSIT', 'WITHDRAW'])
  direction: 'DEPOSIT' | 'WITHDRAW';

  @IsNumber()
  amount: number;
}

export class TagDto {
  @IsIn(['SETUP', 'MISTAKE'])
  type: 'SETUP' | 'MISTAKE';

  @IsString()
  @Length(1, 40)
  label: string;
}

export class CreateEntryDto {
  @IsIn(['TRADE', 'NOTE', 'CASH'])
  kind: 'TRADE' | 'NOTE' | 'CASH';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @IsISO8601()
  occurredAt: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TradeDto)
  trade?: TradeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CashDto)
  cash?: CashDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TagDto)
  tags?: TagDto[];
}
```

- [ ] **Step 4: Add the POST route**

In `backend/src/journal/journal.controller.ts`:

```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { JournalService } from './journal.service.js';
import { CreateEntryDto } from './journal.dto.js';
```

```ts
  @Post()
  create(@Body() body: CreateEntryDto) {
    return this.journal.create({
      kind: body.kind,
      body: body.body ?? '',
      occurredAt: body.occurredAt,
      trade: body.trade
        ? {
            symbol: body.trade.symbol,
            quantity: body.trade.quantity,
            price: body.trade.price,
            fee: body.trade.fee ?? 0,
          }
        : undefined,
      cash: body.cash,
      tags: body.tags,
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:e2e --prefix backend -- journal`
Expected: PASS — 13 tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: create journal entries over the API"
```

---

## Task 7: Route seeding through the journal service

Removes the duplicate write path, so there is genuinely one way transactions get
created.

**Files:**
- Modify: `backend/src/portfolio/portfolio.service.ts`
- Modify: `backend/src/portfolio/portfolio.module.ts`

- [ ] **Step 1: Inject the journal service**

In `backend/src/portfolio/portfolio.module.ts`, add `JournalModule` to `imports`:

```ts
import { JournalModule } from '../journal/journal.module.js';
```

In `portfolio.service.ts`, inject it:

```ts
import { JournalService } from '../journal/journal.service.js';
```

```ts
    private readonly journal: JournalService,
```

- [ ] **Step 2: Replace the inline writes in `seed`**

Replace the body of the `this.dataSource.transaction(...)` block in `seed` with
calls to the journal service:

```ts
    if (contributed !== 0) {
      await this.journal.create({
        kind: 'CASH',
        body: 'Opening capital (seeded)',
        occurredAt: asOf.toISOString(),
        cash: {
          direction: contributed > 0 ? 'DEPOSIT' : 'WITHDRAW',
          amount: Math.abs(contributed),
        },
      });
    }

    for (const { holding } of resolved) {
      await this.journal.create({
        kind: 'TRADE',
        body: `Opening position (seeded): ${holding.symbol.toUpperCase()}`,
        occurredAt: asOf.toISOString(),
        trade: {
          symbol: holding.symbol,
          quantity: holding.quantity,
          price: holding.avgCost,
          // Seeding is not a real trade, so it carries no fee.
          fee: 0,
        },
      });
    }
```

Remove the now-unused `JournalEntry`, `Transaction` and `CashFlow` `manager.create`
imports from `seed` only — `reset` still needs those repositories.

**Note:** seeding is no longer one database transaction. That is acceptable
because tickers are still validated up front, so the realistic failure mode is
gone. If a partial seed ever does occur, reset-and-re-seed recovers it.

- [ ] **Step 3: Run the whole suite**

Run: `npm run test --prefix backend && npm run test:e2e --prefix backend`
Expected: all green — the existing portfolio e2e tests prove seeding still
produces identical numbers through the new path.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: seed through the journal service, one write path"
```

---

## Task 8: The entry composer

**Files:**
- Create: `frontend/src/lib/entryDraft.ts`
- Create: `frontend/src/components/EntrySheet.tsx`
- Modify: `frontend/src/routes/Journal.tsx`

- [ ] **Step 1: Write the failing test first**

Create `frontend/src/lib/entryDraft.spec.ts` with the contents shown in Step 3
below, then run `npm run test --prefix frontend` and confirm it fails to resolve
`./entryDraft`. Only then write the implementation in Step 2.

- [ ] **Step 2: Write the draft shape**

Create `frontend/src/lib/entryDraft.ts`:

```ts
export type EntryKind = 'TRADE' | 'NOTE' | 'CASH';
export type TradeSide = 'BUY' | 'SELL';

export interface EntryDraft {
  kind: EntryKind;
  occurredAt: string;
  body: string;
  symbol: string;
  side: TradeSide;
  quantity: string;
  price: string;
  fee: string;
  cashDirection: 'DEPOSIT' | 'WITHDRAW';
  cashAmount: string;
  setups: string[];
  mistakes: string[];
}

/** Local datetime for a datetime-local input, not UTC. */
export function nowLocalInput(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

export function emptyDraft(defaultFee: number): EntryDraft {
  return {
    kind: 'TRADE',
    occurredAt: nowLocalInput(),
    body: '',
    symbol: '',
    side: 'BUY',
    quantity: '',
    price: '',
    fee: String(defaultFee),
    cashDirection: 'DEPOSIT',
    cashAmount: '',
    setups: [],
    mistakes: [],
  };
}

/** Signed quantity is what the API expects; the UI uses a Buy/Sell toggle. */
export function signedQuantity(draft: EntryDraft): number {
  const magnitude = Math.abs(parseFloat(draft.quantity || '0'));
  return draft.side === 'SELL' ? -magnitude : magnitude;
}
```

- [ ] **Step 3: The test file (write this in Step 1)**

Create `frontend/src/lib/entryDraft.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyDraft, nowLocalInput, signedQuantity } from './entryDraft';

describe('nowLocalInput', () => {
  it('formats local time for a datetime-local input', () => {
    expect(nowLocalInput(new Date(2026, 7, 29, 9, 5))).toBe('2026-08-29T09:05');
  });
  it('pads single digits', () => {
    expect(nowLocalInput(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04');
  });
});

describe('signedQuantity', () => {
  it('is positive for a buy', () => {
    const d = { ...emptyDraft(4), side: 'BUY' as const, quantity: '10' };
    expect(signedQuantity(d)).toBe(10);
  });
  it('is negative for a sell', () => {
    const d = { ...emptyDraft(4), side: 'SELL' as const, quantity: '10' };
    expect(signedQuantity(d)).toBe(-10);
  });
  it('ignores a typed minus sign so it cannot double-negate', () => {
    const d = { ...emptyDraft(4), side: 'SELL' as const, quantity: '-10' };
    expect(signedQuantity(d)).toBe(-10);
  });
  it('is zero for an empty quantity', () => {
    expect(signedQuantity({ ...emptyDraft(4), quantity: '' })).toBe(0);
  });
});

describe('emptyDraft', () => {
  it('prefills the fee from the user default', () => {
    expect(emptyDraft(4).fee).toBe('4');
  });
  it('starts as a trade entry', () => {
    expect(emptyDraft(4).kind).toBe('TRADE');
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --prefix frontend`
Expected: PASS — 8 new tests.

- [ ] **Step 5: Write the composer sheet**

Create `frontend/src/components/EntrySheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { clearDraft, loadDraft, saveDraft } from '../lib/draftStorage';
import {
  emptyDraft,
  signedQuantity,
  type EntryDraft,
  type EntryKind,
} from '../lib/entryDraft';
import { TagPicker } from './TagPicker';

const DRAFT_KEY = 'trader.entryDraft.v1';

const inputClass =
  'w-full min-w-0 rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent';

const KINDS: { value: EntryKind; label: string }[] = [
  { value: 'TRADE', label: 'Trade' },
  { value: 'NOTE', label: 'Note' },
  { value: 'CASH', label: 'Cash' },
];

export function EntrySheet({
  open,
  onClose,
  defaultFee,
}: {
  open: boolean;
  onClose: () => void;
  defaultFee: number;
}) {
  const [draft, setDraft] = useState<EntryDraft>(() =>
    loadDraft(DRAFT_KEY, emptyDraft(defaultFee)),
  );
  const queryClient = useQueryClient();

  useEffect(() => {
    saveDraft(DRAFT_KEY, draft);
  }, [draft]);

  const set = (patch: Partial<EntryDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const mutation = useMutation({
    mutationFn: () =>
      api('/journal', {
        method: 'POST',
        body: JSON.stringify({
          kind: draft.kind,
          body: draft.body,
          occurredAt: new Date(draft.occurredAt).toISOString(),
          trade:
            draft.kind === 'TRADE'
              ? {
                  symbol: draft.symbol.trim().toUpperCase(),
                  quantity: signedQuantity(draft),
                  price: Math.abs(parseFloat(draft.price || '0')),
                  fee: Math.abs(parseFloat(draft.fee || '0')),
                }
              : undefined,
          cash:
            draft.kind === 'CASH'
              ? {
                  direction: draft.cashDirection,
                  amount: Math.abs(parseFloat(draft.cashAmount || '0')),
                }
              : undefined,
          tags: [
            ...draft.setups.map((label) => ({ type: 'SETUP' as const, label })),
            ...draft.mistakes.map((label) => ({
              type: 'MISTAKE' as const,
              label,
            })),
          ],
        }),
      }),
    onSuccess: async () => {
      clearDraft(DRAFT_KEY);
      setDraft(emptyDraft(defaultFee));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['journal'] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
      ]);
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1"
      />
      <div className="max-h-[88vh] space-y-4 overflow-y-auto rounded-t-2xl border-t border-border bg-surface-0 p-4 pb-8">
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={draft.kind === k.value}
              onClick={() => set({ kind: k.value })}
              className={`flex-1 rounded-lg border py-2 text-sm transition-colors ${
                draft.kind === k.value
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border text-muted'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {draft.kind === 'TRADE' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                placeholder="NVDA"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={draft.symbol}
                onChange={(e) => set({ symbol: e.target.value })}
                className={inputClass}
              />
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
                {(['BUY', 'SELL'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={draft.side === s}
                    onClick={() => set({ side: s })}
                    className={`px-3 py-2 text-sm font-medium ${
                      draft.side === s
                        ? s === 'BUY'
                          ? 'bg-up/20 text-up'
                          : 'bg-down/20 text-down'
                        : 'bg-surface-1 text-muted'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder="qty"
                value={draft.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="price"
                value={draft.price}
                onChange={(e) => set({ price: e.target.value })}
                className={inputClass}
              />
              <input
                type="number"
                inputMode="decimal"
                placeholder="fee"
                value={draft.fee}
                onChange={(e) => set({ fee: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>
        )}

        {draft.kind === 'CASH' && (
          <div className="flex gap-2">
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
              {(['DEPOSIT', 'WITHDRAW'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.cashDirection === d}
                  onClick={() => set({ cashDirection: d })}
                  className={`px-3 py-2 text-sm font-medium ${
                    draft.cashDirection === d
                      ? 'bg-surface-2 text-text'
                      : 'bg-surface-1 text-muted'
                  }`}
                >
                  {d === 'DEPOSIT' ? 'In' : 'Out'}
                </button>
              ))}
            </div>
            <input
              type="number"
              inputMode="decimal"
              placeholder="amount"
              value={draft.cashAmount}
              onChange={(e) => set({ cashAmount: e.target.value })}
              className={inputClass}
            />
          </div>
        )}

        <input
          type="datetime-local"
          value={draft.occurredAt}
          onChange={(e) => set({ occurredAt: e.target.value })}
          className={inputClass}
        />

        <textarea
          rows={4}
          placeholder={
            draft.kind === 'TRADE'
              ? 'Why this trade? Setup, thesis, what would make you wrong.'
              : 'What are you thinking?'
          }
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
          className={`${inputClass} resize-none`}
        />

        {draft.kind === 'TRADE' && (
          <div className="space-y-3">
            <TagPicker
              type="SETUP"
              selected={draft.setups}
              onChange={(setups) => set({ setups })}
            />
            <TagPicker
              type="MISTAKE"
              selected={draft.mistakes}
              onChange={(mistakes) => set({ mistakes })}
            />
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-down">
            {(mutation.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-3 text-sm text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="flex-1 rounded-lg bg-accent px-4 py-3 font-medium text-surface-0 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the tag picker**

Create `frontend/src/components/TagPicker.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface Tag {
  id: string;
  type: 'SETUP' | 'MISTAKE';
  label: string;
}

export function TagPicker({
  type,
  selected,
  onChange,
}: {
  type: 'SETUP' | 'MISTAKE';
  selected: string[];
  onChange: (labels: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const { data } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api<Tag[]>('/journal/tags'),
  });

  const existing = (data ?? []).filter((t) => t.type === type);
  const toggle = (label: string) =>
    onChange(
      selected.includes(label)
        ? selected.filter((l) => l !== label)
        : [...selected, label],
    );

  const add = () => {
    const label = input.trim().toLowerCase();
    if (label && !selected.includes(label)) onChange([...selected, label]);
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted">
        {type === 'SETUP' ? 'Setups' : 'Mistakes'}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {[...new Set([...existing.map((t) => t.label), ...selected])].map(
          (label) => (
            <button
              key={label}
              type="button"
              aria-pressed={selected.includes(label)}
              onClick={() => toggle(label)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                selected.includes(label)
                  ? type === 'SETUP'
                    ? 'bg-accent/15 text-accent'
                    : 'bg-down/15 text-down'
                  : 'bg-surface-1 text-muted'
              }`}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={type === 'SETUP' ? 'add a setup' : 'add a mistake'}
          className="flex-1 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-border px-3 text-sm text-muted"
        >
          Add
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the compose button to the timeline**

In `frontend/src/routes/Journal.tsx`, add state and a floating button:

```tsx
const [composing, setComposing] = useState(false);
```

Render at the end of the returned fragment:

```tsx
<button
  type="button"
  onClick={() => setComposing(true)}
  aria-label="New entry"
  className="fixed right-5 bottom-8 z-40 h-14 w-14 rounded-full bg-accent text-2xl font-light text-surface-0 shadow-lg"
>
  +
</button>
<EntrySheet
  open={composing}
  onClose={() => setComposing(false)}
  defaultFee={4}
/>
```

with `import { EntrySheet } from '../components/EntrySheet';`.

- [ ] **Step 8: Verify**

Run: `npm run dev`, open `/journal`, tap +, log a small trade.
Expected: the entry appears on the timeline and the dashboard's position and
cash both move.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: entry composer with trades, notes, cash and tags"
```

### ✋ TEST CHECKPOINT 2 — the important one

**Log a real trade you actually made today.** Then check the dashboard: the
position, the cash, and the account value should all move correctly, and the fee
should be deducted.

Then try the things that break composers on phones: switch to your broker app
mid-entry and come back (the draft must survive), and check the Buy/Sell toggle
and the number keypads are comfortable one-handed.

---

## Task 9: Settings — default fee

**Files:**
- Modify: `backend/src/users/users.service.ts`
- Create: `backend/src/users/users.controller.ts`
- Modify: `backend/src/users/users.module.ts`
- Create: `frontend/src/routes/Settings.tsx`
- Modify: `frontend/src/main.tsx`, `frontend/src/components/EntrySheet.tsx`

- [ ] **Step 1: Add a settings endpoint**

Add to `backend/src/users/users.service.ts`:

```ts
  async getSettings() {
    const user = await this.ensureDefaultUser();
    return { defaultFee: user.defaultFee };
  }

  async updateSettings(defaultFee: number) {
    const user = await this.ensureDefaultUser();
    user.defaultFee = Math.abs(defaultFee);
    await this.users.save(user);
    return { defaultFee: user.defaultFee };
  }
```

Create `backend/src/users/users.controller.ts`:

```ts
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsNumber } from 'class-validator';
import { UsersService } from './users.service.js';

class SettingsDto {
  @IsNumber()
  defaultFee: number;
}

@Controller('settings')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get() {
    return this.users.getSettings();
  }

  @Patch()
  update(@Body() body: SettingsDto) {
    return this.users.updateSettings(body.defaultFee);
  }
}
```

Add `controllers: [UsersController]` to `users.module.ts`.

- [ ] **Step 2: Write the settings screen**

Create `frontend/src/routes/Settings.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function Settings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ defaultFee: number }>('/settings'),
  });
  const [fee, setFee] = useState<string | null>(null);
  const value = fee ?? (data ? String(data.defaultFee) : '');

  const mutation = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ defaultFee: parseFloat(value || '0') }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Settings</h1>
      <label className="block space-y-1">
        <span className="text-xs text-muted">Default trade fee</span>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setFee(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent"
        />
        <span className="block text-[11px] text-muted">
          Prefilled on every trade entry. Editable per trade.
        </span>
      </label>
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="rounded-lg bg-accent px-4 py-2 font-medium text-surface-0 disabled:opacity-50"
      >
        {mutation.isPending ? 'Saving…' : mutation.isSuccess ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}
```

Register the route at `path="settings"`, and add a Settings nav link.

- [ ] **Step 3: Use the real default fee in the composer**

In `frontend/src/routes/Journal.tsx`, fetch settings and pass the value through
instead of the hardcoded `4`:

```tsx
const { data: settings } = useQuery({
  queryKey: ['settings'],
  queryFn: () => api<{ defaultFee: number }>('/settings'),
});
```

```tsx
<EntrySheet
  open={composing}
  onClose={() => setComposing(false)}
  defaultFee={settings?.defaultFee ?? 4}
/>
```

- [ ] **Step 4: Verify and commit**

Run: `npm run dev`, change the fee in Settings, open the composer, confirm it
prefills with the new value.

```bash
git add -A && git commit -m "feat: settings screen for the default trade fee"
```

---

## Task 10: Edit and delete — backend

**Files:**
- Modify: `backend/src/journal/journal.service.ts`
- Modify: `backend/src/journal/journal.controller.ts`
- Modify: `backend/test/journal.e2e-spec.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block in `backend/test/journal.e2e-spec.ts`:

```ts
  it('edits a trade and recomputes the position', async () => {
    const created = await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'fat fingered',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 100, price: 200, fee: 4 },
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'corrected',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 4 },
      })
      .expect(200);

    const portfolio = await request(app.getHttpServer())
      .get('/portfolio')
      .expect(200);
    const nvda = portfolio.body.positions.find(
      (p: { symbol: string }) => p.symbol === 'NVDA',
    );
    expect(nvda.quantity).toBe(10);
    expect(portfolio.body.cash).toBe(-2004);
  });

  it('deletes an entry and removes its effect on the portfolio', async () => {
    const created = await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'logged twice by mistake',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 4 },
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/journal/${created.body.id}`)
      .expect(200);

    const portfolio = await request(app.getHttpServer())
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.positions).toEqual([]);
    expect(portfolio.body.cash).toBe(0);
  });

  it('can add a thesis to an entry saved without one', async () => {
    const created = await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: '',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
      })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'TRADE',
        body: 'Added the reasoning later.',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 1, price: 200, fee: 0 },
        tags: [{ type: 'MISTAKE', label: 'no plan' }],
      })
      .expect(200);

    expect(updated.body.body).toBe('Added the reasoning later.');
    expect(updated.body.tags).toHaveLength(1);
  });

  it('404s editing an entry that does not exist', async () => {
    await request(app.getHttpServer())
      .patch('/journal/00000000-0000-0000-0000-000000000000')
      .send({
        kind: 'NOTE',
        body: 'x',
        occurredAt: '2026-08-29T14:30:00.000Z',
      })
      .expect(404);
  });

  it('can change an entry from a trade into a note', async () => {
    const created = await request(app.getHttpServer())
      .post('/journal')
      .send({
        kind: 'TRADE',
        body: 'this was never a trade',
        occurredAt: '2026-08-29T14:30:00.000Z',
        trade: { symbol: 'NVDA', quantity: 10, price: 200, fee: 4 },
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/journal/${created.body.id}`)
      .send({
        kind: 'NOTE',
        body: 'just a thought',
        occurredAt: '2026-08-29T14:30:00.000Z',
      })
      .expect(200);

    const portfolio = await request(app.getHttpServer())
      .get('/portfolio')
      .expect(200);
    expect(portfolio.body.positions).toEqual([]);
    expect(portfolio.body.cash).toBe(0);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:e2e --prefix backend -- journal`
Expected: FAIL — 404 on PATCH and DELETE.

- [ ] **Step 3: Add update and remove to the service**

Add to `JournalService`:

```ts
  /**
   * Replaces the entry's rows wholesale rather than diffing them. Positions are
   * derived, so deleting and rewriting the transaction is both simpler and
   * exactly equivalent — and it makes changing an entry's kind fall out for
   * free.
   */
  async update(id: string, input: CreateEntryInput): Promise<EntryView> {
    const user = await this.users.ensureDefaultUser();
    const existing = await this.entries.findOne({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Entry not found');

    let instrumentId: string | null = null;
    let side: 'BUY' | 'SELL' = 'BUY';
    let quantity = 0;
    if (input.kind === 'TRADE') {
      if (!input.trade) {
        throw new BadRequestException('A trade entry needs trade details');
      }
      const resolved = resolveTradeSide(input.trade.quantity);
      side = resolved.side;
      quantity = resolved.quantity;
      instrumentId = (
        await this.instrumentsService.findOrCreate(input.trade.symbol)
      ).id;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        JournalEntry,
        { id },
        {
          kind: input.kind,
          body: input.body ?? '',
          occurredAt: new Date(input.occurredAt),
        },
      );

      // Drop whatever this entry used to own, then write what it owns now.
      // Stop levels hang off the transaction, so they go with it.
      const old = await manager.find(Transaction, { where: { entryId: id } });
      for (const t of old) {
        await manager.delete(StopLevel, { transactionId: t.id });
      }
      await manager.delete(Transaction, { entryId: id });
      await manager.delete(CashFlow, { entryId: id });

      if (input.kind === 'TRADE' && input.trade && instrumentId) {
        const txn = await manager.save(
          manager.create(Transaction, {
            userId: user.id,
            entryId: id,
            instrumentId,
            side,
            quantity,
            price: Math.abs(input.trade.price),
            fee: Math.abs(input.trade.fee ?? 0),
            plannedTarget: input.trade.plannedTarget ?? null,
            executedAt: new Date(input.occurredAt),
          }),
        );
        await this.writeStopLevels(manager, txn.id, input.trade.stopLevels);
      }
      if (input.kind === 'CASH' && input.cash) {
        await manager.save(
          manager.create(CashFlow, {
            userId: user.id,
            entryId: id,
            direction: input.cash.direction,
            amount: Math.abs(input.cash.amount),
            occurredAt: new Date(input.occurredAt),
          }),
        );
      }

      await this.applyTags(manager, user.id, id, input.tags ?? []);
    });

    const [view] = (await this.list()).filter((e) => e.id === id);
    return view;
  }

  async remove(id: string): Promise<void> {
    const user = await this.users.ensureDefaultUser();
    const existing = await this.entries.findOne({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Entry not found');

    await this.dataSource.transaction(async (manager) => {
      // Stop levels hang off the transaction, so they must go first.
      const txns = await manager.find(Transaction, { where: { entryId: id } });
      for (const t of txns) {
        await manager.delete(StopLevel, { transactionId: t.id });
      }
      await manager.delete(Transaction, { entryId: id });
      await manager.delete(CashFlow, { entryId: id });
      await manager.delete(EntryTag, { entryId: id });
      await manager.delete(JournalEntry, { id });
    });
  }
```

Add `NotFoundException` to the `@nestjs/common` import.

- [ ] **Step 4: Add the routes**

In `journal.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
```

```ts
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateEntryDto,
  ) {
    return this.journal.update(id, {
      kind: body.kind,
      body: body.body ?? '',
      occurredAt: body.occurredAt,
      trade: body.trade
        ? {
            symbol: body.trade.symbol,
            quantity: body.trade.quantity,
            price: body.trade.price,
            fee: body.trade.fee ?? 0,
          }
        : undefined,
      cash: body.cash,
      tags: body.tags,
    });
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.journal.remove(id);
    return { ok: true };
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:e2e --prefix backend -- journal`
Expected: PASS — 18 tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: edit and delete journal entries, portfolio recomputes"
```

---

## Task 11: Edit and delete — UI

**Files:**
- Modify: `frontend/src/components/EntrySheet.tsx`
- Modify: `frontend/src/routes/Journal.tsx`

- [ ] **Step 1: Let the sheet accept an existing entry**

Add to the imports at the top of `EntrySheet.tsx`:

```tsx
import { nowLocalInput } from '../lib/entryDraft';
import type { Entry } from './EntryCard';
```


Change `EntrySheet`'s props to include an optional entry, and seed the draft from
it when present:

```tsx
export function EntrySheet({
  open,
  onClose,
  defaultFee,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  defaultFee: number;
  editing?: Entry | null;
}) {
```

Add, after the existing `useState` for the draft:

```tsx
  // When opened on an existing entry, the draft mirrors it rather than the
  // persisted new-entry draft — editing must never clobber an unsaved new one.
  useEffect(() => {
    if (!open || !editing) return;
    setDraft({
      kind: editing.kind,
      occurredAt: nowLocalInput(new Date(editing.occurredAt)),
      body: editing.body,
      symbol: editing.trade?.symbol ?? '',
      side: editing.trade?.side ?? 'BUY',
      quantity: editing.trade ? String(editing.trade.quantity) : '',
      price: editing.trade ? String(editing.trade.price) : '',
      fee: editing.trade ? String(editing.trade.fee) : String(defaultFee),
      cashDirection: editing.cash?.direction ?? 'DEPOSIT',
      cashAmount: editing.cash ? String(editing.cash.amount) : '',
      setups: editing.tags.filter((t) => t.type === 'SETUP').map((t) => t.label),
      mistakes: editing.tags
        .filter((t) => t.type === 'MISTAKE')
        .map((t) => t.label),
    });
  }, [open, editing, defaultFee]);
```

Guard the draft persistence so editing does not overwrite the new-entry draft:

```tsx
  useEffect(() => {
    if (!editing) saveDraft(DRAFT_KEY, draft);
  }, [draft, editing]);
```

Change the mutation to PATCH when editing:

```tsx
    mutationFn: () =>
      api(editing ? `/journal/${editing.id}` : '/journal', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ /* unchanged */ }),
      }),
```

and in `onSuccess`, only clear the persisted draft when creating:

```tsx
      if (!editing) {
        clearDraft(DRAFT_KEY);
        setDraft(emptyDraft(defaultFee));
      }
```

- [ ] **Step 2: Add a delete control to the sheet**

Inside the sheet, when `editing` is set, render below the save row:

```tsx
{editing && <DeleteEntry entry={editing} onDone={onClose} />}
```

and define it in the same file:

```tsx
/** Two-step, and it names what it will do to the portfolio. */
function DeleteEntry({
  entry,
  onDone,
}: {
  entry: Entry;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api(`/journal/${entry.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['journal'] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
      ]);
      onDone();
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full text-xs text-muted underline underline-offset-4"
      >
        Delete this entry
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-down/40 bg-down/10 p-3">
      <p className="text-xs">
        {entry.trade
          ? `Deleting this removes the ${entry.trade.side} of ${entry.trade.symbol} from your portfolio.`
          : entry.cash
            ? 'Deleting this removes the cash movement from your balance.'
            : 'This note will be deleted.'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-lg bg-down px-3 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
        >
          {mutation.isPending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-border px-3 py-2 text-sm text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Open the sheet from a timeline entry**

In `Journal.tsx`, hold the entry being edited and pass it through:

```tsx
const [editing, setEditing] = useState<Entry | null>(null);
```

```tsx
<EntryCard key={e.id} entry={e} onOpen={setEditing} />
```

```tsx
<EntrySheet
  open={composing || editing !== null}
  onClose={() => {
    setComposing(false);
    setEditing(null);
  }}
  defaultFee={settings?.defaultFee ?? 4}
  editing={editing}
/>
```

- [ ] **Step 4: Verify and commit**

Run: `npm run dev`. Tap a seeded entry, correct its quantity, save, and watch the
dashboard change. Then delete a test entry.

```bash
git add -A && git commit -m "feat: edit and delete entries from the timeline"
```

### ✋ TEST CHECKPOINT 3 — fix a real mistake

Open the seeded entry for any position whose average cost you want to correct,
edit it, and confirm the dashboard updates. **This replaces reset-and-re-seed as
the way to fix your portfolio** — verify it genuinely does before we retire that
button.

---

## Task 12: Position detail

**Files:**
- Modify: `backend/src/portfolio/portfolio.controller.ts`
- Modify: `backend/src/portfolio/portfolio.service.ts`
- Create: `frontend/src/routes/Position.tsx`
- Modify: `frontend/src/routes/Dashboard.tsx`, `frontend/src/main.tsx`

- [ ] **Step 1: Add a per-symbol endpoint**

Add to `PortfolioService`:

```ts
  /** One position plus every journal entry that ever touched the ticker. */
  async getPosition(symbolInput: string) {
    const symbol = symbolInput.trim().toUpperCase();
    const portfolio = await this.getPortfolio();
    const position = portfolio.positions.find((p) => p.symbol === symbol);
    const entries = await this.journal.list({ symbol });
    if (!position && entries.length === 0) {
      throw new NotFoundException(`No history for "${symbol}"`);
    }
    return { symbol, position: position ?? null, entries };
  }
```

Add `NotFoundException` to the imports.

Add to `PortfolioController`:

```ts
  @Get('position/:symbol')
  position(@Param('symbol') symbol: string) {
    return this.portfolio.getPosition(symbol);
  }
```

with `Param` added to the `@nestjs/common` import.

**Note:** the route is `position/:symbol`, not `:symbol`, so it cannot shadow
`/portfolio/status`.

- [ ] **Step 2: Write the screen**

Create `frontend/src/routes/Position.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { Percent } from '../components/Percent';
import { formatQuantity } from '../components/format';
import { EntryCard, type Entry } from '../components/EntryCard';

interface PositionDetail {
  symbol: string;
  position: {
    quantity: number;
    avgCost: number;
    marketValue: number | null;
    unrealizedPnl: number | null;
    unrealizedPct: number | null;
    realizedPnl: number;
    feesPaid: number;
  } | null;
  entries: Entry[];
}

export function Position() {
  const { symbol = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['position', symbol],
    queryFn: () => api<PositionDetail>(`/portfolio/position/${symbol}`),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (error)
    return <p className="text-sm text-down">{(error as Error).message}</p>;
  if (!data) return null;

  const p = data.position;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold">{data.symbol}</h1>
        {p ? (
          <>
            <div className="mt-1 text-3xl font-semibold">
              <Money value={p.marketValue} />
            </div>
            <div className="mt-1 text-sm">
              <Percent value={p.unrealizedPct} />{' '}
              <span className="text-muted">
                (<Money value={p.unrealizedPnl} signed />) unrealized
              </span>
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">Position closed.</p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 text-sm">
        {p && (
          <>
            <Stat label="Quantity" value={formatQuantity(p.quantity)} />
            <Stat label="Avg cost" value={<Money value={p.avgCost} />} />
          </>
        )}
        <Stat
          label="Realized P&L"
          value={<Money value={p?.realizedPnl ?? 0} colored signed />}
        />
        <Stat label="Fees paid" value={<Money value={p?.feesPaid ?? 0} />} />
      </section>

      <section>
        <h2 className="mb-1 text-[11px] uppercase tracking-wide text-muted">
          History
        </h2>
        <ul>
          {data.entries.map((e) => (
            <EntryCard key={e.id} entry={e} onOpen={() => {}} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: Link holdings to it**

In `Dashboard.tsx`, wrap the `PositionRow` contents in a `Link` to
`/positions/${p.symbol}`, and register the route:

```tsx
<Route path="positions/:symbol" element={<Position />} />
```

- [ ] **Step 4: Verify and commit**

Run: `npm run dev`. Tap a holding on the dashboard.
Expected: its detail page shows the stats and every entry touching that ticker.

```bash
git add -A && git commit -m "feat: position detail page with per-ticker history"
```

### ✋ TEST CHECKPOINT 4 — the payoff

Tap into a position you have traded more than once. **This is the screen that
makes the journal worth keeping** — the whole story of one ticker in order. Judge
whether it tells you something the dashboard cannot.

---

## Task 13: Retire reset-and-re-seed as the correction tool

**Files:**
- Modify: `frontend/src/routes/Dashboard.tsx`

- [ ] **Step 1: Reword the reset control**

Now that entries are editable, reset is a last resort rather than the way to fix a
typo. Change the confirmation copy in `ResetPortfolio` to point at the better
path:

```tsx
      <p className="text-xs text-text">
        This deletes {positionCount}{' '}
        {positionCount === 1 ? 'position' : 'positions'}, your cash balance and
        every journal entry, then takes you back to seeding. It cannot be undone.
      </p>
      <p className="text-xs text-muted">
        To fix a single mistake, edit that entry in the journal instead.
      </p>
```

- [ ] **Step 2: Verify and commit**

```bash
git add -A && git commit -m "feat: point corrections at entry editing rather than reset"
```

---

---

## Task 14: Derive round-trip trades

The second-highest-risk pure module in the repo, after `derive.ts`. Win rate and
expectancy are the numbers most likely to be quietly wrong and most likely to be
believed.

**Files:**
- Create: `backend/src/portfolio/derive-trades.ts`
- Create: `backend/src/portfolio/derive-trades.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/portfolio/derive-trades.spec.ts`:

```ts
import {
  deriveTrades,
  summariseTrades,
  type TradeTxn,
} from './derive-trades.js';

function txn(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number,
  day: number,
  extra: { fee?: number; stop?: number | null } = {},
): TradeTxn {
  return {
    symbol,
    side,
    quantity,
    price,
    fee: extra.fee ?? 0,
    executedAt: new Date(2026, 0, day),
    // A single fixed stop covering the whole fill — the common case.
    stopLevels:
      extra.stop == null
        ? []
        : [
            {
              kind: 'FIXED',
              price: extra.stop,
              trailPercent: null,
              quantity,
            },
          ],
  };
}

describe('deriveTrades', () => {
  it('returns nothing for an empty log', () => {
    expect(deriveTrades([])).toEqual([]);
  });

  it('treats an open position as an open trade with no result', () => {
    const [t] = deriveTrades([txn('NVDA', 'BUY', 10, 100, 1)]);
    expect(t.isOpen).toBe(true);
    expect(t.exitedAt).toBeNull();
    expect(t.realizedPnl).toBeNull();
  });

  it('closes a trade when the position returns to flat', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.isOpen).toBe(false);
    expect(t.symbol).toBe('NVDA');
    expect(t.direction).toBe('LONG');
    expect(t.quantity).toBe(10);
    expect(t.avgEntry).toBe(100);
    expect(t.avgExit).toBe(130);
    expect(t.realizedPnl).toBe(300);
    expect(t.isWin).toBe(true);
    expect(t.holdingDays).toBe(4);
  });

  it('nets fees out of the result', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1, { fee: 4 }),
      txn('NVDA', 'SELL', 10, 130, 5, { fee: 4 }),
    ]);
    expect(t.realizedPnl).toBe(300 - 8);
    expect(t.feesPaid).toBe(8);
  });

  it('averages a scaled-in entry and a scaled-out exit', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'BUY', 10, 120, 2),
      txn('NVDA', 'SELL', 10, 150, 5),
      txn('NVDA', 'SELL', 10, 130, 6),
    ]);
    expect(t.quantity).toBe(20);
    expect(t.avgEntry).toBe(110);
    expect(t.avgExit).toBe(140);
    expect(t.realizedPnl).toBe(600);
  });

  it('splits a re-entry into a separate trade', () => {
    // Flat between them, so these are two trades, not one.
    const trades = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
      txn('NVDA', 'BUY', 10, 140, 10),
      txn('NVDA', 'SELL', 10, 120, 15),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0].realizedPnl).toBe(300);
    expect(trades[1].realizedPnl).toBe(-200);
    expect(trades[1].isWin).toBe(false);
  });

  it('handles a short trade', () => {
    const [t] = deriveTrades([
      txn('TSLA', 'SELL', 10, 300, 1),
      txn('TSLA', 'BUY', 10, 250, 5),
    ]);
    expect(t.direction).toBe('SHORT');
    expect(t.realizedPnl).toBe(500);
    expect(t.isWin).toBe(true);
  });

  it('loses on a short that goes against you', () => {
    const [t] = deriveTrades([
      txn('TSLA', 'SELL', 10, 300, 1),
      txn('TSLA', 'BUY', 10, 340, 5),
    ]);
    expect(t.realizedPnl).toBe(-400);
    expect(t.isWin).toBe(false);
  });

  it('keeps trades in different symbols separate', () => {
    const trades = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('AAPL', 'BUY', 5, 200, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(trades).toHaveLength(2);
    expect(trades.filter((t) => t.isOpen)).toHaveLength(1);
  });

  it('computes risk and R from the stop on the opening fill', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1, { stop: 90 }),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.riskAmount).toBe(100); // (100 - 90) * 10
    expect(t.rMultiple).toBe(3); // +300 on 100 risked
  });

  it('computes R for a short from a stop above entry', () => {
    const [t] = deriveTrades([
      txn('TSLA', 'SELL', 10, 300, 1, { stop: 320 }),
      txn('TSLA', 'BUY', 10, 250, 5),
    ]);
    expect(t.riskAmount).toBe(200);
    expect(t.rMultiple).toBe(2.5);
  });

  it('sums tiered stops into one risk figure', () => {
    const [t] = deriveTrades([
      {
        symbol: 'NVDA',
        side: 'BUY',
        quantity: 100,
        price: 217,
        fee: 0,
        executedAt: new Date(2026, 0, 1),
        stopLevels: [
          { kind: 'FIXED', price: 205, trailPercent: null, quantity: 50 },
          { kind: 'TRAILING', price: null, trailPercent: 8, quantity: 50 },
        ],
      },
      txn('NVDA', 'SELL', 100, 240, 5),
    ]);
    expect(t.riskAmount).toBe(600 + 868);
    expect(t.riskCoversFullPosition).toBe(true);
  });

  it('leaves R null when no stop was set', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.riskAmount).toBeNull();
    expect(t.rMultiple).toBeNull();
  });

  it('leaves R null when the stop equals the entry', () => {
    // Zero risk would divide by zero and produce Infinity.
    const [t] = deriveTrades([
      txn('NVDA', 'BUY', 10, 100, 1, { stop: 100 }),
      txn('NVDA', 'SELL', 10, 130, 5),
    ]);
    expect(t.rMultiple).toBeNull();
  });

  it('orders by execution time regardless of input order', () => {
    const [t] = deriveTrades([
      txn('NVDA', 'SELL', 10, 130, 5),
      txn('NVDA', 'BUY', 10, 100, 1),
    ]);
    expect(t.realizedPnl).toBe(300);
  });
});

describe('summariseTrades', () => {
  const closed = (
    pnl: number,
    r: number | null = null,
    riskAmount: number | null = null,
  ) => ({
    realizedPnl: pnl,
    isOpen: false,
    isWin: pnl > 0,
    rMultiple: r,
    riskAmount,
  });

  it('is empty with no closed trades', () => {
    const s = summariseTrades([]);
    expect(s.closedCount).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.avgRisk).toBeNull();
    expect(s.expectancyR).toBeNull();
  });

  it('ignores open trades in the outcome stats', () => {
    const s = summariseTrades([
      {
        realizedPnl: null,
        isOpen: true,
        isWin: null,
        rMultiple: null,
        riskAmount: null,
      },
    ]);
    expect(s.closedCount).toBe(0);
    expect(s.winRate).toBeNull();
  });

  it('computes win rate', () => {
    const s = summariseTrades([closed(100), closed(-50), closed(200), closed(-10)]);
    expect(s.closedCount).toBe(4);
    expect(s.winRate).toBe(0.5);
  });

  it('averages the dollar risk over trades that set a stop', () => {
    const s = summariseTrades([
      closed(300, 3, 100),
      closed(-200, -1, 200),
      closed(50), // no stop, excluded
    ]);
    expect(s.avgRisk).toBe(150);
    expect(s.riskTradeCount).toBe(2);
  });

  it('counts an open trade in average risk, since risk is known at entry', () => {
    const s = summariseTrades([
      closed(300, 3, 100),
      {
        realizedPnl: null,
        isOpen: true,
        isWin: null,
        rMultiple: null,
        riskAmount: 300,
      },
    ]);
    expect(s.avgRisk).toBe(200);
    expect(s.riskTradeCount).toBe(2);
    expect(s.closedCount).toBe(1);
  });

  it('leaves average risk null when no trade set a stop', () => {
    const s = summariseTrades([closed(300), closed(-100)]);
    expect(s.avgRisk).toBeNull();
    expect(s.riskTradeCount).toBe(0);
  });

  it('computes expectancy in R only over trades that have one', () => {
    const s = summariseTrades([
      closed(300, 3, 100),
      closed(-100, -1, 100),
      closed(200), // no stop, excluded from R
    ]);
    expect(s.expectancyR).toBe(1); // (3 + -1) / 2
    expect(s.rTradeCount).toBe(2);
    expect(s.closedCount).toBe(3);
  });

  it('reports expectancy in dollars over every closed trade', () => {
    const s = summariseTrades([closed(300), closed(-100)]);
    expect(s.expectancyDollars).toBe(100);
  });

  it('leaves expectancy in R null when no trade has a stop', () => {
    const s = summariseTrades([closed(300), closed(-100)]);
    expect(s.expectancyR).toBeNull();
    expect(s.rTradeCount).toBe(0);
  });

  it('treats a scratch trade as a loss, not a win', () => {
    // Break-even is not a win; counting it as one flatters the win rate.
    const s = summariseTrades([closed(0), closed(100)]);
    expect(s.winRate).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --prefix backend -- derive-trades`
Expected: FAIL — `Cannot find module './derive-trades.js'`.

- [ ] **Step 3: Implement**

Create `backend/src/portfolio/derive-trades.ts`:

```ts
import type { DerivedTxn } from './derive.js';

import { computeRisk, type StopLevelInput } from './risk.js';

/** A transaction carrying the stop plan recorded at entry. */
export type TradeTxn = DerivedTxn & {
  stopLevels?: StopLevelInput[];
  plannedTarget?: number | null;
};

export interface DerivedTrade {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  /** Total size opened, in shares. */
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  enteredAt: Date;
  exitedAt: Date | null;
  holdingDays: number | null;
  feesPaid: number;
  /** Null while the trade is still open. Net of fees. */
  realizedPnl: number | null;
  isWin: boolean | null;
  isOpen: boolean;
  /** Dollars at risk from the opening stop tiers. Null when none were set. */
  riskAmount: number | null;
  /** False when the stop tiers covered only part of the position. */
  riskCoversFullPosition: boolean;
  /** Result in units of risk. Null without a stop. */
  rMultiple: number | null;
}

const EPSILON = 1e-9;

/**
 * A trade is the span from flat to flat in one symbol. Derived, never stored,
 * for the same reason positions are: it cannot then disagree with the journal.
 *
 * Scaling in and out stays ONE trade — it is one idea, and splitting it would
 * inflate the trade count and distort win rate. A re-entry after going flat is
 * a new trade.
 */
export function deriveTrades(txns: TradeTxn[]): DerivedTrade[] {
  const bySymbol = new Map<string, TradeTxn[]>();
  for (const t of txns) {
    bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  }

  const trades: DerivedTrade[] = [];

  for (const [symbol, list] of bySymbol) {
    const ordered = [...list].sort(
      (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
    );

    let open: {
      direction: 'LONG' | 'SHORT';
      position: number;
      openQty: number;
      openNotional: number;
      closeQty: number;
      closeNotional: number;
      fees: number;
      enteredAt: Date;
      stopLevels: StopLevelInput[];
    } | null = null;

    for (const t of ordered) {
      const signed = t.side === 'BUY' ? t.quantity : -t.quantity;

      if (open === null) {
        open = {
          direction: signed > 0 ? 'LONG' : 'SHORT',
          position: signed,
          openQty: t.quantity,
          openNotional: t.quantity * t.price,
          closeQty: 0,
          closeNotional: 0,
          fees: t.fee,
          enteredAt: t.executedAt,
          // The plan belongs to the opening fill; later adds do not redefine it.
          stopLevels: t.stopLevels ?? [],
        };
        continue;
      }

      open.fees += t.fee;
      const adding = Math.sign(signed) === Math.sign(open.position);
      if (adding) {
        open.openQty += t.quantity;
        open.openNotional += t.quantity * t.price;
      } else {
        open.closeQty += t.quantity;
        open.closeNotional += t.quantity * t.price;
      }
      open.position += signed;

      if (Math.abs(open.position) < EPSILON) {
        trades.push(finish(symbol, open, t.executedAt));
        open = null;
      }
    }

    if (open !== null) {
      trades.push(finish(symbol, open, null));
    }
  }

  return trades.sort(
    (a, b) => b.enteredAt.getTime() - a.enteredAt.getTime(),
  );
}

function finish(
  symbol: string,
  open: {
    direction: 'LONG' | 'SHORT';
    openQty: number;
    openNotional: number;
    closeQty: number;
    closeNotional: number;
    fees: number;
    enteredAt: Date;
    stopLevels: StopLevelInput[];
  },
  exitedAt: Date | null,
): DerivedTrade {
  const avgEntry = round(open.openNotional / open.openQty);
  const avgExit =
    open.closeQty > EPSILON ? round(open.closeNotional / open.closeQty) : null;

  let realizedPnl: number | null = null;
  if (exitedAt !== null && avgExit !== null) {
    const gross =
      open.direction === 'LONG'
        ? (avgExit - avgEntry) * open.closeQty
        : (avgEntry - avgExit) * open.closeQty;
    realizedPnl = round(gross - open.fees);
  }

  // Risk comes from the stop tiers on the opening fill, against the average
  // entry. Tiers may cover only part of the position; computeRisk reports that
  // rather than pretending the whole position was protected.
  const risk = computeRisk({
    avgEntry,
    quantity: open.openQty,
    levels: open.stopLevels,
    direction: open.direction,
  });
  const riskAmount = risk.amount;

  return {
    symbol,
    direction: open.direction,
    quantity: round(open.openQty),
    avgEntry,
    avgExit,
    enteredAt: open.enteredAt,
    exitedAt,
    holdingDays:
      exitedAt === null
        ? null
        : Math.round(
            (exitedAt.getTime() - open.enteredAt.getTime()) / 86_400_000,
          ),
    feesPaid: round(open.fees),
    realizedPnl,
    // Break-even is not a win. Counting a scratch as a win flatters the rate.
    isWin: realizedPnl === null ? null : realizedPnl > 0,
    isOpen: exitedAt === null,
    riskAmount,
    riskCoversFullPosition: risk.fullyCovered,
    rMultiple:
      realizedPnl !== null && riskAmount !== null
        ? round(realizedPnl / riskAmount)
        : null,
  };
}

export interface TradeSummary {
  closedCount: number;
  openCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /**
   * Average dollars at risk per trade that set a stop. Open trades count:
   * risk is fixed at entry and does not depend on the outcome.
   */
  avgRisk: number | null;
  /** How many trades the risk figure is based on. */
  riskTradeCount: number;
  expectancyDollars: number | null;
  /** Averaged over trades that had a stop. Null when none did. */
  expectancyR: number | null;
  /** How many trades the R figure is based on, so the number stays honest. */
  rTradeCount: number;
}

type Summarisable = Pick<
  DerivedTrade,
  'realizedPnl' | 'isOpen' | 'isWin' | 'rMultiple' | 'riskAmount'
>;

export function summariseTrades(trades: Summarisable[]): TradeSummary {
  const closed = trades.filter((t) => !t.isOpen && t.realizedPnl !== null);
  const wins = closed.filter((t) => t.isWin === true);
  const losses = closed.filter((t) => t.isWin === false);
  const withR = closed.filter((t) => t.rMultiple !== null);
  // Risk is known at entry, so an open trade contributes to average risk.
  const withRisk = trades.filter((t) => t.riskAmount !== null);

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : round(xs.reduce((a, b) => a + b, 0) / xs.length);

  const avgWin = mean(wins.map((t) => t.realizedPnl as number));
  // Reported as a positive magnitude so "avg loss $920" reads naturally.
  const avgLoss = mean(losses.map((t) => Math.abs(t.realizedPnl as number)));

  return {
    closedCount: closed.length,
    openCount: trades.filter((t) => t.isOpen).length,
    winRate: closed.length === 0 ? null : round(wins.length / closed.length),
    avgWin,
    avgLoss,
    avgRisk: mean(withRisk.map((t) => t.riskAmount as number)),
    riskTradeCount: withRisk.length,
    expectancyDollars: mean(closed.map((t) => t.realizedPnl as number)),
    expectancyR: mean(withR.map((t) => t.rMultiple as number)),
    rTradeCount: withR.length,
  };
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --prefix backend -- derive-trades`
Expected: PASS — 25 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: derive round-trip trades with R multiples and summary stats"
```

---

## Task 15: Stats header

**Files:**
- Modify: `backend/src/portfolio/portfolio.service.ts`
- Modify: `backend/src/portfolio/portfolio.controller.ts`
- Modify: `backend/test/portfolio.e2e-spec.ts`
- Create: `frontend/src/components/StatsHeader.tsx`
- Modify: `frontend/src/routes/Journal.tsx`

- [ ] **Step 1: Write the failing e2e test**

Append inside the `describe` block of `backend/test/portfolio.e2e-spec.ts`:

```ts
  it('reports trade stats over closed round trips', async () => {
    const trade = (
      quantity: number,
      price: number,
      occurredAt: string,
      stop?: number,
    ) =>
      request(app.getHttpServer())
        .post('/journal')
        .send({
          kind: 'TRADE',
          body: 'x',
          occurredAt,
          trade: {
            symbol: 'NVDA',
            quantity,
            price,
            fee: 0,
            stopLevels:
              stop === undefined
                ? undefined
                : [
                    {
                      kind: 'FIXED',
                      price: stop,
                      quantity: Math.abs(quantity),
                    },
                  ],
          },
        })
        .expect(201);

    // Winner: +300 on 100 risked = +3R
    await trade(10, 100, '2026-01-01T14:30:00.000Z', 90);
    await trade(-10, 130, '2026-01-05T14:30:00.000Z');
    // Loser: -200, no stop, so excluded from R
    await trade(10, 140, '2026-01-10T14:30:00.000Z');
    await trade(-10, 120, '2026-01-15T14:30:00.000Z');

    const res = await request(app.getHttpServer())
      .get('/portfolio/stats')
      .expect(200);

    expect(res.body.closedCount).toBe(2);
    expect(res.body.winRate).toBe(0.5);
    expect(res.body.avgWin).toBe(300);
    expect(res.body.avgLoss).toBe(200);
    expect(res.body.avgRisk).toBe(100); // (100 - 90) * 10, the one stopped trade
    expect(res.body.riskTradeCount).toBe(1);
    expect(res.body.expectancyDollars).toBe(50);
    expect(res.body.expectancyR).toBe(3); // only the stopped trade
    expect(res.body.rTradeCount).toBe(1);
  });

  it('reports empty stats before any trade is closed', async () => {
    const res = await request(app.getHttpServer())
      .get('/portfolio/stats')
      .expect(200);
    expect(res.body.closedCount).toBe(0);
    expect(res.body.winRate).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e --prefix backend -- portfolio`
Expected: FAIL — 404 on `/portfolio/stats`.

- [ ] **Step 3: Add the stats method**

Add to `PortfolioService`, reusing the transaction loading it already does:

```ts
  async getStats() {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, instrumentRows] = await Promise.all([
      this.txns.find({ where: { userId: user.id } }),
      this.instruments.find(),
    ]);
    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));

    const levelRows = await this.stopLevels.find();
    const levelsByTxn = new Map<string, typeof levelRows>();
    for (const l of levelRows) {
      levelsByTxn.set(l.transactionId, [
        ...(levelsByTxn.get(l.transactionId) ?? []),
        l,
      ]);
    }

    const trades = deriveTrades(
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

    return { ...summariseTrades(trades), trades };
  }
```

with `import { deriveTrades, summariseTrades } from './derive-trades.js';`

`PortfolioService` needs the stop levels repository injected:

```ts
@InjectRepository(StopLevel)
private readonly stopLevels: Repository<StopLevel>,
```

and `StopLevel` added to `TypeOrmModule.forFeature([...])` in
`portfolio.module.ts`.

Add to `PortfolioController`:

```ts
  @Get('stats')
  stats() {
    return this.portfolio.getStats();
  }
```

**Note:** declare `@Get('stats')` alongside `@Get('status')`, both before
`@Get('position/:symbol')`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:e2e --prefix backend -- portfolio`
Expected: PASS.

- [ ] **Step 5: Write the header**

Create `frontend/src/components/StatsHeader.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Money } from './Money';
import { signClass } from './format';

interface Stats {
  closedCount: number;
  openCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgRisk: number | null;
  riskTradeCount: number;
  expectancyDollars: number | null;
  expectancyR: number | null;
  rTradeCount: number;
}

function Stat({
  label,
  value,
  sub,
  tone = '',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-surface-1 p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

export function StatsHeader() {
  const { data } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/portfolio/stats'),
  });

  if (!data) return null;

  if (data.closedCount === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface-1 p-3 text-xs text-muted">
        Stats appear once you close your first trade.
        {data.openCount > 0 && ` ${data.openCount} open.`}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Stat
          label="Win rate"
          value={`${Math.round((data.winRate ?? 0) * 100)}%`}
          sub={`${data.closedCount} closed`}
        />
        <Stat
          label="Avg risk"
          value={
            data.avgRisk === null
              ? '—'
              : `$${Math.round(data.avgRisk).toLocaleString('en-US')}`
          }
          sub={
            data.riskTradeCount > 0
              ? `${data.riskTradeCount} with a stop`
              : 'set stops to unlock'
          }
        />
        <Stat
          label="Expectancy"
          value={
            data.expectancyR !== null
              ? `${data.expectancyR > 0 ? '+' : ''}${data.expectancyR.toFixed(2)}R`
              : '—'
          }
          sub={
            // Never let a headline number hide how small its sample is.
            data.rTradeCount > 0
              ? `${data.rTradeCount} of ${data.closedCount} with a stop`
              : 'set stops to unlock'
          }
          tone={signClass(data.expectancyR)}
        />
      </div>
      {data.expectancyDollars !== null && (
        <p className="text-center text-[10px] text-muted">
          <Money value={data.expectancyDollars} signed /> average per closed
          trade
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Put it at the top of the journal**

In `frontend/src/routes/Journal.tsx`, render `<StatsHeader />` above the filter
row, and invalidate `['stats']` alongside `['journal']` and `['portfolio']` in
`EntrySheet`'s `onSuccess` and in `DeleteEntry`.

- [ ] **Step 7: Verify and commit**

Run: `npm run dev`, open `/journal`.

```bash
git add -A && git commit -m "feat: win rate, average risk and expectancy header"
```

### ✋ TEST CHECKPOINT 5 — your real numbers

Close a round trip (or edit a seeded entry into a closed one) and check the three
stats. **The number to scrutinise is expectancy** — it says "N of M with a stop"
precisely so a confident-looking R figure built on two trades cannot mislead you.

---

---

## Task 16: Stop editor in the composer

**Files:**
- Create: `frontend/src/lib/stopRisk.ts`
- Create: `frontend/src/lib/stopRisk.spec.ts`
- Create: `frontend/src/components/StopLevelEditor.tsx`
- Modify: `frontend/src/lib/entryDraft.ts`
- Modify: `frontend/src/components/EntrySheet.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/stopRisk.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { draftRisk, type StopRow } from './stopRisk';

const fixed = (price: string, quantity: string): StopRow => ({
  kind: 'FIXED',
  price,
  trailPercent: '',
  quantity,
});
const trail = (percent: string, quantity: string): StopRow => ({
  kind: 'TRAILING',
  price: '',
  trailPercent: percent,
  quantity,
});

describe('draftRisk', () => {
  it('is null with no rows', () => {
    expect(draftRisk('217', '100', [], 'BUY').amount).toBeNull();
  });

  it('computes a single fixed stop', () => {
    const r = draftRisk('217', '100', [fixed('205', '100')], 'BUY');
    expect(r.amount).toBe(1200);
    expect(r.covered).toBe(100);
    expect(r.fullyCovered).toBe(true);
  });

  it('sums a tiered plan mixing fixed and trailing', () => {
    const r = draftRisk(
      '217',
      '100',
      [fixed('205', '50'), trail('8', '50')],
      'BUY',
    );
    expect(r.amount).toBe(600 + 868);
  });

  it('reports partial coverage', () => {
    const r = draftRisk('217', '150', [fixed('205', '100')], 'BUY');
    expect(r.fullyCovered).toBe(false);
    expect(r.covered).toBe(100);
  });

  it('handles a short, where a stop sits above entry', () => {
    const r = draftRisk('300', '10', [fixed('320', '10')], 'SELL');
    expect(r.amount).toBe(200);
  });

  it('ignores a half-typed row rather than flashing a wrong number', () => {
    // Mid-typing, price is empty. Showing $21,700 for a moment would be worse
    // than showing nothing.
    const r = draftRisk('217', '100', [fixed('', '100')], 'BUY');
    expect(r.amount).toBeNull();
  });

  it('ignores a stop on the wrong side of the entry', () => {
    expect(draftRisk('217', '100', [fixed('230', '100')], 'BUY').amount).toBeNull();
  });

  it('is null when the entry price is not yet filled in', () => {
    expect(draftRisk('', '100', [fixed('205', '100')], 'BUY').amount).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

Create `frontend/src/lib/stopRisk.ts`:

```ts
export type StopKind = 'FIXED' | 'TRAILING';

/** Draft rows hold strings, because they mirror what is in the inputs. */
export interface StopRow {
  kind: StopKind;
  price: string;
  trailPercent: string;
  quantity: string;
}

export interface DraftRisk {
  amount: number | null;
  covered: number;
  fullyCovered: boolean;
}

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Mirrors the backend's computeRisk, over half-typed strings. Deliberately
 * returns null rather than a partial figure: a risk number that flickers
 * through wrong values while you type is worse than no number at all.
 */
export function draftRisk(
  entryPrice: string,
  positionQuantity: string,
  rows: StopRow[],
  side: 'BUY' | 'SELL',
): DraftRisk {
  const entry = num(entryPrice);
  const size = Math.abs(num(positionQuantity) ?? 0);
  if (entry === null || entry <= 0) {
    return { amount: null, covered: 0, fullyCovered: false };
  }

  let amount = 0;
  let covered = 0;

  for (const row of rows) {
    const qty = Math.abs(num(row.quantity) ?? 0);
    if (qty <= 0) continue;

    let perShare: number | null = null;
    if (row.kind === 'FIXED') {
      const price = num(row.price);
      if (price !== null && price > 0) {
        const distance = side === 'BUY' ? entry - price : price - entry;
        if (distance > 0) perShare = distance;
      }
    } else {
      const pct = num(row.trailPercent);
      if (pct !== null && pct > 0) perShare = entry * (pct / 100);
    }

    if (perShare === null) continue;
    amount += perShare * qty;
    covered += qty;
  }

  const cappedCover = Math.min(covered, size || covered);
  return {
    amount: covered > 0 ? Math.round(amount * 100) / 100 : null,
    covered: cappedCover,
    fullyCovered: covered > 0 && size > 0 && cappedCover >= size,
  };
}
```

- [ ] **Step 3: Run the tests**

Run: `npm run test --prefix frontend -- stopRisk`
Expected: PASS — 8 tests.

- [ ] **Step 4: Add stop rows to the draft**

In `frontend/src/lib/entryDraft.ts`, add to `EntryDraft`:

```ts
  stops: StopRow[];
  target: string;
```

with `import type { StopRow } from './stopRisk';`, and in `emptyDraft`:

```ts
    stops: [],
    target: '',
```

- [ ] **Step 5: Write the editor**

Create `frontend/src/components/StopLevelEditor.tsx`:

```tsx
import { draftRisk, type StopRow } from '../lib/stopRisk';
import { formatMoney, formatQuantity } from './format';

const inputClass =
  'w-full min-w-0 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-sm outline-none focus:border-accent';

export function StopLevelEditor({
  rows,
  onChange,
  entryPrice,
  quantity,
  side,
}: {
  rows: StopRow[];
  onChange: (rows: StopRow[]) => void;
  entryPrice: string;
  quantity: string;
  side: 'BUY' | 'SELL';
}) {
  const risk = draftRisk(entryPrice, quantity, rows, side);
  const size = Math.abs(parseFloat(quantity || '0'));

  const update = (i: number, patch: Partial<StopRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">Stop levels</span>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...rows,
              {
                kind: 'FIXED',
                price: '',
                trailPercent: '',
                // First tier defaults to the whole position; later ones do not
                // guess, since a scale-out is deliberate.
                quantity: rows.length === 0 && size > 0 ? String(size) : '',
              },
            ])
          }
          className="text-xs text-accent"
        >
          + add level
        </button>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
            {(['FIXED', 'TRAILING'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={row.kind === k}
                onClick={() => update(i, { kind: k })}
                className={`px-2 py-1.5 text-xs font-medium ${
                  row.kind === k
                    ? 'bg-surface-2 text-text'
                    : 'bg-surface-1 text-muted'
                }`}
              >
                {k === 'FIXED' ? 'Price' : 'Trail'}
              </button>
            ))}
          </div>

          {row.kind === 'FIXED' ? (
            <input
              type="number"
              inputMode="decimal"
              placeholder="stop"
              value={row.price}
              onChange={(e) => update(i, { price: e.target.value })}
              className={inputClass}
            />
          ) : (
            <input
              type="number"
              inputMode="decimal"
              placeholder="% below high"
              value={row.trailPercent}
              onChange={(e) => update(i, { trailPercent: e.target.value })}
              className={inputClass}
            />
          )}

          <input
            type="number"
            inputMode="decimal"
            placeholder="shares"
            value={row.quantity}
            onChange={(e) => update(i, { quantity: e.target.value })}
            className={inputClass}
          />

          <button
            type="button"
            aria-label={`Remove stop level ${i + 1}`}
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            className="shrink-0 px-1 text-lg leading-none text-muted"
          >
            ×
          </button>
        </div>
      ))}

      {rows.length > 0 && (
        <p className="text-[11px] text-muted">
          {risk.amount === null ? (
            'Risk appears once a level is complete.'
          ) : (
            <>
              Total risk{' '}
              <span className="text-text">{formatMoney(risk.amount)}</span>
              {size > 0 && (
                <>
                  {' · '}
                  <span className={risk.fullyCovered ? '' : 'text-down'}>
                    covers {formatQuantity(risk.covered)} of{' '}
                    {formatQuantity(size)} sh
                  </span>
                </>
              )}
            </>
          )}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire it into the composer**

In `EntrySheet.tsx`, inside the `draft.kind === 'TRADE'` block, below the
qty/price/fee row:

```tsx
<StopLevelEditor
  rows={draft.stops}
  onChange={(stops) => set({ stops })}
  entryPrice={draft.price}
  quantity={draft.quantity}
  side={draft.side}
/>
```

and include the levels in the mutation payload's `trade` object:

```tsx
  plannedTarget: draft.target ? Math.abs(parseFloat(draft.target)) : undefined,
  stopLevels: draft.stops
    .filter(
      (r) =>
        parseFloat(r.quantity || '0') > 0 &&
        (r.kind === 'FIXED' ? r.price !== '' : r.trailPercent !== ''),
    )
    .map((r) => ({
      kind: r.kind,
      price: r.kind === 'FIXED' ? parseFloat(r.price) : undefined,
      trailPercent:
        r.kind === 'TRAILING' ? parseFloat(r.trailPercent) : undefined,
      quantity: Math.abs(parseFloat(r.quantity)),
    })),
```

When editing an existing entry, seed `stops` from `editing.trade.stopLevels`.

- [ ] **Step 7: Verify and commit**

Run: `npm run dev`, open the composer, add two levels, watch the risk figure.

```bash
git add -A && git commit -m "feat: tiered stop editor with live risk in the composer"
```

---

## Task 17: Set stops on existing positions

The catch-up flow for positions seeded before stops existed.

**Files:**
- Create: `frontend/src/routes/SetStops.tsx`
- Modify: `frontend/src/main.tsx`, `frontend/src/routes/Dashboard.tsx`

- [ ] **Step 1: Write the screen**

Create `frontend/src/routes/SetStops.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { formatQuantity } from '../components/format';

interface Trade {
  symbol: string;
  quantity: number;
  avgEntry: number;
  isOpen: boolean;
  riskAmount: number | null;
}

/**
 * Positions seeded in Phase 1 have no stop. Editing twenty journal entries one
 * at a time to fix that is a chore nobody completes, so this lists every open
 * position that still needs one and links straight into it.
 */
export function SetStops() {
  const { data } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<{ trades: Trade[] }>('/portfolio/stats'),
  });

  const open = (data?.trades ?? []).filter((t) => t.isOpen);
  const missing = open.filter((t) => t.riskAmount === null);
  const covered = open.filter((t) => t.riskAmount !== null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Stops on open positions</h1>
        <p className="mt-1 text-sm text-muted">
          {missing.length === 0
            ? 'Every open position has a stop.'
            : `${missing.length} of ${open.length} positions have no stop yet.`}
        </p>
      </div>

      {missing.length > 0 && (
        <section>
          <h2 className="mb-1 text-[11px] uppercase tracking-wide text-muted">
            No stop set
          </h2>
          <ul>
            {missing.map((t) => (
              <Row key={t.symbol} trade={t} />
            ))}
          </ul>
        </section>
      )}

      {covered.length > 0 && (
        <section>
          <h2 className="mb-1 text-[11px] uppercase tracking-wide text-muted">
            Stop set
          </h2>
          <ul>
            {covered.map((t) => (
              <Row key={t.symbol} trade={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ trade }: { trade: Trade }) {
  return (
    <li className="border-b border-border last:border-0">
      <Link
        to={`/positions/${trade.symbol}`}
        className="flex items-center justify-between py-3"
      >
        <div>
          <div className="text-[15px] font-semibold">{trade.symbol}</div>
          <div className="text-[11px] text-muted">
            {formatQuantity(trade.quantity)} @{' '}
            <Money value={trade.avgEntry} />
          </div>
        </div>
        <div className="text-right text-sm">
          {trade.riskAmount === null ? (
            <span className="text-muted">set stop →</span>
          ) : (
            <>
              <div className="text-muted text-[11px]">risk</div>
              <Money value={trade.riskAmount} />
            </>
          )}
        </div>
      </Link>
    </li>
  );
}
```

- [ ] **Step 2: Link it from the dashboard**

Register `<Route path="stops" element={<SetStops />} />`, and on the dashboard
show a prompt while any open position lacks a stop:

```tsx
{stats && stats.openCount > 0 && stats.riskTradeCount < stats.openCount && (
  <Link
    to="/stops"
    className="block rounded-xl border border-border bg-surface-1 p-3 text-xs text-muted"
  >
    {stats.openCount - stats.riskTradeCount} open positions have no stop —
    set them to unlock risk and expectancy →
  </Link>
)}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run dev`, open `/stops`.
Expected: every open position listed, those without a stop first.

```bash
git add -A && git commit -m "feat: catch-up screen for stops on existing positions"
```

### ✋ TEST CHECKPOINT 6 — set your real stops

Work through `/stops` and set stops on the positions where you have one. Some
will be fixed levels, some percentage trails, some tiered. **Check the risk
figures against what you actually consider yourself risking** — if they disagree,
the model is wrong and I need to know before the stats are built on it.


---

## Phase 2 done

Run everything before declaring it finished:

```bash
npm test && npm run build
```

Then update `CLAUDE.md`: mark Phase 2 complete, add the journal module to the
layout, and record any deviations in this plan's own deviations table.

## Deferred

- **Trade replay** — Phase 3. Needs the daily price history that Phase 3 builds
  for the benchmark chart; building the backfill twice would be waste. Phase 2
  captures everything replay depends on (the trade groupings, entry and exit
  dates and prices), so nothing is lost by waiting.
- **R:R in any form** — dropped from the header in favour of average dollar
  risk. Average win and average loss are still computed and returned by the API,
  so adding a payoff ratio later is a pure display change. The planned target is
  captured from Phase 2 onward for the same reason.
- **Attaching a chart to a trade entry** (as in reference #1) — same dependency
  as replay.
- **Filtering the timeline by tag in the UI.** The API supports `tagId` already;
  the control is deliberately left out until there are enough tags to need it.
- **Bulk entry / CSV import.** Not until there is evidence that manual entry is
  too slow.
- **Editing an entry's tags from the timeline without opening the sheet.**
