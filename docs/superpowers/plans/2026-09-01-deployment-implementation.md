# Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Trader off the owner's personal Mac to a free, always-warm public deployment (Cloudflare Pages + Render + Neon, the pattern already proven in `sapako`), gated behind a single shared password.

**Architecture:** Replace `synchronize: true` with real TypeORM migrations (unsafe against a persistent shared database), add single-password Bearer-token auth in front of every route, then produce the hosting config and a human-executed runbook for the actual account setup and data migration.

**Tech Stack:** NestJS 12 + TypeORM 1.1.0 + `pg` (backend), React 19 + Vite 8 (frontend), Postgres (local Homebrew for dev, Neon in production), Render (API hosting), Cloudflare Pages (frontend hosting), GitHub Actions (frontend CI/CD).

**Spec:** `docs/superpowers/specs/2026-09-01-deployment-design.md` — read it before starting; this plan implements it and does not repeat its reasoning.

## Global Constraints

- Never run a destructive command against the real `trader` database. The initial migration must be safe to run against it as-is (see Task 1).
- `trader_test` stays local-only; e2e tests never touch Neon.
- Every schema change from this point on goes through a migration, not an entity edit + restart.
- Auth is a single shared password (Bearer JWT), not user accounts.
- Verify backend changes via the existing test suites; verify frontend auth changes on the phone, not just `tsc`, per `working-agreement.md`.
- Do not edit files while the owner is testing on his phone — checkpoints are real stopping points.

---

## Task 1: Replace `synchronize: true` with TypeORM migrations

**Files:**
- Create: `backend/src/database/ssl.ts`
- Create: `backend/src/database/connection-options.ts`
- Create: `backend/src/database/connection-options.spec.ts`
- Create: `backend/src/database/data-source.ts`
- Create: `backend/src/database/migrate.ts`
- Create: `backend/src/database/revert.ts`
- Create: `backend/src/database/migrations/1788220800000-InitialSchema.ts`
- Create: `backend/test/setup-database.ts`
- Create: `backend/test/global-setup.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/vitest.config.e2e.ts`
- Modify: `backend/package.json`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: `buildDatabaseSsl(env: NodeJS.ProcessEnv): false | { rejectUnauthorized: boolean }` from `ssl.ts` — used by Task 4's `render.yaml` reasoning (not called from render.yaml itself, just what `DATABASE_SSL` controls).
- Produces: `buildConnectionOptions(env: NodeJS.ProcessEnv, overrideDatabase?: string): { url?: string; host?: string; port?: number; username?: string; password?: string; database?: string; ssl: DatabaseSsl }` from `connection-options.ts` — consumed by `app.module.ts` and `data-source.ts`.
- Produces: default-exported `DataSource` from `data-source.ts` — consumed by `migrate.ts`, `revert.ts`, `test/setup-database.ts`, and (in Task 2) `test/global-setup.ts`.
- Produces: `createTestDatabase(): Promise<void>` from `test/setup-database.ts` — consumed by `test/global-setup.ts`.

- [ ] **Step 1: Write `ssl.ts`**

```ts
// backend/src/database/ssl.ts
export type DatabaseSsl = false | { rejectUnauthorized: boolean };

/**
 * Whether to open the Postgres connection over TLS.
 *
 * Managed providers (Neon, Render's own Postgres) require TLS and present
 * publicly trusted certificates. A local Homebrew Postgres serves no TLS at
 * all, so this must stay off unless asked for — otherwise local development
 * breaks. Set DATABASE_SSL=true in a deployed environment.
 */
export function buildDatabaseSsl(env: NodeJS.ProcessEnv): DatabaseSsl {
  if (env.DATABASE_SSL === 'true') {
    return { rejectUnauthorized: true };
  }
  if (env.DATABASE_SSL === 'no-verify') {
    return { rejectUnauthorized: false };
  }
  return false;
}
```

- [ ] **Step 2: Write the failing test for `connection-options.ts`**

```ts
// backend/src/database/connection-options.spec.ts
import { describe, expect, it } from 'vitest';
import { buildConnectionOptions } from './connection-options.js';

describe('buildConnectionOptions', () => {
  it('uses DATABASE_URL when set, ignoring the discrete vars', () => {
    const opts = buildConnectionOptions({
      DATABASE_URL: 'postgresql://u:p@example.com:5432/neondb',
      DB_HOST: 'localhost',
      DB_NAME: 'trader',
    } as NodeJS.ProcessEnv);
    expect(opts).toEqual({
      url: 'postgresql://u:p@example.com:5432/neondb',
      ssl: false,
    });
  });

  it('falls back to discrete DB_* vars locally', () => {
    const opts = buildConnectionOptions({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'dvir',
      DB_NAME: 'trader',
    } as NodeJS.ProcessEnv);
    expect(opts).toEqual({
      host: 'localhost',
      port: 5432,
      username: 'dvir',
      password: undefined,
      database: 'trader',
      ssl: false,
    });
  });

  it('defaults host/port/database when nothing is set', () => {
    const opts = buildConnectionOptions({} as NodeJS.ProcessEnv);
    expect(opts.host).toBe('localhost');
    expect(opts.port).toBe(5432);
    expect(opts.database).toBe('trader');
  });

  it('lets overrideDatabase win over DB_NAME (the NODE_ENV=test case)', () => {
    const opts = buildConnectionOptions(
      { DB_NAME: 'trader' } as NodeJS.ProcessEnv,
      'trader_test',
    );
    expect(opts.database).toBe('trader_test');
  });

  it('reads DATABASE_SSL=true into the ssl option', () => {
    const opts = buildConnectionOptions({
      DATABASE_URL: 'postgresql://u:p@example.com:5432/neondb',
      DATABASE_SSL: 'true',
    } as NodeJS.ProcessEnv);
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run (from `backend/`): `npx vitest run src/database/connection-options.spec.ts`
Expected: FAIL — `connection-options.ts` does not exist yet.

- [ ] **Step 4: Write `connection-options.ts`**

```ts
// backend/src/database/connection-options.ts
import { buildDatabaseSsl, type DatabaseSsl } from './ssl.js';

