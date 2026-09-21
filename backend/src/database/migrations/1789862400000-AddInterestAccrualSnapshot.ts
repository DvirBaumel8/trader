import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A manually-entered, non-transactional snapshot of the broker's own
 * "month-to-date interest" figure. It is deliberately not a journal entry —
 * see interest-charge.entity.ts — because the broker has not yet posted a
 * dated transaction for it; it only accrues daily into the live cash figure
 * shown on the platform. This is display-only input for estimating that
 * accrual, never fed into `deriveCash`.
 */
export class AddInterestAccrualSnapshot1789862400000
  implements MigrationInterface
{
  name = 'AddInterestAccrualSnapshot1789862400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS "interestAccrualAmount" numeric(12,2),
        ADD COLUMN IF NOT EXISTS "interestAccrualAsOf" date;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.users
        DROP COLUMN IF EXISTS "interestAccrualAmount",
        DROP COLUMN IF EXISTS "interestAccrualAsOf";
    `);
  }
}
