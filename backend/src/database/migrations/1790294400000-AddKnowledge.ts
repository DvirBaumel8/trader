import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-ticker knowledge graphs with a version history, and API keys for the editing tool. */
export class AddKnowledge1790294400000 implements MigrationInterface {
  name = 'AddKnowledge1790294400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.knowledge_graphs (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        symbol varchar NOT NULL,
        version integer NOT NULL,
        nodes jsonb NOT NULL,
        edges jsonb NOT NULL,
        "deletedAt" timestamptz NULL,
        "lastViewedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_knowledge_graphs_user_symbol" UNIQUE ("userId", symbol)
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.knowledge_versions (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "graphId" uuid NOT NULL REFERENCES public.knowledge_graphs(id) ON DELETE CASCADE,
        version integer NOT NULL,
        message varchar NOT NULL,
        nodes jsonb NOT NULL,
        edges jsonb NOT NULL,
        deleted boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_knowledge_versions_graph_version" UNIQUE ("graphId", version)
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.api_keys (
        id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
        "userId" uuid NOT NULL,
        name varchar NOT NULL,
        "keyHash" varchar NOT NULL UNIQUE,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "lastUsedAt" timestamptz NULL
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.knowledge_versions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.knowledge_graphs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.api_keys;`);
  }
}