export interface ConnectionOptions {
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl: DatabaseSsl;
}

/**
 * DATABASE_URL (Neon, Render, any managed provider) takes priority. Local
 * development has no DATABASE_URL and falls back to the discrete DB_* vars
 * `.env` already used before this file existed.
 *
 * `overrideDatabase` exists for the one caller that needs to redirect to a
 * different database by name regardless of DB_NAME — the app's own
 * NODE_ENV=test switch to `trader_test`.
 */
export function buildConnectionOptions(
  env: NodeJS.ProcessEnv,
  overrideDatabase?: string,
): ConnectionOptions {
  const ssl = buildDatabaseSsl(env);
  if (env.DATABASE_URL) {
    return { url: env.DATABASE_URL, ssl };
  }
  return {
    host: env.DB_HOST ?? 'localhost',
    port: parseInt(env.DB_PORT ?? '5432', 10),
    username: env.DB_USER,
    password: env.DB_PASSWORD || undefined,
    database: overrideDatabase ?? env.DB_NAME ?? 'trader',
    ssl,
  };
}
```

- [ ] **Step 5: Run the test again to confirm it passes**

Run: `npx vitest run src/database/connection-options.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the initial migration**

```ts
// backend/src/database/migrations/1788220800000-InitialSchema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Captures the schema exactly as it already exists locally (created by
 * `synchronize: true` up to this point) — see
 * docs/superpowers/specs/2026-09-01-deployment-design.md for why that stops
 * being safe once the database is persistent and shared.
 *
 * Every statement is IF NOT EXISTS / IF EXISTS on purpose: this migration
 * runs unchanged against a fresh database (Neon, trader_test), where it
 * creates everything, and against the existing local `trader` database,
 * where every object already exists — there it's a deliberate no-op that
 * only registers the migration as applied, rather than requiring a separate
 * manual bootstrap step. Index and unique-index names are the exact ones
 * `synchronize` already created locally (captured via
 * `pg_dump --schema-only`), so the local run is a true no-op rather than
 * creating duplicates under new names. Primary keys are declared inline
 * instead — Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, and there are no
 * foreign keys anywhere in this schema for a PK's name to matter to.
 */
export class InitialSchema1788220800000 implements MigrationInterface {
  name = 'InitialSchema1788220800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS public.users (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "displayName" character varying NOT NULL DEFAULT 'me',
        "defaultFee" numeric(12,2) NOT NULL DEFAULT '4',
        "createdAt" timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.instruments (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        symbol character varying NOT NULL,
        name character varying,
        type character varying NOT NULL DEFAULT 'STOCK',
        "isBenchmark" boolean NOT NULL DEFAULT false,
        "createdAt" timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.journal_entries (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        kind character varying NOT NULL,
        body text NOT NULL DEFAULT '',
        "occurredAt" timestamp with time zone NOT NULL,
        "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
        "updatedAt" timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.transactions (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "entryId" uuid NOT NULL,
        "instrumentId" uuid NOT NULL,
        side character varying NOT NULL,
        quantity numeric(20,8) NOT NULL,
        price numeric(20,8) NOT NULL,
        fee numeric(12,2) NOT NULL DEFAULT '0',
        "executedAt" timestamp with time zone NOT NULL,
        "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
        "plannedTarget" numeric(20,8)
      );

      CREATE TABLE IF NOT EXISTS public.cash_flows (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "entryId" uuid NOT NULL,
        direction character varying NOT NULL,
        amount numeric(20,2) NOT NULL,
        "occurredAt" timestamp with time zone NOT NULL,
        "createdAt" timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.dividends (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "entryId" uuid NOT NULL,
        "instrumentId" uuid NOT NULL,
        amount numeric(20,2) NOT NULL,
        "occurredAt" timestamp with time zone NOT NULL,
        "createdAt" timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.stop_levels (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "transactionId" uuid NOT NULL,
        kind character varying NOT NULL,
        price numeric(20,8),
        "trailPercent" numeric(8,4),
        quantity numeric(20,8) NOT NULL,
        ordinal integer NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS public.tags (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        type character varying NOT NULL,
        label character varying NOT NULL,
        "createdAt" timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.entry_tags (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "entryId" uuid NOT NULL,
        "tagId" uuid NOT NULL
      );

      CREATE TABLE IF NOT EXISTS public.daily_closes (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "instrumentId" uuid NOT NULL,
        date date NOT NULL,
        close numeric(20,8) NOT NULL,
        "adjClose" numeric(20,8) NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_4a4ecb234ee673e9a5a249c9dbf" ON public.tags ("userId", type, label);
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_82c7df74644aaf738d7f957f13d" ON public.daily_closes ("instrumentId", date);
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fc4a7f8a128e52d503b3ca9b9ff" ON public.entry_tags ("entryId", "tagId");
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_8bd2da22a1ed32dced42f6a4f2" ON public.instruments (symbol);

      CREATE INDEX IF NOT EXISTS "IDX_1255280ec8aae84d80a6278e62" ON public.dividends ("userId");
      CREATE INDEX IF NOT EXISTS "IDX_3185d7358c6e60d7289f8dc5aa" ON public.cash_flows ("entryId");
      CREATE INDEX IF NOT EXISTS "IDX_3cc77fe0d84ccee4f598cffabf" ON public.entry_tags ("entryId");
      CREATE INDEX IF NOT EXISTS "IDX_44e61325dc8eb33a6363a3a3bd" ON public.transactions ("entryId");
      CREATE INDEX IF NOT EXISTS "IDX_68b5c88c5c00ceb6abacf7d2ec" ON public.dividends ("occurredAt");
      CREATE INDEX IF NOT EXISTS "IDX_6bb58f2b6e30cb51a6504599f4" ON public.transactions ("userId");
      CREATE INDEX IF NOT EXISTS "IDX_6f87d0dd150144a190241ec8e3" ON public.daily_closes (date);
      CREATE INDEX IF NOT EXISTS "IDX_7bf17f9a0bb6a43b93ed110398" ON public.daily_closes ("instrumentId");
      CREATE INDEX IF NOT EXISTS "IDX_92e67dc508c705dd66c9461557" ON public.tags ("userId");
      CREATE INDEX IF NOT EXISTS "IDX_981d2a704a80482dbe7fd052fd" ON public.cash_flows ("occurredAt");
      CREATE INDEX IF NOT EXISTS "IDX_ac6477220567face635ee0a904" ON public.transactions ("executedAt");
      CREATE INDEX IF NOT EXISTS "IDX_af77e34d46e46d649511c8217b" ON public.cash_flows ("userId");
      CREATE INDEX IF NOT EXISTS "IDX_b462f36ede21a03142d2b6bac3" ON public.stop_levels ("transactionId");
      CREATE INDEX IF NOT EXISTS "IDX_bf5147ed303e809a150f1f4023" ON public.journal_entries ("userId");
      CREATE INDEX IF NOT EXISTS "IDX_cab47196871b7e45134d505aad" ON public.dividends ("instrumentId");
      CREATE INDEX IF NOT EXISTS "IDX_cc68fde28a0ea272889cd2b0fc" ON public.journal_entries ("occurredAt");
      CREATE INDEX IF NOT EXISTS "IDX_d4555196a2a823d8b96a80c465" ON public.dividends ("entryId");
      CREATE INDEX IF NOT EXISTS "IDX_ee223bec5e4a37de3b0525d90a" ON public.entry_tags ("tagId");
      CREATE INDEX IF NOT EXISTS "IDX_f426f2905de7b16da46f2cf73b" ON public.transactions ("instrumentId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS public.daily_closes;
      DROP TABLE IF EXISTS public.entry_tags;
      DROP TABLE IF EXISTS public.tags;
      DROP TABLE IF EXISTS public.stop_levels;
      DROP TABLE IF EXISTS public.dividends;
      DROP TABLE IF EXISTS public.cash_flows;
      DROP TABLE IF EXISTS public.transactions;
      DROP TABLE IF EXISTS public.journal_entries;
      DROP TABLE IF EXISTS public.instruments;
      DROP TABLE IF EXISTS public.users;
      DROP EXTENSION IF EXISTS "uuid-ossp";
    `);
  }
}
```

- [ ] **Step 7: Write `data-source.ts`**

```ts
// backend/src/database/data-source.ts
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildConnectionOptions } from './connection-options.js';
import { InitialSchema1788220800000 } from './migrations/1788220800000-InitialSchema.js';

