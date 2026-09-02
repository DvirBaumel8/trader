import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stops used to be overwritten in place: trailing a stop deleted the old
 * `stop_levels` rows and wrote fresh ones, so the stop recorded at entry —
 * the thing that defines risk and R-multiple — was destroyed the moment it
 * was ever moved. Every closed trade in the real data now shows a stop that
 * sits on the *wrong* side of entry for a long (above it) because what
 * survived is the final trailed stop, not the original.
 *
 * The fix: stop tiers are never deleted or edited again once written. A
 * revision is a set of rows (one per tier) sharing a `revisionSeq` for a
 * transaction — 0 is the first ever recorded, increasing from there. The
 * *entry* stop (what risk/R must use) is the lowest revisionSeq; the
 * *current* stop (what the dashboard and chart must use) is the highest.
 * See derive-trades.ts.
 *
 * `revisionSeq` defaults to 0 so every row that already exists becomes a
 * single, single-revision history — it is still the right value to show as
 * "current". `createdAt` is left NULL for those same rows rather than
 * backfilled to the migration run time (which would falsely claim they were
 * just set) or to any other guessed timestamp: their true set-time is gone,
 * overwritten by the very bug this migration fixes. A NULL createdAt on the
 * lowest revisionSeq is exactly how derive-trades.ts recognises "the
 * original stop for this trade is not known" and reports risk as null
 * instead of fabricating an R from a trailed stop.
 *
 * No existing row is dropped or altered beyond gaining these two columns.
 */
export class AddStopLevelRevisions1788393600000 implements MigrationInterface {
  name = 'AddStopLevelRevisions1788393600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.stop_levels
        ADD COLUMN IF NOT EXISTS "revisionSeq" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "createdAt" timestamp without time zone;

      CREATE INDEX IF NOT EXISTS "IDX_stop_levels_transactionId_revisionSeq"
        ON public.stop_levels ("transactionId", "revisionSeq");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_stop_levels_transactionId_revisionSeq";

      ALTER TABLE public.stop_levels
        DROP COLUMN IF EXISTS "revisionSeq",
        DROP COLUMN IF EXISTS "createdAt";
    `);
  }
}
