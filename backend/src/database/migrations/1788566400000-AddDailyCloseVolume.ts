import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Volume is what turns "he bought a breakout" into "he bought a breakout
 * with volume behind it" — his own stated rule (`docs/trader-profile.md`:
 * "Volume as a confirming indicator"). Yahoo already returns it in the same
 * chart response the backfill reads for OHLC; the adapter discarded it the
 * same way it once discarded open/high/low — see AddDailyCloseOhlc.
 *
 * Nullable for the same reason OHLC is: rows written before this migration
 * have none until the backfill is re-run, and a bar Yahoo returns without a
 * volume figure is still worth storing for its close.
 */
export class AddDailyCloseVolume1788566400000 implements MigrationInterface {
  name = 'AddDailyCloseVolume1788566400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.daily_closes
        ADD COLUMN IF NOT EXISTS volume bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.daily_closes
        DROP COLUMN IF EXISTS volume;
    `);
  }
}
