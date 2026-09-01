// backend/src/database/migrate.ts
// Runs migrations via the DataSource API directly rather than TypeORM's own
// CLI (`typeorm migration:run`) — that CLI requires ts-node, which isn't a
// dependency here (this project uses vitest, not ts-node/jest), and the
// installed TypeORM version's CLI entrypoint hard-requires it regardless.
// This script has no such dependency and is what actually runs, both
// locally (via tsx) and in production (compiled, via plain node).
import dataSource from './data-source.js';

dataSource
  .initialize()
  .then(() => dataSource.runMigrations())
  .then(() => dataSource.destroy())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
