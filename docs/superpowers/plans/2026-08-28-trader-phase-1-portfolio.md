# Trader Phase 1 — "My Portfolio, Live" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed a real portfolio (holdings + starting cash) once, then see it priced live from a phone — account value, cash, and every position with its P&L.

**Architecture:** NestJS backend over PostgreSQL, React/Vite frontend, talking over a Vite dev proxy so the app works identically from `localhost` and from a phone on the LAN. Positions are never stored — they are derived from an immutable transaction log by a pure, heavily-tested function. Every transaction is owned by a journal entry from day one, so Phase 2 (the diary) has nothing to migrate.

**Tech Stack:** Node 25, NestJS 11, TypeORM, PostgreSQL 18 (local Homebrew), React 19, Vite, Tailwind v4, TanStack Query v5, React Router v7, `yahoo-finance2`, Jest (backend), Vitest (frontend).

---

## Scope

**Phase 1 delivers:** project scaffold, database, live quotes from Yahoo, the portfolio derivation engine (including sells, shorts and FIFO realized P&L), a one-time seed flow, the dashboard, and PWA install on the phone.

**Phase 1 does NOT deliver:** the journal UI, notes, cash entries, tags, position detail pages, price history backfill, or the benchmark chart. Those are Phases 2 and 3.

**Why the derivation engine is built fully now**, including sells and shorts that Phase 1's UI cannot yet produce: it is pure functions, it is the one place where a bug is silent and expensive, and it is far cheaper to test in isolation than through a UI. Phase 2 then adds only the screens that feed it.

## Test checkpoints

Four points where work stops and the human tests before anything else is built:

| After Task | You can test |
|---|---|
| 3 | The app loads, dark shell, backend and database report healthy |
| 6 | Type a ticker, see its real live price |
| 12 | Your real portfolio, seeded and priced — the core deliverable |
| 13 | Installed on the iPhone home screen, works over Wi-Fi |

## Conventions

**Money and rounding.** All monetary and quantity columns are Postgres `numeric`. TypeORM returns `numeric` as a string, so every such column uses the shared `numericTransformer` to parse to `number`. Arithmetic is plain JS numbers; values are rounded to 2 decimals **only at display time**. This is adequate for one trader's book and avoids a decimal library threaded through every calculation.

**Schema management.** TypeORM `synchronize: true` in development. Single user, local database, no production data. Migrations are a Phase-3+ concern and are called out in "Deferred" below.

**LAN access.** The backend listens on `0.0.0.0`; Vite runs with `host: true`. The frontend calls **relative** `/api/...` paths which Vite proxies to the backend, so the exact same build works at `localhost:5173` and at `192.168.x.x:5173` from the phone. Never hardcode a host in frontend code.

**Styling.** Tailwind v4. The theme tokens are declared once in `@theme` under the `--color-*` namespace, which makes Tailwind generate matching utilities automatically — `--color-surface-1` gives `bg-surface-1`, `--color-up` gives `text-up`, and so on. Always use those generated utilities; never hardcode a hex value in a component.

**Commits.** One commit per task, at the end. Message format `feat:` / `test:` / `chore:`.

## File structure

```
trader/
├── package.json                        root scripts (dev/build/test via concurrently)
├── backend/
│   └── src/
│       ├── main.ts                     bootstrap, binds 0.0.0.0
│       ├── app.module.ts               root module, TypeORM config
│       ├── common/
│       │   └── numeric.transformer.ts  numeric <-> number
│       ├── health/
│       │   ├── health.controller.ts    GET /health
│       │   └── health.module.ts
│       ├── users/
│       │   ├── user.entity.ts          single seeded local user
│       │   ├── users.service.ts        ensureDefaultUser()
│       │   └── users.module.ts
│       ├── instruments/
│       │   ├── instrument.entity.ts
│       │   ├── instruments.service.ts  find-or-create by symbol
│       │   ├── instruments.controller.ts  GET /instruments/lookup
│       │   └── instruments.module.ts
│       ├── market-data/
│       │   ├── market-data.service.ts  Yahoo quotes + cache
│       │   ├── yahoo.client.ts         thin wrapper, the only Yahoo import
│       │   └── market-data.module.ts
│       ├── journal/
│       │   └── journal-entry.entity.ts
│       ├── transactions/
│       │   ├── transaction.entity.ts
│       │   └── cash-flow.entity.ts
│       └── portfolio/
│           ├── derive.ts               PURE. positions + cash from a txn log
│           ├── derive.spec.ts          the most important test file in the repo
│           ├── portfolio.service.ts    loads rows, derives, prices
│           ├── portfolio.controller.ts GET /portfolio, POST /portfolio/seed
│           └── portfolio.module.ts
└── frontend/
    └── src/
        ├── main.tsx                    router + query client
        ├── index.css                   Tailwind + dark theme tokens
        ├── api/client.ts               fetch wrapper over /api
        ├── components/
        │   ├── AppShell.tsx            header, nav, dark chrome
        │   ├── Money.tsx               formats currency, colors by sign
        │   └── Percent.tsx             formats percent, colors by sign
        └── routes/
            ├── Dashboard.tsx
            ├── Seed.tsx
            └── TickerProbe.tsx         dev-only price checker
```

Split is by responsibility, not by layer. `derive.ts` has no imports from NestJS, TypeORM, or the network — that is what makes it testable.

---

## Task 1: Scaffold both apps so they boot

