# Stop Executions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which stop tier a fill executed as a confirmed fact rather than inferring it from price proximity, and expose the money each stop tier puts at risk.

**Architecture:** A new `stop_executions` table links a reducing fill to the tier it executed (one row per link, so partial fills and fills spanning two tiers are both expressible). `transactions.exitKind` classifies an exit as `STOP` or `DISCRETIONARY`, with `null` meaning unclassified. The existing price matcher survives only to supply the entry sheet's default; `computeEffectiveStops` prefers recorded executions wherever they exist. `stop_levels` stays append-only throughout — stop CRUD writes new revisions, never edits or deletes rows.

**Tech Stack:** NestJS 12, TypeORM (migrations — `synchronize` is off), PostgreSQL 18, React 19, Vite 8, Tailwind v4, TanStack Query, Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-09-03-stop-executions-design.md`

## Global Constraints

- **Positions are derived, never stored.** Nothing in this plan writes a position.
- **Journal entries are the only write path into transactions and cash flows.** `exitKind` and `stop_executions` are written inside the same DB transaction as the journal entry that creates the fill.
- **`stop_levels` rows are immutable.** Every stop change appends a revision via `JournalService.writeStopRevision`. Never `UPDATE` or `DELETE` a `stop_levels` row from application code.
- **Never backfill `stop_levels.createdAt`.** A NULL on revision 0 is how `selectEntryStops` refuses to report a risk it cannot trust. See the spec's "Schema" section.
- **Schema changes go through migrations** in `backend/src/database/migrations/`, named `<epoch-ms>-<Name>.ts`. Run `npm run migration:run` after adding one.
- **Do not run `nest build` while `npm run dev` is running.** Typecheck with `npx tsc --noEmit -p tsconfig.json` from `backend/`.
- **e2e runs against `trader_test`**, never `trader`. The only exception is Task 9, which is explicitly a one-off against the real database and carries its own safeguards.
- **At risk = `(current − stop) × shares`**, direction-adjusted. Unchanged by this plan except that it is now also exposed per tier.
- **The iOS decimal keypad has no minus key.** Any numeric input added here uses an explicit toggle, never a typed `-`.

---

## Slice 1 — The money each stop tier risks

### Task 1: `amountAtRisk` on each stop tier row

**Files:**
- Modify: `backend/src/portfolio/stop-distance.ts`
- Test: `backend/src/portfolio/stop-distance.spec.ts`

**Interfaces:**
- Consumes: `StopDistanceRow` (existing) with its signed `distance` and `passed` fields.
- Produces: `StopDistanceRow.amountAtRisk: number` — dollars given back if this tier fires, signed. Negative exactly when `passed` is true.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/portfolio/stop-distance.spec.ts`:

```ts
describe('amountAtRisk', () => {
  it('is (current - stop) x quantity for a long', () => {
    const [row] = computeStopDistances([
      {
        symbol: 'SMCI',
        direction: 'LONG',
        avgEntry: 32,
        currentPrice: 36.7,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: null,
        levels: [{ kind: 'FIXED', price: 30.39, trailPercent: null, quantity: 550 }],
      },
    ]);
    expect(row.amountAtRisk).toBeCloseTo((36.7 - 30.39) * 550, 6);
  });

  it('is (stop - current) x quantity for a short', () => {
    const [row] = computeStopDistances([
      {
        symbol: 'MRNA',
        direction: 'SHORT',
        avgEntry: 146.43,
        currentPrice: 100,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: null,
        levels: [{ kind: 'FIXED', price: 110, trailPercent: null, quantity: 50 }],
      },
    ]);
    expect(row.amountAtRisk).toBeCloseTo((110 - 100) * 50, 6);
  });

  it('goes negative when the stop has already been passed', () => {
    const [row] = computeStopDistances([
      {
        symbol: 'BE',
        direction: 'LONG',
        avgEntry: 206,
        currentPrice: 200,
        session: 'REGULAR',
        extended: false,
        stale: false,
        highWaterPrice: null,
        levels: [{ kind: 'FIXED', price: 207.08, trailPercent: null, quantity: 45 }],
      },
    ]);
    expect(row.passed).toBe(true);
    expect(row.amountAtRisk).toBeLessThan(0);
    expect(row.amountAtRisk).toBeCloseTo((200 - 207.08) * 45, 6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/portfolio/stop-distance.spec.ts`
Expected: FAIL — `amountAtRisk` is `undefined`.

- [ ] **Step 3: Add the field**

