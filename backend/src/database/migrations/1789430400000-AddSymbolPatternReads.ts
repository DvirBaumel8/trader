import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSymbolPatternReads1789430400000 implements MigrationInterface {
  name = 'AddSymbolPatternReads1789430400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.symbol_pattern_reads (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        symbol varchar NOT NULL,
        range varchar NOT NULL,
        headline varchar NOT NULL,
        read text NOT NULL,
        "factsSnapshot" text NOT NULL,
        model varchar NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_symbol_pattern_reads_symbol"
        ON public.symbol_pattern_reads (symbol);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_symbol_pattern_reads_userId_symbol_range_createdAt"
        ON public.symbol_pattern_reads ("userId", symbol, range, "createdAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.symbol_pattern_reads;`);
  }
}
