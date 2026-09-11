import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When the target was set, so "has it reached it" can mean what the owner
 * actually asked for.
 *
 * His requirement: tell me whether the stock reached my price at any point
 * FROM THE MOMENT I SET THE TARGET TO NOW. The first build compared only the
 * live price, so a ticker that spiked through the level and pulled back read
 * as never having got there — the one answer the feature must not give.
 *
 * Answering it needs a start date for the window to search. `updatedAt` is
 * not that: editing a note or a tag moves it, which would silently restart
 * the window and erase a hit.
 *
 * Backfilled from `updatedAt` for rows that already have a target, which is
 * the closest thing to the truth available for them and is never later than
 * the real moment — so an existing target can report a hit it missed, but
 * never miss one it had.
 */
export class AddWatchlistTargetSetAt1789257600000 implements MigrationInterface {
  name = 'AddWatchlistTargetSetAt1789257600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.watchlist_items
        ADD COLUMN IF NOT EXISTS "targetSetAt" timestamptz;
    `);
    await queryRunner.query(`
      UPDATE public.watchlist_items
        SET "targetSetAt" = "updatedAt"
        WHERE "targetPrice" IS NOT NULL AND "targetSetAt" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.watchlist_items DROP COLUMN IF EXISTS "targetSetAt";
    `);
  }
}
