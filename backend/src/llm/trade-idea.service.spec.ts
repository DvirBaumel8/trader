import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TradeIdeaService } from './trade-idea.service.js';
import type { LlmClient } from './llm.client.js';
import type { TickerFactsService } from '../market-data/ticker-facts.service.js';
import type { PortfolioService } from '../portfolio/portfolio.service.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { UsersService } from '../users/users.service.js';
import type { AiOutcomeService } from './ai-outcome.service.js';

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
  llmCompleteStream?: () => AsyncIterable<string>;
  ideas?: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  outcomes?: { recordPending: ReturnType<typeof vi.fn> };
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
  async function* defaultStream() {
    yield opts.llmAnswer ?? 'an opinion';
  }
  const llm = {
    complete: vi.fn().mockResolvedValue(opts.llmAnswer ?? 'an opinion'),
    completeStream: opts.llmCompleteStream ?? (() => defaultStream()),
    isConfigured: () => true,
    modelName: () => 'test-model',
  } as unknown as LlmClient;
  const users = {
    ensureDefaultUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    // Services resolve the request's user now, not the single owner.
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const ideas = (opts.ideas ?? {
    create: vi.fn((data: unknown) => data),
    save: vi.fn().mockImplementation(async (r: Record<string, unknown>) => ({
      ...r,
      id: 'idea-1',
    })),
  }) as never;
  const outcomes = (opts.outcomes ?? {
    recordPending: vi.fn(),
  }) as unknown as AiOutcomeService;

  return new TradeIdeaService(llm, tickerFacts, portfolio, trades, ideas, users, outcomes);
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

  it('asks for a minimal thinking budget — a trade idea is short, structured output', async () => {
    const complete = vi.fn().mockResolvedValue('an opinion');
    const llm = {
      complete,
      completeStream: vi.fn(),
      isConfigured: () => true,
      modelName: () => 'test-model',
    } as unknown as LlmClient;
    const tickerFacts = {
      get: vi.fn().mockResolvedValue(fullFacts()),
    } as unknown as TickerFactsService;
    const portfolio = {
      getPortfolio: vi.fn().mockResolvedValue(fullPortfolio()),
    } as unknown as PortfolioService;
    const trades = {
      getStats: vi.fn().mockResolvedValue(fullStats()),
    } as unknown as TradesService;
    const users = {
      currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as UsersService;
    const service = new TradeIdeaService(
      llm, tickerFacts, portfolio, trades,
      {
        create: vi.fn((data: unknown) => data),
        save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-1' })),
      } as never,
      users,
      { recordPending: vi.fn() } as unknown as AiOutcomeService,
    );

    await service.analyse('NVDA');

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'MINIMAL' }),
    );
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
    const ideas = {
      create: vi.fn((data: unknown) => data),
      save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-1' })),
    };
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
        news: [],
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

    expect(result.id).toBe('idea-1');
    expect(result.opinion).toBe('LMND is already 22.1% of your account.');
    expect(ideas.save).toHaveBeenCalledWith(
      expect.objectContaining({ opinion: 'LMND is already 22.1% of your account.' }),
    );
  });

  it("returns the saved row's own id", async () => {
    const ideas = {
      create: vi.fn((data: unknown) => data),
      save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-42' })),
    };
    const service = makeService({
      facts: async () => fullFacts(),
      portfolio: async () => fullPortfolio(),
      stats: async () => fullStats(),
      llmAnswer: 'An opinion.\n\nLEVELS\nstop: 10\ntarget: 20',
      ideas,
    });

    const result = await service.analyse('NVDA');

    expect(result.id).toBe('idea-42');
  });

  it('is null when nothing was saved — unconfigured', async () => {
    const llm = {
      isConfigured: () => false,
      complete: vi.fn(),
      completeStream: vi.fn(),
      modelName: () => 'test-model',
    } as unknown as LlmClient;
    const tickerFacts = { get: vi.fn() } as unknown as TickerFactsService;
    const portfolio = { getPortfolio: vi.fn() } as unknown as PortfolioService;
    const trades = { getStats: vi.fn() } as unknown as TradesService;
    const users = { currentUser: vi.fn() } as unknown as UsersService;
    const service = new TradeIdeaService(
      llm, tickerFacts, portfolio, trades, { create: vi.fn(), save: vi.fn() } as never, users,
      { recordPending: vi.fn() } as unknown as AiOutcomeService,
    );

    const result = await service.analyse('NVDA');

    expect(result.id).toBeNull();
  });

  it('records a pending outcome only when levels were read', async () => {
    const outcomes = { recordPending: vi.fn() };
    const withLevels = makeService({
      facts: async () => fullFacts(),
      portfolio: async () => fullPortfolio(),
      stats: async () => fullStats(),
      llmAnswer: 'An opinion.\n\nLEVELS\nstop: 10\ntarget: 20',
      outcomes,
    });
    await withLevels.analyse('NVDA');
    expect(outcomes.recordPending).toHaveBeenCalledWith('trade_idea', 'idea-1');

    const outcomesUnreadable = { recordPending: vi.fn() };
    const withoutLevels = makeService({
      facts: async () => fullFacts(),
      portfolio: async () => fullPortfolio(),
      stats: async () => fullStats(),
      llmAnswer: 'Prose with no LEVELS block at all.',
      outcomes: outcomesUnreadable,
    });
    await withoutLevels.analyse('NVDA');
    expect(outcomesUnreadable.recordPending).not.toHaveBeenCalled();
  });
});

