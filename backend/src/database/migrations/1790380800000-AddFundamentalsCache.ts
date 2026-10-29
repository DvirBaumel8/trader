import { MigrationInterface, QueryRunner } from 'typeorm';

/** One shared row per ticker: the shaped fundamentals table, refreshed at most once per ET day. */
export class AddFundamentalsCache1790380800000 implements MigrationInterface {
  name = 'AddFundamentalsCache1790380800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.fundamentals_cache (
        symbol varchar PRIMARY KEY,
        data jsonb NOT NULL,
        "fetchedAt" timestamptz NOT NULL
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.fundamentals_cache;`);
  }
}
