import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Candles need the intraday range. Yahoo already returns open/high/low in the
 * same chart response the backfill reads — the adapter simply discarded them
 * until Phase 4.
 *
 * Nullable on purpose: every row written before this migration has no values
 * for them, and stays that way until the backfill is re-run. A chart skips an
 * incomplete candle rather than the whole feature failing, and `close` alone
 * remains sufficient for the benchmark chart and the performance series.
 */
export class AddDailyCloseOhlc1788307200000 implements MigrationInterface {
  name = 'AddDailyCloseOhlc1788307200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.daily_closes
        ADD COLUMN IF NOT EXISTS open numeric(20,8),
        ADD COLUMN IF NOT EXISTS high numeric(20,8),
        ADD COLUMN IF NOT EXISTS low numeric(20,8);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.daily_closes
        DROP COLUMN IF EXISTS open,
        DROP COLUMN IF EXISTS high,
        DROP COLUMN IF EXISTS low;
    `);
  }
}
