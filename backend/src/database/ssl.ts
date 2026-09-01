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