**Files:**
- Create: `package.json`
- Create: `backend/` (via Nest CLI)
- Create: `frontend/` (via Vite)
- Modify: `frontend/vite.config.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Scaffold the backend**

```bash
cd /Users/dvir/claude/trader
npx -y @nestjs/cli@latest new backend --package-manager npm --skip-git --language TypeScript
```

Expected: `backend/` created with `src/main.ts`, `src/app.module.ts`, and a passing default test.

- [ ] **Step 2: Scaffold the frontend**

```bash
cd /Users/dvir/claude/trader
npm create vite@latest frontend -- --template react-ts
npm install --prefix frontend
```

Expected: `frontend/` created, dependencies installed.

- [ ] **Step 3: Bind the backend to all interfaces**

Replace `backend/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  // 0.0.0.0 so the phone on the same Wi-Fi can reach it.
  await app.listen(3000, '0.0.0.0');
}
bootstrap();
```

- [ ] **Step 4: Configure Vite for LAN + API proxy**

Replace `frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on LAN so the phone can load it
    port: 5173,
    proxy: {
      // frontend always calls relative /api/*, works from any host
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
```

- [ ] **Step 5: Add root scripts**

Create `package.json`:

```json
{
  "name": "trader",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "concurrently -n api,web -c cyan,magenta \"npm run start:dev --prefix backend\" \"npm run dev --prefix frontend\"",
    "build": "npm run build --prefix backend && npm run build --prefix frontend",
    "test": "npm run test --prefix backend && npm run test --prefix frontend",
    "install:all": "npm install && npm install --prefix backend && npm install --prefix frontend"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

Then:

```bash
cd /Users/dvir/claude/trader && npm install
```

- [ ] **Step 6: Verify both boot**

Run: `npm run dev`
Expected: `api` logs `Nest application successfully started`; `web` logs a `Local:` URL and a `Network:` URL. Open `http://localhost:5173` and see the Vite React starter page. Stop with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold NestJS backend and Vite frontend with LAN binding"
```

---

## Task 2: Database, User entity, and a health endpoint that proves the connection

**Files:**
- Create: `backend/src/common/numeric.transformer.ts`
- Create: `backend/src/users/user.entity.ts`
- Create: `backend/src/users/users.service.ts`
- Create: `backend/src/users/users.module.ts`
- Create: `backend/src/health/health.controller.ts`
- Create: `backend/src/health/health.module.ts`
- Create: `backend/test/health.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/.env`

- [ ] **Step 1: Create the databases**

```bash
createdb trader && createdb trader_test && psql -lqt | cut -d'|' -f1 | grep trader
```

Expected: both `trader` and `trader_test` listed.

- [ ] **Step 2: Install dependencies**

```bash
npm install --prefix backend @nestjs/typeorm typeorm pg @nestjs/config class-validator class-transformer
npm install --prefix backend -D supertest @types/supertest
```

- [ ] **Step 3: Write the environment file**

Create `backend/.env`:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=trader
DB_USER=dvir
DB_PASSWORD=
DEFAULT_FEE=4
```

Then pin the test database explicitly. In `backend/package.json`, change the `test:e2e` script so it can never touch the real database even if Jest's default `NODE_ENV` behaviour changes:

```json
"test:e2e": "NODE_ENV=test jest --config ./test/jest-e2e.json"
```

Confirm `backend/.env` is covered by the root `.gitignore` (it is — `.env` is listed).

- [ ] **Step 4: Write the failing e2e test**

Create `backend/test/health.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database is reachable and a default user exists', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('ok');
    expect(res.body.userId).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run test:e2e --prefix backend`
Expected: FAIL — 404 on `/health`, or a module resolution error. Either is the expected red.

- [ ] **Step 6: Write the numeric transformer**

Create `backend/src/common/numeric.transformer.ts`:

```ts
import { ValueTransformer } from 'typeorm';

/**
 * Postgres `numeric` arrives over the wire as a string. Every money or
 * quantity column uses this so the rest of the codebase only ever sees numbers.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : parseFloat(value),
};
```

- [ ] **Step 7: Write the User entity**

Create `backend/src/users/user.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 'me' })
  displayName: string;

  @Column('numeric', {
    precision: 12,
    scale: 2,
    default: 4,
    transformer: numericTransformer,
  })
  defaultFee: number;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 8: Write the users service and module**

Create `backend/src/users/users.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Phase 1 is single-user and local. Every table still carries userId so
   * going multi-user later is a config change, not a migration.
   */
  async ensureDefaultUser(): Promise<User> {
    const existing = await this.users.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    if (existing.length > 0) return existing[0];
    return this.users.save(this.users.create({ displayName: 'me' }));
  }
}
```

Create `backend/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 9: Write the health controller and module**

Create `backend/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from '../users/users.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  @Get()
  async check() {
    let database = 'error';
    let userId: string | null = null;
    try {
      await this.dataSource.query('SELECT 1');
      database = 'ok';
      userId = (await this.users.ensureDefaultUser()).id;
    } catch {
      database = 'error';
    }
    return { status: database === 'ok' ? 'ok' : 'degraded', database, userId };
  }
}
```

Create `backend/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 10: Wire the root module**

Replace `backend/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get('DB_HOST', 'localhost'),
        port: parseInt(config.get('DB_PORT', '5432'), 10),
        username: config.get('DB_USER'),
        password: config.get('DB_PASSWORD') || undefined,
        database:
          process.env.NODE_ENV === 'test'
            ? 'trader_test'
            : config.get('DB_NAME', 'trader'),
        autoLoadEntities: true,
        // Single user, local database, no production data.
        synchronize: true,
      }),
    }),
    UsersModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `npm run test:e2e --prefix backend`
Expected: PASS — 1 test, `status: ok`, `database: ok`, a uuid `userId`.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: postgres connection, default user, and health endpoint"
```

---

## Task 3: Dark app shell with a live health indicator

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/components/AppShell.tsx`
- Create: `frontend/src/routes/Dashboard.tsx`
- Delete: `frontend/src/App.tsx`, `frontend/src/App.css`

- [ ] **Step 1: Install dependencies**

```bash
npm install --prefix frontend @tanstack/react-query react-router-dom
npm install --prefix frontend -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Add the Tailwind plugin to Vite**

Modify `frontend/vite.config.ts` — add the import and the plugin, leaving `server` untouched:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
```

- [ ] **Step 3: Write the dark theme tokens**

Replace `frontend/src/index.css`:

```css
@import 'tailwindcss';

@theme {
  --color-surface-0: #0a0e17;
  --color-surface-1: #111827;
  --color-surface-2: #1a2333;
  --color-border: #232f42;
  --color-text: #e6edf7;
  --color-muted: #7d8da6;
  --color-accent: #2dd4bf;
  --color-up: #22c55e;
  --color-down: #f43f5e;
}

html,
body,
#root {
  height: 100%;
}

body {
  background: var(--color-surface-0);
  color: var(--color-text);
  -webkit-font-smoothing: antialiased;
  /* tabular figures so columns of numbers line up */
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Write the API client**

Create `frontend/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Always relative, so it works from localhost and from the phone alike. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 5: Write the app shell**

Create `frontend/src/components/AppShell.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';

type Health = { status: string; database: string; userId: string | null };

function HealthDot() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 30_000,
  });
  const ok = !isError && data?.status === 'ok';
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          ok ? 'bg-up' : 'bg-down'
        }`}
      />
      {ok ? 'connected' : 'offline'}
    </span>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 text-sm ${isActive ? 'text-text' : 'text-muted'}`;

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold tracking-wide">TRADER</span>
        <HealthDot />
      </header>
      <nav className="flex border-b border-border px-2">
        <NavLink to="/" className={linkClass} end>
          Portfolio
        </NavLink>
        <NavLink to="/probe" className={linkClass}>
          Probe
        </NavLink>
      </nav>
      <main className="flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Write a placeholder dashboard**

Create `frontend/src/routes/Dashboard.tsx`:

```tsx
export function Dashboard() {
  return (
    <p className="text-sm text-muted">
      No portfolio yet. Seeding arrives in Task 11.
    </p>
  );
}
```

- [ ] **Step 7: Wire the router**

Replace `frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Dashboard } from './routes/Dashboard';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

Then remove the scaffold leftovers:

```bash
rm frontend/src/App.tsx frontend/src/App.css
```

- [ ] **Step 8: Verify**

Run: `npm run dev`
Expected: `http://localhost:5173` renders a dark page with `TRADER` in the header and a **green** dot reading `connected`. Stop the backend alone and the dot turns red within 30s.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: dark app shell with live backend health indicator"
```

### ✋ TEST CHECKPOINT 1 — stop here

Open `http://localhost:5173`. Confirm: the dark theme reads right to you, the header is what you want, and the connection dot is green. **This is the visual foundation every later screen inherits, so push back now if the palette or density is off.**

---

## Task 4: Yahoo market data with a cache

**Files:**
- Create: `backend/src/market-data/yahoo.client.ts`
- Create: `backend/src/market-data/market-data.service.ts`
- Create: `backend/src/market-data/market-data.service.spec.ts`
- Create: `backend/src/market-data/market-data.module.ts`

- [ ] **Step 1: Install and verify the library actually works**

```bash
npm install --prefix backend yahoo-finance2
cd /Users/dvir/claude/trader/backend && node -e "
const yf = require('yahoo-finance2').default;
yf.quote('NVDA').then(q =>
  console.log('OK', q.symbol, q.regularMarketPrice, q.shortName)
).catch(e => console.error('FAILED', e.message));
"
```

Expected: `OK NVDA <a number> NVIDIA Corporation`.

**If the import shape differs** (the package has changed export style across majors), adjust only `yahoo.client.ts` in the next step — it is the single file in the codebase allowed to import `yahoo-finance2`, precisely so this is a one-line fix.

- [ ] **Step 2: Write the thin Yahoo wrapper**

Create `backend/src/market-data/yahoo.client.ts`:

```ts
import yahooFinance from 'yahoo-finance2';

export interface RawQuote {
  symbol: string;
  name: string | null;
  price: number;
  currency: string | null;
}

/**
 * The only file permitted to import yahoo-finance2. Everything else depends on
 * this interface, so swapping the data provider touches exactly one file.
 */
export class YahooClient {
  async quote(symbol: string): Promise<RawQuote | null> {
    const q = await yahooFinance.quote(symbol);
    if (!q || typeof q.regularMarketPrice !== 'number') return null;
    return {
      symbol: q.symbol,
      name: q.shortName ?? q.longName ?? null,
      price: q.regularMarketPrice,
      currency: q.currency ?? null,
    };
  }

  async quoteMany(symbols: string[]): Promise<RawQuote[]> {
    if (symbols.length === 0) return [];
    const results = await yahooFinance.quote(symbols);
    const list = Array.isArray(results) ? results : [results];
    return list
      .filter((q) => typeof q.regularMarketPrice === 'number')
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? null,
        price: q.regularMarketPrice as number,
        currency: q.currency ?? null,
      }));
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `backend/src/market-data/market-data.service.spec.ts`:

```ts
import { MarketDataService } from './market-data.service';
import { YahooClient, RawQuote } from './yahoo.client';

