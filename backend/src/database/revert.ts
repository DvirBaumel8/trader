// backend/src/database/revert.ts
import dataSource from './data-source.js';

dataSource
  .initialize()
  .then(() => dataSource.undoLastMigration())
  .then(() => dataSource.destroy())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
