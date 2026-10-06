import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DailyBriefService } from './daily-brief.service.js';
import { EMPTY_MOOD } from './brief-mood.js';

/** 21 flat bars then a close above the range on 3× volume: a confirmed breakout (and an ATR move). */
function breakoutBars(instrumentId: string) {
  const flat = Array.from({ length: 21 }, (_, i) => ({
    instrumentId, date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    close: 100, adjClose: 100, open: 100, high: 101, low: 99, volume: 1_000_000,
  }));
  return [...flat, { instrumentId, date: '2026-08-22', close: 110, adjClose: 110, open: 101, high: 111, low: 100, volume: 3_000_000 }];
}

function deps(over: {
  positions?: unknown[];
  watched?: unknown[];
  instruments?: { id: string; symbol: string }[];
  bars?: unknown[];
  calendar?: { available: boolean; events: unknown[] };
  atRisk?: unknown;
} = {}) {
  return [
    { getPortfolio: vi.fn().mockResolvedValue({ positions: over.positions ?? [], atRisk: over.atRisk ?? { positionsWithoutStop: { count: 0, symbols: [] } } }) } as any,
    { list: vi.fn().mockResolvedValue(over.watched ?? []) } as any,
    { find: vi.fn().mockResolvedValue(over.bars ?? []) } as any,
    { find: vi.fn().mockResolvedValue(over.instruments ?? []) } as any,
    { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
    { week: vi.fn().mockResolvedValue(over.calendar ?? { available: true, events: [] }) } as any,
  ] as const;
}

function quote(price: number, previousClose: number) {
  return { symbol: '', name: null, price, stale: false, session: 'REGULAR', extended: false, regularPrice: price, previousClose, peRatio: null };
}

/** 19 flat days, then a jump big enough to trip the ATR_MOVE rule. */
function atrJumpBars() {
  return Array.from({ length: 20 }, (_, i) => ({
    instrumentId: 'nvda',
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    close: i === 19 ? 103 : 100,
    high: i === 19 ? 104 : 101,
    low: 99,
    volume: 1_000_000,
  }));
}
const nvdaPosition = { symbol: 'NVDA', price: 103, regularPrice: 103, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null };

describe('DailyBriefService', () => {
  it('serves the mood from the market-data quotes, without spending the Twelve Data budget', async () => {
    const getQuotes = vi.fn().mockResolvedValue(new Map([
      ['SPY', quote(502, 500)],
      ['^VIX', quote(17.8, 16.7)],
      ['XLE', quote(101.2, 100)],
      ['XLK', quote(99.1, 100)],
    ]));
    const service = new DailyBriefService(...deps(), undefined, undefined, { getQuotes } as any);

    const result = await service.get({ refresh: true, now: new Date('2026-09-16T15:00:00Z') });

    expect(getQuotes).toHaveBeenCalledWith(expect.arrayContaining(['SPY', 'QQQ', '^VIX', 'XLK']), true, false);
    expect(result.mood.indices).toEqual([expect.objectContaining({ symbol: 'SPY', changePct: 0.004 })]);
    expect(result.mood.vix?.level).toBe(17.8);
    expect(result.mood.leader?.symbol).toBe('XLE');
    expect(result.mood.laggard?.symbol).toBe('XLK');
    expect(result.session).toBe('REGULAR');
  });

  it('still serves the brief with an empty mood when the quote fetch throws', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const getQuotes = vi.fn().mockRejectedValue(new Error('provider down'));
    const service = new DailyBriefService(...deps(), undefined, undefined, { getQuotes } as any);

    const result = await service.get();

    expect(result.mood).toEqual(EMPTY_MOOD);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('provider down'));
    warn.mockRestore();
  });

  it('leaves VIX null when the provider returned no VIX quote', async () => {
    const getQuotes = vi.fn().mockResolvedValue(new Map([['SPY', quote(502, 500)]]));
    const service = new DailyBriefService(...deps(), undefined, undefined, { getQuotes } as any);

    expect((await service.get()).mood.vix).toBeNull();
  });

  it('serves no coverage or grouped notes any more', async () => {
    const result = await new DailyBriefService(...deps()).get();
    expect(result).not.toHaveProperty('coverage');
    expect(result).not.toHaveProperty('notes');
  });

  it('lists this week\'s economic events on their own', async () => {
    const service = new DailyBriefService(...deps({ calendar: { available: true, events: [
      { kind: 'RATE_DECISION', name: 'Federal Reserve rate decision', date: '2026-09-16', title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.' },
    ] } }));

    const result = await service.get({ now: new Date('2026-09-16T09:00:00Z') });

    expect(result.events).toEqual([{ title: 'Fed raised rates 25 bp', detail: 'Target range is now 3.75–4.00%.', eventAt: '2026-09-16' }]);
    expect(result.marketDataAvailable).toBe(true);
  });

  it('reports an unavailable macro source', async () => {
    const service = new DailyBriefService(...deps({ calendar: { available: false, events: [] } }));
    await expect(service.get()).resolves.toMatchObject({ marketDataAvailable: false, events: [] });
  });

  it('turns a watch row\'s breakout into a trigger, and drops its plain big move', async () => {
    const service = new DailyBriefService(...deps({
      watched: [{ symbol: 'FSLR', price: 110, regularPrice: 110, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null }],
      instruments: [{ id: 'i-fslr', symbol: 'FSLR' }],
      bars: breakoutBars('i-fslr'),
    }));

    const result = await service.get();

    expect(result.watchTriggers).toEqual([expect.objectContaining({ kind: 'BREAKOUT', symbol: 'FSLR' })]);
    expect(result.watchTriggers.some((t) => (t.kind as string) === 'ATR_MOVE')).toBe(false);
  });

  it('never lists a held ticker as a watch trigger, even when it is also watched', async () => {
    const row = { symbol: 'FSLR', price: 110, regularPrice: 110, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null };
    const service = new DailyBriefService(...deps({
      positions: [row],
      watched: [row],
      instruments: [{ id: 'i-fslr', symbol: 'FSLR' }],
      bars: breakoutBars('i-fslr'),
    }));

    const result = await service.get();

    expect(result.watchTriggers).toEqual([]);
    expect(result.holdingNotes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'BREAKOUT', symbol: 'FSLR' })]));
  });

  it('drops earnings on a watch row, which is no longer a Brief item', async () => {
    const service = new DailyBriefService(...deps({
      watched: [{ symbol: 'PLTR', price: 25, regularPrice: 25, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 1 }],
    }));
    const result = await service.get();
    expect(result.watchTriggers).toEqual([]);
    expect(result.holdingNotes).toEqual([]);
  });

  it('mentions a missing stop on a held position with a notable move', async () => {
    const service = new DailyBriefService(...deps({
      positions: [nvdaPosition],
      atRisk: { positionsWithoutStop: { count: 1, symbols: ['NVDA'] } },
      instruments: [{ id: 'nvda', symbol: 'NVDA' }],
      bars: atrJumpBars(),
    }));

    const result = await service.get({ now: new Date('2026-08-20T16:00:00Z') });

    const move = result.holdingNotes.find((note) => note.kind === 'ATR_MOVE' && note.symbol === 'NVDA');
    expect(move?.detail.endsWith(' No stop is set on this position.')).toBe(true);
  });

  it('does not mention a missing stop when the position has one', async () => {
    const service = new DailyBriefService(...deps({
      positions: [nvdaPosition],
      instruments: [{ id: 'nvda', symbol: 'NVDA' }],
      bars: atrJumpBars(),
    }));

    const result = await service.get({ now: new Date('2026-08-20T16:00:00Z') });

    const move = result.holdingNotes.find((note) => note.kind === 'ATR_MOVE' && note.symbol === 'NVDA');
    expect(move).toBeDefined();
    expect(move?.detail).not.toContain('No stop is set on this position.');
  });

  it('mentions a partial stop on a held position with a notable move', async () => {
    const service = new DailyBriefService(...deps({
      positions: [nvdaPosition],
      atRisk: {
        positionsWithoutStop: { count: 0, symbols: [] },
        positionsWithPartialStop: { count: 1, positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }] },
      },
      instruments: [{ id: 'nvda', symbol: 'NVDA' }],
      bars: atrJumpBars(),
    }));

    const result = await service.get({ now: new Date('2026-08-20T16:00:00Z') });

    const move = result.holdingNotes.find((note) => note.kind === 'ATR_MOVE' && note.symbol === 'NVDA');
    expect(move?.detail).toContain('Partial stop: only 40 of 100 shares are covered.');
    expect(move?.detail).not.toContain('No stop is set');
  });

  it('orders an earnings note ahead of a momentum note', async () => {
    const realDates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10));
    const nvdaBars = realDates.map((date, i) => ({ instrumentId: 'nvda', date, close: 100 + i * 0.2, high: null, low: null, volume: 1_000_000 }));
    const spyBars = realDates.map((date) => ({ instrumentId: 'spy', date, close: 100, high: null, low: null, volume: 1_000_000 }));
    const price = 100 + 59 * 0.2;
    const service = new DailyBriefService(...deps({
      positions: [{ symbol: 'NVDA', price, regularPrice: price, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 0 }],
      instruments: [{ id: 'nvda', symbol: 'NVDA' }, { id: 'spy', symbol: 'SPY' }],
      bars: [...nvdaBars, ...spyBars],
    }));

    const result = await service.get({ now: new Date(Date.UTC(2026, 5, 60)) });

    const kinds = result.holdingNotes.map((note) => note.kind);
    expect(kinds).toContain('MOMENTUM');
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

    it('writes the narrative from the mood, session and holdings, and asks again when they change', async () => {
      const complete = vi.fn().mockResolvedValue('Read.');
      const llm = { isConfigured: () => true, complete } as any;
      const getQuotes = vi.fn().mockResolvedValue(new Map([['SPY', quote(502, 500)]]));
      const withNote = (daysUntilEarnings: number | null) => deps({
        positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings }],
      });
      const first = new DailyBriefService(...withNote(2), llm, undefined, { getQuotes } as any);

      await first.get({ now: new Date('2026-09-16T15:00:00Z') });

      const prompt = complete.mock.calls[0][0].user as string;
      expect(prompt).toContain('- SPY:');
      expect(prompt).toContain('market session REGULAR');
      expect(prompt).toContain('NVDA has earnings this week');

      // Same service, same day: an unchanged brief is reused, a changed holding set is not.
      const holdings = { getPortfolio: vi.fn() };
      holdings.getPortfolio
        .mockResolvedValueOnce({ positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 2 }], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } } })
        .mockResolvedValueOnce({ positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 2 }], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } } })
        .mockResolvedValue({ positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null }], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } } });
      const [, ...rest] = deps();
      const service = new DailyBriefService(holdings as any, ...rest, llm, undefined, { getQuotes } as any);
      complete.mockClear();

      await service.get({ now: new Date('2026-09-16T15:00:00Z') });
      await service.get({ now: new Date('2026-09-16T15:05:00Z') });
      expect(complete).toHaveBeenCalledTimes(1);
      await service.get({ now: new Date('2026-09-16T15:10:00Z') });
      expect(complete).toHaveBeenCalledTimes(2);
    });

    it('does not reuse a pre-market take after the open', async () => {
      const complete = vi.fn().mockResolvedValue('Read.');
      const llm = { isConfigured: () => true, complete } as any;
      const service = new DailyBriefService(...baseDeps(), llm);

      await service.get({ now: new Date('2026-09-16T13:20:00Z') }); // 09:20 ET, PRE
      await service.get({ now: new Date('2026-09-16T13:35:00Z') }); // 09:35 ET, REGULAR

      expect(complete).toHaveBeenCalledTimes(2);
    });

    it('asks again within 30 minutes when this week\'s events change', async () => {
      const complete = vi.fn().mockResolvedValue('Read.');
      const llm = { isConfigured: () => true, complete } as any;
      const week = vi.fn()
        .mockResolvedValueOnce({ available: true, events: [] })
        .mockResolvedValue({ available: true, events: [{ kind: 'RATE_DECISION', name: 'Fed', date: '2026-09-16', title: 'Fed raised rates 25 bp', detail: 'x' }] });
      const [a, b, c, d, e] = deps();
      const service = new DailyBriefService(a, b, c, d, e, { week } as any, llm);

      await service.get({ now: new Date('2026-09-16T15:00:00Z') });
      await service.get({ now: new Date('2026-09-16T15:05:00Z') });

      expect(complete).toHaveBeenCalledTimes(2);
      expect(complete.mock.calls[1][0].user).toContain('Fed raised rates 25 bp');
    });

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

    /**
     * The app prefetches the brief on every open and the Brief screen
     * refetches it every five minutes. Asking the model each time spent the
     * free tier's ~20 requests a day on repeats of the same paragraph, and
     * then the features the owner asks for on purpose failed on quota.
     */
    it('reuses the narrative while the notes it describes are unchanged', async () => {
      const complete = vi.fn().mockResolvedValue('Nothing urgent today.');
      const llm = { isConfigured: () => true, complete } as any;
      const service = new DailyBriefService(...baseDeps(), llm);
      const now = new Date('2026-09-28T14:00:00Z');

      await service.get({ now });
      const again = await service.get({ now: new Date('2026-09-28T14:05:00Z') });

      expect(again.narrative).toBe('Nothing urgent today.');
      // Its own time, so the screen can say how old its figures are.
      expect(again.narrativeAt).toBe('2026-09-28T14:00:00.000Z');
      expect(complete).toHaveBeenCalledTimes(1);

      // Past the age limit it is written afresh even with the same events.
      await service.get({ now: new Date('2026-09-28T14:31:00Z') });
      expect(complete).toHaveBeenCalledTimes(2);
    });

    it('asks again on a new day, and for a different user', async () => {
      const complete = vi.fn().mockResolvedValue('Nothing urgent today.');
      const llm = { isConfigured: () => true, complete } as any;
      let userId = 'u1';
      const users = {
        currentUser: async () => ({ id: userId }),
        ensureDefaultUser: async () => ({ id: 'u1' }),
      } as any;
      const service = new DailyBriefService(...baseDeps(), llm, users);

      await service.get({ now: new Date('2026-09-28T14:00:00Z') });
      await service.get({ now: new Date('2026-09-29T14:00:00Z') });
      userId = 'u2';
      await service.get({ now: new Date('2026-09-29T14:00:00Z') });

      expect(complete).toHaveBeenCalledTimes(3);
    });

    it('does not keep a failure: the next request asks again', async () => {
      const complete = vi
        .fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce('Back.');
      const llm = { isConfigured: () => true, complete } as any;
      const service = new DailyBriefService(...baseDeps(), llm);
      const now = new Date('2026-09-28T14:00:00Z');

      expect((await service.get({ now })).narrative).toBeNull();
      expect((await service.get({ now })).narrative).toBe('Back.');
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
