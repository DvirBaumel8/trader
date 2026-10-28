# Trader Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Trader into three screens — Chat (home), Holdings, Watchlist — that know what the owner holds and watches but never his broker numbers, answer a moving-average question from market data, and turn anything else into a copy-ready Gemini prompt.

**Architecture:** Strip the existing NestJS + React app in place. Delete the journal, transactions, portfolio, performance, Brief, AI and their screens; slim `market-data` to quotes, daily closes and indicators; reduce the watchlist to symbols. Add a `holdings` module (symbol + direction) and an `assistant` module whose pure `parseMessage` routes a sentence to a typed reply the frontend only displays.

**Tech Stack:** NestJS 11, TypeORM (hand-registered migrations), PostgreSQL, Vitest (unit + e2e with supertest), React + React Router + TanStack Query + Tailwind, Playwright (iPhone 16 Pro WebKit).

**Spec:** `docs/superpowers/specs/2026-10-28-trader-rebuild-design.md`

## Global Constraints

- Trader stores no quantities, prices paid, cash, balances, P&L or performance.
- No in-product AI calls; the `llm/` module and the `@google/genai` dependency are removed. Keep `google-auth-library` (Google sign-in).
- Chat input is English, case-insensitive, tickers only (no company-name lookup).
- A ticker token is 1–5 letters with an optional `.X` class suffix (`BRK.B`), optionally prefixed `$`. Longer words are never treated as tickers, so "bought some lemonade" becomes a prompt.
- Every per-user query filters by `userId` from `usersService.currentUser()` — never `ensureDefaultUser()` directly.
- Schema changes only through a TypeORM migration registered by hand in `backend/src/database/data-source.ts`. No migration drops or truncates any existing table or column.
- The frontend displays; the backend computes. All reply text, verdicts, percentages and money formatting come from the backend.
- Tests never call Yahoo or any external service: e2e specs override `YahooClient` with `test/yahoo-stub.ts`.
- Never touch the local `trader` database or Neon from tests; backend e2e uses `trader_test`, browser tests `trader_e2e`.
- Reuse `components/ui/Button.tsx`, `components/ui/inputClasses.ts`, `components/ui/EditModeToggle.tsx`; every destructive action needs edit mode plus a second confirming tap.
- UI is checked at iPhone 16 Pro width (402px).
- Work stays local (commits on `main`, not pushed) until Task 9.

## Review Focus

1. **Ticker case and punctuation** — "Bought lmnd.", "BOUGHT $LMND", "is googl above 150sma?" must all parse; covered in Task 3's table.
2. **Stale or missing price on the MA check** — a provider outage must say "Couldn't get X's price right now", never compute from a cached-but-absent price; covered in Task 4 (stale-price e2e case and the null-quote service unit test).
3. **Period larger than stored history** — "is X above 400 SMA" with ~345 bars must say there isn't enough history, not average fewer bars; covered in Task 4 (unit + e2e).
4. **Another user's holdings** — user B saying "sold LMND" must not touch user A's LMND; covered in Task 2 (isolation e2e).
5. **Double-tap on Send / Flip** — a second identical "bought LMND" must not create a duplicate row (unique constraint + "already" reply); covered in Task 2 and Task 4.

---

## File Map

**Backend — created**
- `backend/src/holdings/holding.entity.ts` — `holdings` table mapping.
- `backend/src/holdings/holdings.service.ts` — list / set direction / remove for the current user.
- `backend/src/holdings/holdings.controller.ts` — `GET/PUT/DELETE /holdings`.
- `backend/src/holdings/holdings.dto.ts` — `SetHoldingDto`.
- `backend/src/holdings/holdings.module.ts`
- `backend/src/database/migrations/1790035200000-AddHoldings.ts`
- `backend/src/market-data/moving-average.ts` (+ `.spec.ts`) — pure SMA/EMA over N bars.
- `backend/src/assistant/parse.ts` (+ `.spec.ts`) — pure sentence → intent.
- `backend/src/assistant/prompt.ts` (+ `.spec.ts`) — pure prompt builder.
- `backend/src/assistant/assistant.service.ts`, `assistant.controller.ts`, `assistant.dto.ts`, `assistant.module.ts`
- `backend/test/holdings.e2e-spec.ts`, `backend/test/assistant.e2e-spec.ts`

**Backend — rewritten**
- `backend/src/watchlist/*` — symbols only.
- `backend/test/watchlist.e2e-spec.ts`
- `backend/src/app.module.ts`, `backend/src/main.e2e.ts`, `backend/src/legacy-api-prefix.ts`
- `backend/src/market-data/market-data.module.ts`, `history.service.ts`
- `backend/src/users/users.module.ts`, `users.service.ts`

**Backend — deleted:** `journal/`, `transactions/`, `portfolio/`, `performance/`, `llm/`, `users/users.controller.ts`, `common/watchlist-change-notifier*`, watchlist ranking/score files, and from `market-data/`: `brief-*`, `daily-brief*`, `earnings*`, `economic-calendar*`, `finnhub*`, `fundamentals*`, `news*`, `ticker-facts*`, `price-action*`, `market-data.controller.ts`, `history.controller.ts`; matching specs under `backend/test/`.

**Frontend — created:** `routes/Chat.tsx`, `routes/Holdings.tsx` (rewritten from scratch), `routes/Watchlist.tsx` (rewritten), `api/assistant.ts`, `api/lists.ts`, specs for each.

**Frontend — kept:** `main.tsx` (rewritten routes), `components/AppShell.tsx` (rewritten nav), `components/ErrorBoundary.tsx`, `components/Logo.tsx`, `components/RestoreLocation.tsx`, `components/RestoreScroll.tsx`, `components/ui/{Button,EditModeToggle,Input,inputClasses}.tsx|ts` and their specs, `routes/Login.tsx` (+spec), `api/client.ts` (+spec), `lib/{auth,uiState,persistentState}.ts` (+specs), `test/memoryLocalStorage.ts`, `index.css`, `assets/`. Everything else under `frontend/src` is deleted.

**Browser tests:** `e2e/chat.spec.ts` (new), `e2e/auth.spec.ts` and `e2e/navigation.spec.ts` (updated), `e2e/composer.spec.ts` and `e2e/watchlist.spec.ts` (deleted), `e2e/helpers.ts` (token probe moved to `/api/holdings`).

**Docs:** `AGENTS.md`, `docs/product-brief.md`, `docs/current-state.md`, `docs/api.md`, `docs/ai-configuration.md`, `docs/backlog.md`.

---

### Task 1: Strip the backend to auth, users, instruments, market data and a symbol-only watchlist

The frontend will not build after this task; that is expected until Task 5. Nothing is pushed.

**Files:**
- Delete: `backend/src/journal/`, `backend/src/transactions/`, `backend/src/portfolio/`, `backend/src/performance/`, `backend/src/llm/`, `backend/src/users/users.controller.ts`, `backend/src/common/watchlist-change-notifier.ts`, `backend/src/common/watchlist-change-notifier.module.ts`, `backend/src/watchlist/score.ts`, `backend/src/watchlist/score.spec.ts`, `backend/src/watchlist/watchlist-ranking*.ts`, `backend/src/watchlist/watchlist-tag.entity.ts`
- Delete from `backend/src/market-data/`: `brief-*.ts`, `daily-brief*.ts`, `earnings*.ts`, `economic-calendar*.ts`, `finnhub*.ts`, `fundamentals*.ts`, `news*.ts`, `ticker-facts*.ts`, `price-action*.ts`, `market-data.controller.ts`, `history.controller.ts`
- Delete from `backend/test/`: `ai-outcomes`, `ai-summaries`, `history`, `journal`, `net-cash-migration`, `portfolio`, `ticker-facts`, `trade-idea`, `trades`, `watchlist-ranking` `.e2e-spec.ts` files
- Modify: `backend/src/app.module.ts`, `backend/src/market-data/market-data.module.ts`, `backend/src/market-data/history.service.ts`, `backend/src/users/users.module.ts`, `backend/src/users/users.service.ts`, `backend/src/legacy-api-prefix.ts` (+ its spec), `backend/src/main.e2e.ts`, `backend/package.json`
- Rewrite: `backend/src/watchlist/watchlist-item.entity.ts`, `watchlist.service.ts`, `watchlist.controller.ts`, `watchlist.dto.ts`, `watchlist.module.ts`, `backend/test/watchlist.e2e-spec.ts`

**Interfaces:**
- Produces: `WatchlistService.list(): Promise<{ symbol: string; name: string | null }[]>` (sorted by symbol), `WatchlistService.add(symbol: string): Promise<{ added: boolean; symbol: string }>` (throws `NotFoundException` for an unknown ticker), `WatchlistService.remove(symbol: string): Promise<boolean>` (false when not watched). Exported from `WatchlistModule`.
- Produces: `HistoryService.ensurePriced(instrument, symbol)` and `HistoryService.ensureFresh()` unchanged; `MarketDataModule` exports `MarketDataService`, `HistoryService`.

- [ ] **Step 1: Delete the removed modules and files listed above**

```bash
cd backend/src
rm -rf journal transactions portfolio performance llm
rm users/users.controller.ts common/watchlist-change-notifier.ts common/watchlist-change-notifier.module.ts
rm watchlist/score.ts watchlist/score.spec.ts watchlist/watchlist-ranking*.ts watchlist/watchlist-tag.entity.ts
cd market-data
rm brief-*.ts daily-brief*.ts earnings*.ts economic-calendar*.ts finnhub*.ts fundamentals*.ts news*.ts ticker-facts*.ts price-action*.ts market-data.controller.ts history.controller.ts
cd ../../test
rm ai-outcomes.e2e-spec.ts ai-summaries.e2e-spec.ts history.e2e-spec.ts journal.e2e-spec.ts net-cash-migration.e2e-spec.ts portfolio.e2e-spec.ts ticker-facts.e2e-spec.ts trade-idea.e2e-spec.ts trades.e2e-spec.ts watchlist-ranking.e2e-spec.ts
```

Migrations under `src/database/migrations/` are NOT deleted, and `data-source.ts` is unchanged: existing databases already ran them and fresh test databases must still build the same tables.

- [ ] **Step 2: Slim `market-data.module.ts`**

```ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketDataService } from './market-data.service.js';
import { YahooClient } from './yahoo.client.js';
import { TwelveDataClient } from './twelvedata.client.js';
import { HistoryService } from './history.service.js';
import { DailyClose } from './daily-close.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyClose, Instrument]),
    // Instruments depends on market data for ticker validation, so the two
    // modules reference each other.
    forwardRef(() => InstrumentsModule),
  ],
  providers: [
    YahooClient,
    // A second opinion for pre/post-market prices when Yahoo's own quote had
    // none to offer — see twelvedata.client.ts. Inert without a key.
    TwelveDataClient,
    HistoryService,
    {
      // Built by factory so the cache TTL stays an explicit constructor
      // argument, which is what makes the service testable without Nest.
      provide: MarketDataService,
      useFactory: (yahoo: YahooClient, twelveData: TwelveDataClient) =>
        new MarketDataService(yahoo, undefined, twelveData),
      inject: [YahooClient, TwelveDataClient],
    },
  ],
  exports: [MarketDataService, HistoryService],
})
export class MarketDataModule {}
```

- [ ] **Step 3: Remove transactions and benchmarks from `history.service.ts`**

Remove the `Transaction` import and constructor parameter, the `BENCHMARKS` export, `backfill()`, `ensureBenchmarksPriced()` and its call at the top of `ensureFresh()`. Keep `ensurePriced`, `ensureFresh`, `liveDailyBars` and `fetchAndStore`. Update doc comments that mention the journal, trades or benchmarks so they describe "held or watched" instruments. If `history.service.spec.ts` tests removed methods, delete those cases; keep the rest passing.

- [ ] **Step 4: Users without settings**

`users.module.ts`: drop `UsersController` from `controllers`. `users.service.ts`: delete `getSettings`, `updateSettings`, `updateInterestAccrual` and the `reasonVocabulary` import. Leave `user.entity.ts` columns as they are (no schema change). Delete any `users.service.spec.ts` cases for the removed methods.

- [ ] **Step 5: `app.module.ts` imports**

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  TypeOrmModule.forRootAsync({ /* unchanged */ }),
  UsersModule,
  InstrumentsModule,
  WatchlistModule,
  HealthModule,
  AuthModule,
],
```

Remove the `PortfolioModule`, `JournalModule`, `PerformanceModule`, `LlmModule` imports.

- [ ] **Step 6: Watchlist entity — map only what the symbol list needs**

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * A ticker the owner is watching. Symbols only: the target, note and
 * acknowledgement columns from the old watchlist stay in the table, unmapped
 * and unused (see docs/superpowers/specs/2026-10-28-trader-rebuild-design.md).
 */
@Entity('watchlist_items')
@Unique(['userId', 'instrumentId'])
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  instrumentId: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

The old `note` column is `NOT NULL DEFAULT ''` and the target columns are nullable, so inserts without them succeed.

- [ ] **Step 7: Write the failing watchlist e2e spec** (`backend/test/watchlist.e2e-spec.ts`, replacing the old file)

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Watchlist (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE watchlist_items, daily_closes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts empty', async () => {
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([]);
  });

  it('watches a ticker, listed by symbol with its name', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'nvda' }).expect(201);
    await http(app, token).post('/watchlist').send({ symbol: 'AAPL' }).expect(201);
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([
      { symbol: 'AAPL', name: 'AAPL Inc' },
      { symbol: 'NVDA', name: 'NVDA Inc' },
    ]);
  });

  it('does not duplicate a ticker watched twice', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'NVDA' }).expect(201);
    const again = await http(app, token).post('/watchlist').send({ symbol: 'NVDA' }).expect(201);
    expect(again.body).toEqual({ added: false, symbol: 'NVDA' });
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('refuses a ticker the provider does not know', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'ZZZZ' }).expect(404);
  });

  it('stops watching by symbol, and 404s for one not watched', async () => {
    await http(app, token).post('/watchlist').send({ symbol: 'NVDA' }).expect(201);
    await http(app, token).delete('/watchlist/nvda').expect(200);
    await http(app, token).delete('/watchlist/NVDA').expect(404);
    const res = await http(app, token).get('/watchlist').expect(200);
    expect(res.body).toEqual([]);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/watchlist.e2e-spec.ts`
Expected: FAIL (compile errors from the old watchlist service, or wrong response shapes).

- [ ] **Step 9: Rewrite the watchlist service, DTO, controller and module**

`watchlist.dto.ts`:

```ts
import { IsString, Length } from 'class-validator';

export class AddWatchlistDto {
  @IsString()
  @Length(1, 12)
  symbol: string;
}
```

`watchlist.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { HistoryService } from '../market-data/history.service.js';
import { UsersService } from '../users/users.service.js';

export interface WatchlistRow {
  symbol: string;
  name: string | null;
}

/** How many tickers may be watched at once — keeps the list readable on a phone. */
export const WATCHLIST_LIMIT = 50;

@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistItem) private readonly items: Repository<WatchlistItem>,
    @InjectRepository(Instrument) private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly history: HistoryService,
    private readonly users: UsersService,
  ) {}

  async list(): Promise<WatchlistRow[]> {
    const user = await this.users.currentUser();
    const rows = await this.items.find({ where: { userId: user.id } });
    if (rows.length === 0) return [];
    const instruments = await this.instruments.find({
      where: { id: In(rows.map((r) => r.instrumentId)) },
    });
    return instruments
      .map((i) => ({ symbol: i.symbol, name: i.name }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  /** Validates the ticker (404 when unknown). `added: false` when it was already watched. */
  async add(symbol: string): Promise<{ added: boolean; symbol: string }> {
    const user = await this.users.currentUser();
    const instrument = await this.instrumentsService.findOrCreate(symbol);
    const existing = await this.items.findOne({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    if (existing) return { added: false, symbol: instrument.symbol };
    const count = await this.items.count({ where: { userId: user.id } });
    if (count >= WATCHLIST_LIMIT) {
      throw new BadRequestException(
        `The watchlist holds ${WATCHLIST_LIMIT} tickers at most. Remove one before adding another.`,
      );
    }
    // Daily history for later market-data answers. A no-op once priced; never throws.
    await this.history.ensurePriced(instrument, instrument.symbol);
    await this.items.save(this.items.create({ userId: user.id, instrumentId: instrument.id }));
    return { added: true, symbol: instrument.symbol };
  }

  /** False when the symbol was not on this user's watchlist. */
  async remove(symbol: string): Promise<boolean> {
    const user = await this.users.currentUser();
    const instrument = await this.instruments.findOne({
      where: { symbol: symbol.trim().toUpperCase() },
    });
    if (!instrument) return false;
    const res = await this.items.delete({ userId: user.id, instrumentId: instrument.id });
    return (res.affected ?? 0) > 0;
  }
}
```

`watchlist.controller.ts`:

```ts
import { Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { WatchlistService } from './watchlist.service.js';
import { AddWatchlistDto } from './watchlist.dto.js';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list() {
    return this.watchlist.list();
  }

  @Post()
  add(@Body() body: AddWatchlistDto) {
    return this.watchlist.add(body.symbol);
  }

  @Delete(':symbol')
  async remove(@Param('symbol') symbol: string) {
    if (!(await this.watchlist.remove(symbol))) {
      throw new NotFoundException(`${symbol.toUpperCase()} isn't on your watchlist`);
    }
    return { ok: true };
  }
}
```

`watchlist.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './watchlist-item.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { WatchlistService } from './watchlist.service.js';
import { WatchlistController } from './watchlist.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, Instrument]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
  ],
  providers: [WatchlistService],
  controllers: [WatchlistController],
  exports: [WatchlistService],
})
export class WatchlistModule {}
```

- [ ] **Step 10: Legacy prefixes, the browser-test entry point, and the SDK dependency**

`legacy-api-prefix.ts`: set `LEGACY_PREFIXES` to `['/watchlist', '/holdings', '/assistant', '/auth', '/instruments']` and update the doc comment's example screens to `/holdings`, `/watchlist`. Update `legacy-api-prefix.spec.ts` cases that used removed prefixes (e.g. `/portfolio`, `/journal`) to use `/holdings` and `/watchlist`.

`main.e2e.ts`: remove the `LlmClient` and `EconomicCalendarClient` imports, overrides, `RANKING_STUB_ANSWER` and the doc paragraphs about them; keep the `YahooClient` override with `yahooStub({ withBars: true })`.

Remove the AI SDK: `cd backend && npm uninstall @google/genai`.

- [ ] **Step 11: Fix remaining compile errors**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: errors only in files that still import deleted modules. For each, delete the dead import/usage, or delete the file if it only served a removed feature (e.g. specs of deleted code, `common/settle-in-chunks*` if now unused, `instruments` code referencing earnings). Repeat until clean. Also `grep -rn "journal\|portfolio\|llm\|transactions" backend/src backend/test` should return only migrations and comments you have intentionally left.

- [ ] **Step 12: Run all backend suites**

Run: `cd backend && npx tsc -p tsconfig.build.json --noEmit && npm test && npm run test:e2e`
Expected: all PASS, including the new watchlist spec.

- [ ] **Step 13: Commit**

```bash
git add -A backend
git commit -m "refactor(backend): remove journal, portfolio, AI and Brief; symbol-only watchlist"
```

---

### Task 2: Holdings — symbol and direction per user

**Files:**
- Create: `backend/src/database/migrations/1790035200000-AddHoldings.ts`, `backend/src/holdings/holding.entity.ts`, `holdings.service.ts`, `holdings.controller.ts`, `holdings.dto.ts`, `holdings.module.ts`, `backend/test/holdings.e2e-spec.ts`
- Modify: `backend/src/database/data-source.ts`, `backend/src/app.module.ts`

**Interfaces:**
- Produces: `type Direction = 'LONG' | 'SHORT'` (exported from `holding.entity.ts`).
- Produces: `HoldingsService.list(): Promise<{ symbol: string; name: string | null; direction: Direction }[]>` sorted by symbol; `HoldingsService.find(symbol: string): Promise<Direction | null>`; `HoldingsService.set(symbol: string, direction: Direction): Promise<{ symbol: string; direction: Direction; previous: Direction | null }>` (validates ticker → `NotFoundException` when unknown; inserts or flips); `HoldingsService.remove(symbol: string): Promise<boolean>`. Exported from `HoldingsModule`.

- [ ] **Step 1: Write the failing e2e spec** (`backend/test/holdings.e2e-spec.ts`)

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Holdings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(yahooStub())
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE holdings, daily_closes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts empty', async () => {
    expect((await http(app, token).get('/holdings').expect(200)).body).toEqual([]);
  });

  it('adds holdings with a direction, sorted by symbol', async () => {
    await http(app, token).put('/holdings/tsla').send({ direction: 'SHORT' }).expect(200);
    const res = await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    expect(res.body).toEqual({ symbol: 'LMND', direction: 'LONG', previous: null });
    expect((await http(app, token).get('/holdings').expect(200)).body).toEqual([
      { symbol: 'LMND', name: 'LMND Inc', direction: 'LONG' },
      { symbol: 'TSLA', name: 'TSLA Inc', direction: 'SHORT' },
    ]);
  });

  it('flips a direction in place, never a second row', async () => {
    await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    const res = await http(app, token).put('/holdings/LMND').send({ direction: 'SHORT' }).expect(200);
    expect(res.body).toEqual({ symbol: 'LMND', direction: 'SHORT', previous: 'LONG' });
    await http(app, token).put('/holdings/LMND').send({ direction: 'SHORT' }).expect(200);
    expect((await http(app, token).get('/holdings').expect(200)).body).toHaveLength(1);
  });

  it('rejects an unknown ticker and a bad direction', async () => {
    await http(app, token).put('/holdings/ZZZZ').send({ direction: 'LONG' }).expect(404);
    await http(app, token).put('/holdings/LMND').send({ direction: 'UP' }).expect(400);
  });

  it('removes by symbol, and 404s for one not held', async () => {
    await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    await http(app, token).delete('/holdings/lmnd').expect(200);
    await http(app, token).delete('/holdings/LMND').expect(404);
  });

  it("never shows or removes another user's holdings", async () => {
    await http(app, token).put('/holdings/LMND').send({ direction: 'LONG' }).expect(200);
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: `other-${Date.now()}@e2e.local`, password: 'other-password-1' })
      .expect(201);
    const other = signup.body.accessToken as string;
    expect((await http(app, other).get('/holdings').expect(200)).body).toEqual([]);
    await http(app, other).delete('/holdings/LMND').expect(404);
    expect((await http(app, token).get('/holdings').expect(200)).body).toHaveLength(1);
  });
});
```

