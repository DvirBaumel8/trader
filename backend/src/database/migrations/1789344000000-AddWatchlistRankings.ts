import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The cached watchlist ranking.
 *
 * Rows accumulate rather than being overwritten: what the model said last
 * week, and the facts it said it from, are worth keeping for the same reason
 * ai_summaries are. The read path takes the newest row per user.
 */
export class AddWatchlistRankings1789344000000 implements MigrationInterface {
  name = 'AddWatchlistRankings1789344000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.watchlist_rankings (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "rankedAt" timestamptz NOT NULL,
        model varchar NOT NULL,
        payload text NOT NULL,
        "factsSnapshot" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_watchlist_rankings_user_ranked"
        ON public.watchlist_rankings ("userId", "rankedAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.watchlist_rankings;`);
  }
}
