import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The opinions themselves are kept, though nothing about the researched
 * ticker is: `instruments` and `daily_closes` mean "things he owns", while
 * "what did the app say before I bought LMND" is a question that only gets
 * more valuable with time.
 *
 * `stop`, `target` and `riskReward` are nullable because an answer whose
 * levels could not be parsed is still worth keeping — it is a record of what
 * was said, minus the numbers the app refused to derive.
 */
export class AddTradeIdeas1788739200000 implements MigrationInterface {
  name = 'AddTradeIdeas1788739200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.trade_ideas (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        symbol varchar NOT NULL,
        "entryPrice" numeric(20,8) NOT NULL,
        "priceStale" boolean NOT NULL DEFAULT false,
        stop numeric(20,8),
        target numeric(20,8),
        "riskReward" numeric(20,8),
        opinion text NOT NULL,
        "factsSnapshot" text NOT NULL,
        model varchar NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trade_ideas_userId_createdAt"
        ON public.trade_ideas ("userId", "createdAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.trade_ideas;`);
  }
}