// Migrations are imported explicitly rather than via a glob string. A glob
// silently matched zero files under some execution contexts in a sibling
// project (sapako), which made runMigrations() report success while doing
// nothing. New migrations must be added to this array by hand, in order.
const dataSource = new DataSource({
  type: 'postgres',
  ...buildConnectionOptions(process.env),
  migrations: [InitialSchema1788220800000],
  synchronize: false,
});

export default dataSource;
```

- [ ] **Step 8: Write `migrate.ts` and `revert.ts`**

```ts
// backend/src/database/migrate.ts
// Runs migrations via the DataSource API directly rather than TypeORM's own
// CLI (`typeorm migration:run`) — that CLI requires ts-node, which isn't a
// dependency here (this project uses vitest, not ts-node/jest), and the
// installed TypeORM version's CLI entrypoint hard-requires it regardless.
// This script has no such dependency and is what actually runs, both
// locally (via tsx) and in production (compiled, via plain node).
import dataSource from './data-source.js';

dataSource
  .initialize()
  .then(() => dataSource.runMigrations())
  .then(() => dataSource.destroy())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

```ts
// backend/src/database/revert.ts
import dataSource from './data-source.js';

dataSource
  .initialize()
  .then(() => dataSource.undoLastMigration())
  .then(() => dataSource.destroy())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 9: Add the new dependencies and scripts to `backend/package.json`**

Add to `dependencies`: `"dotenv": "^17.4.2"`.
Add to `devDependencies`: `"tsx": "^4.23.13"`.
Add to `scripts`:

```json
"migration:run": "tsx src/database/migrate.ts",
"migration:revert": "tsx src/database/revert.ts",
```

Then, from `backend/`: `npm install`

- [ ] **Step 10: Write `test/setup-database.ts`**

```ts
// backend/test/setup-database.ts
import { Client } from 'pg';
import dataSource from '../src/database/data-source.js';

const TEST_DB_NAME = 'trader_test';

/**
 * e2e tests run only against a local Postgres — trader_test is dropped and
 * recreated once per run, not truncated, so a schema change between runs
 * can't leave a stale database that fails in confusing ways. This never
 * touches Neon or the real `trader` database: the name is hardcoded here,
 * and data-source.ts's DATABASE_URL branch is never set for a local test
 * run — if it were, this would need to target it differently, which is why
 * this helper doesn't try to generalize to that case.
 */
export async function createTestDatabase(): Promise<void> {
  const admin = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || undefined,
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  await dataSource.setOptions({ database: TEST_DB_NAME }).initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}
```

- [ ] **Step 11: Write `test/global-setup.ts`**

```ts
// backend/test/global-setup.ts
import { createTestDatabase } from './setup-database.js';