If `http()` in `test/http.ts` has no `put`, add `put: bound('put')` and `'put'` to its `Method` type.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/holdings.e2e-spec.ts`
Expected: FAIL — `relation "holdings" does not exist` / 404 on `/holdings`.

- [ ] **Step 3: Migration** (`1790035200000-AddHoldings.ts`) and register it

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Holdings: which symbols the owner holds and in which direction. Nothing
 * else — no quantity, no price paid. The broker owns those numbers
 * (docs/superpowers/specs/2026-10-28-trader-rebuild-design.md).
 */
export class AddHoldings1790035200000 implements MigrationInterface {
  name = 'AddHoldings1790035200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.holdings (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "instrumentId" uuid NOT NULL,
        direction varchar NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_holdings_user_instrument" UNIQUE ("userId", "instrumentId")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_holdings_userId" ON public.holdings ("userId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.holdings;`);
  }
}
```

In `data-source.ts`: import `AddHoldings1790035200000` and append it after `NetCashExcludesFee1789948800000` in `migrations`.

- [ ] **Step 4: Entity, DTO, service, controller, module**

`holding.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type Direction = 'LONG' | 'SHORT';

/** A symbol the owner holds and which way. Deliberately no quantity or price. */
@Entity('holdings')
@Unique(['userId', 'instrumentId'])
export class Holding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  instrumentId: string;

  @Column({ type: 'varchar' })
  direction: Direction;

  @CreateDateColumn()
  createdAt: Date;
}
```

`holdings.dto.ts`:

```ts
import { IsIn } from 'class-validator';
import type { Direction } from './holding.entity.js';

export class SetHoldingDto {
  @IsIn(['LONG', 'SHORT'])
  direction: Direction;
}
```

`holdings.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Holding, type Direction } from './holding.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { HistoryService } from '../market-data/history.service.js';
import { UsersService } from '../users/users.service.js';

export interface HoldingRow {
  symbol: string;
  name: string | null;
  direction: Direction;
}

@Injectable()
export class HoldingsService {
  constructor(
    @InjectRepository(Holding) private readonly holdings: Repository<Holding>,
    @InjectRepository(Instrument) private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly history: HistoryService,
    private readonly users: UsersService,
  ) {}

  async list(): Promise<HoldingRow[]> {
    const user = await this.users.currentUser();
    const rows = await this.holdings.find({ where: { userId: user.id } });
    if (rows.length === 0) return [];
    const instruments = await this.instruments.find({
      where: { id: In(rows.map((r) => r.instrumentId)) },
    });
    const byId = new Map(instruments.map((i) => [i.id, i]));
    return rows
      .map((r) => {
        const i = byId.get(r.instrumentId);
        return { symbol: i?.symbol ?? 'UNKNOWN', name: i?.name ?? null, direction: r.direction };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  /** The direction held, or null. Never creates an instrument. */
  async find(symbol: string): Promise<Direction | null> {
    const row = await this.rowFor(symbol);
    return row?.direction ?? null;
  }

  /** Adds or flips. Validates the ticker first: unknown → NotFoundException. */
  async set(
    symbol: string,
    direction: Direction,
  ): Promise<{ symbol: string; direction: Direction; previous: Direction | null }> {
    const user = await this.users.currentUser();
    const instrument = await this.instrumentsService.findOrCreate(symbol);
    const existing = await this.holdings.findOne({
      where: { userId: user.id, instrumentId: instrument.id },
    });
    if (existing) {
      const previous = existing.direction;
      if (previous !== direction) {
        existing.direction = direction;
        await this.holdings.save(existing);
      }
      return { symbol: instrument.symbol, direction, previous };
    }
    // Daily history for later market-data answers. A no-op once priced; never throws.
    await this.history.ensurePriced(instrument, instrument.symbol);
    await this.holdings.save(
      this.holdings.create({ userId: user.id, instrumentId: instrument.id, direction }),
    );
    return { symbol: instrument.symbol, direction, previous: null };
  }

  /** False when this user did not hold the symbol. */
  async remove(symbol: string): Promise<boolean> {
    const row = await this.rowFor(symbol);
    if (!row) return false;
    await this.holdings.delete({ id: row.id });
    return true;
  }

  private async rowFor(symbol: string): Promise<Holding | null> {
    const user = await this.users.currentUser();
    const instrument = await this.instruments.findOne({
      where: { symbol: symbol.trim().toUpperCase() },
    });
    if (!instrument) return null;
    return this.holdings.findOne({ where: { userId: user.id, instrumentId: instrument.id } });
  }
}
```

`holdings.controller.ts`:

```ts
import { Body, Controller, Delete, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { HoldingsService } from './holdings.service.js';
import { SetHoldingDto } from './holdings.dto.js';

@Controller('holdings')
export class HoldingsController {
  constructor(private readonly holdings: HoldingsService) {}

  @Get()
  list() {
    return this.holdings.list();
  }

  @Put(':symbol')
  set(@Param('symbol') symbol: string, @Body() body: SetHoldingDto) {
    return this.holdings.set(symbol, body.direction);
  }

  @Delete(':symbol')
  async remove(@Param('symbol') symbol: string) {
    if (!(await this.holdings.remove(symbol))) {
      throw new NotFoundException(`You don't hold ${symbol.toUpperCase()}`);
    }
    return { ok: true };
  }
}
```

`holdings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Holding } from './holding.entity.js';
import { Instrument } from '../instruments/instrument.entity.js';
import { HoldingsService } from './holdings.service.js';
import { HoldingsController } from './holdings.controller.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Holding, Instrument]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
  ],
  providers: [HoldingsService],
  controllers: [HoldingsController],
  exports: [HoldingsService],
})
export class HoldingsModule {}
```

Add `HoldingsModule` to `app.module.ts` imports.

`@Put` returns 200 by default in Nest; the spec expects 200.

- [ ] **Step 5: Run it to verify it passes**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/holdings.e2e-spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(holdings): symbol and direction per user, with migration"
```

---

### Task 3: `parseMessage` — sentence to intent (pure)

**Files:**
- Create: `backend/src/assistant/parse.ts`, `backend/src/assistant/parse.spec.ts`

**Interfaces:**
- Produces:

```ts
export type Intent =
  | { kind: 'add-holding'; symbol: string; direction: 'LONG' | 'SHORT' }
  | { kind: 'remove-holding'; symbol: string }
  | { kind: 'watch'; symbol: string }
  | { kind: 'unwatch'; symbol: string }
  | { kind: 'ma-check'; symbol: string; comparator: 'above' | 'below'; period: number; average: 'SMA' | 'EMA' }
  | { kind: 'unknown' };
export function parseMessage(text: string): Intent;
```

`MA` alone means `SMA`.

- [ ] **Step 1: Write the failing table-driven test**

```ts
import { describe, expect, it } from 'vitest';
import { parseMessage, type Intent } from './parse.js';

const cases: [string, Intent][] = [
  ['bought LMND', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['Bought lmnd.', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['BOUGHT $LMND', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['buy brk.b', { kind: 'add-holding', symbol: 'BRK.B', direction: 'LONG' }],
  ['long NVDA', { kind: 'add-holding', symbol: 'NVDA', direction: 'LONG' }],
  ['I just bought some LMND', { kind: 'add-holding', symbol: 'LMND', direction: 'LONG' }],
  ['short TSLA', { kind: 'add-holding', symbol: 'TSLA', direction: 'SHORT' }],
  ['shorted tsla!', { kind: 'add-holding', symbol: 'TSLA', direction: 'SHORT' }],
  ['sold LMND', { kind: 'remove-holding', symbol: 'LMND' }],
  ['sell lmnd', { kind: 'remove-holding', symbol: 'LMND' }],
  ['closed TSLA', { kind: 'remove-holding', symbol: 'TSLA' }],
  ['covered tsla', { kind: 'remove-holding', symbol: 'TSLA' }],
  ['I sold all my LMND', { kind: 'remove-holding', symbol: 'LMND' }],
  ['watch NVDA', { kind: 'watch', symbol: 'NVDA' }],
  ['unwatch nvda', { kind: 'unwatch', symbol: 'NVDA' }],
  ['is GOOGL above 150 SMA', { kind: 'ma-check', symbol: 'GOOGL', comparator: 'above', period: 150, average: 'SMA' }],
  ['is googl above the 150 sma?', { kind: 'ma-check', symbol: 'GOOGL', comparator: 'above', period: 150, average: 'SMA' }],
  ['Is GOOGL above 150sma', { kind: 'ma-check', symbol: 'GOOGL', comparator: 'above', period: 150, average: 'SMA' }],
  ['is nvda below 50 ema', { kind: 'ma-check', symbol: 'NVDA', comparator: 'below', period: 50, average: 'EMA' }],
  ['is nvda under its 200-day ma', { kind: 'ma-check', symbol: 'NVDA', comparator: 'below', period: 200, average: 'SMA' }],
  ['is AAPL over 20 day sma', { kind: 'ma-check', symbol: 'AAPL', comparator: 'above', period: 20, average: 'SMA' }],
  // Not a ticker shape (more than 5 letters) → a prompt, not an error.
  ['bought some lemonade', { kind: 'unknown' }],
  // Two candidate tickers is ambiguous → prompt.
  ['bought LMND and TSLA', { kind: 'unknown' }],
  ['what do you think about my portfolio?', { kind: 'unknown' }],
  ['', { kind: 'unknown' }],
  ['   ', { kind: 'unknown' }],
  ['is GOOGL above 0 SMA', { kind: 'unknown' }],
  ['watch', { kind: 'unknown' }],
];

describe('parseMessage', () => {
  it.each(cases)('%j', (text, expected) => {
    expect(parseMessage(text)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx vitest run src/assistant/parse.spec.ts`
