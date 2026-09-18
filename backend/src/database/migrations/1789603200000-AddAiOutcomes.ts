import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiOutcomes1789603200000 implements MigrationInterface {
  name = 'AddAiOutcomes1789603200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.ai_outcomes (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        feature varchar NOT NULL,
        "entityId" uuid NOT NULL,
        status varchar NOT NULL DEFAULT 'pending',
        "resolvedAt" timestamptz NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_ai_outcomes_feature_entityId" UNIQUE (feature, "entityId")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_outcomes_userId"
        ON public.ai_outcomes ("userId");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_outcomes_userId_status"
        ON public.ai_outcomes ("userId", status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.ai_outcomes;`);
  }
}
