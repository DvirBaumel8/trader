import { DataType, newDb } from 'pg-mem';
import crypto from 'node:crypto';
import pg from 'pg';
import dataSource from './data-source.js';

let initialized = false;

export async function initDatabaseIfOffline(): Promise<void> {
  if (initialized) return;

  const hasRealDb =
    Boolean(process.env.DATABASE_URL) ||
    Boolean(
      process.env.DB_HOST &&
        process.env.DB_HOST !== 'localhost' &&
        process.env.DB_HOST !== '127.0.0.1',
    );

  if (hasRealDb) {
    initialized = true;
    return;
  }

  console.log(
    '[AI Studio] No external database configured — initializing in-memory PostgreSQL (pg-mem)',
  );

  const db = newDb();

  db.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 14.0',
  });

  db.public.registerFunction({
    name: 'current_database',
    implementation: () => 'trader',
  });

  db.registerExtension('uuid-ossp', (schema) => {
    schema.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      implementation: () => crypto.randomUUID(),
    });
  });

  const pgMock = db.adapters.createPg();
  (pg as any).Pool = pgMock.Pool;
  (pg as any).Client = pgMock.Client;

  // Run migrations against the in-memory database to establish schemas and indexes
  try {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    await dataSource.runMigrations();
    console.log('[AI Studio] Migrations applied to in-memory database successfully');
  } catch (err: any) {
    console.warn('[AI Studio] Error running migrations on in-memory database:', err?.message ?? err);
  }

  initialized = true;
}