Expected: FAIL — cannot find module `./parse.js`.

- [ ] **Step 3: Implement**

```ts
/**
 * Turns one chat message into what Trader should do with it.
 *
 * Deliberately not AI: a small set of plain patterns, each pinned by a test.
 * Anything that does not match exactly is `unknown`, and the caller turns it
 * into a Gemini prompt — so a miss costs the owner a copy-paste, never a
 * wrong write to his holdings.
 */
export type Direction = 'LONG' | 'SHORT';

export type Intent =
  | { kind: 'add-holding'; symbol: string; direction: Direction }
  | { kind: 'remove-holding'; symbol: string }
  | { kind: 'watch'; symbol: string }
  | { kind: 'unwatch'; symbol: string }
  | {
      kind: 'ma-check';
      symbol: string;
      comparator: 'above' | 'below';
      period: number;
      average: 'SMA' | 'EMA';
    }
  | { kind: 'unknown' };

const UNKNOWN: Intent = { kind: 'unknown' };

/** US tickers are at most five letters, plus an optional share-class suffix. */
const TICKER = /^\$?([a-z]{1,5}(?:\.[a-z])?)$/;

const FILLER = new Set(['i', 'just', 'some', 'all', 'my', 'the', 'of', 'more', 'shares', 'a']);

const VERBS: Record<string, (symbol: string) => Intent> = {
  bought: (s) => ({ kind: 'add-holding', symbol: s, direction: 'LONG' }),
  buy: (s) => ({ kind: 'add-holding', symbol: s, direction: 'LONG' }),
  long: (s) => ({ kind: 'add-holding', symbol: s, direction: 'LONG' }),
  short: (s) => ({ kind: 'add-holding', symbol: s, direction: 'SHORT' }),
  shorted: (s) => ({ kind: 'add-holding', symbol: s, direction: 'SHORT' }),
  sold: (s) => ({ kind: 'remove-holding', symbol: s }),
  sell: (s) => ({ kind: 'remove-holding', symbol: s }),
  closed: (s) => ({ kind: 'remove-holding', symbol: s }),
  covered: (s) => ({ kind: 'remove-holding', symbol: s }),
  watch: (s) => ({ kind: 'watch', symbol: s }),
  unwatch: (s) => ({ kind: 'unwatch', symbol: s }),
};

const MA_CHECK =
  /^is \$?([a-z]{1,5}(?:\.[a-z])?) (above|over|below|under) (?:the |its )?(\d{1,4})(?:[ -]?day)? ?(sma|ema|ma)$/;

export function parseMessage(text: string): Intent {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[?!,]+/g, ' ')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === '') return UNKNOWN;

  const ma = MA_CHECK.exec(normalized);
  if (ma) {
    const period = Number(ma[3]);
    if (!(period > 0)) return UNKNOWN;
    return {
      kind: 'ma-check',
      symbol: ma[1].toUpperCase(),
      comparator: ma[2] === 'above' || ma[2] === 'over' ? 'above' : 'below',
      period,
      average: ma[4] === 'ema' ? 'EMA' : 'SMA',
    };
  }

  const words = normalized.split(' ').filter((w) => !FILLER.has(w));
  if (words.length !== 2) return UNKNOWN;
  const verb = VERBS[words[0]];
  const ticker = TICKER.exec(words[1]);
  if (!verb || !ticker) return UNKNOWN;
  return verb(ticker[1].toUpperCase());
}
```

Note: "bought LMND and TSLA" leaves 4 words after filler removal → unknown, as the test requires.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx vitest run src/assistant/parse.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/assistant
git commit -m "feat(assistant): parse chat messages into intents"
```

---

### Task 4: Assistant endpoint — execute intents, MA answer, prompt fallback

**Files:**
- Create: `backend/src/market-data/moving-average.ts` (+ `.spec.ts`), `backend/src/assistant/prompt.ts` (+ `.spec.ts`), `backend/src/assistant/assistant.service.ts`, `assistant.controller.ts`, `assistant.dto.ts`, `assistant.module.ts`, `backend/test/assistant.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `parseMessage`/`Intent` (Task 3); `HoldingsService.find/set/remove/list` (Task 2); `WatchlistService.add/remove/list` (Task 1); `MarketDataService.getQuote(symbol): Promise<Quote | null>` where `Quote = { symbol, name, price, stale, session: 'PRE'|'REGULAR'|'POST'|'OVERNIGHT'|'CLOSED', extended, ... }`; `HistoryService.ensurePriced(instrument, symbol)`, `HistoryService.ensureFresh()`; `InstrumentsService.findOrCreate(symbol)`.
- Produces: `movingAverage(closes: number[], period: number, kind: 'SMA' | 'EMA'): number | null`; `buildPrompt(input: { message: string; date: string; holdings: { symbol: string; direction: 'LONG' | 'SHORT' }[]; watchlist: string[] }): string`; `POST /api/assistant { text }` returning `AssistantReply`:

```ts
export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'confirm'; message: string; action: { symbol: string; direction: 'LONG' | 'SHORT'; label: string } }
  | {
      kind: 'answer';
      message: string;
      facts: {
        symbol: string;
        price: number;
        stale: boolean;
        session: string | null; // 'pre-market' | 'after-hours' | 'overnight' | null
        average: 'SMA' | 'EMA';
        period: number;
        value: number;
        percentFrom: number; // signed fraction: 0.052 = 5.2% above
      };
    }
  | { kind: 'prompt'; text: string }
  | { kind: 'error'; message: string };
```

Exact reply messages (frontend shows them verbatim):

| Situation | kind | message |
|---|---|---|
| new holding | done | `Added LMND (long) to your holdings.` |
| already held same way | done | `You already hold LMND long.` |
| held the other way | confirm | `You hold LMND short. Flip it to long?` with `action = { symbol: 'LMND', direction: 'LONG', label: 'Flip to long' }` |
| removed | done | `Removed LMND from your holdings.` |
| remove not held | error | `You don't hold LMND.` |
| watched | done | `Watching NVDA.` |
| already watched | done | `NVDA is already on your watchlist.` |
| unwatched | done | `Stopped watching NVDA.` |
| unwatch not watched | error | `NVDA isn't on your watchlist.` |
| unknown ticker (add/watch/MA) | error | `I don't know the ticker LMNDD.` |
| MA, condition true | answer | `Yes. GOOGL ($180.00) is 5.20% above its 150-day SMA ($171.10).` |
| MA, condition false | answer | `No. GOOGL ($180.00) is 2.10% below its 150-day SMA ($183.86).` |
| MA suffix when stale | answer | message + ` The price is stale.` |
| MA suffix when PRE/POST/OVERNIGHT and not stale | answer | message + ` The price is pre-market.` / `after-hours.` / `overnight.` |
| MA, no price | error | `Couldn't get GOOGL's price right now.` |
| MA, too little history | error | `Not enough history for a 300-day SMA on GOOGL.` |

"Condition true" means: asked `above` and price ≥ average, or asked `below` and price < average. The sentence always states the actual side (`above`/`below`) and `Math.abs(percentFrom) * 100` to 2 decimals.

- [ ] **Step 1: Failing unit tests for `movingAverage` and `buildPrompt`**

`moving-average.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { movingAverage } from './moving-average.js';

describe('movingAverage', () => {
  it('SMA is the mean of the last N closes', () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3, 'SMA')).toBeCloseTo(4);
  });
  it('returns null with fewer closes than the period', () => {
    expect(movingAverage([1, 2], 3, 'SMA')).toBeNull();
    expect(movingAverage([1, 2], 3, 'EMA')).toBeNull();
  });
  it('EMA seeds with the SMA of the first N, then smooths with k = 2/(N+1)', () => {
    // seed = mean(1,2,3) = 2; k = 0.5; 4 → 3; 5 → 4
    expect(movingAverage([1, 2, 3, 4, 5], 3, 'EMA')).toBeCloseTo(4);
    // seed = mean(10,10) = 10; k = 2/3; 13 → 12
    expect(movingAverage([10, 10, 13], 2, 'EMA')).toBeCloseTo(12);
  });
  it('rejects a non-positive period', () => {
    expect(movingAverage([1, 2, 3], 0, 'SMA')).toBeNull();
  });
});
```

`prompt.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt.js';

describe('buildPrompt', () => {
  it('carries the date, holdings with direction, watchlist and the message verbatim', () => {
    expect(
      buildPrompt({
        message: 'What do you think about my semis exposure?',
        date: '2026-10-28',
        holdings: [
          { symbol: 'LMND', direction: 'LONG' },
          { symbol: 'TSLA', direction: 'SHORT' },
        ],
        watchlist: ['AMD', 'NVDA'],
      }),
    ).toBe(
      [
        'Date: 2026-10-28',
        '',
        'My holdings: LMND (long), TSLA (short)',
        'My watchlist: AMD, NVDA',
        '',
        'My question:',
        'What do you think about my semis exposure?',
      ].join('\n'),
    );
  });

  it('says none for empty lists', () => {
    const text = buildPrompt({ message: 'hi', date: '2026-10-28', holdings: [], watchlist: [] });
    expect(text).toContain('My holdings: none');
    expect(text).toContain('My watchlist: none');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx vitest run src/market-data/moving-average.spec.ts src/assistant/prompt.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both**

`moving-average.ts`:

```ts
/**
 * Simple or exponential moving average of the last `period` closes.
 *
 * Null when there are fewer closes than the period: averaging what history
 * exists would be a plausible number that is not the thing it claims to be.
 * Pure; the caller supplies closes oldest first.
 */
export function movingAverage(
  closes: number[],
  period: number,
  kind: 'SMA' | 'EMA',
): number | null {
  if (!(period > 0) || closes.length < period) return null;
  if (kind === 'SMA') {
    const window = closes.slice(-period);
    return window.reduce((sum, c) => sum + c, 0) / period;
  }
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((sum, c) => sum + c, 0) / period;
  for (const close of closes.slice(period)) ema = close * k + ema * (1 - k);
  return ema;
}
```

`prompt.ts`:

```ts
/**
 * The text the owner pastes into his Gemini conversation when Trader cannot
 * answer by itself. Minimal by design — prompt content is a later session
 * (docs/superpowers/specs/2026-10-28-trader-rebuild-design.md).
 */
