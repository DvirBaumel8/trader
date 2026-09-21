import { Module } from '@nestjs/common';
import { WatchlistChangeNotifier } from './watchlist-change-notifier.js';

/**
 * A single shared instance of `WatchlistChangeNotifier`, imported by both
 * JournalModule (which emits) and WatchlistModule (which listens) — see the
 * notifier's own doc comment for why they can't reach each other directly.
 */
@Module({
  providers: [WatchlistChangeNotifier],
  exports: [WatchlistChangeNotifier],
})
export class WatchlistChangeNotifierModule {}