In `backend/src/portfolio/stop-distance.ts`, add to `StopDistanceRow` after `distance`:

```ts
  /**
   * Dollars given back if this tier fires: `distance x currentPrice x
   * quantity`, which resolves to (current - stop) for a long and
   * (stop - current) for a short because `distance` is already signed by
   * direction. Negative exactly when `passed` — the level has been crossed
   * and firing it now would realise more than the stop promised. The
   * headline sum in portfolio.service.ts floors each position at zero for
   * that reason; this row-level figure stays honest about the sign.
   */
  amountAtRisk: number;
```

And in the row the loop pushes, alongside `distance` and `passed`:

```ts
      amountAtRisk: distance * p.currentPrice * level.quantity,
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && npx vitest run src/portfolio/stop-distance.spec.ts`
Expected: PASS, and every pre-existing test in the file still passes.

- [ ] **Step 5: Typecheck and commit**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json
git add backend/src/portfolio/stop-distance.ts backend/src/portfolio/stop-distance.spec.ts
git commit -m "feat: dollars at risk per stop tier"
```

### Task 2: Show the dollar column on the Stops page

**Files:**
- Modify: `frontend/src/routes/Stops.tsx` (the `StopTierRow` interface near line 13, and `StopTierRowView` near line 105)

**Interfaces:**
- Consumes: `amountAtRisk` from Task 1, served through `GET /portfolio`'s `stopTiers`.

- [ ] **Step 1: Extend the row type**

In `frontend/src/routes/Stops.tsx`, add to `interface StopTierRow`:

```ts
  amountAtRisk: number;
```

- [ ] **Step 2: Render it under the distance**

`StopTierRowView` currently renders the distance percentage and the word "room" in its right-hand column. Put the money directly beneath, so the row reads "how far" then "how much":

```tsx
              <div className="mt-0.5 text-[11px] leading-tight text-muted">
                <Money value={row.amountAtRisk} />
              </div>
```

Place it inside the same right-hand `div` that holds the percentage and the `room` / `passed` label, after that label.

- [ ] **Step 3: Verify on the phone**

Run `npm run dev` from the repo root if it is not already running, open the Stops tab on the phone, and check:
- every tier row shows a dollar figure beneath its percentage
- the figures sum to roughly the headline (they will not match exactly — the headline floors passed stops at zero)
- nothing wraps or overflows at 11px on a real screen

STOP here and let the owner look before continuing.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/Stops.tsx
git commit -m "feat: show dollars at risk per tier on the Stops page"
```

---

## Slice 2 — Schema

### Task 3: `stop_executions` table and `transactions.exitKind`

**Files:**
- Create: `backend/src/database/migrations/1788652800000-AddStopExecutions.ts`
- Create: `backend/src/transactions/stop-execution.entity.ts`
- Modify: `backend/src/transactions/transaction.entity.ts`
- Modify: `backend/src/app.module.ts` (register the new entity if entities are listed explicitly)

**Interfaces:**
- Produces: `StopExecution` entity with `id`, `stopLevelId`, `transactionId`, `quantity`, `confirmedAt`; and `Transaction.exitKind: 'STOP' | 'DISCRETIONARY' | null`.

- [ ] **Step 1: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A stop tier is recorded at entry and never touched again, so when a stop
 * actually fires nothing records that it did — `computeEffectiveStops` has
 * had to infer it by matching a fill's price to the nearest tier. That
 * inference was wrong on at least one real trade (MSTR, whose only tier was
 * a trailing stop the exit never reached), and it cannot be right in
 * principle: "my stop fired" and "I sold near where my stop happened to be"
 * look identical to a price matcher and mean opposite things.
 *
 * The link is its own table rather than a column on either side because one
 * fill can execute two tiers (a scaled exit) and one tier can be executed
 * partially — neither is expressible as a foreign key on a row.
 *
 * `exitKind` is separate and deliberately nullable: NULL means "not yet
 * classified", which is what keeps the exit statistics honest about their
 * own coverage instead of counting unreviewed exits as discretionary.
 */