export function buildPrompt(input: {
  message: string;
  date: string;
  holdings: { symbol: string; direction: 'LONG' | 'SHORT' }[];
  watchlist: string[];
}): string {
  const holdings = input.holdings.length
    ? input.holdings.map((h) => `${h.symbol} (${h.direction.toLowerCase()})`).join(', ')
    : 'none';
  const watchlist = input.watchlist.length ? input.watchlist.join(', ') : 'none';
  return [
    `Date: ${input.date}`,
    '',
    `My holdings: ${holdings}`,
    `My watchlist: ${watchlist}`,
    '',
    'My question:',
    input.message,
  ].join('\n');
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `cd backend && npx vitest run src/market-data/moving-average.spec.ts src/assistant/prompt.spec.ts`
Expected: PASS.

- [ ] **Step 5: Failing e2e spec** (`backend/test/assistant.e2e-spec.ts`)

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { http, login } from './http.js';
import { AppModule } from '../src/app.module.js';
import { YahooClient } from '../src/market-data/yahoo.client.js';
import { yahooStub } from './yahoo-stub.js';

describe('Assistant (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const stub = yahooStub();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(YahooClient)
      .useValue(stub)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    token = await login(app);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE holdings, watchlist_items, daily_closes RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  const say = (text: string) => http(app, token).post('/assistant').send({ text }).expect(201);

  /** `count` daily closes for `symbol`, each at `close`, ending yesterday. */
  async function seedCloses(symbol: string, count: number, close: number) {
    await http(app, token).post('/watchlist').send({ symbol }).expect(201);
    const [{ id }] = await dataSource.query('SELECT id FROM instruments WHERE symbol = $1', [symbol]);
    for (let i = 0; i < count; i++) {
      const date = new Date(Date.now() - (count - i) * 86_400_000).toISOString().slice(0, 10);
      await dataSource.query(
        `INSERT INTO daily_closes ("instrumentId", date, close, "adjClose") VALUES ($1, $2, $3, $3)
         ON CONFLICT ("instrumentId", date) DO NOTHING`,
        [id, date, close],
      );
    }
  }

  it('adds, confirms a flip, and removes holdings', async () => {
    expect((await say('bought LMND')).body).toEqual({ kind: 'done', message: 'Added LMND (long) to your holdings.' });
    expect((await say('bought lmnd')).body).toEqual({ kind: 'done', message: 'You already hold LMND long.' });
    expect((await say('short LMND')).body).toEqual({
      kind: 'confirm',
      message: 'You hold LMND long. Flip it to short?',
      action: { symbol: 'LMND', direction: 'SHORT', label: 'Flip to short' },
    });
    // The confirm did not change anything by itself.
    expect((await http(app, token).get('/holdings')).body[0].direction).toBe('LONG');
    expect((await say('sold LMND')).body).toEqual({ kind: 'done', message: 'Removed LMND from your holdings.' });
    expect((await say('sold LMND')).body).toEqual({ kind: 'error', message: "You don't hold LMND." });
  });

  it('refuses an unknown ticker without saving it', async () => {
    expect((await say('bought ZZZZ')).body).toEqual({ kind: 'error', message: "I don't know the ticker ZZZZ." });
    expect((await http(app, token).get('/holdings')).body).toEqual([]);
  });

  it('watches and unwatches', async () => {
    expect((await say('watch NVDA')).body).toEqual({ kind: 'done', message: 'Watching NVDA.' });
    expect((await say('watch nvda')).body).toEqual({ kind: 'done', message: 'NVDA is already on your watchlist.' });
    expect((await say('unwatch NVDA')).body).toEqual({ kind: 'done', message: 'Stopped watching NVDA.' });
    expect((await say('unwatch NVDA')).body).toEqual({ kind: 'error', message: "NVDA isn't on your watchlist." });
  });

  it('answers an SMA check from stored closes', async () => {
    // GOOGL quotes at 180 in the stub; 150 closes at 160 → 12.50% above.
    await seedCloses('GOOGL', 150, 160);
    const res = await say('is GOOGL above 150 SMA?');
    expect(res.body.kind).toBe('answer');
    expect(res.body.message).toBe('Yes. GOOGL ($180.00) is 12.50% above its 150-day SMA ($160.00).');
    expect(res.body.facts).toMatchObject({ symbol: 'GOOGL', price: 180, average: 'SMA', period: 150, value: 160, stale: false, session: null });
    expect(res.body.facts.percentFrom).toBeCloseTo(0.125);
    expect((await say('is googl below 150 sma')).body.message).toBe(
      'No. GOOGL ($180.00) is 12.50% above its 150-day SMA ($160.00).',
    );
  });

  it('says when there is not enough history', async () => {
    await seedCloses('GOOGL', 40, 160);
    expect((await say('is GOOGL above 300 SMA')).body).toEqual({
      kind: 'error',
      message: 'Not enough history for a 300-day SMA on GOOGL.',
    });
  });

  it('answers with a stale price when the provider fails after a recent quote', async () => {
    await seedCloses('GOOGL', 150, 160);
    await say('is GOOGL above 150 SMA'); // primes the quote cache
    const original = stub.quote;
    stub.quote = async () => {
      throw new Error('provider down');
    };
    try {
      const res = await say('is GOOGL above 150 SMA');
      expect(res.body.kind).toBe('answer');
      expect(res.body.message).toMatch(/ The price is stale\.$/);
      expect(res.body.facts.stale).toBe(true);
    } finally {
      stub.quote = original;
    }
  });

  it('turns anything else into a prompt with holdings and watchlist', async () => {
    await say('bought LMND');
    await say('short TSLA');
    await say('watch NVDA');
    const res = await say('what do you think about my portfolio?');
    expect(res.body.kind).toBe('prompt');
    expect(res.body.text).toContain('My holdings: LMND (long), TSLA (short)');
    expect(res.body.text).toContain('My watchlist: NVDA');
    expect(res.body.text).toContain('My question:\nwhat do you think about my portfolio?');
    expect(res.body.text).toMatch(/^Date: \d{4}-\d{2}-\d{2}/);
  });

  it('rejects an empty or oversized message', async () => {
    await http(app, token).post('/assistant').send({ text: '' }).expect(400);
    await http(app, token).post('/assistant').send({ text: 'x'.repeat(2001) }).expect(400);
  });
});
```

Why the price cases look like this: the MA check calls `getQuote(symbol, true)` so a cached price never masks an outage. When the provider throws and a cached quote exists, `getQuote` returns that quote marked `stale: true` — Trader answers with the stale suffix (pinned above). Only a null quote means "no price"; that branch is pinned by the service unit test in Step 7, because in e2e a never-quoted symbol with a failing provider is rejected earlier as an unknown ticker.

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/assistant.e2e-spec.ts`
Expected: FAIL — 404 on `/assistant`.

- [ ] **Step 7: Implement DTO, service, controller, module**

`assistant.dto.ts`:

```ts
import { IsString, Length } from 'class-validator';

export class AssistantDto {
  @IsString()
  @Length(1, 2000)
  text: string;
}
```

