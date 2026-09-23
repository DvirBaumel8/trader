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

  it('mentions a missing stop on a portfolio position with a notable move', async () => {
    // 19 flat days, then a jump big enough to trip the ATR_MOVE rule.
    const dates = Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const bars = dates.map((date, i) => ({
      instrumentId: 'nvda',
      date,
      close: i === 19 ? 103 : 100,
      high: i === 19 ? 104 : 101,
      low: i === 19 ? 99 : 99,
      volume: 1_000_000,
    }));
    const service = new DailyBriefService(
      {
        getPortfolio: vi.fn().mockResolvedValue({
          positions: [{ symbol: 'NVDA', price: 103, regularPrice: 103, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null }],
          atRisk: { positionsWithoutStop: { count: 1, symbols: ['NVDA'] } },
        }),
      } as any,
      { list: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue(bars) } as any,
      { find: vi.fn().mockResolvedValue([{ id: 'nvda', symbol: 'NVDA' }]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get({ now: new Date('2026-08-20T16:00:00Z') });

    const move = result.notes.find((note) => note.kind === 'ATR_MOVE');
    expect(move?.detail).toMatch(/no stop/i);
  });

  it('does not mention a missing stop when the position has one', async () => {
    const dates = Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const bars = dates.map((date, i) => ({
      instrumentId: 'nvda',
      date,
      close: i === 19 ? 103 : 100,
      high: i === 19 ? 104 : 101,
      low: i === 19 ? 99 : 99,
      volume: 1_000_000,
    }));
    const service = new DailyBriefService(
      {
        getPortfolio: vi.fn().mockResolvedValue({
          positions: [{ symbol: 'NVDA', price: 103, regularPrice: 103, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null }],
          atRisk: { positionsWithoutStop: { count: 0, symbols: [] } },
        }),
      } as any,
      { list: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue(bars) } as any,
      { find: vi.fn().mockResolvedValue([{ id: 'nvda', symbol: 'NVDA' }]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get({ now: new Date('2026-08-20T16:00:00Z') });

    const move = result.notes.find((note) => note.kind === 'ATR_MOVE');
    expect(move?.detail).not.toMatch(/no stop/i);
  });

  it('mentions a partial stop on a portfolio position with a notable move', async () => {
    const dates = Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    const bars = dates.map((date, i) => ({
      instrumentId: 'nvda',
      date,
      close: i === 19 ? 103 : 100,
      high: i === 19 ? 104 : 101,
      low: i === 19 ? 99 : 99,
      volume: 1_000_000,
    }));
    const service = new DailyBriefService(
      {
        getPortfolio: vi.fn().mockResolvedValue({
          positions: [{ symbol: 'NVDA', price: 103, regularPrice: 103, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null }],
          atRisk: {
            positionsWithoutStop: { count: 0, symbols: [] },
            positionsWithPartialStop: {
              count: 1,
              positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }],
            },
          },
        }),
      } as any,
      { list: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue(bars) } as any,
      { find: vi.fn().mockResolvedValue([{ id: 'nvda', symbol: 'NVDA' }]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get({ now: new Date('2026-08-20T16:00:00Z') });

    const move = result.notes.find((note) => note.kind === 'ATR_MOVE');
    expect(move?.detail).toMatch(/partial stop/i);
    expect(move?.detail).not.toMatch(/no stop/i);
  });

  it('names the day\'s biggest mover when nothing else earns a note', async () => {
    const dates = Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
    // A move clearly smaller than the ATR (~1.0 from the flat prior days),
    // so nothing else fires — the point is an uneventful day, not a rule
    // that almost triggered.
    const bars = dates.map((date, i) => ({
      instrumentId: 'nvda',
      date,
      close: i === 19 ? 100.3 : 100,
      high: i === 19 ? 100.8 : 100.5,
      low: i === 19 ? 99.8 : 99.5,
      volume: 1_000_000,
    }));
    const service = new DailyBriefService(
      { getPortfolio: vi.fn().mockResolvedValue({ positions: [
        { symbol: 'NVDA', price: 100.3, regularPrice: 100.3, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null },
      ], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } } }) } as any,
      { list: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue(bars) } as any,
      { find: vi.fn().mockResolvedValue([{ id: 'nvda', symbol: 'NVDA' }]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get({ now: new Date('2026-08-20T16:00:00Z') });

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ kind: 'QUIET_DAY', symbol: 'NVDA' });
    expect(result.notes[0].detail).toContain('0.3%');
  });

  it('never fabricates a quiet-day note when there are no bars to compute one from', async () => {
    const service = new DailyBriefService(
      { getPortfolio: vi.fn().mockResolvedValue({ positions: [], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } } }) } as any,
      { list: vi.fn().mockResolvedValue([
        { symbol: 'FSLR', price: 235, regularPrice: 232, stale: false, session: 'PRE', extended: true, daysUntilEarnings: null },
      ]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get();

    expect(result.notes).toEqual([]);
  });

  it('orders an earnings note ahead of a momentum note for the same kind of urgency', async () => {
    const realDates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10));
    const nvdaBars = realDates.map((date, i) => ({
      instrumentId: 'nvda',
      date,
      close: 100 + i * 0.2,
      high: null,
      low: null,
      volume: 1_000_000,
    }));
    const spyBars = realDates.map((date) => ({ instrumentId: 'spy', date, close: 100, high: null, low: null, volume: 1_000_000 }));
    const service = new DailyBriefService(
      { getPortfolio: vi.fn().mockResolvedValue({
        positions: [{ symbol: 'NVDA', price: 100 + 59 * 0.2, regularPrice: 100 + 59 * 0.2, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 0 }],
        atRisk: { positionsWithoutStop: { count: 0, symbols: [] } },
      }) } as any,
      { list: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([...nvdaBars, ...spyBars]) } as any,
      { find: vi.fn().mockResolvedValue([{ id: 'nvda', symbol: 'NVDA' }, { id: 'spy', symbol: 'SPY' }]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    );

    const result = await service.get({ now: new Date(Date.UTC(2026, 5, 60)) });

    const kinds = result.notes.map((note) => note.kind);
    expect(kinds.indexOf('EARNINGS')).toBeLessThan(kinds.indexOf('MOMENTUM'));
  });

  describe('the AI narrative', () => {
    const baseDeps = () => [
      { getPortfolio: vi.fn().mockResolvedValue({ positions: [], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } } }) } as any,
      { list: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      { week: vi.fn().mockResolvedValue({ available: true, events: [] }) } as any,
    ] as const;

    it('is null when no LLM client was given, the same as an unconfigured one', async () => {
      const service = new DailyBriefService(...baseDeps());
      const result = await service.get();
      expect(result.narrative).toBeNull();
    });

    it('is null and makes no call when the client is not configured', async () => {
      const complete = vi.fn();
      const llm = { isConfigured: () => false, complete } as any;
      const service = new DailyBriefService(...baseDeps(), llm);

      const result = await service.get();

      expect(result.narrative).toBeNull();
      expect(complete).not.toHaveBeenCalled();
    });

    it('is the model\'s text when the client is configured and answers', async () => {
      const llm = {
        isConfigured: () => true,
        complete: vi.fn().mockResolvedValue('Nothing urgent today.'),
      } as any;
      const service = new DailyBriefService(...baseDeps(), llm);

      const result = await service.get();

      expect(result.narrative).toBe('Nothing urgent today.');
    });

    it('is null rather than throwing when the model call fails', async () => {
      const llm = {
        isConfigured: () => true,
        complete: vi.fn().mockRejectedValue(new Error('provider down')),
      } as any;
      const service = new DailyBriefService(...baseDeps(), llm);

      const result = await service.get();

      expect(result.narrative).toBeNull();
    });
  });
});