export class AddStopExecutions1788652800000 implements MigrationInterface {
  name = 'AddStopExecutions1788652800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.stop_executions (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "stopLevelId" uuid NOT NULL REFERENCES public.stop_levels(id) ON DELETE CASCADE,
        "transactionId" uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
        quantity numeric(20,8) NOT NULL,
        "confirmedAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stop_executions_transactionId"
        ON public.stop_executions ("transactionId");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stop_executions_stopLevelId"
        ON public.stop_executions ("stopLevelId");
    `);
    await queryRunner.query(`
      ALTER TABLE public.transactions
        ADD COLUMN IF NOT EXISTS "exitKind" varchar;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE public.transactions DROP COLUMN IF EXISTS "exitKind";`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.stop_executions;`);
  }
}
```

- [ ] **Step 2: Create the entity**

`backend/src/transactions/stop-execution.entity.ts`:

```ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer.js';

/**
 * A confirmed link between a reducing fill and the stop tier it executed.
 * Always the owner's own decision — the price matcher only ever supplies the
 * default the entry sheet offers, never the stored record.
 *
 * One row per (fill, tier) pair: a fill that spans two tiers writes two
 * rows, and a partially executed tier writes a row whose `quantity` is less
 * than the tier's own. This is why the link is a table.
 */
@Entity('stop_executions')
export class StopExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  stopLevelId: string;

  @Index()
  @Column('uuid')
  transactionId: string;

  /** Shares of this tier that this fill executed. Always positive. */
  @Column('numeric', { precision: 20, scale: 8, transformer: numericTransformer })
  quantity: number;

  @Column('timestamp', { default: () => 'now()' })
  confirmedAt: Date;
}
```

- [ ] **Step 3: Add `exitKind` to the Transaction entity**

In `backend/src/transactions/transaction.entity.ts`, after `side`:

```ts
  /**
   * How this exit came about, on a reducing fill only. NULL means it has not
   * been classified yet — which the exit statistics report rather than
   * quietly treating as discretionary. Opening fills are always NULL.
   */
  @Column({ type: 'varchar', nullable: true })
  exitKind: 'STOP' | 'DISCRETIONARY' | null;
```

- [ ] **Step 4: Run the migration against the test database and the real one**

```bash
cd backend && npm run migration:run
```

Then confirm the shape:

```bash
psql -d trader -c '\d stop_executions'
psql -d trader -c "SELECT column_name FROM information_schema.columns WHERE table_name='transactions' AND column_name='exitKind';"
```

Expected: the table exists with both indexes, and `exitKind` is present.

- [ ] **Step 5: Run the full suite and commit**

```bash
cd backend && npx vitest run && npm run test:e2e
git add backend/src/database/migrations backend/src/transactions
git commit -m "feat: stop_executions table and transactions.exitKind"
```

---

## Slice 3 — Stop CRUD

### Task 4: Stop plan editor on the trade detail

**Files:**
- Create: `frontend/src/components/StopPlanEditor.tsx`
- Modify: `frontend/src/routes/TradeDetail.tsx`
- Modify: `frontend/src/routes/Stops.tsx` (link each tier row through to its trade — `tradeIdBySymbol` is already built there)

**Interfaces:**
- Consumes: `PATCH /portfolio/trades/:id/stops` with body `{ levels: [{ kind, price?, trailPercent?, quantity }] }`, which already exists in `portfolio.controller.ts` and appends a revision.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Build the editor component**

`StopPlanEditor.tsx` renders the trade's current tiers as editable rows — kind (FIXED / TRAILING), price or trail percent, quantity — with an "Add tier" button and a remove control per row. It holds the whole list in local state and submits the **entire list** on save, because `PATCH` replaces the plan with a new revision rather than patching one tier.

Reuse the numeric input the entry sheet already uses for stop prices rather than writing a new one; the iOS keypad has no minus key and that input already handles it.

Removing a tier means submitting a list without it. Never call a delete endpoint — there isn't one, deliberately.

- [ ] **Step 2: Wire it into the trade detail**

Add the editor to `TradeDetail.tsx` behind a "Stops" section. On successful save, invalidate the TanStack Query keys for both the trade and `/portfolio`, so the Stops page and the dashboard reflect the new plan without a reload.

- [ ] **Step 3: Make Stops page rows reach it**

In `Stops.tsx`, `StopTierRowView` already receives `tradeId`. Wrap the row in a `Link` to `/trades/{tradeId}` the same way `UnstoppedPositions` does, so a tier that looks wrong is one tap from being fixed.

- [ ] **Step 4: Verify on the phone**

- edit a stop price, save, and confirm the Stops page shows the new level
- add a second tier and confirm two rows appear for that symbol
- remove a tier and confirm it disappears
- confirm `SELECT "revisionSeq", price, quantity FROM stop_levels WHERE "transactionId" = '<id>' ORDER BY "revisionSeq"` shows a NEW revision each time and that no earlier row changed

STOP and let the owner exercise it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StopPlanEditor.tsx frontend/src/routes/TradeDetail.tsx frontend/src/routes/Stops.tsx
git commit -m "feat: edit a stop plan from the trade detail"
```

