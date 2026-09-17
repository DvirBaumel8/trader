import { describe, expect, it, vi } from 'vitest';
import { DailyBriefService } from './daily-brief.service.js';

describe('DailyBriefService', () => {
  it('combines portfolio, watchlist, and market notes while keeping portfolio ownership primary', async () => {
    const service = new DailyBriefService(
      {
        getPortfolio: vi.fn().mockResolvedValue({
          positions: [{ symbol: 'NVDA', price: 110, regularPrice: 109, stale: false, session: 'POST', extended: true, daysUntilEarnings: 0 }],
        }),
      } as any,
      {
        list: vi.fn().mockResolvedValue([
          { symbol: 'NVDA', price: 110, regularPrice: 109, stale: false, session: 'POST', extended: true, daysUntilEarnings: 0 },
          { symbol: 'PLTR', price: 25, regularPrice: 25, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 3 },
        ]),
      } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      {
        week: vi.fn().mockResolvedValue({ available: true, events: [
          { kind: 'RATE_DECISION', name: 'Federal Reserve rate decision', date: '2026-09-16', title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.' },
        ] }),
      } as any,
    );

    const result = await service.get({ now: new Date('2026-09-16T09:00:00.000Z') });

    expect(result.refreshAfterSeconds).toBe(300);
    expect(result.marketDataAvailable).toBe(true);
    expect(result.coverage).toEqual([
      { source: 'PORTFOLIO', symbol: 'NVDA', price: 110, regularPrice: 109, stale: false, session: 'POST', extended: true },
      { source: 'WATCHLIST', symbol: 'PLTR', price: 25, regularPrice: 25, stale: false, session: 'REGULAR', extended: false },
    ]);
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'EARNINGS', symbol: 'NVDA', source: 'PORTFOLIO' }),
      expect.objectContaining({ kind: 'EARNINGS', symbol: 'PLTR', source: 'WATCHLIST' }),
      expect.objectContaining({ kind: 'ECONOMIC', source: 'MARKET', title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.', eventAt: '2026-09-16' }),
    ]));
    expect(result.notes.filter((note) => note.kind === 'EARNINGS' && note.symbol === 'NVDA')).toHaveLength(1);
  });

  it('forces quotes and includes a newly watched ticker even without technical bars', async () => {
    const portfolio = { getPortfolio: vi.fn().mockResolvedValue({ positions: [] }) };
    const watchlist = { list: vi.fn().mockResolvedValue([
      { symbol: 'FSLR', price: 235, regularPrice: 232, stale: false, session: 'PRE', extended: true, daysUntilEarnings: null },
    ]) };
    const service = new DailyBriefService(
      portfolio as any, watchlist as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get({ refresh: true, now: new Date('2026-09-16T16:00:00Z') });

    expect(portfolio.getPortfolio).toHaveBeenCalledWith({ refresh: true });
    expect(watchlist.list).toHaveBeenCalledWith({ refresh: true });
    expect(result.coverage).toEqual([
      { source: 'WATCHLIST', symbol: 'FSLR', price: 235, regularPrice: 232, stale: false, session: 'PRE', extended: true },
    ]);
    expect(result.notes).toEqual([]);
  });

  it('reports an unavailable macro source rather than a quiet market day', async () => {
    const service = new DailyBriefService(
      { getPortfolio: vi.fn().mockResolvedValue({ positions: [] }) } as any,
      { list: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: false, events: [] }) } as any,
    );

    await expect(service.get()).resolves.toMatchObject({
      marketDataAvailable: false,
      notes: [],
    });
  });

  it('uses the portfolio quote for a ticker that is also watched', async () => {
    const dates = Array.from({ length: 55 }, (_, i) => new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10));
    const bars = dates.flatMap((date, i) => [
      { instrumentId: 'nvda', date, close: i === 54 ? 110 : 100, high: null, low: null, volume: null },
      { instrumentId: 'spy', date, close: 100, high: null, low: null, volume: null },
    ]);
    const service = new DailyBriefService(
      { getPortfolio: vi.fn().mockResolvedValue({ positions: [
        { symbol: 'NVDA', price: 110, regularPrice: 110, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null },
      ] }) } as any,
      { list: vi.fn().mockResolvedValue([
        { symbol: 'NVDA', price: 5, regularPrice: 5, stale: true, session: 'CLOSED', extended: false, daysUntilEarnings: null },
      ]) } as any,
      { find: vi.fn().mockResolvedValue(bars) } as any,
      { find: vi.fn().mockResolvedValue([{ id: 'nvda', symbol: 'NVDA' }, { id: 'spy', symbol: 'SPY' }]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get({ now: new Date('2026-09-16T16:00:00Z') });

    expect(result.coverage).toEqual([{ source: 'PORTFOLIO', symbol: 'NVDA', price: 110, regularPrice: 110, stale: false, session: 'REGULAR', extended: false }]);
    expect(result.notes).toContainEqual(expect.objectContaining({ kind: 'MOMENTUM', source: 'PORTFOLIO', symbol: 'NVDA' }));
  });
});
