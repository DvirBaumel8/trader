import { MigrationInterface, QueryRunner } from 'typeorm';

/** Cache of the next earnings instant (and whether it is an estimate), plus the one just reported. */
export class AddNextEarnings1790121600000 implements MigrationInterface {
  name = 'AddNextEarnings1790121600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE public.instruments ADD COLUMN IF NOT EXISTS "nextEarningsAt" timestamptz NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE public.instruments ADD COLUMN IF NOT EXISTS "nextEarningsEstimated" boolean NOT NULL DEFAULT false;`,
    );
    await queryRunner.query(
      `ALTER TABLE public.instruments ADD COLUMN IF NOT EXISTS "previousEarningsAt" timestamptz NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE public.instruments DROP COLUMN IF EXISTS "previousEarningsAt";`);
    await queryRunner.query(`ALTER TABLE public.instruments DROP COLUMN IF EXISTS "nextEarningsEstimated";`);
    await queryRunner.query(`ALTER TABLE public.instruments DROP COLUMN IF EXISTS "nextEarningsAt";`);
  }
}
