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
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
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

describe('AiOutcomeService.recordOutcome', () => {
  it('swallows a recordPending failure rather than letting it propagate', async () => {
    const { service, outcomes } = makeService();
    outcomes.save.mockRejectedValueOnce(new Error('db down'));

    await expect(service.recordOutcome('trade_idea', 'idea-1')).resolves.toBeUndefined();
  });

  it('still records the row on the success path, same as recordPending', async () => {
    const { service, outcomes } = makeService();

    await service.recordOutcome('symbol_pattern', 'read-1');

    expect(outcomes.create).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'symbol_pattern',
      entityId: 'read-1',
      status: 'pending',
    });
  });
});

describe('AiOutcomeService.deleteFor', () => {
  it('deletes outcome rows matching the feature and entityId', async () => {
    const { service, outcomes } = makeService();

    await service.deleteFor('trade_idea', 'idea-1');

    expect(outcomes.delete).toHaveBeenCalledWith({ feature: 'trade_idea', entityId: 'idea-1' });
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

  const SHORT_IDEA: Partial<TradeIdea> = {
    id: 'idea-2',
    symbol: 'BITX',
    entryPrice: 20,
    stop: 22,
    target: 15,
    createdAt: new Date('2026-08-01T00:00:00Z'),
  };

  it("resolves stop_hit when a SHORT idea's stop is crossed before its target", async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o2', feature: 'trade_idea', entityId: 'idea-2', status: 'pending' }],
      findIdea: () => SHORT_IDEA,
      liveDailyBars: async () => [bar('2026-08-05', 19, 23)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o2', status: 'stop_hit' }),
    );
  });

  it('resolves stop_hit — the conservative read — for a SHORT idea when one bar crosses both levels', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o2', feature: 'trade_idea', entityId: 'idea-2', status: 'pending' }],
      findIdea: () => SHORT_IDEA,
      liveDailyBars: async () => [bar('2026-08-05', 14, 25)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o2', status: 'stop_hit' }),
    );
  });

  it('resolves expired immediately for a malformed idea whose stop and target sit on the SAME side of entry — not a two-way guess at direction', async () => {
    // entry 100, stop 110, target 120: neither a valid long (stop below
    // entry) nor a valid short (stop above, target below) — computeTradeRisk
    // returns null for exactly this shape. Bars are crafted so the OLD,
    // buggy two-way inference (`stop < entry ? LONG : SHORT`) would have
    // called this a SHORT and graded it target_hit — a fake win.
    const malformed: Partial<TradeIdea> = {
      id: 'idea-9',
      symbol: 'ZZZZ',
      entryPrice: 100,
      stop: 110,
      target: 120,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    };
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o9', feature: 'trade_idea', entityId: 'idea-9', status: 'pending' }],
      findIdea: () => malformed,
      liveDailyBars: async () => [bar('2026-08-05', 90, 130)],
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o9', status: 'expired' }),
    );
  });

  it('resolves expired when the trade idea row itself no longer exists (e.g. the owner deleted it — but see Important #5: deletion now cascades so this path is for any other cause of a missing idea)', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o10', feature: 'trade_idea', entityId: 'idea-missing', status: 'pending' }],
      findIdea: () => null,
    });

    await service.resolvePending();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o10', status: 'expired' }),
    );
  });

  it("ignores the idea's own creation-day bar even when its range would otherwise cross both levels", async () => {
    // Recent createdAt (not the fixed 2026-08-01 LONG_IDEA date) so the
    // 30-day expiry never fires and masks what this test actually checks:
    // that a same-day bar's range is excluded from grading.
    const recentIdea = { ...LONG_IDEA, createdAt: new Date() }; // stop 90, target 120
    const today = recentIdea.createdAt.toISOString().slice(0, 10);
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' }],
      findIdea: () => recentIdea,
      liveDailyBars: async () => [
        bar(today, 50, 200), // day 0: spans both levels — must be skipped
      ],
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
  });

  it('resolves the remaining rows when one row throws mid-pass instead of letting the whole call fail', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [
        { id: 'o-bad', feature: 'trade_idea', entityId: 'idea-bad', status: 'pending' },
        { id: 'o-good', feature: 'trade_idea', entityId: 'idea-1', status: 'pending' },
      ],
      findIdea: (id) => {
        if (id === 'idea-bad') throw new Error('lookup boom');
        return id === 'idea-1' ? LONG_IDEA : null;
      },
      liveDailyBars: async () => [bar('2026-08-10', 98, 121)],
    });

    await expect(service.resolvePending()).resolves.toBeUndefined();

    expect(outcomes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o-good', status: 'target_hit' }),
    );
    expect(outcomes.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o-bad' }),
    );
  });

  it('leaves a row with an unrecognized feature value unresolved rather than routing it into behavioral grading', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [
        { id: 'o-mystery', feature: 'mystery_feature' as never, entityId: 'x', status: 'pending' },
      ],
    });

    await service.resolvePending();

    expect(outcomes.save).not.toHaveBeenCalled();
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

  it('leaves a row with a malformed factsSnapshot unresolved instead of throwing out of resolvePending', async () => {
    const { service, outcomes } = makeService({
      pendingRows: [{ id: 'o1', feature: 'symbol_pattern', entityId: 'read-bad', status: 'pending' }],
      findRead: () => ({ ...READ, id: 'read-bad', factsSnapshot: 'not valid json' }),
    });

    await expect(service.resolvePending()).resolves.toBeUndefined();
    expect(outcomes.save).not.toHaveBeenCalled();
  });

  it('fetches deriveAllTrades and tagsByEntryId once per pass, not once per behavioral row', async () => {
    const deriveAllTrades = vi.fn().mockResolvedValue([closedTrade('e1', '2026-08-10')]);
    const tagsByEntryId = vi
      .fn()
      .mockResolvedValue(new Map([['e1', { setups: [], mistakes: ['cut winner short'] }]]));
    const { service } = makeService({
      pendingRows: [
        { id: 'o1', feature: 'symbol_pattern', entityId: 'read-1', status: 'pending' },
        { id: 'o2', feature: 'trade_review', entityId: 'rev-1', status: 'pending' },
      ],
      findRead: () => READ,
      findReview: () => REVIEW,
      deriveAllTrades,
      tagsByEntryId,
    });

    await service.resolvePending();

    expect(deriveAllTrades).toHaveBeenCalledTimes(1);
    expect(tagsByEntryId).toHaveBeenCalledTimes(1);
  });
});
