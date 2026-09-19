import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTradeReconciliation1789689600000
  implements MigrationInterface
{
  name = 'AddTradeReconciliation1789689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.transactions
        ADD COLUMN IF NOT EXISTS "reportedNetCash" numeric(20,2),
        ADD COLUMN IF NOT EXISTS "reportedBalance" numeric(20,2);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.transactions
        DROP COLUMN IF EXISTS "reportedNetCash",
        DROP COLUMN IF EXISTS "reportedBalance";
    `);
  }
}
