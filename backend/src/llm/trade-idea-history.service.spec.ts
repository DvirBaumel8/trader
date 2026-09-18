import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TradeIdeaHistoryService } from './trade-idea-history.service.js';
import type { UsersService } from '../users/users.service.js';
import type { Repository } from 'typeorm';
import type { TradeIdea } from './trade-idea.entity.js';
import type { AiOutcomeService } from './ai-outcome.service.js';

function makeService(opts: {
  deleteResult?: { affected: number };
  outcomes?: { deleteFor: ReturnType<typeof vi.fn> };
} = {}) {
  const ideas = {
    delete: vi.fn().mockResolvedValue(opts.deleteResult ?? { affected: 1 }),
    findOne: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const users = {
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;
  const outcomes = (opts.outcomes ?? { deleteFor: vi.fn() }) as unknown as AiOutcomeService;

  return {
    service: new TradeIdeaHistoryService(
      ideas as unknown as Repository<TradeIdea>,
      users,
      outcomes,
    ),
    ideas,
    outcomes,
  };
}

describe('TradeIdeaHistoryService.remove', () => {
  it('deletes the matching ai_outcomes row after a successful delete', async () => {
    const { service, ideas, outcomes } = makeService();

    await service.remove('idea-1');

    expect(ideas.delete).toHaveBeenCalledWith({ id: 'idea-1', userId: 'user-1' });
    expect(outcomes.deleteFor).toHaveBeenCalledWith('trade_idea', 'idea-1');
  });

  it('throws NotFoundException and does not touch ai_outcomes when nothing was deleted', async () => {
    const { service, outcomes } = makeService({ deleteResult: { affected: 0 } });

    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(outcomes.deleteFor).not.toHaveBeenCalled();
  });
});