---

## Slice 4 — Recording an execution

### Task 5: The tier matcher, extracted and named

**Files:**
- Modify: `backend/src/portfolio/derive-trades.ts`
- Test: `backend/src/portfolio/derive-trades.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function suggestTierForFill(
    tiers: Array<StopLevelInput & { id: string }>,
    fillPrice: number,
  ): string | null;
  ```
  The id of the tier whose price is closest to the fill, or `null` when no tier has a resolvable price (all TRAILING). This is the entry sheet's DEFAULT only — never a stored record.

- [ ] **Step 1: Write the failing test**

```ts
describe('suggestTierForFill', () => {
  const tiers = [
    { id: 'a', kind: 'FIXED' as const, price: 36.92, trailPercent: null, quantity: 600 },
    { id: 'b', kind: 'FIXED' as const, price: 30.39, trailPercent: null, quantity: 550 },
  ];

  it('picks the tier nearest the fill price', () => {
    expect(suggestTierForFill(tiers, 36.92)).toBe('a');
    expect(suggestTierForFill(tiers, 30.5)).toBe('b');
  });

  it('returns null when no tier has a resolvable price', () => {
    expect(
      suggestTierForFill(
        [{ id: 'c', kind: 'TRAILING', price: null, trailPercent: 11.9, quantity: 100 }],
        123.07,
      ),
    ).toBeNull();
  });

  it('returns null for an empty plan', () => {
    expect(suggestTierForFill([], 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx vitest run src/portfolio/derive-trades.spec.ts`
Expected: FAIL — `suggestTierForFill is not a function`.

- [ ] **Step 3: Implement**

```ts
/**
 * The tier a fill most plausibly executed, by price proximity — the same
 * signal `computeEffectiveStops` uses, extracted so the entry sheet can
 * offer it as a pre-selected default.
 *
 * This is a SUGGESTION and nothing more. It was wrong on a real trade
 * (MSTR: the only tier was a trailing stop the exit never reached, and a
 * matcher with one candidate will always pick it), which is exactly why the
 * owner confirms it before anything is stored.
 */
export function suggestTierForFill(
  tiers: Array<StopLevelInput & { id: string }>,
  fillPrice: number,
): string | null {
  let best: { id: string; gap: number } | null = null;
  for (const tier of tiers) {
    if (tier.price === null || !(tier.price > 0)) continue;
    const gap = Math.abs(tier.price - fillPrice);
    if (best === null || gap < best.gap) best = { id: tier.id, gap };
  }
  return best?.id ?? null;
}
```

- [ ] **Step 4: Run and commit**

```bash
cd backend && npx vitest run src/portfolio/derive-trades.spec.ts
git add backend/src/portfolio/derive-trades.ts backend/src/portfolio/derive-trades.spec.ts
git commit -m "feat: suggestTierForFill, the entry sheet's default"
```

### Task 6: `computeEffectiveStops` prefers recorded executions

**Files:**
- Modify: `backend/src/portfolio/derive-trades.ts`
- Test: `backend/src/portfolio/derive-trades.spec.ts`

**Interfaces:**
- Consumes: `ReducingFill` (existing), extended with the executions recorded against it.
- Produces: `ReducingFill` gains `executions?: Array<{ stopLevelId: string; quantity: number }>` and `exitKind?: 'STOP' | 'DISCRETIONARY' | null`. `computeEffectiveStops` consumes tiers named by `executions` exactly, ignores price matching for any fill that has them or is `DISCRETIONARY`, and falls back to price matching only for unclassified fills.

- [ ] **Step 1: Write the failing tests**