async function collectLines(stream: AsyncGenerator<string>): Promise<unknown[]> {
  const lines: unknown[] = [];
  for await (const line of stream) lines.push(JSON.parse(line));
  return lines;
}

const fullFacts = () => ({
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
  news: [],
});

const fullPortfolio = () => ({
  positions: [{ symbol: 'LMND', quantity: 100, price: 221, marketValue: 22_100 }],
  accountValue: 100_000,
  cash: 0,
  atRisk: { amount: null },
});

const fullStats = () => ({
  winRate: null,
  avgWin: null,
  avgLoss: null,
  avgRisk: null,
  expectancyR: null,
  closedCount: 0,
  trades: [],
});

describe('TradeIdeaService.analyseStream', () => {
  it('yields a single done line, unconfigured, without touching the portfolio', async () => {
    const llm = {
      isConfigured: () => false,
      complete: vi.fn(),
      completeStream: vi.fn(),
      modelName: () => 'test-model',
    } as unknown as LlmClient;
    const tickerFacts = { get: vi.fn() } as unknown as TickerFactsService;
    const portfolio = { getPortfolio: vi.fn() } as unknown as PortfolioService;
    const trades = { getStats: vi.fn() } as unknown as TradesService;
    const users = { currentUser: vi.fn() } as unknown as UsersService;
    const service = new TradeIdeaService(
      llm, tickerFacts, portfolio, trades, { create: vi.fn(), save: vi.fn() } as never, users,
      { recordPending: vi.fn() } as unknown as AiOutcomeService,
    );

    const lines = await collectLines(service.analyseStream('nvda'));

    expect(lines).toEqual([
      {
        done: true,
        configured: false,
        symbol: 'NVDA',
        facts: null,
        levels: null,
        risk: null,
        levelsUnreadable: false,
        error: null,
        errorKind: null,
        id: null,
      },
    ]);
    expect(portfolio.getPortfolio).not.toHaveBeenCalled();
  });

  it('never yields the LEVELS block or a raw {{...}} placeholder, only the substituted body', async () => {
    const ideas = {
      create: vi.fn((data: unknown) => data),
      save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-1' })),
    };
    const service = makeService({
      facts: async () => fullFacts(),
      portfolio: async () => fullPortfolio(),
      stats: async () => fullStats(),
      llmCompleteStream: async function* () {
        yield 'LMND is already {{WEIGHT:LM';
        yield 'ND}} of your account.\n\nLEVELS\nstop: 10\ntarget: 20';
      },
      ideas,
    });

    const lines = await collectLines(service.analyseStream('NVDA'));

    const deltas = lines.filter((l): l is { delta: string } => 'delta' in (l as object));
    // Trailing whitespace before the LEVELS block survives in the streamed
    // deltas — only the persisted `opinion` goes through a final `.trim()`,
    // same as every other streamed AI feature in the app.
    const joined = deltas.map((d) => d.delta).join('').trim();
    expect(joined).toBe('LMND is already 22.1% of your account.');
    expect(joined).not.toContain('{{');
    expect(joined).not.toContain('LEVELS');
  });

  it('yields a final done line with the parsed levels and persists the same substituted opinion', async () => {
    const ideas = {
      create: vi.fn((data: unknown) => data),
      save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-1' })),
    };
    const service = makeService({
      facts: async () => fullFacts(),
      portfolio: async () => fullPortfolio(),
      stats: async () => fullStats(),
      llmCompleteStream: async function* () {
        yield 'LMND is already {{WEIGHT:LMND}} of your account.\n\nLEVELS\nstop: 10\ntarget: 20';
      },
      ideas,
    });

    const lines = await collectLines(service.analyseStream('NVDA'));

    const done = lines.at(-1) as Record<string, unknown>;
    expect(done).toMatchObject({
      done: true,
      configured: true,
      symbol: 'NVDA',
      levels: { stop: 10, target: 20 },
      levelsUnreadable: false,
      error: null,
      id: 'idea-1',
    });
    expect(ideas.save).toHaveBeenCalledWith(
      expect.objectContaining({ opinion: 'LMND is already 22.1% of your account.' }),
    );
  });

  it('asks for a minimal thinking budget on the streamed call too', async () => {
    async function* stub() {
      yield 'an opinion';
    }
    const completeStream = vi.fn(() => stub());
    const llm = {
      complete: vi.fn(),
      completeStream,
      isConfigured: () => true,
      modelName: () => 'test-model',
    } as unknown as LlmClient;
    const tickerFacts = {
      get: vi.fn().mockResolvedValue(fullFacts()),
    } as unknown as TickerFactsService;
    const portfolio = {
      getPortfolio: vi.fn().mockResolvedValue(fullPortfolio()),
    } as unknown as PortfolioService;
    const trades = {
      getStats: vi.fn().mockResolvedValue(fullStats()),
    } as unknown as TradesService;
    const users = {
      currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    } as unknown as UsersService;
    const service = new TradeIdeaService(
      llm, tickerFacts, portfolio, trades,
      {
        create: vi.fn((data: unknown) => data),
        save: vi.fn().mockImplementation(async (r: unknown) => ({ ...(r as object), id: 'idea-1' })),
      } as never,
      users,
      { recordPending: vi.fn() } as unknown as AiOutcomeService,
    );

    await collectLines(service.analyseStream('NVDA'));

    expect(completeStream).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'MINIMAL' }),
    );
  });

  it('yields a done line with the error copy, and no delta lines, when the stream fails before any text', async () => {
    const ideas = { create: vi.fn(), save: vi.fn() };
    const service = makeService({
      facts: async () => fullFacts(),
      portfolio: async () => fullPortfolio(),
      stats: async () => fullStats(),
      llmCompleteStream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new Error('boom')),
        }),
      }),
      ideas,
    });

    const lines = await collectLines(service.analyseStream('NVDA'));

    expect(lines).toEqual([
      expect.objectContaining({
        done: true,
        configured: true,
        symbol: 'NVDA',
        levels: null,
        error: expect.any(String),
        errorKind: 'unknown',
      }),
    ]);
    expect(ideas.save).not.toHaveBeenCalled();
  });
});
