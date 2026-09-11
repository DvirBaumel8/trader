import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TradeReviewService } from './trade-review.service.js';
import type { LlmClient } from './llm.client.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { UsersService } from '../users/users.service.js';
import type { Repository } from 'typeorm';
import type { TradeReview } from './trade-review.entity.js';
import type { JournalEntry } from '../journal/journal-entry.entity.js';

function makeService(opts: {
  isConfigured?: boolean;
  tradeData?: any;
  llmComplete?: () => Promise<string>;
  savedReview?: any;
}) {
  const trades = {
    getTrade: vi.fn().mockImplementation(async (_id: string) => {
      if (opts.tradeData === null) return null;
      return (
        opts.tradeData ?? {
          trade: {
            symbol: 'NVDA',
            direction: 'LONG',
            isOpen: false,
            enteredAt: new Date('2026-03-01'),
            exitedAt: new Date('2026-03-10'),
            quantity: 100,
            remainingQuantity: 0,
            avgEntry: 120,
            avgExit: 132,
            realizedPnl: 1200,
            rMultiple: 2.0,
            initialRiskPerShare: 6,
            plannedTarget: 135,
            holdingDays: 7,
            entryRelativeVolume: 1.8,
            highWaterPrice: 134,
          },
          fills: [
            {
              executedAt: new Date('2026-03-01'),
              side: 'BUY',
              quantity: 100,
              price: 120,
              entryId: 'e1',
            },
            {
              executedAt: new Date('2026-03-10'),
              side: 'SELL',
              quantity: 100,
              price: 132,
              exitKind: 'TARGET',
              entryId: 'e2',
            },
          ],
          stopLevels: [{ kind: 'FIXED', price: 114, quantity: 100 }],
        }
      );
    }),
    tagsByEntryId: vi.fn().mockResolvedValue(new Map()),
  } as unknown as TradesService;

  const users = {
    ensureDefaultUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    // Services resolve the request's user now, not the single owner.
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;

  const reviews = {
    findOne: vi.fn().mockResolvedValue(opts.savedReview ?? null),
    create: vi.fn().mockImplementation((data) => ({
      ...data,
      id: 'rev-1',
      createdAt: new Date(),
    })),
    save: vi.fn().mockImplementation(async (r) => r),
  };

  const entries = {
    find: vi.fn().mockResolvedValue([]),
  };

  const llm = {
    isConfigured: () => opts.isConfigured ?? true,
    modelName: () => 'gemini-3.8-flash',
    complete:
      opts.llmComplete ??
      vi.fn().mockResolvedValue(`[REVIEW_META]
SCORE: A
VERDICT: Disciplined Target Exit
[/REVIEW_META]

### Process vs Outcome
Exemplary adherence to risk boundaries.`),
  } as unknown as LlmClient;

  return {
    service: new TradeReviewService(
      llm,
      trades,
      users,
      // Cast at the boundary, not on the stub itself: `as never` erased the
      // mocks' own types, so `reviews.save` resolved to `never` and the
      // assertion below could not typecheck. It also swallowed any future
      // change to this constructor, which is exactly how the four errors in
      // llm.controller.spec.ts survived unnoticed.
      reviews as unknown as Repository<TradeReview>,
      entries as unknown as Repository<JournalEntry>,
    ),
    trades,
    reviews,
  };
}

describe('TradeReviewService', () => {
  it('throws NotFoundException when trade does not exist', async () => {
    const { service } = makeService({ tradeData: null });
    await expect(service.reviewTrade('non-existent')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns configured: false when LLM key is not provided', async () => {
    const { service } = makeService({ isConfigured: false });
    const result = await service.reviewTrade('trade-1');
    expect(result.configured).toBe(false);
    expect(result.score).toBeNull();
    expect(result.facts?.symbol).toBe('NVDA');
  });

  it('generates and persists review when LLM answers', async () => {
    const { service, reviews } = makeService({ isConfigured: true });
    const result = await service.reviewTrade('trade-1');
    expect(result.configured).toBe(true);
    expect(result.score).toBe('A');
    expect(result.verdict).toBe('Disciplined Target Exit');
    expect(result.review).toContain('### Process vs Outcome');
    expect(reviews.save).toHaveBeenCalled();
  });

  it('retrieves existing review if already saved', async () => {
    const { service } = makeService({
      savedReview: {
        tradeId: 'trade-1',
        symbol: 'NVDA',
        score: 'A',
        verdict: 'Disciplined Target Exit',
        review: 'Great trade execution',
        factsSnapshot: JSON.stringify({ symbol: 'NVDA' }),
        createdAt: new Date(),
      },
    });

    const result = await service.getReview('trade-1');
    expect(result).not.toBeNull();
    expect(result?.score).toBe('A');
    expect(result?.verdict).toBe('Disciplined Target Exit');
  });
});
