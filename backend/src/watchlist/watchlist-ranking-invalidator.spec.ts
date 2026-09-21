import { describe, expect, it, vi } from 'vitest';
import { WatchlistRankingInvalidator } from './watchlist-ranking-invalidator.js';
import { WatchlistChangeNotifier } from '../common/watchlist-change-notifier.js';
import type { WatchlistRankingService } from './watchlist-ranking.service.js';

function fakeRankingService(refresh: () => Promise<unknown> = () => Promise.resolve({})) {
  return { refresh: vi.fn(refresh) } as unknown as WatchlistRankingService;
}

describe('WatchlistRankingInvalidator', () => {
  it('refreshes the ranking when a watchlist ticker comes off the list', async () => {
    const notifier = new WatchlistChangeNotifier();
    const ranking = fakeRankingService();
    const invalidator = new WatchlistRankingInvalidator(notifier, ranking);

    invalidator.onModuleInit();
    notifier.notifyTickerRemoved();
    // The listener fires an async refresh without the notifier awaiting it.
    await new Promise((r) => setTimeout(r, 0));

    expect(ranking.refresh).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed refresh escape as an unhandled rejection', async () => {
    const notifier = new WatchlistChangeNotifier();
    const ranking = fakeRankingService(() => Promise.reject(new Error('model down')));
    const invalidator = new WatchlistRankingInvalidator(notifier, ranking);
    invalidator.onModuleInit();

    expect(() => notifier.notifyTickerRemoved()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(ranking.refresh).toHaveBeenCalledTimes(1);
  });
});
