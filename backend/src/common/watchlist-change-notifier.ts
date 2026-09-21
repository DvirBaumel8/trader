import { Injectable } from '@nestjs/common';

/**
 * Lets JournalService announce "a watchlist ticker just came off the list"
 * without depending on WatchlistModule — importing it from JournalModule
 * would create a real cycle (Journal -> Watchlist -> Portfolio -> Journal,
 * since WatchlistModule already imports PortfolioModule which imports
 * JournalModule). This is a leaf both modules can depend on instead, with
 * no imports of its own.
 */
@Injectable()
export class WatchlistChangeNotifier {
  private listeners: Array<() => void> = [];

  onTickerRemoved(listener: () => void): void {
    this.listeners.push(listener);
  }

  notifyTickerRemoved(): void {
    for (const listener of this.listeners) listener();
  }
}
