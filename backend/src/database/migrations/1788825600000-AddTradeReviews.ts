import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTradeReviews1788825600000 implements MigrationInterface {
  name = 'AddTradeReviews1788825600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.trade_reviews (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tradeId" varchar NOT NULL,
        symbol varchar NOT NULL,
        score varchar NOT NULL,
        verdict varchar NOT NULL,
        review text NOT NULL,
        "factsSnapshot" text NOT NULL,
        model varchar NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trade_reviews_tradeId"
        ON public.trade_reviews ("tradeId");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trade_reviews_userId_createdAt"
        ON public.trade_reviews ("userId", "createdAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.trade_reviews;`);
  }
}
