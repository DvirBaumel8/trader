import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a stop plan be emptied.
 *
 * `stop_levels` is append-only and a revision IS its rows, so "no stops" had
 * no representation: writing zero rows left `revisionSeq` unadvanced and
 * every reader taking max(revisionSeq) kept serving the PREVIOUS revision —
 * the old tier stayed live and stayed priced into at-risk. One path rejected
 * that loudly; the other (editing the journal entry) did it silently.
 *
 * An emptied plan is now exactly one tombstone row carrying `cleared`, so the
 * revision advances like any other and the entry stop at revision 0 — which
 * defines risk and therefore R — is left untouched.
 *
 * The row keeps `kind = 'FIXED'` rather than gaining a third kind: StopKind
 * is validated on the wire, and widening it there would let a client post a
 * tombstone. Price and trailPercent are null and quantity is 0, so a reader
 * that somehow bypasses `stop-revisions.ts` sees a tier worth nothing rather
 * than a phantom level.
 */
export class AddStopPlanCleared1788998400000 implements MigrationInterface {
  name = 'AddStopPlanCleared1788998400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.stop_levels
        ADD COLUMN IF NOT EXISTS cleared boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.stop_levels DROP COLUMN IF EXISTS cleared;
    `);
  }
}