export default async function globalSetup(): Promise<void> {
  await createTestDatabase();
}
```

- [ ] **Step 12: Wire the global setup into the e2e config**

In `backend/vitest.config.e2e.ts`, add `globalSetup: ['./test/global-setup.ts']` to the `test` object:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
  },
});
```

(Only the `globalSetup` line is new — keep the existing comment on `fileParallelism` as-is.)

- [ ] **Step 13: Point `app.module.ts` at the shared connection options and turn `synchronize` off**

```ts
// backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';
import { InstrumentsModule } from './instruments/instruments.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';
import { JournalModule } from './journal/journal.module.js';
import { PerformanceModule } from './performance/performance.module.js';
import { buildConnectionOptions } from './database/connection-options.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        ...buildConnectionOptions(
          process.env,
          process.env.NODE_ENV === 'test' ? 'trader_test' : undefined,
        ),
        autoLoadEntities: true,
        // Schema now comes from src/database/migrations — see
        // docs/superpowers/specs/2026-09-01-deployment-design.md for why
        // synchronize is unsafe against a persistent shared database.
        synchronize: false,
      }),
    }),
    UsersModule,
    InstrumentsModule,
    JournalModule,
    PortfolioModule,
    PerformanceModule,
    HealthModule,
  ],
})
export class AppModule {}
```