```ts
describe('computeEffectiveStops with recorded executions', () => {
  it('consumes exactly the recorded tier, ignoring price proximity', () => {
    // The fill price sits nearest tier A, but the OWNER said it was tier B.
    // The record must win.
    const tiers = [
      { id: 'a', kind: 'FIXED' as const, price: 100, trailPercent: null, quantity: 50 },
      { id: 'b', kind: 'FIXED' as const, price: 90, trailPercent: null, quantity: 50 },
    ];
    const result = computeEffectiveStops(tiers, null, new Date('2026-01-01'), [
      {
        executedAt: new Date('2026-01-05'),
        price: 99.9,
        quantity: 50,
        exitKind: 'STOP',
        executions: [{ stopLevelId: 'b', quantity: 50 }],
      },
    ]);
    expect(result.find((t) => t.id === 'a')?.quantity).toBe(50);
    expect(result.find((t) => t.id === 'b')).toBeUndefined();
  });

  it('leaves every tier intact for a discretionary exit', () => {
    const tiers = [
      { id: 'a', kind: 'FIXED' as const, price: 100, trailPercent: null, quantity: 50 },
    ];
    const result = computeEffectiveStops(tiers, null, new Date('2026-01-01'), [
      {
        executedAt: new Date('2026-01-05'),
        price: 100,
        quantity: 20,
        exitKind: 'DISCRETIONARY',
        executions: [],
      },
    ]);
    // The shares are gone, so coverage cannot exceed what is held - but no
    // tier is attributed, because the owner said this was his own decision.
    expect(result.find((t) => t.id === 'a')?.quantity).toBe(50);
  });

  it('still price-matches a fill nobody has classified', () => {
    const tiers = [
      { id: 'a', kind: 'FIXED' as const, price: 100, trailPercent: null, quantity: 50 },
    ];
    const result = computeEffectiveStops(tiers, null, new Date('2026-01-01'), [
      { executedAt: new Date('2026-01-05'), price: 100, quantity: 50 },
    ]);
    expect(result.find((t) => t.id === 'a')).toBeUndefined();
  });
});
```

Note: `computeEffectiveStops` currently takes `StopLevelInput[]` without ids. Widen its tier parameter to `Array<StopLevelInput & { id: string }>` and carry the id through to the returned tiers; the ids come from `stop_levels.id` and are already loaded by `portfolio.service.ts`.

- [ ] **Step 2: Run and watch them fail**

Run: `cd backend && npx vitest run src/portfolio/derive-trades.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `computeEffectiveStops`, process fills oldest-first as it does today, but branch per fill before the existing proximity logic:

- if `fill.executions` is non-empty: subtract each `execution.quantity` from the tier with the matching `stopLevelId`, removing the tier when it reaches zero. Do not run proximity matching for this fill.
- else if `fill.exitKind === 'DISCRETIONARY'`: attribute nothing. Skip the fill.
- else: run the existing closest-price consumption unchanged.

Keep the existing `recordedAt` / `openedAt` cutoff behaviour for the price-matched branch only. A recorded execution is authoritative regardless of revision timing — the owner named the tier.

- [ ] **Step 4: Run every backend test**

Run: `cd backend && npx vitest run`
Expected: PASS, including the pre-existing `computeEffectiveStops` tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/portfolio/derive-trades.ts backend/src/portfolio/derive-trades.spec.ts
git commit -m "feat: recorded stop executions beat price matching"
```

### Task 7: Write executions through the journal

**Files:**
- Modify: `backend/src/journal/journal.dto.ts`
- Modify: `backend/src/journal/journal.service.ts`
- Modify: `backend/src/portfolio/portfolio.service.ts` (load executions alongside stop levels and pass them into `deriveTrades`)
- Test: `backend/test/journal.e2e-spec.ts`

**Interfaces:**
- Consumes: `StopExecution` from Task 3, `computeEffectiveStops` from Task 6.
- Produces: the trade DTO accepts `exitKind?: 'STOP' | 'DISCRETIONARY'` and `stopExecutions?: Array<{ stopLevelId: string; quantity: number }>`, written in the same DB transaction as the entry.

- [ ] **Step 1: Write the failing e2e test**

