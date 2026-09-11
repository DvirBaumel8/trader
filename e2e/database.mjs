import { Client } from 'pg';
import { execFileSync } from 'node:child_process';

/**
 * The browser suite's database: created empty for every run, dropped after.
 *
 * Plain JavaScript, not TypeScript, because it is invoked two ways — from
 * Playwright's teardown hook and from the shell command that starts the test
 * server — and one implementation both can load beats two that drift.
 *
 * Hard-coded name, and an outright refusal when DATABASE_URL is set: the same
 * guard `test/setup-database.ts` carries, for the same reason. A test-prep
 * reset once destroyed the owner's real seeded portfolio, and the rule that
 * came out of it is that verification never runs destructive commands against
 * a database that might be his.
 */
export const E2E_DB = 'trader_e2e';

function refuseIfManaged() {
  if (process.env.DATABASE_URL) {
    throw new Error(
      'Browser tests must never run with DATABASE_URL set — that points at a ' +
        'managed database, quite possibly production. Unset it.',
    );
  }
}

function adminClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || undefined,
    database: 'postgres',
  });
}

/**
 * Dropped and recreated, not truncated. A crashed previous run leaves rows
 * behind, and "empty" has to mean empty however the last one ended.
 */
export async function createFreshDatabase({ cwd }) {
  refuseIfManaged();
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${E2E_DB}`);
  await admin.end();

  // Through the app's own migrate script, so the browser suite exercises the
  // same path a deploy does rather than a second one that could drift.
  execFileSync('node', ['dist/database/migrate.js'], {
    cwd,
    env: { ...process.env, DB_NAME: E2E_DB },
    stdio: 'inherit',
  });
}

export async function dropDatabase() {
  refuseIfManaged();
  const admin = adminClient();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  await admin.end();
}
