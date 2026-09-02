import { describe, expect, it, vi } from 'vitest';
import { LlmService } from './llm.service.js';
import type { LlmClient } from './llm.client.js';
import type { AiSummaryService } from './ai-summary.service.js';
import type { PortfolioService } from '../portfolio/portfolio.service.js';
import type { PerformanceService } from '../performance/performance.service.js';

function fakePortfolioService(): PortfolioService {
  return {
    getPortfolio: vi.fn().mockResolvedValue({
      positions: [
        {
          symbol: 'AAPL',
          quantity: 100,
          avgCost: 150,
          price: 160,
          marketValue: 16000,
          unrealizedPnl: 1000,
          unrealizedPct: 0.0667,
          stale: false,
        },
      ],
      cash: 5000,
      positionsValue: 16000,
      accountValue: 21000,
      pricedAt: '2026-09-02T14:30:00.000Z',
      hasStalePrices: false,
      atRisk: { amount: 800, positionsWithoutStop: { count: 0, symbols: [] } },
    }),
    getStats: vi.fn().mockResolvedValue({
      closedCount: 10,
      openCount: 1,
      winRate: 0.6,
      avgWin: 500,
      avgLoss: 200,
      avgRisk: 400,
      riskTradeCount: 8,
      expectancyDollars: 220,
      expectancyR: 0.5,
      rTradeCount: 8,
    }),
    // Unused by LlmService — present only so the fake satisfies the type.
  } as unknown as PortfolioService;
}

function fakePerformanceService(): PerformanceService {
  return {
    getSeries: vi.fn().mockResolvedValue({
      range: '1M',
      points: [{ date: '2026-09-02', you: 0.042, sp500: 0.021, nasdaq: 0.047 }],
      deltas: { vsSp500: 0.021, vsNasdaq: -0.005 },
      unpricedSymbols: [],
    }),
  } as unknown as PerformanceService;
}

function fakeSummaries(): AiSummaryService {
  return {
    create: vi.fn().mockResolvedValue({ id: 'saved-id-1' }),
    list: vi.fn(),
    findOne: vi.fn(),
    remove: vi.fn(),
  } as unknown as AiSummaryService;
}

describe('LlmService.portfolioSummary', () => {
  it('returns an unconfigured result without touching the portfolio, model, or persistence, when no key is set', async () => {
    const client: LlmClient = {
      isConfigured: () => false,
      complete: vi.fn(),
      modelName: () => 'gemini-2.5-flash',
    };
    const portfolio = fakePortfolioService();
    const performance = fakePerformanceService();
    const summaries = fakeSummaries();
    const service = new LlmService(client, portfolio, performance, summaries);

    const result = await service.portfolioSummary();

    expect(result).toEqual({
      configured: false,
      summary: null,
      factsAsOf: null,
      error: null,
      id: null,
    });
    expect(portfolio.getPortfolio).not.toHaveBeenCalled();
    expect(performance.getSeries).not.toHaveBeenCalled();
    expect(summaries.create).not.toHaveBeenCalled();
  });

  it('builds facts from the portfolio and performance services, passes them to the client, and persists the result', async () => {
    const complete = vi.fn().mockResolvedValue('You are up 4.2% this month...');
    const client: LlmClient = {
      isConfigured: () => true,
      complete,
      modelName: () => 'gemini-2.5-flash',
    };
    const portfolio = fakePortfolioService();
    const performance = fakePerformanceService();
    const summaries = fakeSummaries();
    const service = new LlmService(client, portfolio, performance, summaries);

    const result = await service.portfolioSummary();

    expect(result.configured).toBe(true);
    expect(result.summary).toBe('You are up 4.2% this month...');
    expect(result.factsAsOf).toBe('2026-09-02T14:30:00.000Z');
    expect(result.error).toBeNull();
    expect(result.id).toBe('saved-id-1');

    expect(complete).toHaveBeenCalledTimes(1);
    const call = complete.mock.calls[0][0];
    expect(call.grounded).toBe(true);
    // The facts the app computed must actually reach the model, quoted.
    expect(call.user).toContain('$21,000.00');
    expect(call.system).toMatch(/never invent/i);

    // What's persisted is exactly what the model was fed and produced.
    expect(summaries.create).toHaveBeenCalledTimes(1);
    const saved = (summaries.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.summary).toBe('You are up 4.2% this month...');
    expect(saved.factsSnapshot).toContain('$21,000.00');
    expect(saved.model).toBe('gemini-2.5-flash');
    expect(saved.grounded).toBe(true);
    expect(saved.factsAsOf).toBe('2026-09-02T14:30:00.000Z');
  });

  it('returns a structured, non-throwing error when the model call fails, and persists nothing', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('rate limited'));
    const client: LlmClient = {
      isConfigured: () => true,
      complete,
      modelName: () => 'gemini-2.5-flash',
    };
    const portfolio = fakePortfolioService();
    const performance = fakePerformanceService();
    const summaries = fakeSummaries();
    const service = new LlmService(client, portfolio, performance, summaries);

    const result = await service.portfolioSummary();

    expect(result.configured).toBe(true);
    expect(result.summary).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.id).toBeNull();
    // The facts timestamp is still known even though the model call failed.
    expect(result.factsAsOf).toBe('2026-09-02T14:30:00.000Z');
    expect(summaries.create).not.toHaveBeenCalled();
  });

  it('exposes isConfigured by delegating to the client', () => {
    const client: LlmClient = {
      isConfigured: () => true,
      complete: vi.fn(),
      modelName: () => 'gemini-2.5-flash',
    };
    const service = new LlmService(
      client,
      fakePortfolioService(),
      fakePerformanceService(),
      fakeSummaries(),
    );
    expect(service.isConfigured()).toBe(true);
  });
});
