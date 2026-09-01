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
  if (process.env.DATABASE_URL) {
    throw new Error(
      'e2e tests must never run with DATABASE_URL set — unset it to run against local Postgres.',
    );
  }
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