```ts
it('records which stop tier a sell executed', async () => {
  const open = await http(app, token).post('/journal').send({
    kind: 'TRADE',
    body: 'entry',
    occurredAt: '2026-01-03T14:30:00.000Z',
    trade: {
      symbol: 'NVDA', quantity: 100, price: 200, fee: 0,
      stopLevels: [{ kind: 'FIXED', price: 180, quantity: 100 }],
    },
  }).expect(201);

  const [{ id: stopLevelId }] = (await dataSource.query(
    `SELECT s.id FROM stop_levels s
     JOIN transactions t ON t.id = s."transactionId"
     JOIN instruments i ON i.id = t."instrumentId"
     WHERE i.symbol = 'NVDA'`,
  )) as Array<{ id: string }>;

  await http(app, token).post('/journal').send({
    kind: 'TRADE',
    body: 'stopped out',
    occurredAt: '2026-01-08T14:30:00.000Z',
    trade: {
      symbol: 'NVDA', quantity: -100, price: 180, fee: 0,
      exitKind: 'STOP',
      stopExecutions: [{ stopLevelId, quantity: 100 }],
    },
  }).expect(201);

  const rows = (await dataSource.query(
    `SELECT quantity FROM stop_executions WHERE "stopLevelId" = $1`, [stopLevelId],
  )) as Array<{ quantity: string }>;
  expect(rows).toHaveLength(1);
  expect(Number(rows[0].quantity)).toBe(100);

  const kinds = (await dataSource.query(
    `SELECT "exitKind" FROM transactions WHERE side = 'SELL'`,
  )) as Array<{ exitKind: string | null }>;
  expect(kinds[0].exitKind).toBe('STOP');

  // The tier is consumed, so the position no longer reports coverage.
  const res = await http(app, token).get('/portfolio').expect(200);
  expect(res.body.stopTiers.filter((r: { symbol: string }) => r.symbol === 'NVDA')).toEqual([]);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/journal.e2e-spec.ts`
Expected: FAIL — the fields are rejected or ignored.

- [ ] **Step 3: Add the DTO fields**

In `journal.dto.ts`, on the trade DTO:

```ts
  @IsOptional()
  @IsIn(['STOP', 'DISCRETIONARY'])
  exitKind?: 'STOP' | 'DISCRETIONARY';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => StopExecutionDto)
  stopExecutions?: StopExecutionDto[];
```

with

```ts
class StopExecutionDto {
  @IsUUID()
  stopLevelId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
}
```

- [ ] **Step 4: Write them in the service**

Inside the existing `this.dataSource.transaction(...)` that creates the entry and its transaction, after the transaction row is saved:

```ts
if (spec.exitKind) {
  await manager.update(Transaction, txn.id, { exitKind: spec.exitKind });
}
for (const exec of spec.stopExecutions ?? []) {
  await manager.save(
    manager.create(StopExecution, {
      stopLevelId: exec.stopLevelId,
      transactionId: txn.id,
      quantity: Math.abs(exec.quantity),
    }),
  );
}
```

On entry **update**, delete the entry's existing `stop_executions` rows and rewrite them from the new payload, the same way tags are replaced — an execution is a claim about one fill, so it follows that fill's edits.

- [ ] **Step 5: Load them for derivation**

In `portfolio.service.ts`, where stop levels are loaded for `deriveTrades`, also load `stop_executions` keyed by `transactionId`, and attach `executions` and `exitKind` to each `ReducingFill`.

- [ ] **Step 6: Run everything**

```bash
cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run test:e2e
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/journal backend/src/portfolio/portfolio.service.ts backend/test/journal.e2e-spec.ts
git commit -m "feat: write stop executions through the journal"
```

### Task 8: "Was this a stop?" in the entry sheet

**Files:**
- Modify: `frontend/src/components/EntrySheet.tsx`
- Create: `frontend/src/lib/stopExecutionPrompt.ts`
- Test: `frontend/src/lib/stopExecutionPrompt.spec.ts`

**Interfaces:**
- Consumes: the trade's live tiers (id, kind, price, trailPercent, quantity) from `GET /portfolio/trades/:id`.
- Produces: `exitKind` and `stopExecutions` on the journal payload from Task 7.

- [ ] **Step 1: Write the failing test for the pure part**

