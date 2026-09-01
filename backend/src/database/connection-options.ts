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
  if (env.DATABASE_URL && !overrideDatabase) {
    return { url: env.DATABASE_URL, ssl };
  }
  if (env.DATABASE_URL && overrideDatabase) {
    // An explicit database override (the NODE_ENV=test redirect to
    // trader_test) must never be silently discarded — that's the guard
    // that keeps tests off a real, possibly-production database.
    throw new Error(
      `Refusing to redirect a DATABASE_URL connection to "${overrideDatabase}" — unset DATABASE_URL to run against a local database.`,
    );
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
