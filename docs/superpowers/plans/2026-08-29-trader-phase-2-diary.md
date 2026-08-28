# Trader Phase 2 — "The Diary" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the diary the thing that maintains the portfolio — log a trade and the position moves, write a note and nothing moves, record a deposit and cash moves. All on one timeline, all editable.

**Architecture:** A new `journal` module owns the only write path into `transactions` and `cash_flows`, exactly as seeding already does. Positions stay derived, so editing or deleting an entry recomputes the portfolio for free. The frontend gains a timeline, a bottom-sheet composer, and a position detail page.

**Tech Stack:** Unchanged — NestJS 12 + TypeORM + PostgreSQL, React 19 + Vite + Tailwind v4 + TanStack Query. See `CLAUDE.md`.

---

## Scope

**Phase 2 delivers:**

- Trade entries that move the portfolio (buy / sell, with fee)
- Note entries that move nothing
- Cash entries (deposit / withdraw) that move cash
- Setup and mistake tags, created on the fly
- One chronological timeline, filterable
- Full edit and delete of any entry, with the portfolio recomputing
- Position detail: every entry that ever touched a ticker
- Settings: default fee

**Phase 2 does NOT deliver:** price history backfill, the benchmark chart, or any AI. Those are Phase 3 and later.

## Decisions carried in from review

| Decision | Rationale |
|---|---|
| **Notes optional but prompted** | A trade saves in two taps when busy, but an entry with no thesis is visibly marked in the timeline and can be annotated later. Requiring a note risks the worse failure: skipping logging entirely and letting the portfolio drift. |
| **Full edit and delete** | Positions are derived, so recomputation is free. This becomes the real "edit a position" mechanism and retires reset-and-re-seed as the only correction tool. |
| **Seeded entries are ordinary entries** | They already exist as `TRADE`/`CASH` entries from Phase 1. They appear in the timeline and are editable like anything else — which is what finally lets a seeding typo be fixed properly. |

## Test checkpoints

| After Task | You can test |
|---|---|
| 4 | The timeline shows your seeded entries, filterable |
| 8 | Log a real trade and watch the dashboard move |
| 11 | Notes, cash entries, and tags |
| 13 | Edit and delete — fix a seeding typo properly |
| 15 | Position detail: the story of one ticker |

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

## Task 1: Tag entities

**Files:**
- Create: `backend/src/journal/tag.entity.ts`
- Create: `backend/src/journal/entry-tag.entity.ts`

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

- [ ] **Step 3: Verify it compiles**

Run: `npm run build --prefix backend`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: tag entities for setups and mistakes"
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
export interface CreateEntryInput {
  kind: 'TRADE' | 'NOTE' | 'CASH';
  body: string;
  occurredAt: string;
  trade?: { symbol: string; quantity: number; price: number; fee: number };
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
        await manager.save(
          manager.create(Transaction, {
            userId: user.id,
            entryId: entry.id,
            instrumentId,
            side,
            quantity,
            price: Math.abs(input.trade.price),
            fee: Math.abs(input.trade.fee ?? 0),
            executedAt: new Date(input.occurredAt),
          }),
        );
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
      await manager.delete(Transaction, { entryId: id });
      await manager.delete(CashFlow, { entryId: id });

      if (input.kind === 'TRADE' && input.trade && instrumentId) {
        await manager.save(
          manager.create(Transaction, {
            userId: user.id,
            entryId: id,
            instrumentId,
            side,
            quantity,
            price: Math.abs(input.trade.price),
            fee: Math.abs(input.trade.fee ?? 0),
            executedAt: new Date(input.occurredAt),
          }),
        );
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

## Phase 2 done

Run everything before declaring it finished:

```bash
npm test && npm run build
```

Then update `CLAUDE.md`: mark Phase 2 complete, add the journal module to the
layout, and record any deviations in this plan's own deviations table.

## Deferred

- **Attaching a chart to a trade entry** (as in reference #1) — needs price
  history, which arrives in Phase 3.
- **Filtering the timeline by tag in the UI.** The API supports `tagId` already;
  the control is deliberately left out until there are enough tags to need it.
- **Bulk entry / CSV import.** Not until there is evidence that manual entry is
  too slow.
- **Editing an entry's tags from the timeline without opening the sheet.**
