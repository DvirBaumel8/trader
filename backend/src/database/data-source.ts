// backend/src/database/data-source.ts
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildConnectionOptions } from './connection-options.js';
import { InitialSchema1788220800000 } from './migrations/1788220800000-InitialSchema.js';
import { AddDailyCloseOhlc1788307200000 } from './migrations/1788307200000-AddDailyCloseOhlc.js';
import { AddStopLevelRevisions1788393600000 } from './migrations/1788393600000-AddStopLevelRevisions.js';
import { AddAiSummaries1788480000000 } from './migrations/1788480000000-AddAiSummaries.js';
import { AddDailyCloseVolume1788566400000 } from './migrations/1788566400000-AddDailyCloseVolume.js';

// Migrations are imported explicitly rather than via a glob string. A glob
// silently matched zero files under some execution contexts in a sibling
// project (sapako), which made runMigrations() report success while doing
// nothing. New migrations must be added to this array by hand, in order.
const dataSource = new DataSource({
  type: 'postgres',
  ...buildConnectionOptions(process.env),
  migrations: [
    InitialSchema1788220800000,
    AddDailyCloseOhlc1788307200000,
    AddStopLevelRevisions1788393600000,
    AddAiSummaries1788480000000,
    AddDailyCloseVolume1788566400000,
  ],
  synchronize: false,
});

export default dataSource;
