import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The watchlist: tickers the owner is considering but does not own.
 *
 * Nothing here touches `transactions`, so the portfolio stays derived from
 * the journal alone and invariant 1 is unaffected. A watchlist item is an
 * intention; a position is a fact.
 *
 * Tags reuse the existing `tags` table under a new type ('WATCH') rather than
 * a second vocabulary store, joined through `watchlist_item_tags`.
 */
export class AddWatchlist1789084800000 implements MigrationInterface {
  name = 'AddWatchlist1789084800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.watchlist_items (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "instrumentId" uuid NOT NULL,
        "targetPrice" numeric(20,8),
        "targetDirection" varchar,
        note text NOT NULL DEFAULT '',
        "acknowledgedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_watchlist_user_instrument" UNIQUE ("userId", "instrumentId")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_watchlist_items_userId"
        ON public.watchlist_items ("userId");
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.watchlist_item_tags (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "itemId" uuid NOT NULL REFERENCES public.watchlist_items(id) ON DELETE CASCADE,
        "tagId" uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
        CONSTRAINT "UQ_watchlist_item_tag" UNIQUE ("itemId", "tagId")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.watchlist_item_tags;`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.watchlist_items;`);
  }
}
