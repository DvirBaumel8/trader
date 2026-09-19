import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A broker-charged cost outside any trade — margin interest, to start. See
 * interest-charge.entity.ts for why this is deliberately not a cash flow.
 */
export class AddInterestCharges1789776000000 implements MigrationInterface {
  name = 'AddInterestCharges1789776000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.interest_charges (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "entryId" uuid NOT NULL,
        amount numeric(20,2) NOT NULL,
        "occurredAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS "IDX_interest_charges_userId" ON public.interest_charges ("userId");
      CREATE INDEX IF NOT EXISTS "IDX_interest_charges_entryId" ON public.interest_charges ("entryId");
      CREATE INDEX IF NOT EXISTS "IDX_interest_charges_occurredAt" ON public.interest_charges ("occurredAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.interest_charges;`);
  }
}
