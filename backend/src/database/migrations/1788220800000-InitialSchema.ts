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
