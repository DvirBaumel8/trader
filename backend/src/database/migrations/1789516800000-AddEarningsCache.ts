import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEarningsCache1789516800000 implements MigrationInterface {
  name = 'AddEarningsCache1789516800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.instruments
        ADD COLUMN IF NOT EXISTS "nextEarningsDate" date,
        ADD COLUMN IF NOT EXISTS "earningsCheckedAt" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.instruments
        DROP COLUMN IF EXISTS "nextEarningsDate",
        DROP COLUMN IF EXISTS "earningsCheckedAt";
    `);
  }
}