(Task 2 adds `AuthModule` to this `imports` array — leave room but don't add it yet.)

- [ ] **Step 14: Run the full e2e suite**

Run (from `backend/`): `npm run test:e2e`
Expected: PASS — `global-setup.ts` drops/recreates `trader_test`, runs the migration fresh against it (proving `up()` works against an empty database), then every existing e2e spec passes against the migrated schema exactly as it did against the synchronized one.

- [ ] **Step 15: Run the backend unit suite**

Run (from `backend/`): `npm test`
Expected: PASS, including the new `connection-options.spec.ts`.

- [ ] **Step 16: Baseline the real local `trader` database**

This is the one-time step that gets the migration bookkeeping table into your existing local database — necessary once, never again. Because every statement in the migration is `IF NOT EXISTS`, this is a safe no-op against schema that already matches.

Run (from `backend/`): `npm run migration:run`
Expected output ends with `query: SELECT ... FROM "migrations" ...` followed by no errors, and no `CREATE TABLE` actually creating anything new (everything already exists). Verify with:

```bash
psql -d trader -c 'SELECT name FROM migrations;'
```

Expected: one row, `InitialSchema1788220800000`.

- [ ] **Step 17: Sanity-check local dev still boots against the real database**

Run (from repo root): `npm run dev`, then in another terminal: `curl -s http://localhost:3000/health`
Expected: `{"status":"ok","database":"ok","userId":"<uuid>"}` — same as before this task, since `synchronize: false` changes nothing when the schema already matches. Stop the dev server after checking.

- [ ] **Step 18: Update `CLAUDE.md`'s known-shortcuts note**

In the `## Known shortcuts` section, replace:

```
- `synchronize: true` — no migrations yet. Fine while the data is one local
  user's.
```

with:

```
- Schema changes go through TypeORM migrations
  (`backend/src/database/migrations/`), not `synchronize: true` — that
  stopped being safe once production runs against a persistent, shared
  Neon database. Run `npm run migration:run` after adding one, in both
  local `trader` and (per `docs/DEPLOYMENT.md`) production.
```

- [ ] **Step 19: Commit**

```bash
git add backend/src/database backend/test/setup-database.ts backend/test/global-setup.ts \
  backend/src/app.module.ts backend/vitest.config.e2e.ts backend/package.json backend/package-lock.json \
  CLAUDE.md
git commit -m "feat: replace synchronize:true with TypeORM migrations"
```

---

## Task 2: Single-password auth (Bearer JWT)

**Files:**
- Create: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/jwt-auth.guard.ts`
- Create: `backend/src/auth/public.decorator.ts`
- Create: `backend/src/auth/dto/login.dto.ts`
- Create: `backend/test/http.ts`
- Create: `backend/test/auth.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/src/health/health.controller.ts`
- Modify: `backend/test/global-setup.ts`
- Modify: `backend/test/health.e2e-spec.ts`
- Modify: `backend/test/portfolio.e2e-spec.ts`
- Modify: `backend/test/journal.e2e-spec.ts`
- Modify: `backend/test/instruments.e2e-spec.ts`
- Modify: `backend/test/history.e2e-spec.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond what's already in `app.module.ts`.
- Produces: `POST /auth/login` accepting `{ password: string }`, returning `{ accessToken: string }` on success or 401 on failure.
- Produces: `Public()` decorator (from `public.decorator.ts`) — marks a route exempt from the global guard. Used on `/auth/login` and the new `GET /health/ping`.
- Produces: `login(app: INestApplication): Promise<string>` and `http(app: INestApplication, token: string): { get, post, patch, delete }` from `test/http.ts` — consumed by every other e2e spec file in this task.

- [ ] **Step 1: Add the new dependencies**

Add to `backend/package.json` `dependencies`: `"@nestjs/jwt": "^12.0.1"`, `"bcryptjs": "^3.0.3"`.
Then, from `backend/`: `npm install`

- [ ] **Step 2: Write the public-route decorator**

```ts
// backend/src/auth/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 3: Write the login DTO**

```ts
// backend/src/auth/dto/login.dto.ts
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  password!: string;
}
```

- [ ] **Step 4: Write the auth service**

```ts
// backend/src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(password: string): Promise<{ accessToken: string }> {
    const hash = process.env.APP_PASSWORD_HASH;
    if (!hash || !(await compare(password, hash))) {
      throw new UnauthorizedException('Wrong password');
    }
    return { accessToken: await this.jwt.signAsync({ sub: 'owner' }) };
  }
}
```

- [ ] **Step 5: Write the guard**

```ts
// backend/src/auth/jwt-auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header = req.headers.authorization as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing token');

    try {
      await this.jwt.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

- [ ] **Step 6: Write the controller**

```ts
// backend/src/auth/auth.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.password);
  }
}
```

- [ ] **Step 7: Write the module**

`JwtModule.registerAsync` (not `register`) matters here: a static `register()` call reads `process.env.JWT_SECRET` the moment this file is first imported, which — because of how NestJS resolves the module graph — can happen before `ConfigModule.forRoot()` has loaded `.env`. `registerAsync`'s factory runs later, during dependency injection, after that's settled.

```ts
// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 8: Register `AuthModule` in `app.module.ts`**

Add the import and add `AuthModule` to the `imports` array (after `HealthModule`):

```ts
import { AuthModule } from './auth/auth.module.js';
```

```ts
    HealthModule,
    AuthModule,
```

- [ ] **Step 9: Add the DB-free keep-warm endpoint**

```ts
// backend/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsersService } from '../users/users.service.js';
import { Public } from '../auth/public.decorator.js';

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

  // Deliberately DB-free — this is what the external keep-warm pinger hits
  // every 5 minutes (see docs/DEPLOYMENT.md). Touching the database here
  // would keep re-waking Neon continuously and risk its free CU-hour cap.
  @Public()
  @Get('ping')
  ping() {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 10: Add CORS support to `main.ts`**

```ts
// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Unset locally: the frontend and backend are the same origin there
  // (Vite's dev proxy), so no CORS handling is needed. In production the
  // frontend is on Cloudflare Pages, a different origin — see render.yaml.
  if (process.env.WEB_ORIGINS) {
    app.enableCors({
      origin: process.env.WEB_ORIGINS.split(',').map((o) => o.trim()),
    });
  }
  // 0.0.0.0 so the phone on the same Wi-Fi can reach it.
  await app.listen(3000, '0.0.0.0');
}
void bootstrap();
```

- [ ] **Step 11: Set the e2e test password hash before the app ever boots**

```ts
// backend/test/global-setup.ts
import { hashSync } from 'bcryptjs';
import { createTestDatabase } from './setup-database.js';

export default async function globalSetup(): Promise<void> {
  // Must be set before any spec file's beforeAll boots the app —
  // AuthService reads this from process.env on every login call.
  process.env.APP_PASSWORD_HASH = hashSync('e2e-test-password', 10);
  await createTestDatabase();
}
```

- [ ] **Step 12: Write the shared e2e auth helper**

```ts
// backend/test/http.ts
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

const TEST_PASSWORD = 'e2e-test-password';

/**
 * Every protected route now requires a bearer token. Logging in once per
 * spec file and reusing the token keeps each test focused on what it's
 * actually checking, instead of repeating a login call in every case.
 */
export async function login(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ password: TEST_PASSWORD })
    .expect(201);
  return res.body.accessToken as string;
}

type Method = 'get' | 'post' | 'patch' | 'delete';

/**
 * Same call shape as `request(app.getHttpServer())`, with the bearer token
 * already attached — a drop-in replacement so existing spec bodies don't
 * need to change beyond the token being in scope.
 */
export function http(app: INestApplication, token: string) {
  const bound = (method: Method) => (path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
  return {
    get: bound('get'),
    post: bound('post'),
    patch: bound('patch'),
    delete: bound('delete'),
  };
}
```

- [ ] **Step 13: Write the auth e2e spec**

```ts
// backend/test/auth.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects the wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'not-the-password' })
      .expect(401);
  });

  it('issues a token for the correct password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'e2e-test-password' })
      .expect(201);
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('blocks a protected route without a token', async () => {
    await request(app.getHttpServer()).get('/portfolio').expect(401);
  });

  it('blocks a protected route with a garbage token', async () => {
    await request(app.getHttpServer())
      .get('/portfolio')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
  });

  it('allows /health/ping with no token', async () => {
    await request(app.getHttpServer()).get('/health/ping').expect(200);
  });
});
```

- [ ] **Step 14: Run the new spec on its own**

Run (from `backend/`): `npm run test:e2e -- auth.e2e-spec`
Expected: PASS, 5 tests. (The other spec files will fail at this point — that's expected, fixed in the next steps.)

- [ ] **Step 15: Rewrite `test/health.e2e-spec.ts`**

```ts
// backend/test/health.e2e-spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { http, login } from './http.js';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database is reachable and a default user exists', async () => {
    const res = await http(app, token).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('ok');
    expect(res.body.userId).toEqual(expect.any(String));
  });

  it('serves /health/ping with no token, touching no database state', async () => {
    const res = await request(app.getHttpServer()).get('/health/ping').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 16: Retrofit `test/portfolio.e2e-spec.ts`**

Three edits to the top of the file (the many call sites below are handled by one `replace_all` in the last edit):

1. Replace `import request from 'supertest';` with `import { http, login } from './http.js';`
2. Replace:
   ```ts
     let app: INestApplication;
     let dataSource: DataSource;
   ```
   with:
   ```ts
     let app: INestApplication;
     let dataSource: DataSource;
     let token: string;
   ```
3. Replace:
   ```ts
       await app.init();
       dataSource = app.get(DataSource);
     });
   ```
   with:
   ```ts
       await app.init();
       dataSource = app.get(DataSource);
       token = await login(app);
     });
   ```
4. `replace_all` every occurrence of `request(app.getHttpServer())` with `http(app, token)`.

- [ ] **Step 17: Retrofit `test/journal.e2e-spec.ts`**

Same four edits as Step 16, applied to this file (it has the same `let app` / `dataSource` / `await app.init(); dataSource = app.get(DataSource);` shape).

- [ ] **Step 18: Retrofit `test/history.e2e-spec.ts`**

Same four edits as Step 16, applied to this file (same shape).

- [ ] **Step 19: Retrofit `test/instruments.e2e-spec.ts`**

This file has no `dataSource` line, so the declaration and setup edits differ slightly:

1. Replace `import request from 'supertest';` with `import { http, login } from './http.js';`
2. Replace:
   ```ts
     let app: INestApplication;
   ```
   with:
   ```ts
     let app: INestApplication;
     let token: string;
   ```
3. Replace:
   ```ts
       await app.init();
     });
   ```
   with:
   ```ts
       await app.init();
       token = await login(app);
     });
   ```
4. `replace_all` every occurrence of `request(app.getHttpServer())` with `http(app, token)`.

- [ ] **Step 20: Run the full e2e suite**

Run (from `backend/`): `npm run test:e2e`
Expected: PASS — all five spec files, every previously-passing case still passes, now authenticated.

- [ ] **Step 21: Run the unit suite**

Run (from `backend/`): `npm test`
Expected: PASS.

- [ ] **Step 22: Commit**

```bash
git add backend/src/auth backend/src/app.module.ts backend/src/main.ts backend/src/health/health.controller.ts \
  backend/test backend/package.json backend/package-lock.json
