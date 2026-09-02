import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists AI portfolio summaries so they can be browsed as history instead
 * of vanishing the moment the screen is left. See ai-summary.entity.ts for
 * why every column exists — in short: the model's text, the exact facts it
 * read, which model, and whether grounding was used, so a summary read weeks
 * later can be judged against what the book looked like when it was written.
 *
 * Create/read/delete only, by design — no column here is ever updated after
 * insert, so there is no `updatedAt`.
 */
export class AddAiSummaries1788480000000 implements MigrationInterface {
  name = 'AddAiSummaries1788480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.ai_summaries (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        summary text NOT NULL,
        "factsSnapshot" text NOT NULL,
        model character varying NOT NULL,
        grounded boolean NOT NULL DEFAULT false,
        "factsAsOf" timestamp with time zone NOT NULL,
        "createdAt" timestamp without time zone NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "IDX_ai_summaries_userId_createdAt"
        ON public.ai_summaries ("userId", "createdAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ai_summaries_userId_createdAt";
      DROP TABLE IF EXISTS public.ai_summaries;
    `);
  }
}
