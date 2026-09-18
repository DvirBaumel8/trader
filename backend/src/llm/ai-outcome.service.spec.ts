import { describe, expect, it, vi } from 'vitest';
import { AiOutcomeService } from './ai-outcome.service.js';
import type { UsersService } from '../users/users.service.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { HistoryService } from '../market-data/history.service.js';
import type { Repository } from 'typeorm';
import type { AiOutcome } from './ai-outcome.entity.js';
import type { TradeIdea } from './trade-idea.entity.js';
import type { SymbolPatternRead } from './symbol-pattern.entity.js';
import type { TradeReview } from './trade-review.entity.js';
import type { RawBar } from '../market-data/yahoo.client.js';

function makeService(opts: {
  pendingRows?: Partial<AiOutcome>[];
  findIdea?: (id: string) => Partial<TradeIdea> | null;
  findRead?: (id: string) => Partial<SymbolPatternRead> | null;
  findReview?: (id: string) => Partial<TradeReview> | null;
  liveDailyBars?: (symbol: string, from: Date) => Promise<RawBar[]>;
  deriveAllTrades?: () => Promise<unknown[]>;
  tagsByEntryId?: () => Promise<Map<string, { setups: string[]; mistakes: string[] }>>;
} = {}) {
  const outcomes = {
    create: vi.fn().mockImplementation((data) => ({ ...data })),
    save: vi.fn().mockImplementation(async (r) => r),
    find: vi.fn().mockResolvedValue(opts.pendingRows ?? []),
  };
  const ideas = {
    findOne: vi
      .fn()
      .mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
        opts.findIdea ? opts.findIdea(id) : null,
      ),
  };
  const reads = {
    findOne: vi
      .fn()
      .mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
        opts.findRead ? opts.findRead(id) : null,
      ),
  };
  const reviews = {
    findOne: vi
      .fn()
      .mockImplementation(async ({ where: { id } }: { where: { id: string } }) =>
        opts.findReview ? opts.findReview(id) : null,
      ),
  };
  const users = {
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const trades = {
    deriveAllTrades: opts.deriveAllTrades ?? (async () => []),
    tagsByEntryId: opts.tagsByEntryId ?? (async () => new Map()),
  } as unknown as TradesService;
  const history = {
    liveDailyBars: opts.liveDailyBars ?? (async () => []),
  } as unknown as HistoryService;

  return {
    service: new AiOutcomeService(
      outcomes as unknown as Repository<AiOutcome>,
      ideas as unknown as Repository<TradeIdea>,
      reads as unknown as Repository<SymbolPatternRead>,
      reviews as unknown as Repository<TradeReview>,
      users,
      trades,
      history,
    ),
    outcomes,
    ideas,
  };
}

describe('AiOutcomeService.recordPending', () => {
  it('creates a pending row for the current user, feature and entity', async () => {
    const { service, outcomes } = makeService();

    await service.recordPending('trade_idea', 'idea-1');

    expect(outcomes.create).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'trade_idea',
      entityId: 'idea-1',
      status: 'pending',
    });
    expect(outcomes.save).toHaveBeenCalled();
  });
});

describe('AiOutcomeService.list', () => {
  it("returns the current user's outcome rows, newest first", async () => {
    const { service, outcomes } = makeService({ pendingRows: [] });
    outcomes.find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'o1' }, { id: 'o2' }]);

    const result = await service.list();

    expect(result).toEqual([{ id: 'o1' }, { id: 'o2' }]);
  });
});

