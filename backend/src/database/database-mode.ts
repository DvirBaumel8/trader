/**
 * Which database this process should talk to.
 *
 * Its own pure function because getting it wrong is invisible and expensive.
 * The previous logic treated `DB_HOST=localhost` as "no real database
 * configured" and silently substituted an in-memory one, so every local run
 * ignored the owner's Postgres and started empty — his local database sat
 * untouched for a week while he believed he was testing against it, and a
 * boot against an empty database created a phantom user row in PRODUCTION
 * that had to be deleted by hand.
 *
 * The rule now: a configured database is used, an in-memory one is an
 * explicit request, and nothing configured is an error. Never a guess.
 */
export type DatabaseMode = 'external' | 'unconfigured';

export function chooseDatabaseMode(env: NodeJS.ProcessEnv): DatabaseMode {
  // A local Postgres is a real database. That sentence is the whole fix: the
  // previous logic asked whether the host was localhost and, if so, invented
  // an in-memory database instead. There is no in-memory mode any more — it
  // served no one and cost a phantom row in production.
  if (env.DATABASE_URL || env.DB_HOST || env.DB_NAME) return 'external';

  return 'unconfigured';
}
