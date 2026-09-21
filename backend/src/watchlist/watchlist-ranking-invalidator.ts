import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { WatchlistChangeNotifier } from '../common/watchlist-change-notifier.js';
import { WatchlistRankingService } from './watchlist-ranking.service.js';

/**
 * Keeps a stale ranking from naming a ticker that just came off the
 * watchlist — buying a watched ticker removes it from the list (see
 * JournalService.writeOwnedRows), and without this the cached ranking would
 * still show it until someone happened to hit "Refresh".
 *
 * Listens rather than being called directly: JournalModule cannot depend on
 * WatchlistModule without a real cycle — see WatchlistChangeNotifier's own
 * doc comment.
 */
@Injectable()
export class WatchlistRankingInvalidator implements OnModuleInit {
  private readonly logger = new Logger(WatchlistRankingInvalidator.name);

  constructor(
    private readonly notifier: WatchlistChangeNotifier,
    private readonly ranking: WatchlistRankingService,
  ) {}

  onModuleInit(): void {
    this.notifier.onTickerRemoved(() => {
      // Fire-and-forget: the buy that triggered this already succeeded and
      // returned, and a failed refresh here must never surface as anything
      // more than a log line — the previous ranking is still perfectly
      // servable, exactly as a manual Refresh failure leaves it.
      this.ranking.refresh().catch((err) => {
        this.logger.warn(
          `Ranking refresh after a watchlist removal failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
  }
}