git commit -m "feat: single-password Bearer-token auth"
```

---

## Task 3: Frontend login + cross-origin API calls

**Files:**
- Create: `frontend/src/lib/auth.ts`
- Create: `frontend/src/lib/auth.spec.ts`
- Create: `frontend/src/routes/Login.tsx`
- Create: `frontend/src/vite-env.d.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: nothing from the backend tasks directly (talks to `POST /auth/login` and reads `401` responses, both already shipped in Task 2).
- Produces: `getToken(): string | null`, `setToken(token: string): void`, `clearToken(): void` from `lib/auth.ts` — consumed by `api/client.ts` and `routes/Login.tsx`.

- [ ] **Step 1: Write the failing test for the token store**

```ts
// frontend/src/lib/auth.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, getToken, setToken } from './auth';

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('window', { localStorage: impl });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  const store = new Map<string, string>();
  stubStorage({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
});

describe('auth token storage', () => {
  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('round-trips a token', () => {
    setToken('abc.def.ghi');
    expect(getToken()).toBe('abc.def.ghi');
  });

  it('clears a token', () => {
    setToken('abc.def.ghi');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('survives storage that throws on read', () => {
    stubStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(getToken()).toBeNull();
  });

  it('survives storage that throws on write', () => {
    stubStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    });
    expect(() => setToken('x')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run (from `frontend/`): `npx vitest run src/lib/auth.spec.ts`
Expected: FAIL — `./auth` does not exist yet.

- [ ] **Step 3: Write `lib/auth.ts`**

```ts
// frontend/src/lib/auth.ts
/**
 * Guarded the same way lib/draftStorage.ts is: localStorage throws outright
 * in some privacy modes, and a failure here must never break the app —
 * worst case, the user is asked to log in again.
 */
const KEY = 'trader.authToken.v1';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // Storage full or blocked — login still works, it just won't persist.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; a stale token left behind is harmless.
  }
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run src/lib/auth.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Declare the build-time env var's type**