`assistant.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parseMessage, type Intent } from './parse.js';
import { buildPrompt } from './prompt.js';
import { HoldingsService } from '../holdings/holdings.service.js';
import { WatchlistService } from '../watchlist/watchlist.service.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { MarketDataService } from '../market-data/market-data.service.js';
import { HistoryService } from '../market-data/history.service.js';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { movingAverage } from '../market-data/moving-average.js';

export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'confirm'; message: string; action: { symbol: string; direction: 'LONG' | 'SHORT'; label: string } }
  | {
      kind: 'answer';
      message: string;
      facts: {
        symbol: string;
        price: number;
        stale: boolean;
        session: string | null;
        average: 'SMA' | 'EMA';
        period: number;
        value: number;
        percentFrom: number;
      };
    }
  | { kind: 'prompt'; text: string }
  | { kind: 'error'; message: string };

const SESSION_WORD: Record<string, string> = {
  PRE: 'pre-market',
  POST: 'after-hours',
  OVERNIGHT: 'overnight',
};

const usd = (n: number) => `$${n.toFixed(2)}`;

@Injectable()
export class AssistantService {
  constructor(
    private readonly holdings: HoldingsService,
    private readonly watchlist: WatchlistService,
    private readonly instruments: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly history: HistoryService,
    @InjectRepository(DailyClose) private readonly closes: Repository<DailyClose>,
  ) {}

  async handle(text: string, now: Date = new Date()): Promise<AssistantReply> {
    const intent = parseMessage(text);
    try {
      return await this.execute(intent, text, now);
    } catch (err) {
      if (err instanceof NotFoundException && 'symbol' in intent) {
        return { kind: 'error', message: `I don't know the ticker ${intent.symbol}.` };
      }
      throw err;
    }
  }

  private async execute(intent: Intent, text: string, now: Date): Promise<AssistantReply> {
    switch (intent.kind) {
      case 'add-holding': {
        const held = await this.holdings.find(intent.symbol);
        const word = intent.direction.toLowerCase();
        if (held === intent.direction) {
          return { kind: 'done', message: `You already hold ${intent.symbol} ${word}.` };
        }
        if (held !== null) {
          return {
            kind: 'confirm',
            message: `You hold ${intent.symbol} ${held.toLowerCase()}. Flip it to ${word}?`,
            action: { symbol: intent.symbol, direction: intent.direction, label: `Flip to ${word}` },
          };
        }
        const res = await this.holdings.set(intent.symbol, intent.direction);
        return { kind: 'done', message: `Added ${res.symbol} (${word}) to your holdings.` };
      }
      case 'remove-holding':
        return (await this.holdings.remove(intent.symbol))
          ? { kind: 'done', message: `Removed ${intent.symbol} from your holdings.` }
          : { kind: 'error', message: `You don't hold ${intent.symbol}.` };
      case 'watch': {
        const res = await this.watchlist.add(intent.symbol);
        return res.added
          ? { kind: 'done', message: `Watching ${res.symbol}.` }
          : { kind: 'done', message: `${res.symbol} is already on your watchlist.` };
      }
      case 'unwatch':
        return (await this.watchlist.remove(intent.symbol))
          ? { kind: 'done', message: `Stopped watching ${intent.symbol}.` }
          : { kind: 'error', message: `${intent.symbol} isn't on your watchlist.` };
      case 'ma-check':
        return this.maCheck(intent);
      case 'unknown':
        return {
          kind: 'prompt',
          text: buildPrompt({
            message: text.trim(),
            date: now.toISOString().slice(0, 10),
            holdings: (await this.holdings.list()).map((h) => ({ symbol: h.symbol, direction: h.direction })),
            watchlist: (await this.watchlist.list()).map((w) => w.symbol),
          }),
        };
    }
  }

  private async maCheck(intent: Extract<Intent, { kind: 'ma-check' }>): Promise<AssistantReply> {
    const { symbol, period, average, comparator } = intent;
    const instrument = await this.instruments.findOrCreate(symbol); // unknown → NotFoundException
    await this.history.ensurePriced(instrument, instrument.symbol);
    await this.history.ensureFresh();
    // force: a cached price must never hide an outage; getQuote marks its fallback stale.
    const quote = await this.marketData.getQuote(instrument.symbol, true);
    if (!quote) return { kind: 'error', message: `Couldn't get ${instrument.symbol}'s price right now.` };

    const rows = await this.closes.find({
      where: { instrumentId: instrument.id },
      order: { date: 'ASC' },
    });
    const value = movingAverage(rows.map((r) => r.close), period, average);
    if (value === null) {
      return { kind: 'error', message: `Not enough history for a ${period}-day ${average} on ${instrument.symbol}.` };
    }

    const percentFrom = (quote.price - value) / value;
    const side = quote.price >= value ? 'above' : 'below';
    const session = quote.stale ? null : SESSION_WORD[quote.session] ?? null;
    let message =
      `${side === comparator ? 'Yes' : 'No'}. ${instrument.symbol} (${usd(quote.price)}) is ` +
      `${(Math.abs(percentFrom) * 100).toFixed(2)}% ${side} its ${period}-day ${average} (${usd(value)}).`;
    if (quote.stale) message += ' The price is stale.';
    else if (session) message += ` The price is ${session}.`;

    return {
      kind: 'answer',
      message,
      facts: { symbol: instrument.symbol, price: quote.price, stale: quote.stale, session, average, period, value, percentFrom },
    };
  }
}
```

`assistant.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { AssistantService } from './assistant.service.js';
import { AssistantDto } from './assistant.dto.js';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  handle(@Body() body: AssistantDto) {
    return this.assistant.handle(body.text);
  }
}
```

`assistant.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyClose } from '../market-data/daily-close.entity.js';
import { AssistantService } from './assistant.service.js';
import { AssistantController } from './assistant.controller.js';
import { HoldingsModule } from '../holdings/holdings.module.js';
import { WatchlistModule } from '../watchlist/watchlist.module.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { MarketDataModule } from '../market-data/market-data.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyClose]),
    HoldingsModule,
    WatchlistModule,
    InstrumentsModule,
    MarketDataModule,
  ],
  providers: [AssistantService],
  controllers: [AssistantController],
})
export class AssistantModule {}
```

Add `AssistantModule` to `app.module.ts` imports.

Add `backend/src/assistant/assistant.service.spec.ts` with one case for the null-quote branch:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from './assistant.service.js';

describe('AssistantService.maCheck', () => {
  it("says it couldn't get a price when the provider has none", async () => {
    const service = new AssistantService(
      {} as never,
      {} as never,
      { findOrCreate: vi.fn(async () => ({ id: 'i1', symbol: 'GOOGL' })) } as never,
      { getQuote: vi.fn(async () => null) } as never,
      { ensurePriced: vi.fn(), ensureFresh: vi.fn() } as never,
      { find: vi.fn() } as never,
    );
    expect(await service.handle('is GOOGL above 150 SMA')).toEqual({
      kind: 'error',
      message: "Couldn't get GOOGL's price right now.",
    });
  });
});
```

- [ ] **Step 8: Run all backend suites**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json && npm test && npm run test:e2e`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(assistant): POST /assistant — holdings, watchlist, MA check, Gemini prompt"
```

---

### Task 5: Strip the frontend; new shell, routes, Holdings and Watchlist screens

**Files:**
- Delete: everything under `frontend/src` not in the File Map's "kept" list (all other routes, components, `components/brief`, `components/chart`, `api/dailyBrief.ts`, `api/settings.ts`, `api/streamNdjson*`, all other `lib/*` files and their specs).
- Rewrite: `frontend/src/main.tsx`, `frontend/src/components/AppShell.tsx`, `frontend/src/components/AppShell.spec.tsx`
- Create: `frontend/src/api/lists.ts`, `frontend/src/routes/Holdings.tsx` (+ `.spec.tsx`), `frontend/src/routes/Watchlist.tsx` (+ `.spec.tsx`), placeholder `frontend/src/routes/Chat.tsx` (replaced in Task 6)

**Interfaces:**
- Consumes: `GET/PUT/DELETE /holdings`, `GET/POST/DELETE /watchlist` (Tasks 1–2).
- Produces (`api/lists.ts`):

```ts
export type Direction = 'LONG' | 'SHORT';
export interface HoldingRow { symbol: string; name: string | null; direction: Direction }
export interface WatchRow { symbol: string; name: string | null }
export const HOLDINGS_KEY = ['holdings'] as const;
export const WATCHLIST_KEY = ['watchlist'] as const;
export function useHoldings(): UseQueryResult<HoldingRow[]>;
export function useWatchlist(): UseQueryResult<WatchRow[]>;
export function setHolding(symbol: string, direction: Direction): Promise<unknown>;
export function removeHolding(symbol: string): Promise<unknown>;
export function addWatch(symbol: string): Promise<unknown>;
export function removeWatch(symbol: string): Promise<unknown>;
```

- [ ] **Step 1: Delete unkept files**

From `frontend/src`, delete every file not listed as kept. Then:
Run: `cd frontend && ls -R src`
Expected: only the kept files plus the ones this task creates.

- [ ] **Step 2: `api/lists.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export type Direction = 'LONG' | 'SHORT';
export interface HoldingRow {
  symbol: string;
  name: string | null;
  direction: Direction;
}
export interface WatchRow {
  symbol: string;
  name: string | null;
}

export const HOLDINGS_KEY = ['holdings'] as const;
export const WATCHLIST_KEY = ['watchlist'] as const;

export function useHoldings() {
  return useQuery({ queryKey: HOLDINGS_KEY, queryFn: () => api<HoldingRow[]>('/holdings') });
}

export function useWatchlist() {
  return useQuery({ queryKey: WATCHLIST_KEY, queryFn: () => api<WatchRow[]>('/watchlist') });
}

const enc = (s: string) => encodeURIComponent(s.trim().toUpperCase());

export const setHolding = (symbol: string, direction: Direction) =>
  api(`/holdings/${enc(symbol)}`, { method: 'PUT', body: JSON.stringify({ direction }) });
export const removeHolding = (symbol: string) => api(`/holdings/${enc(symbol)}`, { method: 'DELETE' });
export const addWatch = (symbol: string) =>
  api('/watchlist', { method: 'POST', body: JSON.stringify({ symbol: symbol.trim() }) });
export const removeWatch = (symbol: string) => api(`/watchlist/${enc(symbol)}`, { method: 'DELETE' });
```

- [ ] **Step 3: Failing spec for the shell's navigation** (`AppShell.spec.tsx`, replacing the old file)

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';

vi.mock('../api/client', () => ({
  api: vi.fn(() => Promise.resolve({ status: 'ok' })),
}));

afterEach(cleanup);

it('offers exactly Chat, Holdings and Watch', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>chat content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('chat content')).toBeInTheDocument();
  const links = screen.getAllByRole('link').map((a) => a.textContent);
  expect(links).toEqual(['Chat', 'Holdings', 'Watch']);
});
```

- [ ] **Step 4: Rewrite `AppShell.tsx`**

Keep `ConnectionBanner` and the header exactly as they are; remove the Brief prefetch (`useEffect`, `useQueryClient`, `dailyBrief` import); replace the nav links with:

```tsx
<nav className="flex justify-around border-b border-border px-2">
  <NavLink to="/" className={linkClass} end>
    Chat
  </NavLink>
  <NavLink to="/holdings" className={linkClass}>
    Holdings
  </NavLink>
  <NavLink to="/watchlist" className={linkClass}>
    Watch
  </NavLink>
</nav>
```

- [ ] **Step 5: Failing specs for Holdings and Watchlist**

`routes/Holdings.spec.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Holdings } from './Holdings';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Holdings />
    </QueryClientProvider>,
  );

it('lists holdings with their direction', async () => {
  vi.mocked(api).mockResolvedValue([
    { symbol: 'LMND', name: 'Lemonade', direction: 'LONG' },
    { symbol: 'TSLA', name: 'Tesla', direction: 'SHORT' },
  ]);
  renderIt();
  expect(await screen.findByTestId('holding-LMND')).toHaveTextContent('Long');
  expect(screen.getByTestId('holding-TSLA')).toHaveTextContent('Short');
});

it('explains an empty list and points at the chat', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  expect(await screen.findByText(/No holdings yet/)).toBeInTheDocument();
});

it('adds a holding as long or short', async () => {
  vi.mocked(api).mockResolvedValue([]);
  renderIt();
  await userEvent.type(await screen.findByPlaceholderText('Ticker'), 'lmnd');
  await userEvent.click(screen.getByRole('button', { name: 'Add short' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'PUT', body: JSON.stringify({ direction: 'SHORT' }) }),
  );
});

it('removes only after edit mode and a second tap', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'LMND', name: null, direction: 'LONG' }]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(api).not.toHaveBeenCalledWith('/holdings/LMND', { method: 'DELETE' });
  await userEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'DELETE' }));
});

it('flips direction in edit mode', async () => {
  vi.mocked(api).mockResolvedValue([{ symbol: 'LMND', name: null, direction: 'LONG' }]);
  renderIt();
  await screen.findByTestId('holding-LMND');
  await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Flip to short' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'PUT', body: JSON.stringify({ direction: 'SHORT' }) }),
  );
});
```

`routes/Watchlist.spec.tsx`: same harness, rendering `<Watchlist />`, with cases: lists symbols (`watch-NVDA` test id contains `NVDA`); empty state `/Nothing watched yet/`; typing `nvda` in placeholder `Ticker` and clicking `Watch` calls `api('/watchlist', { method: 'POST', body: JSON.stringify({ symbol: 'nvda' }) })`; remove requires `Edit watchlist` → `Remove` → `Confirm remove`, then `api('/watchlist/NVDA', { method: 'DELETE' })`. Write each case out in full, mirroring the Holdings spec above.

- [ ] **Step 6: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/components/AppShell.spec.tsx src/routes/Holdings.spec.tsx src/routes/Watchlist.spec.tsx`
Expected: FAIL — modules/elements missing.

