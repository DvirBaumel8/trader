import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmService } from './llm.service.js';
import { LlmFailure, type LlmClient } from './llm.client.js';
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
          peRatio: 32.1,
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
      // The real getStats() carries the per-trade list the facts block now
      // renders; without it the context builder has nothing to iterate.
      trades: [],
    }),
    getOpenTradeEntryVolume: vi.fn().mockResolvedValue(
      new Map([['AAPL', 1.8]]),
    ),
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
    findLatest: vi.fn().mockResolvedValue(null),
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
      errorKind: null,
      id: null,
    });
    expect(portfolio.getPortfolio).not.toHaveBeenCalled();
    expect(performance.getSeries).not.toHaveBeenCalled();
    expect(summaries.create).not.toHaveBeenCalled();
  });

  // `grounded` is read from `LLM_GROUNDED` at call time (see llm.service.ts —
  // grounding is opt-in and off by default because the free Gemini tier
  // rejects grounded requests outright). Both tests stub the env var
  // explicitly rather than relying on whatever happens to be in `.env`, so
  // they assert the wiring, not the ambient environment.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds facts from the portfolio and performance services, passes them to the client, and persists the result', async () => {
    vi.stubEnv('LLM_GROUNDED', 'true');
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
    expect(result.errorKind).toBeNull();
    expect(result.id).toBe('saved-id-1');

    expect(complete).toHaveBeenCalledTimes(1);
    const call = complete.mock.calls[0][0];
    expect(call.grounded).toBe(true);
    // The facts the app computed must actually reach the model, quoted.
    expect(call.user).toContain('$21,000');
    // Volume and P/E facts (the reason this test suite exists) reach the model too.
    expect(call.user).toContain('P/E 32.1');
    expect(call.user).toContain('entry volume 1.80x its 20-day average');
    expect(call.system).toMatch(/never invent/i);

    // What's persisted is exactly what the model was fed and produced.
    expect(summaries.create).toHaveBeenCalledTimes(1);
    const saved = (summaries.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.summary).toBe('You are up 4.2% this month...');
    expect(saved.factsSnapshot).toContain('$21,000');
    expect(saved.model).toBe('gemini-2.5-flash');
    expect(saved.grounded).toBe(true);
    expect(saved.factsAsOf).toBe('2026-09-02T14:30:00.000Z');
  });

  it('defaults grounded to false when LLM_GROUNDED is unset', async () => {
    vi.stubEnv('LLM_GROUNDED', undefined);
    const complete = vi.fn().mockResolvedValue('summary text');
    const client: LlmClient = {
      isConfigured: () => true,
      complete,
      modelName: () => 'gemini-2.5-flash',
    };
    const service = new LlmService(
      client,
      fakePortfolioService(),
      fakePerformanceService(),
      fakeSummaries(),
    );

    await service.portfolioSummary();

    expect(complete.mock.calls[0][0].grounded).toBe(false);
  });

  it('returns a structured, non-throwing error when the model call fails with an unclassified error, and persists nothing', async () => {
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
    expect(result.errorKind).toBe('unknown');
    expect(result.id).toBeNull();
    // The facts timestamp is still known even though the model call failed.
    expect(result.factsAsOf).toBe('2026-09-02T14:30:00.000Z');
    expect(summaries.create).not.toHaveBeenCalled();
  });

  it.each([
    ['busy', 'The AI model is busy right now. Worth another tap in a moment.'],
    ['quota_exceeded', "Today's free AI quota is used up. Try again tomorrow."],
    [
      'setup_problem',
      'The AI summary is not set up correctly. Ask the developer to check the model and API key.',
    ],
  ] as const)(
    'maps an LlmFailure of kind %s to its own copy and errorKind',
    async (kind, expectedCopy) => {
      const complete = vi.fn().mockRejectedValue(new LlmFailure(kind, 'provider said so'));
      const client: LlmClient = {
        isConfigured: () => true,
        complete,
        modelName: () => 'gemini-2.5-flash',
      };
      const service = new LlmService(
        client,
        fakePortfolioService(),
        fakePerformanceService(),
        fakeSummaries(),
      );

      const result = await service.portfolioSummary();

      expect(result.errorKind).toBe(kind);
      expect(result.error).toBe(expectedCopy);
      expect(result.summary).toBeNull();
      expect(result.id).toBeNull();
    },
  );

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

  it('feeds the previous summary back so the model can say what changed', async () => {
    const complete = vi.fn().mockResolvedValue('summary text');
    const client: LlmClient = {
      isConfigured: () => true,
      complete,
      modelName: () => 'gemini-2.5-flash',
    };
    const summaries = fakeSummaries();
    (summaries.findLatest as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: 'Last time: LMND was 31% of the account and already unstopped.',
      factsAsOf: new Date('2026-09-01T20:00:00.000Z'),
    });
    const service = new LlmService(
      client,
      fakePortfolioService(),
      fakePerformanceService(),
      summaries,
    );

    await service.portfolioSummary();

    const call = complete.mock.calls[0][0];
    expect(call.user).toContain('LMND was 31% of the account');
    expect(call.user).toContain('2026-09-01T20:00:00.000Z');
    expect(call.user).toMatch(/MATERIALLY changed/);
  });

  it('says nothing about a previous summary when there is none', async () => {
    const complete = vi.fn().mockResolvedValue('summary text');
    const client: LlmClient = {
      isConfigured: () => true,
      complete,
      modelName: () => 'gemini-2.5-flash',
    };
    const service = new LlmService(
      client,
      fakePortfolioService(),
      fakePerformanceService(),
      fakeSummaries(),
    );

    await service.portfolioSummary();

    const call = complete.mock.calls[0][0];
    expect(call.user).not.toMatch(/last time/i);
    expect(call.user).not.toMatch(/MATERIALLY changed/);
  });
});