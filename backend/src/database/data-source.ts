// backend/src/database/data-source.ts
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildConnectionOptions } from './connection-options.js';
import { InitialSchema1788220800000 } from './migrations/1788220800000-InitialSchema.js';
import { AddDailyCloseOhlc1788307200000 } from './migrations/1788307200000-AddDailyCloseOhlc.js';
import { AddStopLevelRevisions1788393600000 } from './migrations/1788393600000-AddStopLevelRevisions.js';
import { AddAiSummaries1788480000000 } from './migrations/1788480000000-AddAiSummaries.js';
import { AddDailyCloseVolume1788566400000 } from './migrations/1788566400000-AddDailyCloseVolume.js';
import { AddStopExecutions1788652800000 } from './migrations/1788652800000-AddStopExecutions.js';
import { AddTradeIdeas1788739200000 } from './migrations/1788739200000-AddTradeIdeas.js';
import { AddTradeReviews1788825600000 } from './migrations/1788825600000-AddTradeReviews.js';
import { AddEntryReasons1788912000000 } from './migrations/1788912000000-AddEntryReasons.js';
import { AddStopPlanCleared1788998400000 } from './migrations/1788998400000-AddStopPlanCleared.js';
import { AddWatchlist1789084800000 } from './migrations/1789084800000-AddWatchlist.js';
import { AddUserAccounts1789171200000 } from './migrations/1789171200000-AddUserAccounts.js';
import { AddWatchlistTargetSetAt1789257600000 } from './migrations/1789257600000-AddWatchlistTargetSetAt.js';
import { AddWatchlistRankings1789344000000 } from './migrations/1789344000000-AddWatchlistRankings.js';

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
    AddStopExecutions1788652800000,
    AddTradeIdeas1788739200000,
    AddTradeReviews1788825600000,
    AddEntryReasons1788912000000,
    AddStopPlanCleared1788998400000,
    AddWatchlist1789084800000,
    AddUserAccounts1789171200000,
    AddWatchlistTargetSetAt1789257600000,
    AddWatchlistRankings1789344000000,
  ],
  synchronize: false,
});

export default dataSource;