function fakeClient(quotes: RawQuote[], onCall: () => void = () => {}) {
  return {
    quote: async (s: string) => {
      onCall();
      return quotes.find((q) => q.symbol === s) ?? null;
    },
    quoteMany: async (symbols: string[]) => {
      onCall();
      return quotes.filter((q) => symbols.includes(q.symbol));
    },
  } as unknown as YahooClient;
}

const NVDA: RawQuote = { symbol: 'NVDA', name: 'NVIDIA', price: 168.2, currency: 'USD' };

describe('MarketDataService', () => {
  it('returns a fresh quote from the provider', async () => {
    const svc = new MarketDataService(fakeClient([NVDA]));
    const q = await svc.getQuote('NVDA');
    expect(q).toMatchObject({
      symbol: 'NVDA',
      name: 'NVIDIA',
      price: 168.2,
      stale: false,
    });
    expect(q?.fetchedAt).toBeInstanceOf(Date);
  });

  it('uppercases the symbol before lookup', async () => {
    const svc = new MarketDataService(fakeClient([NVDA]));
    const q = await svc.getQuote('nvda');
    expect(q?.price).toBe(168.2);
  });

  it('serves a cached quote without calling the provider again', async () => {
    let calls = 0;
    const svc = new MarketDataService(fakeClient([NVDA], () => calls++));
    await svc.getQuote('NVDA');
    await svc.getQuote('NVDA');
    expect(calls).toBe(1);
  });

  it('returns null for an unknown symbol', async () => {
    const svc = new MarketDataService(fakeClient([]));
    expect(await svc.getQuote('NOTREAL')).toBeNull();
  });

  it('falls back to the cached price and marks it stale when the provider fails', async () => {
    let shouldFail = false;
    const client = {
      quote: async (s: string) => {
        if (shouldFail) throw new Error('network down');
        return s === 'NVDA' ? NVDA : null;
      },
      quoteMany: async () => [],
    } as unknown as YahooClient;

    const svc = new MarketDataService(client, 0); // ttl 0 => always refetch
    await svc.getQuote('NVDA');
    shouldFail = true;
    const q = await svc.getQuote('NVDA');
    expect(q).toMatchObject({ price: 168.2, stale: true });
    expect(q?.fetchedAt).toBeInstanceOf(Date);
  });

  it('returns null when the provider fails and nothing is cached', async () => {
    const client = {
      quote: async () => {
        throw new Error('network down');
      },
      quoteMany: async () => [],
    } as unknown as YahooClient;
    const svc = new MarketDataService(client);
    expect(await svc.getQuote('NVDA')).toBeNull();
  });

  it('fetches many symbols in one provider call', async () => {
    let calls = 0;
    const svc = new MarketDataService(
      fakeClient(
        [NVDA, { symbol: 'AAPL', name: 'Apple', price: 214, currency: 'USD' }],
        () => calls++,
      ),
    );
    const map = await svc.getQuotes(['NVDA', 'AAPL']);
    expect(calls).toBe(1);
    expect(map.get('NVDA')?.price).toBe(168.2);
    expect(map.get('AAPL')?.price).toBe(214);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test --prefix backend -- market-data.service`
Expected: FAIL — `Cannot find module './market-data.service'`.

- [ ] **Step 5: Implement the service**

Create `backend/src/market-data/market-data.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { YahooClient } from './yahoo.client';

export interface Quote {
  symbol: string;
  name: string | null;
  price: number;
  stale: boolean;
  fetchedAt?: Date;
}

interface CacheEntry {
  quote: Quote;
  fetchedAt: number;
}

const DEFAULT_TTL_MS = 60_000;

@Injectable()
export class MarketDataService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly yahoo: YahooClient,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async getQuote(symbol: string): Promise<Quote | null> {
    const key = symbol.toUpperCase();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.quote;
    }
    try {
      const raw = await this.yahoo.quote(key);
      if (!raw) return null;
      return this.store(key, raw.name, raw.price);
    } catch {
      // Never show a wrong number as if it were fresh.
      return cached ? { ...cached.quote, stale: true } : null;
    }
  }

  async getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const keys = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const out = new Map<string, Quote>();
    const missing: string[] = [];

    for (const key of keys) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
        out.set(key, cached.quote);
      } else {
        missing.push(key);
      }
    }
    if (missing.length === 0) return out;

    try {
      for (const raw of await this.yahoo.quoteMany(missing)) {
        out.set(raw.symbol.toUpperCase(), this.store(raw.symbol.toUpperCase(), raw.name, raw.price));
      }
    } catch {
      for (const key of missing) {
        const cached = this.cache.get(key);
        if (cached) out.set(key, { ...cached.quote, stale: true });
      }
    }
    return out;
  }

  private store(key: string, name: string | null, price: number): Quote {
    const now = new Date();
    const quote: Quote = { symbol: key, name, price, stale: false, fetchedAt: now };
    this.cache.set(key, { quote, fetchedAt: now.getTime() });
    return quote;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --prefix backend -- market-data.service`
Expected: PASS — 7 tests.

- [ ] **Step 7: Create the module**

Create `backend/src/market-data/market-data.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { YahooClient } from './yahoo.client';

@Module({
  providers: [
    YahooClient,
    {
      provide: MarketDataService,
      useFactory: (yahoo: YahooClient) => new MarketDataService(yahoo),
      inject: [YahooClient],
    },
  ],
  exports: [MarketDataService],
})
export class MarketDataModule {}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: yahoo market data service with cache and stale fallback"
```

---

## Task 5: Instruments — validate and store tickers

**Files:**
- Create: `backend/src/instruments/instrument.entity.ts`
- Create: `backend/src/instruments/instruments.service.ts`
- Create: `backend/src/instruments/instruments.controller.ts`
- Create: `backend/src/instruments/instruments.module.ts`
- Create: `backend/test/instruments.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/instruments.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Instruments (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('looks up a real ticker and returns its price', async () => {
    const res = await request(app.getHttpServer())
      .get('/instruments/lookup?symbol=nvda')
      .expect(200);
    expect(res.body.symbol).toBe('NVDA');
    expect(typeof res.body.price).toBe('number');
    expect(res.body.price).toBeGreaterThan(0);
    expect(typeof res.body.name).toBe('string');
  });

  it('404s on a ticker that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/instruments/lookup?symbol=ZZZZNOTREAL')
      .expect(404);
  });

  it('400s when no symbol is supplied', async () => {
    await request(app.getHttpServer()).get('/instruments/lookup').expect(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:e2e --prefix backend -- instruments`
Expected: FAIL — 404 on `/instruments/lookup`.

- [ ] **Step 3: Write the entity**

Create `backend/src/instruments/instrument.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type InstrumentType = 'STOCK' | 'ETF';

@Entity('instruments')
export class Instrument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  symbol: string;

  @Column({ nullable: true, type: 'varchar' })
  name: string | null;

  @Column({ type: 'varchar', default: 'STOCK' })
  type: InstrumentType;

  /** SPY and QQQ get price history without ever appearing as holdings. */
  @Column({ default: false })
  isBenchmark: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 4: Write the service**

Create `backend/src/instruments/instruments.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instrument } from './instrument.entity';
import { MarketDataService } from '../market-data/market-data.service';

@Injectable()
export class InstrumentsService {
  constructor(
    @InjectRepository(Instrument) private readonly repo: Repository<Instrument>,
    private readonly marketData: MarketDataService,
  ) {}

  /** Validates against the provider, then stores. Throws if the ticker is unknown. */
  async findOrCreate(symbolInput: string): Promise<Instrument> {
    const symbol = symbolInput.trim().toUpperCase();
    const existing = await this.repo.findOne({ where: { symbol } });
    if (existing) return existing;

    const quote = await this.marketData.getQuote(symbol);
    if (!quote) {
      throw new NotFoundException(`Unknown ticker "${symbol}"`);
    }
    return this.repo.save(
      this.repo.create({ symbol, name: quote.name, type: 'STOCK' }),
    );
  }

  async lookup(symbolInput: string) {
    const instrument = await this.findOrCreate(symbolInput);
    const quote = await this.marketData.getQuote(instrument.symbol);
    if (!quote) throw new NotFoundException(`No price for "${instrument.symbol}"`);
    return {
      id: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      price: quote.price,
      stale: quote.stale,
    };
  }
}
```

- [ ] **Step 5: Write the controller**

Create `backend/src/instruments/instruments.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InstrumentsService } from './instruments.service';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @Get('lookup')
  async lookup(@Query('symbol') symbol?: string) {
    if (!symbol || symbol.trim() === '') {
      throw new BadRequestException('symbol is required');
    }
    return this.instruments.lookup(symbol);
  }
}
```

- [ ] **Step 6: Write the module and register it**

Create `backend/src/instruments/instruments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from './instrument.entity';
import { InstrumentsService } from './instruments.service';
import { InstrumentsController } from './instruments.controller';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [TypeOrmModule.forFeature([Instrument]), MarketDataModule],
  providers: [InstrumentsService],
  controllers: [InstrumentsController],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
```

In `backend/src/app.module.ts`, add `InstrumentsModule` to the `imports` array (after `UsersModule`) and add the matching import statement at the top:

```ts
import { InstrumentsModule } from './instruments/instruments.module';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run test:e2e --prefix backend -- instruments`
Expected: PASS — 3 tests. (This one hits the real Yahoo API; it needs a network connection.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: instrument lookup with ticker validation"
```

---

## Task 6: Ticker probe screen

**Files:**
- Create: `frontend/src/routes/TickerProbe.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Write the probe screen**

Create `frontend/src/routes/TickerProbe.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

type Lookup = {
  symbol: string;
  name: string | null;
  price: number;
  stale: boolean;
};

export function TickerProbe() {
  const [input, setInput] = useState('');
  const [symbol, setSymbol] = useState('');

  const { data, error, isFetching } = useQuery({
    queryKey: ['lookup', symbol],
    queryFn: () => api<Lookup>(`/instruments/lookup?symbol=${encodeURIComponent(symbol)}`),
    enabled: symbol.length > 0,
    retry: false,
  });

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSymbol(input.trim().toUpperCase());
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="NVDA"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0"
        >
          Check
        </button>
      </form>

      {isFetching && <p className="text-sm text-muted">Loading…</p>}

      {error && (
        <p className="text-sm text-down">{(error as Error).message}</p>
      )}

      {data && !isFetching && (
        <div className="rounded-xl border border-border bg-surface-1 p-4">
          <div className="text-lg font-semibold">{data.symbol}</div>
          <div className="text-sm text-muted">{data.name}</div>
          <div className="mt-3 text-3xl font-semibold">
            ${data.price.toFixed(2)}
          </div>
          {data.stale && (
            <div className="mt-2 text-xs text-down">
              stale — provider unreachable, showing last known price
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `frontend/src/main.tsx`, add the import and the route inside the `AppShell` route:

```tsx
import { TickerProbe } from './routes/TickerProbe';
```

```tsx
<Route index element={<Dashboard />} />
<Route path="probe" element={<TickerProbe />} />
```

- [ ] **Step 3: Verify**

Run: `npm run dev`
Expected: at `/probe`, entering `NVDA` shows the name and a live price. Entering `ZZZZNOTREAL` shows a red `Unknown ticker "ZZZZNOTREAL"` message.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: ticker probe screen for live price lookup"
```

### ✋ TEST CHECKPOINT 2 — stop here

Go to `/probe` and try your real tickers — the ones you actually hold, including any ETFs. **What we're checking: that Yahoo knows every symbol you care about and the prices are right.** If any of your tickers fail here, we need to know now, before the portfolio is built on top of this.

---

## Task 7: Journal entry, transaction, and cash flow entities

**Files:**
- Create: `backend/src/journal/journal-entry.entity.ts`
- Create: `backend/src/transactions/transaction.entity.ts`
- Create: `backend/src/transactions/cash-flow.entity.ts`

- [ ] **Step 1: Write the journal entry entity**

Create `backend/src/journal/journal-entry.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EntryKind = 'TRADE' | 'NOTE' | 'CASH';

/**
 * The single timeline. A TRADE entry owns one transaction, a CASH entry owns one
 * cash flow, a NOTE owns neither. Transactions are ONLY ever created through an
 * entry, so there is exactly one write path into the portfolio.
 */
@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar' })
  kind: EntryKind;

  @Column({ type: 'text', default: '' })
  body: string;

  @Index()
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Write the transaction entity**

Create `backend/src/transactions/transaction.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';

export type Side = 'BUY' | 'SELL';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  entryId: string;

  @Index()
  @Column('uuid')
  instrumentId: string;

  @Column({ type: 'varchar' })
  side: Side;

  /** Always positive. Direction comes from `side`; shorts fall out of derivation. */
  @Column('numeric', { precision: 20, scale: 8, transformer: numericTransformer })
  quantity: number;

  @Column('numeric', { precision: 20, scale: 8, transformer: numericTransformer })
  price: number;

  @Column('numeric', { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  fee: number;

  @Index()
  @Column({ type: 'timestamptz' })
  executedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 3: Write the cash flow entity**

Create `backend/src/transactions/cash-flow.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../common/numeric.transformer';

export type CashDirection = 'DEPOSIT' | 'WITHDRAW';

/**
 * External money movement ONLY. Buys and sells move money between cash and
 * positions internally and are deliberately not cash flows — that distinction is
 * what makes the Phase 3 benchmark comparison honest.
 */
@Entity('cash_flows')
export class CashFlow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  entryId: string;

  @Column({ type: 'varchar' })
  direction: CashDirection;

  /** Always positive. Direction comes from `direction`. */
  @Column('numeric', { precision: 20, scale: 2, transformer: numericTransformer })
  amount: number;

  @Index()
  @Column({ type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 4: Verify the schema syncs**

These entities are picked up by `autoLoadEntities` once a module registers them (Task 9). For now just confirm nothing is broken:

Run: `npm run build --prefix backend`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: journal entry, transaction and cash flow entities"
```

---

## Task 8: The derivation engine (pure functions)

**This is the most important task in the plan.** Positions, cash, and P&L all come from here, and a bug produces numbers that look plausible and are wrong.

**Files:**
- Create: `backend/src/portfolio/derive.ts`
- Create: `backend/src/portfolio/derive.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/portfolio/derive.spec.ts`:

```ts
import { derivePositions, deriveCash, DerivedTxn, DerivedFlow } from './derive';

function buy(symbol: string, quantity: number, price: number, fee = 4, day = 1): DerivedTxn {
  return { symbol, side: 'BUY', quantity, price, fee, executedAt: new Date(2026, 0, day) };
}
function sell(symbol: string, quantity: number, price: number, fee = 4, day = 1): DerivedTxn {
  return { symbol, side: 'SELL', quantity, price, fee, executedAt: new Date(2026, 0, day) };
}
function deposit(amount: number, day = 1): DerivedFlow {
  return { direction: 'DEPOSIT', amount, occurredAt: new Date(2026, 0, day) };
}
function withdraw(amount: number, day = 1): DerivedFlow {
  return { direction: 'WITHDRAW', amount, occurredAt: new Date(2026, 0, day) };
}

describe('derivePositions', () => {
  it('returns nothing for an empty log', () => {
    expect(derivePositions([])).toEqual([]);
  });

  it('derives a single long position', () => {
    const [p] = derivePositions([buy('NVDA', 10, 100)]);
    expect(p.symbol).toBe('NVDA');
    expect(p.quantity).toBe(10);
    expect(p.costBasis).toBe(1000);
    expect(p.avgCost).toBe(100);
    expect(p.feesPaid).toBe(4);
    expect(p.realizedPnl).toBe(-4); // no closes yet, so realized is just fees
  });

  it('averages cost across multiple buys', () => {
    const [p] = derivePositions([buy('NVDA', 10, 100, 4, 1), buy('NVDA', 10, 120, 4, 2)]);
    expect(p.quantity).toBe(20);
    expect(p.costBasis).toBe(2200);
    expect(p.avgCost).toBe(110);
    expect(p.feesPaid).toBe(8);
  });

  it('matches lots FIFO on a partial sell', () => {
    // buy 10@100, buy 10@120, sell 15@130
    // FIFO closes 10 from the 100 lot (+300) and 5 from the 120 lot (+50) = +350
    const [p] = derivePositions([
      buy('NVDA', 10, 100, 4, 1),
      buy('NVDA', 10, 120, 4, 2),
      sell('NVDA', 15, 130, 4, 3),
    ]);
    expect(p.quantity).toBe(5);
    expect(p.costBasis).toBe(600); // 5 remaining @ 120
    expect(p.avgCost).toBe(120);
    expect(p.feesPaid).toBe(12);
    expect(p.realizedPnl).toBe(350 - 12);
  });

  it('drops a fully closed position to zero quantity but keeps realized P&L', () => {
    const [p] = derivePositions([buy('NVDA', 10, 100, 4, 1), sell('NVDA', 10, 130, 4, 2)]);
    expect(p.quantity).toBe(0);
    expect(p.costBasis).toBe(0);
    expect(p.realizedPnl).toBe(300 - 8);
    expect(p.isOpen).toBe(false);
  });

  it('opens a short when selling with no position', () => {
    const [p] = derivePositions([sell('TSLA', 10, 300, 4)]);
    expect(p.quantity).toBe(-10);
    expect(p.costBasis).toBe(-3000);
    expect(p.avgCost).toBe(300);
    expect(p.isOpen).toBe(true);
  });

  it('profits on a short when the price falls', () => {
    const [p] = derivePositions([sell('TSLA', 10, 300, 4, 1), buy('TSLA', 10, 250, 4, 2)]);
    expect(p.quantity).toBe(0);
    expect(p.realizedPnl).toBe(500 - 8); // (300-250)*10 minus fees
  });

  it('loses on a short when the price rises', () => {
    const [p] = derivePositions([sell('TSLA', 10, 300, 4, 1), buy('TSLA', 10, 340, 4, 2)]);
    expect(p.realizedPnl).toBe(-400 - 8);
  });

  it('flips from long to short in one oversized sell', () => {
    // long 10@100, sell 15@130: closes 10 (+300), opens a 5 short at 130
    const [p] = derivePositions([buy('NVDA', 10, 100, 4, 1), sell('NVDA', 15, 130, 4, 2)]);
    expect(p.quantity).toBe(-5);
    expect(p.costBasis).toBe(-650);
    expect(p.realizedPnl).toBe(300 - 8);
  });

  it('keeps positions independent from each other', () => {
    const positions = derivePositions([buy('NVDA', 10, 100), buy('AAPL', 5, 200)]);
    expect(positions.map((p) => p.symbol).sort()).toEqual(['AAPL', 'NVDA']);
  });

  it('orders by execution time regardless of input order', () => {
    const [p] = derivePositions([
      sell('NVDA', 10, 130, 4, 5), // later
      buy('NVDA', 10, 100, 4, 1), // earlier
    ]);
    expect(p.quantity).toBe(0);
    expect(p.realizedPnl).toBe(300 - 8);
  });

  it('handles fractional quantities', () => {
    const [p] = derivePositions([buy('SPY', 0.5, 600, 0)]);
    expect(p.quantity).toBe(0.5);
    expect(p.costBasis).toBe(300);
  });
});

describe('deriveCash', () => {
  it('is zero with no activity', () => {
    expect(deriveCash([], [])).toBe(0);
  });

  it('adds deposits and subtracts withdrawals', () => {
    expect(deriveCash([], [deposit(10000), withdraw(2500)])).toBe(7500);
  });

  it('subtracts buy cost and fee', () => {
    expect(deriveCash([buy('NVDA', 10, 100, 4)], [deposit(10000)])).toBe(10000 - 1000 - 4);
  });

  it('adds sell proceeds and still subtracts the fee', () => {
    const cash = deriveCash(
      [buy('NVDA', 10, 100, 4, 1), sell('NVDA', 10, 130, 4, 2)],
      [deposit(10000)],
    );
    expect(cash).toBe(10000 - 1000 - 4 + 1300 - 4);
  });

  it('goes negative on margin without complaint', () => {
    // Buying more than the cash on hand is a legitimate margin state.
    expect(deriveCash([buy('NVDA', 100, 100, 4)], [deposit(1000)])).toBe(1000 - 10000 - 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --prefix backend -- derive`
Expected: FAIL — `Cannot find module './derive'`.

- [ ] **Step 3: Implement the engine**

Create `backend/src/portfolio/derive.ts`:

```ts
export type Side = 'BUY' | 'SELL';
export type CashDirection = 'DEPOSIT' | 'WITHDRAW';

export interface DerivedTxn {
  symbol: string;
  side: Side;
  quantity: number; // always positive
  price: number;
  fee: number;
  executedAt: Date;
}

export interface DerivedFlow {
  direction: CashDirection;
  amount: number; // always positive
  occurredAt: Date;
}

export interface DerivedPosition {
  symbol: string;
  /** Negative means short. */
  quantity: number;
  /** Signed: negative for a short. Fees excluded. */
  costBasis: number;
  /** Always positive — the price per share, not the signed basis. */
  avgCost: number;
  feesPaid: number;
  /** Closing gains net of ALL fees on this instrument. */
  realizedPnl: number;
  isOpen: boolean;
}

interface Lot {
  quantity: number; // signed: positive long, negative short
  price: number;
}

const EPSILON = 1e-9;

/**
 * Positions are never stored — they are always derived from the immutable
 * transaction log, so they cannot drift out of sync with the journal.
 *
 * Lot matching is FIFO. Shorts are not a special case: selling below zero
 * simply produces negatively-signed lots, and the same close/flip logic applies.
 */
export function derivePositions(txns: DerivedTxn[]): DerivedPosition[] {
  const bySymbol = new Map<string, DerivedTxn[]>();
  for (const t of txns) {
    const list = bySymbol.get(t.symbol) ?? [];
    list.push(t);
    bySymbol.set(t.symbol, list);
  }

  const positions: DerivedPosition[] = [];

  for (const [symbol, list] of bySymbol) {
    const ordered = [...list].sort(
      (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
    );

    const lots: Lot[] = [];
    let realizedGains = 0;
    let feesPaid = 0;

    for (const t of ordered) {
      feesPaid += t.fee;
      let remaining = t.side === 'BUY' ? t.quantity : -t.quantity;

      // Consume opposing lots FIFO.
      while (Math.abs(remaining) > EPSILON && lots.length > 0) {
        const lot = lots[0];
        const opposing = Math.sign(lot.quantity) !== Math.sign(remaining);
        if (!opposing) break;

        const closed = Math.min(Math.abs(lot.quantity), Math.abs(remaining));
        // Long lot: gain when the exit price exceeds the entry price.
        // Short lot: gain when the exit price is below the entry price.
        realizedGains +=
          lot.quantity > 0
            ? (t.price - lot.price) * closed
            : (lot.price - t.price) * closed;

        lot.quantity -= Math.sign(lot.quantity) * closed;
        remaining -= Math.sign(remaining) * closed;
        if (Math.abs(lot.quantity) < EPSILON) lots.shift();
      }

      // Anything left opens (or extends) a position in this direction.
      if (Math.abs(remaining) > EPSILON) {
        lots.push({ quantity: remaining, price: t.price });
      }
    }

    const quantity = lots.reduce((sum, l) => sum + l.quantity, 0);
    const costBasis = lots.reduce((sum, l) => sum + l.quantity * l.price, 0);

    positions.push({
      symbol,
      quantity: round(quantity),
      costBasis: round(costBasis),
      avgCost: Math.abs(quantity) > EPSILON ? round(Math.abs(costBasis / quantity)) : 0,
      feesPaid: round(feesPaid),
      realizedPnl: round(realizedGains - feesPaid),
      isOpen: Math.abs(quantity) > EPSILON,
    });
  }

  return positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Cash may legitimately be negative — that is margin, not an error.
 */
export function deriveCash(txns: DerivedTxn[], flows: DerivedFlow[]): number {
  let cash = 0;
  for (const f of flows) {
    cash += f.direction === 'DEPOSIT' ? f.amount : -f.amount;
  }
  for (const t of txns) {
    const notional = t.quantity * t.price;
    cash += t.side === 'BUY' ? -notional : notional;
    cash -= t.fee;
  }
  return round(cash);
}

/** Kills floating-point dust without pulling in a decimal library. */
function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test --prefix backend -- derive`
Expected: PASS — 18 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pure portfolio derivation engine with FIFO lots and shorts"
```

---

## Task 9: Portfolio service and endpoint

**Files:**
- Create: `backend/src/portfolio/portfolio.service.ts`
- Create: `backend/src/portfolio/portfolio.controller.ts`
- Create: `backend/src/portfolio/portfolio.module.ts`
- Create: `backend/test/portfolio.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/portfolio.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Portfolio (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE transactions, cash_flows, journal_entries RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an empty portfolio before seeding', async () => {
    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
    expect(res.body.positions).toEqual([]);
    expect(res.body.cash).toBe(0);
    expect(res.body.accountValue).toBe(0);
  });

  it('prices seeded positions and computes account value', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 10000,
        holdings: [{ symbol: 'NVDA', quantity: 10, avgCost: 100 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
    expect(res.body.positions).toHaveLength(1);

    const p = res.body.positions[0];
    expect(p.symbol).toBe('NVDA');
    expect(p.quantity).toBe(10);
    expect(p.avgCost).toBe(100);
    expect(typeof p.price).toBe('number');
    expect(p.marketValue).toBeCloseTo(p.price * 10, 2);
    expect(p.unrealizedPnl).toBeCloseTo(p.price * 10 - 1000, 2);

    // The seed deposit is startingCash + holdings cost, and the opening BUYs
    // then spend the holdings cost — so the balance lands exactly on what the
    // user said they had. This is the invariant most likely to regress.
    expect(res.body.cash).toBe(10000);
    expect(res.body.accountValue).toBeCloseTo(10000 + p.marketValue, 2);
  });

  it('seeds a short position with the right sign and cash', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 5000,
        holdings: [{ symbol: 'TSLA', quantity: -10, avgCost: 300 }],
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/portfolio').expect(200);
    const p = res.body.positions[0];
    expect(p.symbol).toBe('TSLA');
    expect(p.quantity).toBe(-10);
    expect(p.costBasis).toBe(-3000);
    expect(p.avgCost).toBe(300);
    expect(res.body.cash).toBe(5000);
  });

  it('rejects seeding an unknown ticker', async () => {
    await request(app.getHttpServer())
      .post('/portfolio/seed')
      .send({
        asOf: '2026-01-02',
        startingCash: 1000,
        holdings: [{ symbol: 'ZZZZNOTREAL', quantity: 1, avgCost: 1 }],
      })
      .expect(404);
  });

  it('refuses to seed twice', async () => {
    const body = {
      asOf: '2026-01-02',
      startingCash: 10000,
      holdings: [{ symbol: 'NVDA', quantity: 1, avgCost: 100 }],
    };
    await request(app.getHttpServer()).post('/portfolio/seed').send(body).expect(201);
    await request(app.getHttpServer()).post('/portfolio/seed').send(body).expect(409);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:e2e --prefix backend -- portfolio`
Expected: FAIL — 404 on `/portfolio`.

- [ ] **Step 3: Write the service**

Create `backend/src/portfolio/portfolio.service.ts`:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction } from '../transactions/transaction.entity';
import { CashFlow } from '../transactions/cash-flow.entity';
import { JournalEntry } from '../journal/journal-entry.entity';
import { Instrument } from '../instruments/instrument.entity';
import { InstrumentsService } from '../instruments/instruments.service';
import { MarketDataService } from '../market-data/market-data.service';
import { UsersService } from '../users/users.service';
import { derivePositions, deriveCash, DerivedTxn, DerivedFlow } from './derive';

export interface SeedHolding {
  symbol: string;
  quantity: number;
  avgCost: number;
}

export interface SeedRequest {
  asOf: string;
  startingCash: number;
  holdings: SeedHolding[];
}

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(Transaction) private readonly txns: Repository<Transaction>,
    @InjectRepository(CashFlow) private readonly flows: Repository<CashFlow>,
    @InjectRepository(JournalEntry) private readonly entries: Repository<JournalEntry>,
    @InjectRepository(Instrument) private readonly instruments: Repository<Instrument>,
    private readonly instrumentsService: InstrumentsService,
    private readonly marketData: MarketDataService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  async getPortfolio() {
    const user = await this.users.ensureDefaultUser();
    const [txnRows, flowRows, instrumentRows] = await Promise.all([
      this.txns.find({ where: { userId: user.id } }),
      this.flows.find({ where: { userId: user.id } }),
      this.instruments.find(),
    ]);

    const symbolById = new Map(instrumentRows.map((i) => [i.id, i.symbol]));
    const nameBySymbol = new Map(instrumentRows.map((i) => [i.symbol, i.name]));

    const derivedTxns: DerivedTxn[] = txnRows.map((t) => ({
      symbol: symbolById.get(t.instrumentId) ?? 'UNKNOWN',
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      fee: t.fee,
      executedAt: t.executedAt,
    }));
    const derivedFlows: DerivedFlow[] = flowRows.map((f) => ({
      direction: f.direction,
      amount: f.amount,
      occurredAt: f.occurredAt,
    }));

    const derived = derivePositions(derivedTxns).filter((p) => p.isOpen);
    const cash = deriveCash(derivedTxns, derivedFlows);

    const quotes = await this.marketData.getQuotes(derived.map((p) => p.symbol));

    const positions = derived.map((p) => {
      const quote = quotes.get(p.symbol);
      const price = quote?.price ?? null;
      const marketValue = price === null ? null : price * p.quantity;
      return {
        symbol: p.symbol,
        name: nameBySymbol.get(p.symbol) ?? null,
        quantity: p.quantity,
        avgCost: p.avgCost,
        costBasis: p.costBasis,
        feesPaid: p.feesPaid,
        realizedPnl: p.realizedPnl,
        price,
        stale: quote?.stale ?? true,
        marketValue,
        unrealizedPnl: marketValue === null ? null : marketValue - p.costBasis,
        unrealizedPct:
          marketValue === null || p.costBasis === 0
            ? null
            : (marketValue - p.costBasis) / Math.abs(p.costBasis),
      };
    });

    const positionsValue = positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);

    return {
      positions,
      cash,
      positionsValue,
      accountValue: cash + positionsValue,
      hasStalePrices: positions.some((p) => p.stale),
    };
  }

  async isSeeded(): Promise<boolean> {
    const user = await this.users.ensureDefaultUser();
    return (await this.entries.count({ where: { userId: user.id } })) > 0;
  }

  /**
   * One-time: writes an opening BUY per holding plus a starting-cash deposit,
   * each wrapped in a journal entry so the "transactions only via journal"
   * invariant holds from the very first row.
   */
  async seed(req: SeedRequest) {
    const user = await this.users.ensureDefaultUser();
    if (await this.isSeeded()) {
      throw new ConflictException(
        'Portfolio already seeded. Reset it before seeding again.',
      );
    }

    // Validate every ticker BEFORE writing anything.
    const resolved = await Promise.all(
      req.holdings.map(async (h) => ({
        holding: h,
        instrument: await this.instrumentsService.findOrCreate(h.symbol),
      })),
    );

    const asOf = new Date(`${req.asOf}T00:00:00Z`);

    /**
     * `startingCash` is the cash you have RIGHT NOW, standing alongside holdings
     * you already own. But the opening BUYs we are about to write will each
     * subtract their cost from cash. So the seed deposit must be the capital you
     * actually contributed — cash plus what the holdings cost — otherwise the
     * opening trades would eat the balance you just told us about.
     *
     *   contributed = startingCash + Σ(signed quantity × avgCost)
     *
     * A short has negative quantity, so it correctly reduces contributed capital
     * by the proceeds it generated. After derivation, cash === startingCash.
     */
    const holdingsCost = req.holdings.reduce(
      (sum, h) => sum + h.quantity * h.avgCost,
      0,
    );
    const contributed = req.startingCash + holdingsCost;

    await this.dataSource.transaction(async (manager) => {
      if (contributed !== 0) {
        const entry = await manager.save(
          manager.create(JournalEntry, {
            userId: user.id,
            kind: 'CASH',
            body: 'Opening capital (seeded)',
            occurredAt: asOf,
          }),
        );
        await manager.save(
          manager.create(CashFlow, {
            userId: user.id,
            entryId: entry.id,
            direction: contributed > 0 ? 'DEPOSIT' : 'WITHDRAW',
            amount: Math.abs(contributed),
            occurredAt: asOf,
          }),
        );
      }

      for (const { holding, instrument } of resolved) {
        const entry = await manager.save(
          manager.create(JournalEntry, {
            userId: user.id,
            kind: 'TRADE',
            body: `Opening position (seeded): ${instrument.symbol}`,
            occurredAt: asOf,
          }),
        );
        await manager.save(
          manager.create(Transaction, {
            userId: user.id,
            entryId: entry.id,
            instrumentId: instrument.id,
            side: holding.quantity >= 0 ? 'BUY' : 'SELL',
            quantity: Math.abs(holding.quantity),
            price: holding.avgCost,
            // Seeding is not a real trade, so it carries no fee.
            fee: 0,
            executedAt: asOf,
          }),
        );
      }
    });

    return this.getPortfolio();
  }

  async reset() {
    const user = await this.users.ensureDefaultUser();
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Transaction, { userId: user.id });
      await manager.delete(CashFlow, { userId: user.id });
      await manager.delete(JournalEntry, { userId: user.id });
    });
  }
}
```

- [ ] **Step 4: Write the controller**

Create `backend/src/portfolio/portfolio.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PortfolioService } from './portfolio.service';

class SeedHoldingDto {
  @IsString()
  @Length(1, 12)
  symbol: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  avgCost: number;
}

class SeedDto {
  @IsISO8601()
  asOf: string;

  @IsNumber()
  startingCash: number;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SeedHoldingDto)
  holdings: SeedHoldingDto[];
}

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  get() {
    return this.portfolio.getPortfolio();
  }

  @Get('status')
  async status() {
    return { seeded: await this.portfolio.isSeeded() };
  }

  @Post('seed')
  seed(@Body() body: SeedDto) {
    return this.portfolio.seed(body);
  }

  @Delete('reset')
  async reset() {
    await this.portfolio.reset();
    return { ok: true };
  }
}
```

- [ ] **Step 5: Write the module and register it**

Create `backend/src/portfolio/portfolio.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/transaction.entity';
import { CashFlow } from '../transactions/cash-flow.entity';
import { JournalEntry } from '../journal/journal-entry.entity';
import { Instrument } from '../instruments/instrument.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { InstrumentsModule } from '../instruments/instruments.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, CashFlow, JournalEntry, Instrument]),
    InstrumentsModule,
    MarketDataModule,
    UsersModule,
  ],
  providers: [PortfolioService],
  controllers: [PortfolioController],
  exports: [PortfolioService],
})
export class PortfolioModule {}
```

In `backend/src/app.module.ts`, add `PortfolioModule` to `imports` and the import statement:

```ts
import { PortfolioModule } from './portfolio/portfolio.module';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:e2e --prefix backend -- portfolio`
Expected: PASS — 5 tests.

- [ ] **Step 7: Run the whole backend suite**

Run: `npm run test --prefix backend && npm run test:e2e --prefix backend`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: portfolio endpoint with live pricing and one-time seeding"
```

---

## Task 10: Money and percent display components

**Files:**
- Create: `frontend/src/components/Money.tsx`
- Create: `frontend/src/components/Percent.tsx`
- Create: `frontend/src/components/format.spec.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the test runner**

```bash
npm install --prefix frontend -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Add to `frontend/package.json` scripts:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/format.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMoney, formatPercent, signClass } from './format';

describe('formatMoney', () => {
  it('formats a plain amount', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
  });
  it('shows negatives with a leading minus, not parentheses', () => {
    expect(formatMoney(-1234.5)).toBe('-$1,234.50');
  });
  it('rounds to cents', () => {
    expect(formatMoney(0.005)).toBe('$0.01');
  });
  it('renders a dash for a missing value', () => {
    expect(formatMoney(null)).toBe('—');
  });
  it('adds an explicit plus when asked', () => {
    expect(formatMoney(12, { signed: true })).toBe('+$12.00');
  });
});

describe('formatPercent', () => {
  it('formats a fraction as a percentage', () => {
    expect(formatPercent(0.184)).toBe('+18.40%');
  });
  it('formats a negative fraction', () => {
    expect(formatPercent(-0.021)).toBe('-2.10%');
  });
  it('renders a dash for a missing value', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('signClass', () => {
  it('is the up colour when positive', () => {
    expect(signClass(1)).toContain('up');
  });
  it('is the down colour when negative', () => {
    expect(signClass(-1)).toContain('down');
  });
  it('is muted at exactly zero', () => {
    expect(signClass(0)).toContain('muted');
  });
  it('is muted for a missing value', () => {
    expect(signClass(null)).toContain('muted');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test --prefix frontend`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 4: Implement the formatters**

Create `frontend/src/components/format.ts`:

```ts
export function formatMoney(
  value: number | null | undefined,
  opts: { signed?: boolean } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (value < 0) return `-$${abs}`;
  return opts.signed ? `+$${abs}` : `$${abs}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${(Math.abs(value) * 100).toFixed(2)}%`;
}

/** Colour always means one thing: green up, red down, muted flat or unknown. */
export function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
    return 'text-muted';
  }
  return value > 0 ? 'text-up' : 'text-down';
}
```

- [ ] **Step 5: Write the components**

Create `frontend/src/components/Money.tsx`:

```tsx
import { formatMoney, signClass } from './format';

export function Money({
  value,
  signed = false,
  colored = false,
  className = '',
}: {
  value: number | null | undefined;
  signed?: boolean;
  colored?: boolean;
  className?: string;
}) {
  return (
    <span className={`${colored ? signClass(value) : ''} ${className}`}>
      {formatMoney(value, { signed })}
    </span>
  );
}
```

Create `frontend/src/components/Percent.tsx`:

```tsx
import { formatPercent, signClass } from './format';

export function Percent({
  value,
  colored = true,
  className = '',
}: {
  value: number | null | undefined;
  colored?: boolean;
  className?: string;
}) {
  return (
    <span className={`${colored ? signClass(value) : ''} ${className}`}>
      {formatPercent(value)}
    </span>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test --prefix frontend`
Expected: PASS — 13 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: money and percent display components"
```

---

## Task 11: Seed screen

**Files:**
- Create: `frontend/src/routes/Seed.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Write the seed screen**

Create `frontend/src/routes/Seed.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface HoldingRow {
  symbol: string;
  quantity: string;
  avgCost: string;
}

const blankRow: HoldingRow = { symbol: '', quantity: '', avgCost: '' };

const inputClass =
  'w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-base outline-none focus:border-accent';

export function Seed() {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [startingCash, setStartingCash] = useState('');
  const [rows, setRows] = useState<HoldingRow[]>([{ ...blankRow }]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const update = (i: number, patch: Partial<HoldingRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const mutation = useMutation({
    mutationFn: () =>
      api('/portfolio/seed', {
        method: 'POST',
        body: JSON.stringify({
          asOf,
          startingCash: parseFloat(startingCash || '0'),
          holdings: rows
            .filter((r) => r.symbol.trim() !== '')
            .map((r) => ({
              symbol: r.symbol.trim().toUpperCase(),
              quantity: parseFloat(r.quantity || '0'),
              avgCost: parseFloat(r.avgCost || '0'),
            })),
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      navigate('/');
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Seed your portfolio</h1>
        <p className="mt-1 text-sm text-muted">
          One time only. After this, the diary keeps it current.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">As of</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Starting cash</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={startingCash}
            onChange={(e) => setStartingCash(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-3">
        <span className="text-xs text-muted">Holdings</span>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <input
              placeholder="NVDA"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={row.symbol}
              onChange={(e) => update(i, { symbol: e.target.value })}
              className={inputClass}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="qty"
              value={row.quantity}
              onChange={(e) => update(i, { quantity: e.target.value })}
              className={inputClass}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="avg cost"
              value={row.avgCost}
              onChange={(e) => update(i, { avgCost: e.target.value })}
              className={inputClass}
            />
            <button
              type="button"
              aria-label="Remove holding"
              onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              className="px-2 text-muted"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { ...blankRow }])}
          className="text-sm text-accent"
        >
          + Add holding
        </button>
      </div>

      {mutation.isError && (
        <p className="text-sm text-down">
          {(mutation.error as Error).message}
        </p>
      )}

      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-surface-0 disabled:opacity-50"
      >
        {mutation.isPending ? 'Seeding…' : 'Seed portfolio'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `frontend/src/main.tsx` add the import and route:

```tsx
import { Seed } from './routes/Seed';
```

```tsx
<Route path="seed" element={<Seed />} />
```

- [ ] **Step 3: Verify**

Run: `npm run dev`
Expected: `/seed` shows the form. Submitting a bad ticker shows a red `Unknown ticker` message and writes nothing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: one-time portfolio seed screen"
```

---

## Task 12: The dashboard

**Files:**
- Modify: `frontend/src/routes/Dashboard.tsx`

- [ ] **Step 1: Write the dashboard**

Replace `frontend/src/routes/Dashboard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money } from '../components/Money';
import { Percent } from '../components/Percent';
import { signClass } from '../components/format';

interface Position {
  symbol: string;
  name: string | null;
  quantity: number;
  avgCost: number;
  costBasis: number;
  feesPaid: number;
  realizedPnl: number;
  price: number | null;
  stale: boolean;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
}

interface Portfolio {
  positions: Position[];
  cash: number;
  positionsValue: number;
  accountValue: number;
  hasStalePrices: boolean;
}

function PositionRow({ p }: { p: Position }) {
  return (
    <li className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{p.symbol}</span>
          {p.quantity < 0 && (
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-wide text-muted">
              SHORT
            </span>
          )}
          {p.stale && (
            <span className="text-[10px] text-down">stale</span>
          )}
        </div>
        <div className="truncate text-xs text-muted">
          {p.quantity} @ <Money value={p.avgCost} />
        </div>
      </div>
      <div className="text-right">
        <div className="font-medium">
          <Money value={p.marketValue} />
        </div>
        <div className="text-xs">
          <Percent value={p.unrealizedPct} />{' '}
          <span className={signClass(p.unrealizedPnl)}>
            (<Money value={p.unrealizedPnl} signed />)
          </span>
        </div>
      </div>
    </li>
  );
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api<Portfolio>('/portfolio'),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-down">{(error as Error).message}</p>;
  }
  if (!data || data.positions.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">No portfolio yet.</p>
        <Link
          to="/seed"
          className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0"
        >
          Seed your portfolio
        </Link>
      </div>
    );
  }

  const totalUnrealized = data.positions.reduce(
    (sum, p) => sum + (p.unrealizedPnl ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs uppercase tracking-wide text-muted">
          Account value
        </div>
        <div className="mt-1 text-4xl font-semibold">
          <Money value={data.accountValue} />
        </div>
        <div className="mt-1 text-sm">
          <span className={signClass(totalUnrealized)}>
            <Money value={totalUnrealized} signed /> unrealized
          </span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface-1 p-3">
          <div className="text-xs text-muted">Cash</div>
          <div className={`mt-1 text-lg font-medium ${data.cash < 0 ? 'text-down' : ''}`}>
            <Money value={data.cash} />
          </div>
          {data.cash < 0 && (
            <div className="text-[10px] tracking-wide text-down">ON MARGIN</div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface-1 p-3">
          <div className="text-xs text-muted">Deployed</div>
          <div className="mt-1 text-lg font-medium">
            <Money value={data.positionsValue} />
          </div>
        </div>
      </section>

      <section>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">
          Holdings
        </div>
        <ul>
          {data.positions.map((p) => (
            <PositionRow key={p.symbol} p={p} />
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify with the real app**

Run: `npm run dev`
Expected: with a seeded portfolio, the dashboard shows account value, cash, deployed, and every holding with a live price and P&L.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: portfolio dashboard with live pricing and P&L"
```

### ✋ TEST CHECKPOINT 3 — the big one, stop here

```bash
curl -X DELETE http://localhost:3000/portfolio/reset   # clear the test data first
```

Then go to `/seed` and **enter your actual portfolio** — real tickers, real quantities, real average costs, real cash balance.

What to check:
- Every position priced correctly, market values matching what your broker says
- Account value = cash + deployed, and it matches reality
- Any short shows the `SHORT` badge with the right P&L sign
- Negative cash shows red with `ON MARGIN`
- The numbers are readable at a glance — this screen is the product

**Discrepancies against your broker matter most here.** Nothing gets built on top until these numbers are right.

---

## Task 13: PWA install

**Files:**
- Create: `frontend/public/manifest.webmanifest`
- Create: `frontend/public/icon-192.png`, `frontend/public/icon-512.png`
- Modify: `frontend/index.html`

- [ ] **Step 1: Write the manifest**

Create `frontend/public/manifest.webmanifest`:

```json
{
  "name": "Trader",
  "short_name": "Trader",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0e17",
  "theme_color": "#0a0e17",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Generate placeholder icons**

```bash
cd /Users/dvir/claude/trader/frontend/public
python3 -c "
import struct, zlib
def png(path, size, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c))
    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw))
        + chunk(b'IEND', b'')
    )
png('icon-192.png', 192, (45, 212, 191))
png('icon-512.png', 512, (45, 212, 191))
print('icons written')
"
```

Expected: `icons written`, and two PNG files exist. These are solid accent-colour squares — a real icon is a design task for later.

- [ ] **Step 3: Link the manifest**

In `frontend/index.html`, inside `<head>`, add:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0a0e17" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="/icon-192.png" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

Also change the `<title>` to `Trader`.

- [ ] **Step 4: Find your LAN address**

```bash
ipconfig getifaddr en0
```

Expected: something like `192.168.1.42`. If empty, try `en1`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: PWA manifest and icons for home screen install"
```

### ✋ TEST CHECKPOINT 4 — stop here

With `npm run dev` running, open `http://<your-lan-ip>:5173` on your iPhone (same Wi-Fi). Share → **Add to Home Screen**. Launch it from the icon.

Check: it opens full-screen with no browser chrome, the dark theme extends into the status bar area, your portfolio loads, and the numbers are readable one-handed.

---

## Phase 1 done

Run the full suite before declaring it finished:

```bash
npm run test --prefix backend && npm run test:e2e --prefix backend && npm run test --prefix frontend
```

Then write `CLAUDE.md` documenting the stack, the "diary maintains the portfolio" invariant, and how to run things — and commit.

## Deferred to later phases

Called out explicitly so nothing is silently dropped:

- **Journal UI, notes, cash entries, tags** — Phase 2. Entities already exist and are used by seeding, so Phase 2 adds screens and endpoints only.
- **Position detail page** — Phase 2.
- **`daily_closes` backfill, valuation series, benchmark chart** — Phase 3.
- **A persisted `quotes` table** — the spec lists one, but Phase 1 caches quotes **in memory** instead. Single process, 60-second TTL, and nothing of value is lost on restart. A table only earns its place once a background job needs to write quotes the request path can read, which is a Phase 3 concern.
- **TypeORM migrations** — when the database holds data that matters more than the convenience of `synchronize: true`.
- **A real app icon** — a design task, not an engineering one.
- **Service worker / offline** — the manifest gives home-screen install; genuine offline support is not needed while the data is live prices.
- **Settings screen for default fee** — Phase 2, when fees are actually entered by hand.
