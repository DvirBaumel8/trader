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

function makeService() {
  const outcomes = {
    create: vi.fn().mockImplementation((data) => ({ ...data })),
    save: vi.fn().mockImplementation(async (r) => r),
    find: vi.fn().mockResolvedValue([]),
  };
  const ideas = { findOne: vi.fn() };
  const reads = { findOne: vi.fn() };
  const reviews = { findOne: vi.fn() };
  const users = {
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const trades = {} as unknown as TradesService;
  const history = {} as unknown as HistoryService;

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
    const { service, outcomes } = makeService();
    outcomes.find.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);

    const result = await service.list();

    expect(result).toEqual([{ id: 'o1' }, { id: 'o2' }]);
    expect(outcomes.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { createdAt: 'DESC' },
    });
  });
});
