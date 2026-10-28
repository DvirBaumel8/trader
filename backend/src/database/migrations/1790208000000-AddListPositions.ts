import { MigrationInterface, QueryRunner } from 'typeorm';

/** A saved, user-chosen order for holdings and watchlist; existing rows start alphabetical per user. */
export class AddListPositions1790208000000 implements MigrationInterface {
  name = 'AddListPositions1790208000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['holdings', 'watchlist_items']) {
      await queryRunner.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS position integer;`);
      await queryRunner.query(
        `UPDATE public.${table} t SET position = o.pos
         FROM (
           SELECT h.id, row_number() OVER (PARTITION BY h."userId" ORDER BY i.symbol) - 1 AS pos
           FROM public.${table} h JOIN public.instruments i ON i.id = h."instrumentId"
         ) o
         WHERE t.id = o.id AND t.position IS NULL;`,
      );
      await queryRunner.query(`UPDATE public.${table} SET position = 0 WHERE position IS NULL;`);
      await queryRunner.query(`ALTER TABLE public.${table} ALTER COLUMN position SET NOT NULL;`);
      await queryRunner.query(`ALTER TABLE public.${table} ALTER COLUMN position SET DEFAULT 0;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE public.watchlist_items DROP COLUMN IF EXISTS position;`);
    await queryRunner.query(`ALTER TABLE public.holdings DROP COLUMN IF EXISTS position;`);
  }
}
