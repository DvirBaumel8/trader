import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TradeIdeaService } from './trade-idea.service.js';
import type { LlmClient } from './llm.client.js';
import type { TickerFactsService } from '../market-data/ticker-facts.service.js';
import type { PortfolioService } from '../portfolio/portfolio.service.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { UsersService } from '../users/users.service.js';

/**
 * The gathering step only. What the model does with the prompt is covered by
 * the e2e spec and by prompts.spec.ts; what matters here is that gathering
 * four independent things at once did not change which failure a caller is
 * told about, or let one overtake another.
 */
function makeService(opts: {
  facts?: () => unknown;
  stats?: () => unknown;
  portfolio?: () => unknown;
  llmAnswer?: string;
  ideas?: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
}) {
  const tickerFacts = {
    get: vi.fn().mockImplementation(opts.facts ?? (async () => ({ symbol: 'NVDA' }))),
  } as unknown as TickerFactsService;
  const trades = {
    getStats: vi
      .fn()
      .mockImplementation(opts.stats ?? (async () => ({ avgRisk: null, trades: [] }))),
  } as unknown as TradesService;
  const portfolio = {
    getPortfolio: vi
      .fn()
      .mockImplementation(opts.portfolio ?? (async () => ({ positions: [] }))),
  } as unknown as PortfolioService;
  const llm = {
    complete: vi.fn().mockResolvedValue(opts.llmAnswer ?? 'an opinion'),
    isConfigured: () => true,
    modelName: () => 'test-model',
  } as unknown as LlmClient;
  const users = {
    ensureDefaultUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    // Services resolve the request's user now, not the single owner.
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const ideas = (opts.ideas ?? { create: vi.fn(), save: vi.fn() }) as never;

  return new TradeIdeaService(llm, tickerFacts, portfolio, trades, ideas, users);
}

describe('TradeIdeaService.analyse — gathering', () => {
  it('reports an unknown ticker as unknown even when the book also fails', async () => {
    // The facts, the record, the book and the profile are now fetched
    // together. Whichever settles first must not decide the error: a bad
    // ticker is a 404, not whatever the portfolio happened to throw.
    const service = makeService({
      facts: async () => {
        throw new NotFoundException('Unknown ticker: ZZZZNOTREAL');
      },
      portfolio: async () => {
        throw new Error('database down');
      },
    });

    await expect(service.analyse('ZZZZNOTREAL')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('starts every fetch before the first has come back', async () => {
    const order: string[] = [];
    const service = makeService({
      facts: async () => {
        order.push('facts:start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('facts:end');
        return { symbol: 'NVDA' };
      },
      portfolio: async () => {
        order.push('book:start');
        return { positions: [] };
      },
      stats: async () => {
        order.push('record:start');
        return { avgRisk: null, trades: [] };
      },
    });

    await service.analyse('NVDA').catch(() => undefined);

    // Both begin before the facts resolve — impossible if serial.
    expect(order.indexOf('book:start')).toBeLessThan(order.indexOf('facts:end'));
    expect(order.indexOf('record:start')).toBeLessThan(order.indexOf('facts:end'));
  });
});

describe('TradeIdeaService.analyse — book placeholders', () => {
  /**
   * The end-to-end path for the BITX/LMND failure: the model is free to cite
   * a figure from the book in its prose, but only ever through a placeholder
   * — never by typing the digits itself. Both the returned opinion and the
   * one persisted for history must carry the real figure, not the model's.
   */
  it('substitutes a placeholder in the model answer with the real weight, in both the response and the saved row', async () => {
    const ideas = { create: vi.fn((data: unknown) => data), save: vi.fn() };
    const service = makeService({
      facts: async () => ({
        symbol: 'NVDA',
        name: null,
        price: 200,
        stale: false,
        session: 'REGULAR',
        extended: false,
        peRatio: null,
        priceAction: null,
        indicators: {
          sma20: null, sma50: null, sma150: null, sma200: null,
          percentFromSma20: null, percentFromSma50: null,
          percentFromSma150: null, percentFromSma200: null,
          high52w: null, low52w: null,
          percentFromHigh52w: null, percentFromLow52w: null,
          atr14: null, atrPercentOfPrice: null,
          relativeVolume: null, barsAvailable: 0,
        },
      }),
      portfolio: async () => ({
        positions: [{ symbol: 'LMND', quantity: 100, price: 221, marketValue: 22_100 }],
        accountValue: 100_000,
        cash: 0,
        atRisk: { amount: null },
      }),
      stats: async () => ({
        winRate: null,
        avgWin: null,
        avgLoss: null,
        avgRisk: null,
        expectancyR: null,
        closedCount: 0,
        trades: [],
      }),
      llmAnswer:
        'LMND is already {{WEIGHT:LMND}} of your account.\n\nLEVELS\nstop: 10\ntarget: 20',
      ideas,
    });

    const result = await service.analyse('NVDA');

    expect(result.opinion).toBe('LMND is already 22.1% of your account.');
    expect(ideas.save).toHaveBeenCalledWith(
      expect.objectContaining({ opinion: 'LMND is already 22.1% of your account.' }),
    );
  });
});