```ts
import { describe, expect, it } from 'vitest';
import { shouldAskAboutStop, defaultTierId } from './stopExecutionPrompt';

describe('shouldAskAboutStop', () => {
  it('asks when the fill reduces a position that has live tiers', () => {
    expect(shouldAskAboutStop({ signedQuantity: -100, heldQuantity: 100, tierCount: 2 })).toBe(true);
  });

  it('does not ask when the fill adds to the position', () => {
    expect(shouldAskAboutStop({ signedQuantity: 100, heldQuantity: 100, tierCount: 2 })).toBe(false);
  });

  it('does not ask when there are no tiers to attribute to', () => {
    expect(shouldAskAboutStop({ signedQuantity: -100, heldQuantity: 100, tierCount: 0 })).toBe(false);
  });

  it('asks on a covering buy against a short', () => {
    expect(shouldAskAboutStop({ signedQuantity: 100, heldQuantity: -100, tierCount: 1 })).toBe(true);
  });
});

describe('defaultTierId', () => {
  it('pre-selects the tier nearest the fill price', () => {
    expect(
      defaultTierId(
        [
          { id: 'a', price: 36.92, trailPercent: null },
          { id: 'b', price: 30.39, trailPercent: null },
        ],
        36.9,
      ),
    ).toBe('a');
  });

  it('pre-selects nothing when every tier is trailing', () => {
    expect(defaultTierId([{ id: 'c', price: null, trailPercent: 11.9 }], 123.07)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npx vitest run src/lib/stopExecutionPrompt.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure module**

`shouldAskAboutStop` returns true when the fill's sign is opposite to the held quantity's sign and `tierCount > 0`. `defaultTierId` mirrors `suggestTierForFill` from Task 5 — nearest resolvable price, else null. Keep the two in step; they are the same rule on two sides of the wire, and a divergence would show as the sheet defaulting to one tier while the backend's fallback picks another.

- [ ] **Step 4: Add the UI**

When `shouldAskAboutStop` is true, the sheet shows a "Was this a stop?" block: one row per live tier (price or trail percent, plus quantity), the `defaultTierId` one pre-selected, and a "No — my own decision" option. Selecting a tier sets `exitKind: 'STOP'` and one `stopExecutions` entry for the filled quantity; selecting "No" sets `exitKind: 'DISCRETIONARY'` and no entries.

Persist the choice into the existing `localStorage` draft (`lib/draftStorage.ts`) alongside the rest of the form. iOS Safari discards backgrounded tabs, and losing this selection means losing the whole entry.

- [ ] **Step 5: Verify on the phone**

- journal a partial sell on a stopped position and confirm the block appears with a sensible tier pre-selected
- confirm "No — my own decision" saves and the tier survives on the Stops page
- background the app mid-entry, return, and confirm the selection is still there

STOP for the owner.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/EntrySheet.tsx frontend/src/lib/stopExecutionPrompt.ts frontend/src/lib/stopExecutionPrompt.spec.ts
git commit -m "feat: ask whether an exit was a stop"
```

---

## Slice 5 — Historical backfill

### Task 9: Apply the ten attributions to the real database

**Files:**
- Create: `backend/scripts/2026-09-03-backfill-stop-executions.sql`

This task writes to the owner's real `trader` database. It is the one place in this plan that does.

- [ ] **Step 1: Take a dump first**

```bash
pg_dump -d trader -F c -f ~/trader-backup-$(date +%Y%m%d-%H%M%S).dump
```

Confirm the file exists and is non-trivial in size before continuing. Do not proceed without it.

- [ ] **Step 2: Write the script**

Each statement resolves its own ids by symbol, price and quantity rather than hard-coding uuids, so the script is readable and can be checked against the spec's table. One `INSERT` per attribution, following this shape:

```sql
-- SMCI: SELL 600 @ 36.92 executed the 36.92 x 600 tier.
INSERT INTO stop_executions ("stopLevelId", "transactionId", quantity)
SELECT s.id, tx.id, 600
FROM stop_levels s
JOIN transactions ot ON ot.id = s."transactionId"
JOIN instruments i ON i.id = ot."instrumentId"
JOIN transactions tx ON tx."instrumentId" = i.id AND tx.side = 'SELL'
  AND tx.quantity = 600 AND tx.price = 36.92
WHERE i.symbol = 'SMCI' AND s.price = 36.92 AND s.quantity = 600;
```

Repeat for the other nine rows in the spec's table: AVGO 40 @ 349.91 → 349.93×40; BE 45 @ 206.90 → 207.08×45; BITX 1000 @ 17.46 → 17.46×1000; BITX 800 @ 17.07 → 17.07×800; BMNR 500 @ 24.34 → 24.34×500; MRNA (covering BUY) 200 @ 149.65 → 149.64×200; MSTR 100 @ 123.07 → the TRAILING 11.9% tier; NVDA 151 @ 220.07 → 220.07×151; PLTR 120 @ 167.15 → 167.13×120.

Then mark the fills:

```sql
UPDATE transactions SET "exitKind" = 'STOP'
WHERE id IN (SELECT DISTINCT "transactionId" FROM stop_executions);
```

And delete the misfiled tier:

```sql
-- A MRNA stop filed against the AVGO entry. MRNA's own second sell already
-- carries an identical 200 @ 161.93, and no AVGO fill of 200 shares exists.
DELETE FROM stop_levels WHERE id = 'b23d5bef-1c9f-42e7-a306-a1bae81d62ad';
```

