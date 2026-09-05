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
    complete: vi.fn().mockResolvedValue('an opinion'),
    isConfigured: () => true,
  } as unknown as LlmClient;
  const users = {
    ensureDefaultUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const ideas = { save: vi.fn() } as never;

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