```ts
// frontend/src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The backend's origin in production (e.g. https://trader-backend.onrender.com),
   * baked in at build time by the Cloudflare Pages workflow. Empty locally,
   * where the frontend and backend are the same origin via Vite's dev proxy.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 6: Update the API client for a configurable base URL and 401 handling**

```ts
// frontend/src/api/client.ts
import { clearToken, getToken } from '../lib/auth';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Relative locally, so Vite's dev proxy handles it and it works from
 * localhost and the phone alike. In production BASE_URL is the backend's
 * absolute origin, baked in at build time — see
 * docs/superpowers/specs/2026-09-01-deployment-design.md.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  if (res.status === 401) {
    clearToken();
    if (!path.startsWith('/auth/login')) {
      window.location.href = '/login';
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 7: Write the login screen**

```tsx
// frontend/src/routes/Login.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { setToken } from '../lib/auth';

export function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { accessToken } = await api<{ accessToken: string }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ password }) },
      );
      setToken(accessToken);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Wrong password'
          : 'Could not reach the server',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6">
      <h1 className="mb-6 text-center text-lg font-semibold text-text">
        Trader
      </h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3 text-text"
        />
        {error && <p className="text-sm text-down">{error}</p>}
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-surface-0 disabled:opacity-50"
        >
          {submitting ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: Add the `/login` route**

```tsx
// frontend/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RestoreLocation } from './components/RestoreLocation';
import { Dashboard } from './routes/Dashboard';
import { TickerProbe } from './routes/TickerProbe';
import { Seed } from './routes/Seed';
import { Journal } from './routes/Journal';
import { Login } from './routes/Login';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RestoreLocation />
        <Routes>
          <Route path="login" element={<Login />} />
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="journal" element={<Journal />} />
            <Route path="seed" element={<Seed />} />
            <Route path="probe" element={<TickerProbe />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

(Only the `Login` import and the new `<Route path="login" .../>` line are new.)

- [ ] **Step 9: Run the frontend unit suite**

Run (from `frontend/`): `npm test`
Expected: PASS.

- [ ] **Step 10: Typecheck**

Run (from `frontend/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 11: Set a local test password and verify on the phone**

This is a real checkpoint, not just a build check — per `working-agreement.md`, verify on the device, not only the type checker.

1. Generate a bcrypt hash for a password of your choice:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'your-chosen-password'
   ```
2. Add to `backend/.env`: `APP_PASSWORD_HASH=<the hash printed above>`
3. `npm run dev` from the repo root.
4. On your phone (same Wi-Fi, as before): load the app. Expect the login screen (no valid token yet on this device). Enter the wrong password — expect "Wrong password". Enter the right one — expect it to land on the Dashboard and stay logged in across a reload.

**STOP — do not proceed to Task 4 until this checkpoint is confirmed working on the phone.**

- [ ] **Step 12: Commit**

```bash
git add frontend/src/lib/auth.ts frontend/src/lib/auth.spec.ts frontend/src/routes/Login.tsx \
  frontend/src/vite-env.d.ts frontend/src/api/client.ts frontend/src/main.tsx
git commit -m "feat: login screen and bearer-token API calls"
```

*(Do not commit `backend/.env` — it's already gitignored; the checkpoint's password hash was for local testing only. Task 4 covers setting the real one on Render.)*

---

## Task 4: Deployment artifacts and runbook

**Files:**
- Create: `render.yaml`
- Create: `.github/workflows/deploy-web.yml`
- Create: `docs/DEPLOYMENT.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the `startCommand` in `render.yaml` calls `node dist/database/migrate.js`, the compiled output of Task 1's `backend/src/database/migrate.ts`.
- Consumes: the GitHub Actions workflow's build step reads a `VITE_API_BASE_URL` repository variable, consumed by Task 3's `frontend/src/api/client.ts` via `import.meta.env.VITE_API_BASE_URL`.
- Produces: nothing further code consumes — this task's outputs are read by Render, Cloudflare, and the owner following the runbook.

- [ ] **Step 1: Write `render.yaml`**

```yaml
# render.yaml
# Render Blueprint for the Trader API.
#
# Postgres lives on Neon rather than Render: Render's own free Postgres
# expires after a fixed period, whereas Neon's free tier does not. The
# database is therefore NOT declared here — DATABASE_URL is set by hand
# (see docs/DEPLOYMENT.md).
#
# Free web services sleep after roughly 15 minutes idle. See
# docs/DEPLOYMENT.md for the keep-warm ping that prevents that in
# practice — it targets /health/ping (no database access), not this
# file's healthCheckPath, which Render itself only calls at deploy time.

services:
  - type: web
    name: trader-backend
    runtime: node
    plan: free
    region: frankfurt
    rootDir: backend
    # devDependencies are needed to compile (nest build, typescript), then
    # pruned: nothing in the runtime path needs them, and the free instance
    # has 512 MB to work with.
    buildCommand: npm ci --include=dev && npm run build && npm prune --omit=dev
    # Migrations run from compiled output, not tsx — see
    # src/database/migrate.ts for why the equivalent local script avoids
    # TypeORM's own CLI.
    startCommand: node dist/database/migrate.js && node dist/main
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION
        value: 22.13.0
      # Neon requires TLS; local Postgres serves none — off by default in
      # code, so it must be turned on explicitly here.
      - key: DATABASE_SSL
        value: 'true'
      # sync: false means "prompt me for this, do not store it in the repo".
      - key: DATABASE_URL
        sync: false
      - key: WEB_ORIGINS
        sync: false
      - key: APP_PASSWORD_HASH
        sync: false
      - key: JWT_SECRET
        generateValue: true
```

- [ ] **Step 2: Write the Cloudflare Pages deploy workflow**

```yaml
# .github/workflows/deploy-web.yml
name: deploy-web

# Builds the frontend and deploys it to Cloudflare Pages. Pushing any
# branch produces a preview at <branch>.trader-app.pages.dev — open it on
# the phone before merging. Pushing main deploys production.
#
# See docs/DEPLOYMENT.md for the one-time Cloudflare/Render/Neon account
# setup this depends on.

on:
  push:
    branches: ['**']
    paths:
      - 'frontend/**'
      - '.github/workflows/deploy-web.yml'
  workflow_dispatch:

concurrency:
  group: deploy-web-${{ github.ref }}
  cancel-in-progress: true

env:
  PROJECT: trader-app

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - run: npm ci

      - name: Typecheck + build
        env:
          VITE_API_BASE_URL: ${{ vars.VITE_API_BASE_URL }}
        run: |
          if [ -z "$VITE_API_BASE_URL" ]; then
            echo "::error::The VITE_API_BASE_URL repository variable is not set. Without it the production build would call relative /api paths that don't exist on Cloudflare Pages, and every screen would fail to load."
            exit 1
          fi
          npm run build

      - name: Test
        run: npm test

      - name: Ensure the Cloudflare Pages project exists
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          if ! npx wrangler@3 pages project list 2>/dev/null | grep -qw "$PROJECT"; then
            npx wrangler@3 pages project create "$PROJECT" --production-branch main
          fi

      - name: Deploy
        id: deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          npx wrangler@3 pages deploy dist \
            --project-name "$PROJECT" \
            --branch "$GITHUB_REF_NAME" \
            --commit-dirty=true | tee deploy.log
          url=$(grep -oE 'https://[a-z0-9.-]+\.pages\.dev' deploy.log | tail -1)
          echo "url=$url" >> "$GITHUB_OUTPUT"

      - name: Publish the URL to the run summary
        run: |
          {
            echo "### Trader web — \`$GITHUB_REF_NAME\`"
            echo ""
            echo "**${{ steps.deploy.outputs.url }}**"
            echo ""
            if [ "$GITHUB_REF_NAME" = "main" ]; then
              echo "Production. Also reachable at https://$PROJECT.pages.dev"
            else
              echo "Preview. Open it in Safari on the iPhone to test before merging."
            fi
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 3: Write the deployment runbook**

```markdown
# docs/DEPLOYMENT.md

# Deployment

Three pieces, each on a free tier — the same combination already proven in
the sibling `sapako` project:

| Piece | Host | Config |
|---|---|---|
| Frontend | Cloudflare Pages | `.github/workflows/deploy-web.yml` |
| API | Render | `render.yaml` |
| Postgres | Neon | none — connection string set by hand |

Postgres is on Neon rather than Render because Render's free Postgres
expires after a fixed period while Neon's free tier does not.

## 1. Neon (database)

1. Create a project at neon.tech. Region: choose the one nearest Render's
   (`frankfurt` in `render.yaml`) — every query crosses this gap.
2. Copy the **pooled** connection string. It looks like
   `postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   The pooled endpoint matters: a free Render instance restarts often and
   would otherwise exhaust direct connections.

## 2. Generate the password hash

Trader has one shared password, not accounts. Generate its bcrypt hash
locally (never commit the plaintext password or the hash):

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'choose-a-real-password'
```

Keep the printed hash for the next step.

## 3. Render (API)

1. Render dashboard → New → **Blueprint** → connect this repo. It reads
   `render.yaml`, so nothing else is configured by hand in the UI.
2. It prompts for the four `sync: false` variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Neon pooled string from step 1 |
   | `WEB_ORIGINS` | `https://trader-app.pages.dev` (plus any custom domain, comma-separated) |
   | `APP_PASSWORD_HASH` | the hash from step 2 |

   `JWT_SECRET` is generated by Render. `DATABASE_SSL=true` is already set in
   the blueprint — Neon requires TLS, and the code defaults it off so local
   Postgres still works.
3. First deploy runs the migration, then boots. Note the service URL:
   `https://trader-backend.onrender.com`.

## 4. Cloudflare Pages (frontend)

1. In this GitHub repo's settings, add:
   - Secret `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with Pages edit
     permission.
   - Secret `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard.
   - Repository variable `VITE_API_BASE_URL` — the Render URL from step 3
     (`https://trader-backend.onrender.com`).
2. Push to `main` (or run the `deploy-web` workflow manually). It creates
   the Cloudflare Pages project on first run and deploys.
3. Note the production URL: `https://trader-app.pages.dev`.

## 5. Keep the API warm

A free Render web service sleeps after ~15 minutes idle and takes roughly 50
seconds to wake. For an app opened several times a day, that's a 50-second
spinner each time it's been idle.

Render's free tier allows 750 instance hours a month. A service kept awake
around the clock uses about 730, so a permanent keep-warm ping fits inside
the cap — but only for a single free service.

1. Create a free account at uptimerobot.com.
2. Add an **HTTP(s)** monitor:
   - URL: `https://trader-backend.onrender.com/health/ping`
   - Interval: 5 minutes.
3. That's all. `/health/ping` returns a static `{"status":"ok"}` and touches
   no database (`backend/src/health/health.controller.ts`) — the ping keeps
   Render's instance awake without waking Neon or spending its database
   compute every five minutes.

This does not remove the cold start after a deploy, or if the ping lapses,
and it does not need to help the database — Neon's own free-tier
scale-to-zero wakes in well under a second, which nobody notices.

## 6. Move the real portfolio data

Only after steps 1–5 are deployed and you've confirmed you can log into the
**empty** production app from your phone (off Wi-Fi, to prove it's actually
public), move your real data over. Run locally, once:

```bash
pg_dump -d trader --no-owner --no-privileges --no-comments \
  --exclude-table=migrations > /tmp/trader-data.sql
psql "<the Neon pooled connection string>" < /tmp/trader-data.sql
```

`--exclude-table=migrations` matters: Neon already has its own migrations
bookkeeping row from Render's first deploy, and this dump should only add
data, not fight over migration history.

Verify row counts match before trusting it:

```bash
psql -d trader -c "SELECT count(*) FROM transactions;"
psql "<the Neon pooled connection string>" -c "SELECT count(*) FROM transactions;"
```

Repeat for `cash_flows`, `journal_entries`, and `dividends`. This is a
one-time, by-hand step — not a script that could be run twice by accident.

## Environments

There is no staging environment, deliberately. `main` is production; work is
built and tested locally, then pushed. Every branch pushed to GitHub gets its
own Cloudflare preview URL for testing on a real phone before merging.

## Local development

Unchanged, except schema changes now go through a migration:

```bash
npm run dev          # from the repo root, as before
```

After adding a migration file to `backend/src/database/migrations/` and
registering it in `backend/src/database/data-source.ts`:

```bash
cd backend && npm run migration:run
```
```

- [ ] **Step 4: Add a Deployment section to `CLAUDE.md`**

Add a new section after `## Running it`:

```markdown
## Deployment

Production runs on Cloudflare Pages (frontend) + Render (API) + Neon
(Postgres) — see `docs/DEPLOYMENT.md` for account setup, environment
variables, and the keep-warm/data-migration runbook. Local development is
unaffected; `main` deploys automatically on push.
```

And in the documentation map table, add a row:

```markdown
| `docs/DEPLOYMENT.md` | How to deploy, and the account setup behind it | On demand |
```

- [ ] **Step 5: Validate the YAML files parse**

Run: `python3 -c "import yaml; yaml.safe_load(open('render.yaml'))"`
Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-web.yml'))"`
Expected: no errors from either.

- [ ] **Step 6: Commit**

```bash
git add render.yaml .github/workflows/deploy-web.yml docs/DEPLOYMENT.md CLAUDE.md
git commit -m "docs+ci: deployment config and runbook (Cloudflare Pages + Render + Neon)"
```

- [ ] **Step 7: Checkpoint — hand off to the owner**

Everything past this point requires accounts only the owner can create
(Neon, Render, Cloudflare, GitHub secrets) and his real password choice.
Walk him through `docs/DEPLOYMENT.md` steps 1–6 live rather than
proceeding further unattended — this is exactly the "ask before doing
anything outward-facing" boundary from `working-agreement.md`.
