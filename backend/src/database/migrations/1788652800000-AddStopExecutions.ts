import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A stop tier is recorded at entry and never touched again, so when a stop
 * actually fires nothing records that it did — `computeEffectiveStops` has
 * had to infer it by matching a fill's price to the nearest tier. That
 * inference was wrong on at least one real trade (MSTR, whose only tier was
 * a trailing stop the exit never reached), and it cannot be right in
 * principle: "my stop fired" and "I sold near where my stop happened to be"
 * look identical to a price matcher and mean opposite things.
 *
 * The link is its own table rather than a column on either side because one
 * fill can execute two tiers (a scaled exit) and one tier can be executed
 * partially — neither is expressible as a foreign key on a row.
 *
 * `exitKind` is separate and deliberately nullable: NULL means "not yet
 * classified", which is what keeps the exit statistics honest about their
 * own coverage instead of counting unreviewed exits as discretionary.
 */
export class AddStopExecutions1788652800000 implements MigrationInterface {
  name = 'AddStopExecutions1788652800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.stop_executions (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "stopLevelId" uuid NOT NULL REFERENCES public.stop_levels(id) ON DELETE CASCADE,
        "transactionId" uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
        quantity numeric(20,8) NOT NULL,
        "confirmedAt" timestamp NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stop_executions_transactionId"
        ON public.stop_executions ("transactionId");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stop_executions_stopLevelId"
        ON public.stop_executions ("stopLevelId");
    `);
    await queryRunner.query(`
      ALTER TABLE public.transactions
        ADD COLUMN IF NOT EXISTS "exitKind" varchar;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE public.transactions DROP COLUMN IF EXISTS "exitKind";`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.stop_executions;`);
  }
}
