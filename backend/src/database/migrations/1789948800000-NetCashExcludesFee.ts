import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision, 2026-10-08: on his broker the net amount for a fill is
 * exactly quantity x price, and the fee is charged to cash separately
 * (SELL 1000 BITX, net 19,560, fee 10 -> price 19.56, cash +19,560 - 10).
 * Until now a trade's price was backed out of its reported net cash with the
 * fee added back (sell) or taken off (buy), which stored 19.57. He explicitly
 * approved recalculating the stored price of past trades that carry a
 * reported net cash.
 *
 * `reportedNetCash` is stored signed (negative on a buy); its magnitude over
 * the quantity is the new price. Trades without a reported net cash keep the
 * price that was typed. `quantity` is always positive.
 */
export class NetCashExcludesFee1789948800000 implements MigrationInterface {
  name = 'NetCashExcludesFee1789948800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE public.transactions
        SET price = ABS("reportedNetCash") / quantity
        WHERE "reportedNetCash" IS NOT NULL
          AND quantity > 0
          AND ABS("reportedNetCash") > 0;
    `);
  }

  /** Restores the old rule: the fee was part of the reported net cash. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE public.transactions
        SET price = (
          ABS("reportedNetCash") + CASE WHEN side = 'SELL' THEN fee ELSE -fee END
        ) / quantity
        WHERE "reportedNetCash" IS NOT NULL
          AND quantity > 0
          AND ABS("reportedNetCash") + CASE WHEN side = 'SELL' THEN fee ELSE -fee END > 0;
    `);
  }
}
