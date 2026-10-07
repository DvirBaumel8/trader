import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DailyBriefService, headlineWindowStart } from './daily-brief.service.js';
import { EMPTY_MOOD } from './brief-mood.js';

/** 21 flat bars then a close above the range on 3× volume: a confirmed breakout. */
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
  instruments?: { id: string; symbol: string; nextEarningsDate?: string }[];
  bars?: unknown[];
  calendar?: { available: boolean; events: unknown[] };
  atRisk?: unknown;
  stopTiers?: unknown[];
} = {}) {
  return [
    { getPortfolio: vi.fn().mockResolvedValue({ positions: over.positions ?? [], atRisk: over.atRisk ?? { positionsWithoutStop: { count: 0, symbols: [] } }, stopTiers: over.stopTiers ?? [] }) } as any,
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

/** 19 flat days, then a jump of a few ATRs. */
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

  it('turns a watch row\'s breakout into a trigger', async () => {
    const service = new DailyBriefService(...deps({
      watched: [{ symbol: 'FSLR', price: 110, regularPrice: 110, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null }],
      instruments: [{ id: 'i-fslr', symbol: 'FSLR' }],
      bars: breakoutBars('i-fslr'),
    }));

    const result = await service.get();

    expect(result.watchTriggers).toEqual([expect.objectContaining({ kind: 'BREAKOUT', symbol: 'FSLR' })]);
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
  });

  it('drops earnings on a watch row, which is no longer a Brief item', async () => {
    const service = new DailyBriefService(...deps({
      watched: [{ symbol: 'PLTR', price: 25, regularPrice: 25, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: 1 }],
    }));
    const result = await service.get();
    expect(result.watchTriggers).toEqual([]);
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
      const withNote = (noStop: boolean) => deps({
        positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null, marketValue: 10_000 }],
        atRisk: { positionsWithoutStop: { count: noStop ? 1 : 0, symbols: noStop ? ['NVDA'] : [] } },
      });
      const first = new DailyBriefService(...withNote(true), llm, undefined, { getQuotes } as any);

      await first.get({ now: new Date('2026-09-16T15:00:00Z') });

      const prompt = complete.mock.calls[0][0].user as string;
      expect(prompt).toContain('- SPY:');
      expect(prompt).toContain('market session REGULAR');
      expect(prompt).toContain('NVDA has no stop');

      // Same service, same day: an unchanged brief is reused, a changed holding set is not.
      const holdings = { getPortfolio: vi.fn() };
      holdings.getPortfolio
        .mockResolvedValueOnce({ positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null, marketValue: 10_000 }], atRisk: { positionsWithoutStop: { count: 1, symbols: ['NVDA'] } }, stopTiers: [] })
        .mockResolvedValueOnce({ positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null, marketValue: 10_000 }], atRisk: { positionsWithoutStop: { count: 1, symbols: ['NVDA'] } }, stopTiers: [] })
        .mockResolvedValue({ positions: [{ symbol: 'NVDA', price: 100, regularPrice: 100, stale: false, session: 'REGULAR', extended: false, daysUntilEarnings: null, marketValue: 10_000 }], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } }, stopTiers: [] });
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

  describe('the decision queue', () => {
    const position = (symbol: string, over: object = {}) => ({
      symbol, price: 93, regularPrice: 93, stale: false, session: 'REGULAR', extended: false,
      daysUntilEarnings: null, marketValue: 9_300, ...over,
    });
    const tradesStub = (entries: unknown[] = []) => ({ openTradeEntries: vi.fn().mockResolvedValue(entries) }) as any;

    it('serves a crossed stop from the portfolio\'s own stop rows', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('NVDA')],
        stopTiers: [{ symbol: 'NVDA', stopPrice: 95, currentPrice: 93, distance: -0.0215, passed: true, quantity: 100 }],
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'STOP_CROSSED', symbol: 'NVDA' })]);
    });

    it('serves a near-stop item using the ATR from the symbol\'s bars', async () => {
      // atrJumpBars give a prior ATR of 2.00; a stop $1 below the price is 0.5 ATR away.
      const service = new DailyBriefService(...deps({
        positions: [position('NVDA', { price: 100 })],
        instruments: [{ id: 'nvda', symbol: 'NVDA' }],
        bars: atrJumpBars(),
        stopTiers: [{ symbol: 'NVDA', stopPrice: 99, currentPrice: 100, distance: 0.01, passed: false, extended: false, quantity: 100 }],
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([{
        kind: 'NEAR_STOP',
        symbol: 'NVDA',
        title: 'NVDA is within 1 ATR of its stop',
        detail: 'Stop $99.00, last $100.00: 0.5 ATR (1.0%) away.',
      }]);
    });

    it('passes invalid stop plans from the portfolio into the queue', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('NVDA')],
        atRisk: {
          positionsWithoutStop: { count: 0, symbols: [] },
          stopPlanNeedsUpdate: { count: 1, positions: [{ symbol: 'NVDA', issue: 'DIRECTION_MISMATCH', recordedQuantity: 1, heldQuantity: 1 }] },
        },
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'NO_STOP', symbol: 'NVDA', title: "NVDA's stop does not fit this position" })]);
    });

    it('dates a thesis by the market day of entry, not the UTC day', async () => {
      // 2026-06-01 23:00 ET is 2026-06-02T03:00Z: the market date is still 06-01.
      const bars = Array.from({ length: 21 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 4, 12) + i * 86_400_000).toISOString().slice(0, 10); // 05-12 .. 06-01
        const close = i === 20 ? 90 : 100;
        return { instrumentId: 'i-nvda', date, close, adjClose: close, open: close, high: close + 1, low: close - 1, volume: 1_000_000 };
      });
      expect(bars.at(-1)!.date).toBe('2026-06-01');
      const service = new DailyBriefService(
        ...deps({ positions: [position('NVDA', { price: 90 })], instruments: [{ id: 'i-nvda', symbol: 'NVDA' }], bars }),
        undefined, undefined, undefined,
        tradesStub([{ symbol: 'NVDA', direction: 'LONG', enteredAt: new Date('2026-06-02T03:00:00Z'), reasons: ['ENTRY_BREAKOUT'] }]),
      );
      const result = await service.get({ now: new Date('2026-06-01T23:30:00Z') });
      // Entered on 06-01 and the 06-01 bar is the last completed one: it is judged, with 20 bars before it.
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'THESIS_BROKEN', symbol: 'NVDA' })]);
    });

    it('lists a held position with no stop', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('PLTR')],
        atRisk: { positionsWithoutStop: { count: 1, symbols: ['PLTR'] } },
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'NO_STOP', symbol: 'PLTR' })]);
    });

    it('passes partial stops from the portfolio into the queue', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('NVDA')],
        atRisk: {
          positionsWithoutStop: { count: 0, symbols: [] },
          positionsWithPartialStop: { count: 1, positions: [{ symbol: 'NVDA', coveredQuantity: 40, heldQuantity: 100 }] },
        },
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([{
        kind: 'PARTIAL_STOP',
        symbol: 'NVDA',
        title: "NVDA's stop covers 40 of 100 shares",
        detail: '60 shares have nothing limiting the loss.',
      }]);
    });

    it('reads the earnings date from the instrument', async () => {
      const service = new DailyBriefService(...deps({
        positions: [position('NVDA', { daysUntilEarnings: 1 })],
        instruments: [{ id: 'i-nvda', symbol: 'NVDA', nextEarningsDate: '2026-10-08' }],
      }));
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.queue).toEqual([expect.objectContaining({ kind: 'EARNINGS', symbol: 'NVDA', title: 'NVDA reports tomorrow' })]);
    });

    it('checks the thesis from the opening entry\'s reasons and the symbol\'s bars', async () => {
      const bars = Array.from({ length: 160 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 4, 1) + i * 86_400_000).toISOString().slice(0, 10);
        const close = i === 159 ? 90 : 100;
        return { instrumentId: 'i-nvda', date, close, adjClose: close, open: close, high: close + 1, low: close - 1, volume: 1_000_000 };
      });
      const service = new DailyBriefService(
        ...deps({ positions: [position('NVDA', { price: 90 })], instruments: [{ id: 'i-nvda', symbol: 'NVDA' }], bars }),
        undefined, undefined, undefined,
        tradesStub([{ symbol: 'NVDA', direction: 'LONG', enteredAt: new Date('2026-06-01T14:00:00Z'), reasons: ['ENTRY_SMA_150'] }]),
      );
      // After the close on the last bar's date, so that bar is a completed session.
      const result = await service.get({ now: new Date(`${bars.at(-1)!.date}T22:00:00Z`) });
      expect(result.queue).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'THESIS_BROKEN', symbol: 'NVDA' })]));
    });

    it('still serves the brief, without thesis items, when the trades read fails', async () => {
      const trades = { openTradeEntries: vi.fn().mockRejectedValue(new Error('db down')) } as any;
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        const service = new DailyBriefService(...deps({ positions: [position('NVDA')] }), undefined, undefined, undefined, trades);
        await expect(service.get()).resolves.toMatchObject({ queue: [] });
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('hands the queue to the AI and re-asks when it changes', async () => {
      const complete = vi.fn().mockResolvedValue('Act on NVDA.');
      const llm = { isConfigured: () => true, complete } as any;
      const portfolio = { getPortfolio: vi.fn() };
      portfolio.getPortfolio.mockResolvedValueOnce({ positions: [position('PLTR')], atRisk: { positionsWithoutStop: { count: 1, symbols: ['PLTR'] } }, stopTiers: [] });
      portfolio.getPortfolio.mockResolvedValueOnce({ positions: [position('PLTR')], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } }, stopTiers: [] });
      const [, ...rest] = deps();
      const service = new DailyBriefService(portfolio as any, ...rest, llm);

      await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(complete.mock.calls[0][0].user).toContain('Needs attention\n- PLTR has no stop');
      await service.get({ now: new Date('2026-10-07T15:05:00Z') });
      expect(complete).toHaveBeenCalledTimes(2);
    });
  });

  describe('movers', () => {
    // 15 bars at 100 with high 101 / low 99 give priorAtr = 2.
    const flat = (instrumentId: string) => Array.from({ length: 16 }, (_, i) => ({
      instrumentId, date: `2026-09-${String(i + 10).padStart(2, '0')}`,
      close: 100, adjClose: 100, open: 100, high: 101, low: 99, volume: 1_000_000,
    }));
    const position = (symbol: string, dayChange: number) => ({
      symbol, price: 100 + dayChange, regularPrice: 100, stale: false, session: 'REGULAR', extended: false,
      daysUntilEarnings: null, marketValue: 10_000, dayChange, dayChangePct: dayChange / 100, dayPnl: dayChange * 100,
    });
    const tradesStub = (entries: unknown[] = []) => ({ openTradeEntries: vi.fn().mockResolvedValue(entries) }) as any;

    it('serves holdings that moved 1 ATR or more, with a headline and entry reasons', async () => {
      const news = { latestHeadline: vi.fn().mockResolvedValue({ title: 'Deal', source: 'Reuters', url: 'https://x.test', at: '2026-10-07T13:00:00.000Z' }) };
      const service = new DailyBriefService(
        ...deps({ positions: [position('NVDA', 5), position('QUIET', 1)], instruments: [{ id: 'i-n', symbol: 'NVDA' }, { id: 'i-q', symbol: 'QUIET' }], bars: [...flat('i-n'), ...flat('i-q')] }),
        undefined, undefined, undefined,
        tradesStub([{ symbol: 'NVDA', direction: 'LONG', enteredAt: new Date('2026-09-01T14:00:00Z'), reasons: ['ENTRY_BREAKOUT'] }]),
        news as any,
      );
      const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(result.movers).toEqual([expect.objectContaining({
        symbol: 'NVDA', atrMultiple: 2.5, dollarChange: 500,
        reasons: [{ code: 'ENTRY_BREAKOUT', label: 'Breakout' }],
        headline: { title: 'Deal', source: 'Reuters', url: 'https://x.test', at: '2026-10-07T13:00:00.000Z' },
        thesis: null,
      })]);
      expect(news.latestHeadline).toHaveBeenCalledWith('NVDA', new Date('2026-10-06T13:30:00Z'));
      expect(news.latestHeadline).toHaveBeenCalledTimes(1); // only movers ask for news
      expect(result).not.toHaveProperty('holdingNotes');
    });

    it('serves movers without headlines when the news lookup fails', async () => {
      const news = { latestHeadline: vi.fn().mockRejectedValue(new Error('finnhub down')) };
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        const service = new DailyBriefService(
          ...deps({ positions: [position('NVDA', 5)], instruments: [{ id: 'i-n', symbol: 'NVDA' }], bars: flat('i-n') }),
          undefined, undefined, undefined, undefined, news as any,
        );
        const result = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
        expect(result.movers).toEqual([expect.objectContaining({ symbol: 'NVDA', headline: null })]);
      } finally {
        warn.mockRestore();
      }
    });

    it('hands movers to the AI and re-asks when a new headline arrives', async () => {
      const complete = vi.fn().mockResolvedValue('NVDA is moving on news.');
      const llm = { isConfigured: () => true, complete } as any;
      const news = { latestHeadline: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ title: 'Deal', source: 'Reuters', url: 'https://x.test', at: '2026-10-07T13:00:00.000Z' }) };
      const service = new DailyBriefService(
        ...deps({ positions: [position('NVDA', 5)], instruments: [{ id: 'i-n', symbol: 'NVDA' }], bars: flat('i-n') }),
        llm, undefined, undefined, undefined, news as any,
      );
      await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      expect(complete.mock.calls[0][0].user).toContain('Movers\n- NVDA:');
      await service.get({ now: new Date('2026-10-07T15:05:00Z') });
      expect(complete).toHaveBeenCalledTimes(2);
    });

    it('keeps the narrative cached when two movers merely swap rank', async () => {
      const complete = vi.fn().mockResolvedValue('Two movers.');
      const llm = { isConfigured: () => true, complete } as any;
      const headline = (s: string) => ({ title: s, source: 'Reuters', url: `https://x.test/${s}`, at: '2026-10-07T13:00:00.000Z' });
      const news = { latestHeadline: vi.fn(async (symbol: string) => headline(symbol)) };
      const portfolio = { getPortfolio: vi.fn() };
      portfolio.getPortfolio.mockResolvedValueOnce({ positions: [position('NVDA', 5), position('AMD', 3)], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } }, stopTiers: [] });
      portfolio.getPortfolio.mockResolvedValueOnce({ positions: [position('NVDA', 3), position('AMD', 5)], atRisk: { positionsWithoutStop: { count: 0, symbols: [] } }, stopTiers: [] });
      const [, ...rest] = deps({ instruments: [{ id: 'i-n', symbol: 'NVDA' }, { id: 'i-a', symbol: 'AMD' }], bars: [...flat('i-n'), ...flat('i-a')] });
      const service = new DailyBriefService(portfolio as any, ...rest, llm, undefined, undefined, undefined, news as any);

      const first = await service.get({ now: new Date('2026-10-07T15:00:00Z') });
      const second = await service.get({ now: new Date('2026-10-07T15:05:00Z') });
      expect(first.movers.map((m) => m.symbol)).toEqual(['NVDA', 'AMD']);
      expect(second.movers.map((m) => m.symbol)).toEqual(['AMD', 'NVDA']);
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('gives up on a headline that never arrives, without holding up the brief', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        const news = { latestHeadline: vi.fn(() => new Promise(() => {})) };
        const service = new DailyBriefService(
          ...deps({ positions: [position('NVDA', 5)], instruments: [{ id: 'i-n', symbol: 'NVDA' }], bars: flat('i-n') }),
          undefined, undefined, undefined, undefined, news as any,
        );
        const pending = service.get({ now: new Date('2026-10-07T15:00:00Z') });
        await vi.advanceTimersByTimeAsync(4001);
        const result = await pending;
        expect(result.movers).toEqual([expect.objectContaining({ symbol: 'NVDA', headline: null })]);
        expect(warn).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });
  });
});

describe('headlineWindowStart', () => {
  const at = (iso: string) => headlineWindowStart(new Date(iso)).toISOString();
  it('on a weekend reaches back to 24h before Friday\'s open', () => {
    expect(at('2026-10-10T16:00:00Z')).toBe('2026-10-08T13:30:00.000Z');
  });
  it('during a session reaches back to 24h before that day\'s open', () => {
    expect(at('2026-10-06T15:00:00Z')).toBe('2026-10-05T13:30:00.000Z');
  });
  // Pre-market the coming session's open is still ahead, so the plain last 24h reaches further back.
  it('pre-market is the plain last 24 hours', () => {
    expect(at('2026-10-06T09:00:00Z')).toBe('2026-10-05T09:00:00.000Z');
  });
  it('follows the winter offset', () => {
    expect(at('2026-12-08T15:00:00Z')).toBe('2026-12-07T14:30:00.000Z');
  });
  it('after the close still reaches back to 24h before that day\'s open', () => {
    expect(at('2026-10-07T23:00:00Z')).toBe('2026-10-06T13:30:00.000Z');
  });
});
