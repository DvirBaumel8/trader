import { describe, expect, it } from 'vitest';
import { chooseDatabaseMode } from './database-mode.js';

describe('chooseDatabaseMode', () => {
  it('uses the managed database when DATABASE_URL is set', () => {
    expect(chooseDatabaseMode({ DATABASE_URL: 'postgres://x/y' })).toBe('external');
  });

  /**
   * The bug this exists to prevent. localhost was treated as "no real
   * database configured", so every local run silently ignored the owner's
   * Postgres and started from an empty in-memory one. His local database sat
   * untouched for a week while he believed he was testing against it — and a
   * boot against an empty database created a second, phantom user row in
   * PRODUCTION, which had to be deleted by hand.
   *
   * A local Postgres is a real database.
   */
  it('uses a local Postgres rather than inventing one', () => {
    expect(chooseDatabaseMode({ DB_HOST: 'localhost', DB_NAME: 'trader' })).toBe(
      'external',
    );
    expect(chooseDatabaseMode({ DB_HOST: '127.0.0.1', DB_NAME: 'trader' })).toBe(
      'external',
    );
  });

  it('uses a remote host configured through the discrete vars', () => {
    expect(chooseDatabaseMode({ DB_HOST: 'db.example.com' })).toBe('external');
  });

  /**
   * Nothing configured is an error, not an invitation to invent a database.
   * Serving an empty portfolio as though it were real is the exact failure
   * the honest-numbers rule exists to prevent, and it is worse than not
   * booting: the app looks fine and the data looks gone.
   */
  it('refuses to guess when nothing is configured', () => {
    expect(chooseDatabaseMode({})).toBe('unconfigured');
  });
});
