import dataSource from './data-source.js';
import { chooseDatabaseMode } from './database-mode.js';

let ready = false;

/**
 * Connect to the configured database and bring its schema up to date, or
 * refuse to start.
 *
 * This replaces a function that would silently substitute an in-memory
 * database when it decided none was configured — and it decided that whenever
 * `DB_HOST` was localhost, which is to say on every local run. The owner's
 * Postgres sat untouched for a week while he believed he was testing against
 * it, and a boot against an empty database wrote a phantom user row into
 * PRODUCTION that had to be deleted by hand.
 *
 * There is no fallback now. A database is configured or the process stops.
 */
export async function ensureDatabaseReady(): Promise<void> {
  if (ready) return;

  if (chooseDatabaseMode(process.env) === 'unconfigured') {
    /**
     * Loud, and deliberately unhelpful about carrying on. Inventing an empty
     * database is how a running app reports a zero portfolio as fact — worse
     * than not booting, because everything looks fine and only the data looks
     * gone.
     */
    throw new Error(
      'No database configured. Set DATABASE_URL (managed) or DB_HOST/DB_NAME ' +
        '(local Postgres).',
    );
  }

  try {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    await dataSource.runMigrations();
    console.log('[trader] Database ready, migrations up to date');
  } catch (err) {
    /**
     * Rethrown, not warned about. This used to log a warning and carry on,
     * so a failed migration left the app serving requests against a schema it
     * did not match — surfacing as "column does not exist" from random
     * screens rather than as a boot failure anyone would notice. A deploy
     * that cannot migrate has not succeeded.
     */
    throw new Error(
      `Database migrations failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy().catch(() => undefined);
    }
  }

  ready = true;
}