This `DELETE` is the single exception to the append-only rule, and it is a correction of bad data rather than a stop being retired. Nothing in application code may do this.

- [ ] **Step 3: Dry-run the SELECTs**

Convert each `INSERT ... SELECT` to its bare `SELECT` and confirm every one returns **exactly one row**. A zero-row or multi-row result means an attribution does not match the data and must be resolved with the owner before writing anything.

- [ ] **Step 4: Show the owner the script, then run it**

Do not run it unreviewed. After approval:

```bash
psql -d trader -1 -f backend/scripts/2026-09-03-backfill-stop-executions.sql
```

`-1` wraps it in a single transaction so a failure part-way leaves nothing behind.

- [ ] **Step 5: Verify**

```bash
psql -d trader -c "SELECT count(*) FROM stop_executions;"          # expect 10
psql -d trader -c "SELECT count(*) FROM transactions WHERE \"exitKind\" IS NOT NULL;"  # expect 10
```

Then open the Stops page on the phone and confirm the tier list and at-risk figure still read correctly.

- [ ] **Step 6: Commit the script**

```bash
git add backend/scripts/2026-09-03-backfill-stop-executions.sql
git commit -m "chore: backfill ten historical stop executions"
```

---

## Slice 6 — Exit statistics

### Task 10: "Stopped out on X% of exits"

**Files:**
- Modify: `backend/src/portfolio/derive-trades.ts` (where `computeExitStats` lives — it is pure and belongs with the other derivation functions, not in the service)
- Modify: `backend/src/portfolio/portfolio.service.ts` (call it and put `exitStats` on the trades response)
- Modify: `frontend/src/routes/Journal.tsx` (the stats header)
- Test: `backend/src/portfolio/derive-trades.spec.ts`

**Interfaces:**
- Consumes: `exitKind` on reducing fills, loaded in Task 7.
- Produces: `exitStats: { stopped: number; discretionary: number; unclassified: number }` on the trades response.

- [ ] **Step 1: Write the failing test**

```ts
describe('exit statistics', () => {
  it('counts classified exits and reports the unclassified separately', () => {
    const stats = computeExitStats([
      { exitKind: 'STOP' },
      { exitKind: 'STOP' },
      { exitKind: 'DISCRETIONARY' },
      { exitKind: null },
    ]);
    expect(stats).toEqual({ stopped: 2, discretionary: 1, unclassified: 1 });
  });

  it('is all zeroes for a history with no exits at all', () => {
    expect(computeExitStats([])).toEqual({ stopped: 0, discretionary: 0, unclassified: 0 });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd backend && npx vitest run src/portfolio/derive-trades.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * How exits came about. `unclassified` is reported rather than folded into
 * `discretionary`, because "I chose to sell" and "nobody has said yet" are
 * different facts and the percentage would silently overstate discipline if
 * they were merged.
 */
export function computeExitStats(
  fills: Array<{ exitKind: 'STOP' | 'DISCRETIONARY' | null }>,
): { stopped: number; discretionary: number; unclassified: number } {
  let stopped = 0;
  let discretionary = 0;
  let unclassified = 0;
  for (const f of fills) {
    if (f.exitKind === 'STOP') stopped += 1;
    else if (f.exitKind === 'DISCRETIONARY') discretionary += 1;
    else unclassified += 1;
  }
  return { stopped, discretionary, unclassified };
}
```

- [ ] **Step 4: Render it**

In the Journal's stats header, show `stopped / (stopped + discretionary)` as a percentage, and when `unclassified > 0` append the count so the figure never implies a completeness it lacks. Render nothing at all when `stopped + discretionary === 0` — a percentage of zero exits is not a number.

- [ ] **Step 5: Run everything and commit**

```bash
cd backend && npx vitest run && npm run test:e2e
cd ../frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json
git add backend/src/portfolio frontend/src/routes/Journal.tsx
git commit -m "feat: stopped-out rate in the Journal stats header"
```

---

## Done when

- Every stop tier row on the Stops page shows the dollars it puts at risk
- A stop plan can be edited and tiers added or removed, each change a new revision with no row ever mutated
- Journalling an exit on a stopped position asks whether it was a stop, pre-selecting the likely tier
- `computeEffectiveStops` uses recorded executions and price-matches only unclassified fills
- The ten historical exits are recorded, and the misfiled AVGO tier is gone
- The Journal header reports the stopped-out rate and how many exits remain unclassified
