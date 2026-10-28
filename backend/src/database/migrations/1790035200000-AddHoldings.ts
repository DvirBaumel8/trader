import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Holdings: which symbols the owner holds and in which direction. Nothing
 * else — no quantity, no price paid. The broker owns those numbers
 * (docs/superpowers/specs/2026-10-28-trader-rebuild-design.md).
 */
export class AddHoldings1790035200000 implements MigrationInterface {
  name = 'AddHoldings1790035200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.holdings (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "instrumentId" uuid NOT NULL,
        direction varchar NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_holdings_user_instrument" UNIQUE ("userId", "instrumentId")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_holdings_userId" ON public.holdings ("userId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.holdings;`);
  }
}
