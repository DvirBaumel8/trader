import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Why a fill was taken, as a list of codes from `journal/reasons.ts`.
 *
 * It lives on the ENTRY and not on the transaction, unlike `exitKind`, for a
 * specific reason: `update()` deletes and recreates the transaction row, so
 * anything stored there is lost on an edit unless the client resends it —
 * the bug that forced `exitKind` to become server-derived (cc675d2). Reasons
 * are human input and cannot be recomputed, so the only safe home is the row
 * that survives the edit.
 *
 * NOT NULL with a '{}' default: an entry with no reasons has an empty list,
 * never null, so nothing downstream has to ask which kind of nothing it is.
 */
export class AddEntryReasons1788912000000 implements MigrationInterface {
  name = 'AddEntryReasons1788912000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.journal_entries
        ADD COLUMN IF NOT EXISTS reasons text[] NOT NULL DEFAULT '{}';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.journal_entries DROP COLUMN IF EXISTS reasons;
    `);
  }
}
