import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives a user an identity, so there can be more than one of them.
 *
 * Every table already carried `userId` — the single-user build was always a
 * multi-user schema with one row in it — so this adds no foreign keys and
 * rewrites no data. What was missing was a way to tell users apart.
 *
 * All three identity columns are NULLABLE, and that is the point: the
 * existing owner row has no email and no password of its own, and must keep
 * working exactly as it did. He signs in with the shared APP_PASSWORD until
 * he chooses to attach an email to the account. Making these NOT NULL would
 * have required inventing credentials for him during a migration, which is
 * how a deploy locks its only user out.
 *
 * Uniqueness is enforced with partial indexes rather than plain UNIQUE
 * constraints so that many rows may have NULL email — Postgres allows
 * repeated NULLs under UNIQUE, but being explicit about it here documents
 * that the repetition is intended rather than tolerated.
 */
export class AddUserAccounts1789171200000 implements MigrationInterface {
  name = 'AddUserAccounts1789171200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.users
        ADD COLUMN IF NOT EXISTS email varchar,
        ADD COLUMN IF NOT EXISTS "passwordHash" varchar,
        ADD COLUMN IF NOT EXISTS "googleId" varchar,
        ADD COLUMN IF NOT EXISTS "avatarUrl" varchar,
        ADD COLUMN IF NOT EXISTS "lastSeenAt" timestamptz;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_email"
        ON public.users (lower(email)) WHERE email IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_googleId"
        ON public.users ("googleId") WHERE "googleId" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_googleId";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_email";`);
    await queryRunner.query(`
      ALTER TABLE public.users
        DROP COLUMN IF EXISTS email,
        DROP COLUMN IF EXISTS "passwordHash",
        DROP COLUMN IF EXISTS "googleId",
        DROP COLUMN IF EXISTS "avatarUrl",
        DROP COLUMN IF EXISTS "lastSeenAt";
    `);
  }
}