- [ ] **Step 7: Implement `Holdings.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { EditModeToggle } from '../components/ui/EditModeToggle';
import { inputClasses } from '../components/ui/inputClasses';
import { HOLDINGS_KEY, removeHolding, setHolding, useHoldings, type Direction } from '../api/lists';

export function Holdings() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useHoldings();
  const [symbol, setSymbol] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: HOLDINGS_KEY });

  const add = useMutation({
    mutationFn: (direction: Direction) => setHolding(symbol, direction),
    onSuccess: () => {
      setSymbol('');
      void refresh();
    },
  });
  const flip = useMutation({
    mutationFn: (v: { symbol: string; direction: Direction }) => setHolding(v.symbol, v.direction),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (s: string) => removeHolding(s),
    onSuccess: () => {
      setConfirming(null);
      void refresh();
    },
  });

  const canAdd = symbol.trim() !== '' && !add.isPending;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Holdings</h1>
        <EditModeToggle on={editing} onChange={setEditing} noun="holdings" />
      </div>

      <div className="flex gap-2">
        <input
          className={inputClasses('md', 'uppercase')}
          placeholder="Ticker"
          value={symbol}
          autoCapitalize="characters"
          autoCorrect="off"
          onChange={(e) => setSymbol(e.target.value)}
        />
        <Button variant="accent" disabled={!canAdd} onClick={() => add.mutate('LONG')}>
          Add long
        </Button>
        <Button variant="secondary" disabled={!canAdd} onClick={() => add.mutate('SHORT')}>
          Add short
        </Button>
      </div>
      {add.isError && <p className="text-sm text-down">{(add.error as Error).message}</p>}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {isError && <p className="text-sm text-down">Couldn’t load your holdings.</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-muted">No holdings yet. Tell the chat “bought LMND”, or add one above.</p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {data?.map((h) => {
          const other: Direction = h.direction === 'LONG' ? 'SHORT' : 'LONG';
          return (
            <li key={h.symbol} data-testid={`holding-${h.symbol}`} className="flex items-center gap-3 px-3 py-2.5">
              <span className="font-medium">{h.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted">{h.name}</span>
              <span className={`text-sm ${h.direction === 'LONG' ? 'text-up' : 'text-down'}`}>
                {h.direction === 'LONG' ? 'Long' : 'Short'}
              </span>
              {editing && confirming !== h.symbol && (
                <>
                  <Button onClick={() => flip.mutate({ symbol: h.symbol, direction: other })}>
                    {other === 'LONG' ? 'Flip to long' : 'Flip to short'}
                  </Button>
                  <Button onClick={() => setConfirming(h.symbol)}>Remove</Button>
                </>
              )}
              {editing && confirming === h.symbol && (
                <Button variant="danger" aria-label="Confirm remove" onClick={() => remove.mutate(h.symbol)}>
                  Remove {h.symbol}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

If `text-up`/`text-down` are not defined colour tokens in `index.css`, use the tokens that file defines for gains/losses (check with `grep -n "up\|down" frontend/src/index.css`).

- [ ] **Step 8: Implement `Watchlist.tsx`**

Same structure as Holdings: title "Watchlist", `EditModeToggle noun="watchlist"`, input with placeholder `Ticker` and one `Button variant="accent"` labelled `Watch` that calls `addWatch(symbol)` (send the raw trimmed input; the backend uppercases), empty state `Nothing watched yet. Tell the chat “watch NVDA”, or add one above.`, rows with `data-testid={`watch-${w.symbol}`}` showing symbol and name, and in edit mode `Remove` → `Confirm remove` calling `removeWatch(w.symbol)`. Write it out in full in the file; do not import from Holdings.

- [ ] **Step 9: Routes** (`main.tsx`) and a placeholder Chat

```tsx
import { Chat } from './routes/Chat';
import { Holdings } from './routes/Holdings';
import { Watchlist } from './routes/Watchlist';
import { Login } from './routes/Login';
// ...
<Routes>
  <Route path="login" element={<Login />} />
  <Route element={<AppShell />}>
    <Route index element={<Chat />} />
    <Route path="holdings" element={<Holdings />} />
    <Route path="watchlist" element={<Watchlist />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>
</Routes>
```

`routes/Chat.tsx` placeholder: `export function Chat() { return <section />; }`.

- [ ] **Step 10: Run frontend checks**

Run: `cd frontend && npx tsc -b && npm test`
Expected: PASS. Fix any kept file that still imports a deleted one by removing the dead import.

- [ ] **Step 11: Commit**

```bash
git add -A frontend
git commit -m "refactor(frontend): three-screen shell; symbol-only Holdings and Watchlist"
```

---

### Task 6: Chat screen

**Files:**
- Create: `frontend/src/api/assistant.ts`, `frontend/src/routes/Chat.spec.tsx`
- Rewrite: `frontend/src/routes/Chat.tsx`

**Interfaces:**
- Consumes: `POST /assistant` and `AssistantReply` (Task 4); `setHolding`, `HOLDINGS_KEY`, `WATCHLIST_KEY` (Task 5).
- Produces: `sendMessage(text: string): Promise<AssistantReply>` and the `AssistantReply` type in `api/assistant.ts` (copy the union from Task 4 exactly).

Behaviour:
- One `<textarea>` (placeholder `Talk to Trader — “bought LMND”, “is GOOGL above 150 SMA?”`, `rows={2}`, 16px text via `inputClasses('md')`) and a `Send` button (`variant="primary"`). Enter without Shift sends; Shift+Enter adds a newline. Send is disabled while empty or pending.
- On success: clear the input, show only the latest reply below, and invalidate `HOLDINGS_KEY` and `WATCHLIST_KEY`.
- On request failure: keep the input text and show `Couldn’t reach Trader. Try again.`
- Reply rendering by `kind`:
  - `done` / `answer`: the message as plain text.
  - `error`: the message in the loss colour.
  - `confirm`: the message, then `[action.label]` (primary) and `Cancel` (secondary). The action button calls `setHolding(action.symbol, action.direction)`, then shows `Flipped LMND to short.` (built as `Flipped ${symbol} to ${direction.toLowerCase()}.`) and invalidates `HOLDINGS_KEY`. Cancel clears the reply.
  - `prompt`: a small heading `Prompt for Gemini`, the text in a `<pre className="whitespace-pre-wrap">`, and a `Copy` button calling `navigator.clipboard.writeText(text)`; label becomes `Copied` for 2 s. If the clipboard call rejects, show `Copy failed — select the text and copy it manually.`

- [ ] **Step 1: Failing spec** (`routes/Chat.spec.tsx`)

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Chat } from './Chat';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../api/client';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Chat />
    </QueryClientProvider>,
  );
const box = () => screen.getByPlaceholderText(/Talk to Trader/);

it('sends on Enter, clears the box, and shows the reply', async () => {
  vi.mocked(api).mockResolvedValue({ kind: 'done', message: 'Added LMND (long) to your holdings.' });
  renderIt();
  await userEvent.type(box(), 'bought LMND{Enter}');
  expect(api).toHaveBeenCalledWith('/assistant', { method: 'POST', body: JSON.stringify({ text: 'bought LMND' }) });
  expect(await screen.findByText('Added LMND (long) to your holdings.')).toBeInTheDocument();
  expect(box()).toHaveValue('');
});

it('keeps the text when the request fails', async () => {
  vi.mocked(api).mockRejectedValue(new Error('network'));
  renderIt();
  await userEvent.type(box(), 'bought LMND{Enter}');
  expect(await screen.findByText(/Couldn’t reach Trader/)).toBeInTheDocument();
  expect(box()).toHaveValue('bought LMND');
});

it('flips only when the confirm button is tapped', async () => {
  vi.mocked(api).mockResolvedValueOnce({
    kind: 'confirm',
    message: 'You hold LMND long. Flip it to short?',
    action: { symbol: 'LMND', direction: 'SHORT', label: 'Flip to short' },
  });
  vi.mocked(api).mockResolvedValueOnce({ symbol: 'LMND', direction: 'SHORT', previous: 'LONG' });
  renderIt();
  await userEvent.type(box(), 'short LMND{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: 'Flip to short' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/holdings/LMND', { method: 'PUT', body: JSON.stringify({ direction: 'SHORT' }) }),
  );
  expect(await screen.findByText('Flipped LMND to short.')).toBeInTheDocument();
});

it('cancel clears a confirm without calling holdings', async () => {
  vi.mocked(api).mockResolvedValueOnce({
    kind: 'confirm',
    message: 'You hold LMND long. Flip it to short?',
    action: { symbol: 'LMND', direction: 'SHORT', label: 'Flip to short' },
  });
  renderIt();
  await userEvent.type(box(), 'short LMND{Enter}');
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText(/Flip it to short/)).toBeNull();
  expect(api).toHaveBeenCalledTimes(1);
});

it('shows a prompt with a working Copy button', async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  vi.mocked(api).mockResolvedValue({ kind: 'prompt', text: 'Date: 2026-10-28\n\nMy question:\nhello' });
  renderIt();
  await userEvent.type(box(), 'hello{Enter}');
  expect(await screen.findByText('Prompt for Gemini')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith('Date: 2026-10-28\n\nMy question:\nhello');
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

it('Shift+Enter adds a newline instead of sending', async () => {
  renderIt();
  await userEvent.type(box(), 'line one{Shift>}{Enter}{/Shift}line two');
  expect(api).not.toHaveBeenCalled();
  expect(box()).toHaveValue('line one\nline two');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/routes/Chat.spec.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `api/assistant.ts` and `Chat.tsx`**

`api/assistant.ts`:

```ts
import { api } from './client';

export type AssistantReply =
  | { kind: 'done'; message: string }
  | { kind: 'confirm'; message: string; action: { symbol: string; direction: 'LONG' | 'SHORT'; label: string } }
  | {
      kind: 'answer';
      message: string;
      facts: {
        symbol: string;
        price: number;
        stale: boolean;
        session: string | null;
        average: 'SMA' | 'EMA';
        period: number;
        value: number;
        percentFrom: number;
      };
    }
  | { kind: 'prompt'; text: string }
  | { kind: 'error'; message: string };

export const sendMessage = (text: string) =>
  api<AssistantReply>('/assistant', { method: 'POST', body: JSON.stringify({ text }) });
```

`routes/Chat.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/Button';
import { inputClasses } from '../components/ui/inputClasses';
import { sendMessage, type AssistantReply } from '../api/assistant';
import { HOLDINGS_KEY, WATCHLIST_KEY, setHolding } from '../api/lists';

type Shown = AssistantReply | { kind: 'flipped'; message: string };

export function Chat() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Shown | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: HOLDINGS_KEY });
    void queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });
  };

  const send = useMutation({
    mutationFn: (message: string) => sendMessage(message),
    onSuccess: (r) => {
      setText('');
      setCopy('idle');
      setReply(r);
      refresh();
    },
  });

  const flip = useMutation({
    mutationFn: (a: { symbol: string; direction: 'LONG' | 'SHORT' }) => setHolding(a.symbol, a.direction),
    onSuccess: (_res, a) => {
      setReply({ kind: 'flipped', message: `Flipped ${a.symbol} to ${a.direction.toLowerCase()}.` });
      refresh();
    },
  });

  const submit = () => {
    const message = text.trim();
    if (message && !send.isPending) send.mutate(message);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const copyPrompt = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopy('copied');
      setTimeout(() => setCopy('idle'), 2000);
    } catch {
      setCopy('failed');
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          className={inputClasses('md', 'resize-none')}
          placeholder="Talk to Trader — “bought LMND”, “is GOOGL above 150 SMA?”"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button variant="primary" size="lg" disabled={!text.trim() || send.isPending} onClick={submit}>
          Send
        </Button>
      </div>

      {send.isError && <p className="text-sm text-down">Couldn’t reach Trader. Try again.</p>}

      {reply && (
        <div className="rounded-lg border border-border bg-surface-1 p-3 text-sm">
          {(reply.kind === 'done' || reply.kind === 'answer' || reply.kind === 'flipped') && <p>{reply.message}</p>}
          {reply.kind === 'error' && <p className="text-down">{reply.message}</p>}
          {reply.kind === 'confirm' && (
            <div className="space-y-3">
              <p>{reply.message}</p>
              <div className="flex gap-2">
                <Button variant="primary" disabled={flip.isPending} onClick={() => flip.mutate(reply.action)}>
                  {reply.action.label}
                </Button>
                <Button onClick={() => setReply(null)}>Cancel</Button>
              </div>
              {flip.isError && <p className="text-down">{(flip.error as Error).message}</p>}
            </div>
          )}
          {reply.kind === 'prompt' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Prompt for Gemini</h2>
                <Button variant="accent" onClick={() => void copyPrompt(reply.text)}>
                  {copy === 'copied' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-muted">{reply.text}</pre>
              {copy === 'failed' && (
                <p className="text-down">Copy failed — select the text and copy it manually.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
```

If `bg-surface-1` or `text-down` are not tokens in `index.css`, use the ones it defines (they are used by `inputClasses.ts` and the old `AppShell` banner, so they should exist).

- [ ] **Step 4: Run frontend checks**

Run: `cd frontend && npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 5: Look at it on a real screen**

Start `npm run start:dev --prefix backend` (local `trader` DB is real data: read-only checks only — do not send add/remove messages against it; use a throwaway account created via `/api/auth/signup` against a local copy, or run against `trader_e2e` per `playwright.config.ts`) and `npm run dev --prefix frontend`; open `http://localhost:5173` at 402px width (Playwright `devices['iPhone 16 Pro']`), screenshot Chat with a prompt reply, Holdings and Watchlist, and fix layout issues (wrapping buttons, overflowing prompt text).

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(chat): one box to talk to Trader, with prompt copy and flip confirm"
```

---

### Task 7: Browser tests for the new flows

**Files:**
- Create: `e2e/chat.spec.ts`
- Modify: `e2e/helpers.ts`, `e2e/navigation.spec.ts`, `e2e/auth.spec.ts` (only where they reference removed screens)
- Delete: `e2e/composer.spec.ts`, `e2e/watchlist.spec.ts`

- [ ] **Step 1: Token probe** — in `e2e/helpers.ts` change the probe from `/api/settings` to `/api/holdings` and the error text to `/api/holdings returned ${status}`.

- [ ] **Step 2: Write `e2e/chat.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { signUpAndSignIn } from './helpers';

test.describe('the chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await signUpAndSignIn(page, 'chat');
    await page.goto('/');
  });

  const box = (page: import('@playwright/test').Page) => page.getByPlaceholder(/Talk to Trader/);

  test('a buy in chat shows up in Holdings, and a sale removes it', async ({ page }) => {
    await box(page).fill('bought NVDA');
    await box(page).press('Enter');
    await expect(page.getByText('Added NVDA (long) to your holdings.')).toBeVisible();
    await page.getByRole('link', { name: 'Holdings' }).click();
    await expect(page.getByTestId('holding-NVDA')).toContainText('Long');
    await page.getByRole('link', { name: 'Chat' }).click();
    await box(page).fill('sold NVDA');
    await box(page).press('Enter');
    await expect(page.getByText('Removed NVDA from your holdings.')).toBeVisible();
  });

  test('answers a moving-average question', async ({ page }) => {
    await box(page).fill('is NVDA above 150 SMA?');
    await box(page).press('Enter');
    // The browser server's stub gives flat bars at the quote price, so price == average.
    await expect(page.getByText(/^Yes\. NVDA \(\$200\.00\) is 0\.00% above its 150-day SMA/)).toBeVisible();
  });

  test('turns free text into a prompt that can be copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await box(page).fill('watch AAPL');
    await box(page).press('Enter');
    await expect(page.getByText('Watching AAPL.')).toBeVisible();
    await box(page).fill('what should I look at this week?');
    await box(page).press('Enter');
    await expect(page.getByText('Prompt for Gemini')).toBeVisible();
    await expect(page.locator('pre')).toContainText('My watchlist: AAPL');
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: /Copied|Copy/ })).toBeVisible();
  });
});
```

WebKit may refuse clipboard permissions; the last assertion accepts either label so the test checks the button exists and is tappable, while the unit test in Task 6 pins the copy behaviour.

- [ ] **Step 3: Update `navigation.spec.ts`** to assert the three nav links `Chat`, `Holdings`, `Watch` each load their screen (heading `Holdings`, heading `Watchlist`, the chat placeholder), replacing references to removed screens. Update `auth.spec.ts` only if it asserts a removed screen after login (it should now land on Chat).

- [ ] **Step 4: Run the browser suite**

Run: `npm run test:browser`
Expected: PASS. Read the full output.

- [ ] **Step 5: Commit**

```bash
git add -A e2e
git commit -m "test(e2e): chat, holdings and prompt flows on iPhone WebKit"
```

---

### Task 8: Documentation for the new product

**Files:**
- Modify: `AGENTS.md`, `docs/product-brief.md`, `docs/current-state.md`, `docs/api.md`, `docs/ai-configuration.md`, `docs/backlog.md`, `docs/DEPLOYMENT.md`, `render.yaml`

- [ ] **Step 1: `AGENTS.md`** — replace the "Product and data invariants" bullets about the journal, transactions, positions, cash, stops, and the Yahoo/Finnhub/LLM import boundaries with:
  - Trader knows what you hold (symbol + direction) and watch (symbol), never your numbers: no quantities, prices paid, cash, balances, P&L or performance.
  - No in-product AI calls. Anything Trader can't answer itself becomes a prompt for the owner's Gemini conversation (`backend/src/assistant/prompt.ts`).
  - The chat's parsing is deterministic (`backend/src/assistant/parse.ts`); a miss becomes a prompt, never a guessed write.
  - Keep: `usersService.currentUser()` rule, per-user `userId` filtering, stale prices labelled, `yahoo.client.ts` and `twelvedata.client.ts` as the only provider import boundaries, migrations registered by hand.
  Update the architecture map to `assistant/`, `holdings/`, `watchlist/`, `market-data/`, `instruments/`, `users/`, `auth/`, `database/` and frontend `routes/{Chat,Holdings,Watchlist,Login}`. Remove the `CollapsibleCard` UI-pattern bullet (file deleted). Remove the `trader-profile.md` reference from the routing table.
- [ ] **Step 2: `docs/product-brief.md`** — keep "Who this is for", "Purpose", "Principles" (drop the v1 three-things sentence); replace "The core product idea" with the spec's four principles; replace "Deliberately out of scope" with the spec's out-of-scope list.
- [ ] **Step 3: `docs/current-state.md`** — rewrite "Current product" to the three screens and the chat commands table; set **Last verified** to the date and files you checked; replace "Active checkpoints" with: owner tries the chat on his phone; prompt-design session; decide which question type to add next; decide whether to drop the old tables.
- [ ] **Step 4: `docs/api.md`** — document only `/auth/*`, `/health`, `/health/ping`, `/holdings`, `/watchlist`, `/assistant` (request/response shapes from Tasks 1, 2, 4).
- [ ] **Step 5: `docs/ai-configuration.md`** — reduce to: "Trader makes no in-product AI calls. Gemini is used by the owner directly with prompts Trader builds in `backend/src/assistant/prompt.ts`." Remove `LLM_*`/`GEMINI_API_KEY` from `render.yaml` and `docs/DEPLOYMENT.md` (step 3a), and the Finnhub section 4b (client deleted). Keep Twelve Data.
- [ ] **Step 6: `docs/backlog.md`** — remove items for deleted features; add "Next chat question types (price, earnings date, list scan) — add one at a time as the owner asks".
- [ ] **Step 7: Commit**

```bash
git add AGENTS.md docs render.yaml
git commit -m "docs: describe the chat, holdings and watchlist product"
```

---

### Task 9: Release (owner approval required before the push)

- [ ] **Step 1: Full verification**

Run: `npm test && npm run test:e2e --prefix backend && npm run test:browser && (cd backend && npx tsc -p tsconfig.build.json --noEmit) && (cd frontend && npx tsc -b)`
Expected: all PASS. Read every summary.

- [ ] **Step 2: Ask the owner to approve pushing to `main`.** Do not push without it.

- [ ] **Step 3: Push**

```bash
git -c credential.helper='!gh auth git-credential' push origin main
```

`deploy-web` rebuilds the frontend with the current `VITE_API_BASE_URL` (the Mac tunnel while Render is suspended).

- [ ] **Step 4: Move the Mac host to the new commit**

```bash
cd ~/trader-mac-host && git fetch origin && git checkout --detach origin/main
cd backend && npm ci --include=dev --no-audit --no-fund && npm run build
launchctl kickstart -k gui/$(id -u)/com.trader.api
```

Then check `~/Library/Logs/trader/api.log` shows `starting from … at <new sha>` and migrations up to date, and confirm `AddHoldings1790035200000` is the newest row in Neon's `migrations` table (read-only query).

- [ ] **Step 5: Verify live** — wait for the `deploy-web` run to succeed, open `https://trader-app-55e.pages.dev` at iPhone width, log in with a throwaway account (signup), send `watch AAPL`, a free-text question, and `is AAPL above 50 SMA`; then remove the throwaway data (`unwatch AAPL`). Do not write to the owner's account.

- [ ] **Step 6: Update memory** — note the Mac host is on the new commit in `trader-mac-host-temp-host` memory.