describe('AiOutcomeService.resolvePending — trade_idea', () => {
  const LONG_IDEA: Partial<TradeIdea> = {
    id: 'idea-1',
    symbol: 'NVDA',
    entryPrice: 100,
    stop: 90,
    target: 120,
    createdAt: new Date('2026-08-01T00:00:00Z'),
  };

  function bar(date: string, low: number, high: number): RawBar {
    return { date, close: (low + high) / 2, adjClose: (low + high) / 2, open: low, high, low, volume: 1_000 };
  }

  it("resolves target_hit when a LONG idea's target is crossed before its stop", async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: (id) => (id === 'idea-1' ? LONG_IDEA : null),
      liveDailyBars: async () => [
        bar('2026-08-05', 95, 105),
        bar('2026-08-10', 98, 121),
      ],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'target_hit' }),
    );
  });

  it("resolves stop_hit when a LONG idea's stop is crossed before its target", async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => LONG_IDEA,
      liveDailyBars: async () => [bar('2026-08-05', 89, 101)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'stop_hit' }),
    );
  });

  it('resolves stop_hit — the conservative read — when one bar crosses both levels', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => LONG_IDEA,
      liveDailyBars: async () => [bar('2026-08-05', 85, 125)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'stop_hit' }),
    );
  });

  it('stays pending when neither level has been crossed and 30 days have not passed', async () => {
    const recentIdea = { ...LONG_IDEA, createdAt: new Date() };
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => recentIdea,
      liveDailyBars: async () => [bar('2026-08-05', 95, 105)],
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
  });

  it('expires when neither level has been crossed within 30 days', async () => {
    const oldIdea = { ...LONG_IDEA, createdAt: new Date(Date.now() - 31 * 86_400_000) };
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => oldIdea,
      liveDailyBars: async () => [bar('2026-08-05', 95, 105)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'expired' }),
    );
  });

  it("resolves against a SHORT idea's levels the same way, mirrored", async () => {
    const shortIdea: Partial<TradeIdea> = {
      id: 'idea-2',
      symbol: 'BITX',
      entryPrice: 20,
      stop: 22,
      target: 15,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    };
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o2', feature: 'trade_idea', entityId: 'idea-2', status: 'pending' }],
      findIdea: () => shortIdea,
      liveDailyBars: async () => [bar('2026-08-05', 14, 19)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o2', status: 'target_hit' }),
    );
  });
});

describe('AiOutcomeService.resolvePending — symbol_pattern and trade_review', () => {
  const READ: Partial<SymbolPatternRead> = {
    id: 'read-1',
    symbol: 'NVDA',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    factsSnapshot: JSON.stringify({
      symbol: 'NVDA',
      trades: [{ symbol: 'NVDA', mistakes: ['cut winner short'] }],
    }),
  };

  const REVIEW: Partial<TradeReview> = {
    id: 'rev-1',
    symbol: 'NVDA',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    factsSnapshot: JSON.stringify({ symbol: 'NVDA', mistakes: ['cut winner short'] }),
  };

  function closedTrade(entryId: string, enteredAt: string) {
    return {
      symbol: 'NVDA',
      isOpen: false,
      enteredAt: new Date(enteredAt),
      exitedAt: new Date(enteredAt),
      fills: [{ entryId, executedAt: new Date(enteredAt), side: 'BUY', quantity: 1, price: 1, fee: 0 }],
    };
  }

  it('resolves repeated when the next closed trade in that symbol carries the same mistake tag', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'symbol_pattern', entityId: 'read-1', status: 'pending' }],
      findRead: () => READ,
      deriveAllTrades: async () => [closedTrade('e1', '2026-08-10')],
      tagsByEntryId: async () =>
        new Map([['e1', { setups: [], mistakes: ['cut winner short'] }]]),
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'repeated' }),
    );
  });

  it('resolves improved when the next closed trade shares none of the named mistakes', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_review', entityId: 'rev-1', status: 'pending' }],
      findReview: () => REVIEW,
      deriveAllTrades: async () => [closedTrade('e1', '2026-08-10')],
      tagsByEntryId: async () => new Map([['e1', { setups: [], mistakes: [] }]]),
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'improved' }),
    );
  });

  it('stays pending with no qualifying next trade and 90 days have not passed', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_review', entityId: 'rev-1', status: 'pending' }],
      findReview: () => ({ ...REVIEW, createdAt: new Date() }),
      deriveAllTrades: async () => [],
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
  });

  it('expires with no qualifying next trade after 90 days', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_review', entityId: 'rev-1', status: 'pending' }],
      findReview: () => ({ ...REVIEW, createdAt: new Date(Date.now() - 91 * 86_400_000) }),
      deriveAllTrades: async () => [],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1', status: 'expired' }),
    );
  });

  it('ignores a closed trade in the same symbol that closed BEFORE the opinion was made', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'symbol_pattern', entityId: 'read-1', status: 'pending' }],
      findRead: () => READ,
      deriveAllTrades: async () => [closedTrade('e0', '2026-07-01')],
      tagsByEntryId: async () =>
        new Map([['e0', { setups: [], mistakes: ['cut winner short'] }]]),
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
  });
});
