import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TradeReviewService } from './trade-review.service.js';
import { LlmFailure, type LlmClient } from './llm.client.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { UsersService } from '../users/users.service.js';
import type { Repository } from 'typeorm';
import type { TradeReview } from './trade-review.entity.js';
import type { JournalEntry } from '../journal/journal-entry.entity.js';

function makeService(opts: {
  isConfigured?: boolean;
  tradeData?: any;
  llmComplete?: () => Promise<string>;
  llmCompleteStream?: () => AsyncIterable<string>;
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

  async function* defaultStream() {
    yield '[REVIEW_META]\nSCORE: A\nVERDICT: Disciplined Target Exit\n[/REVIEW_META]\n\n';
    yield '### Process vs Outcome\n';
    yield 'Exemplary adherence to risk boundaries.';
  }

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
    completeStream: opts.llmCompleteStream ?? (() => defaultStream()),
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

async function collectLines(stream: AsyncGenerator<string>): Promise<unknown[]> {
  const lines: unknown[] = [];
  for await (const line of stream) lines.push(JSON.parse(line));
  return lines;
}

describe('TradeReviewService.reviewTradeStream', () => {
  it('throws NotFoundException when the trade does not exist, same as the non-streaming call', async () => {
    const { service } = makeService({ tradeData: null });
    await expect(collectLines(service.reviewTradeStream('non-existent'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('yields a single done line, unconfigured, with facts but no score/verdict', async () => {
    const { service } = makeService({ isConfigured: false });
    const lines = await collectLines(service.reviewTradeStream('trade-1'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ done: true, configured: false, score: null, verdict: null });
    expect((lines[0] as { facts: { symbol: string } }).facts.symbol).toBe('NVDA');
  });

  it('never yields the [REVIEW_META] block as a delta, only the body after it', async () => {
    const { service } = makeService({ isConfigured: true });
    const lines = await collectLines(service.reviewTradeStream('trade-1'));

    const deltas = lines.filter((l): l is { delta: string } => 'delta' in (l as object));
    const joined = deltas.map((d) => d.delta).join('');
    expect(joined).not.toContain('REVIEW_META');
    expect(joined).toContain('### Process vs Outcome');
    expect(joined).toContain('Exemplary adherence to risk boundaries.');
  });

  it('yields a final done line with the parsed score/verdict and the saved createdAt', async () => {
    const { service, reviews } = makeService({ isConfigured: true });
    const lines = await collectLines(service.reviewTradeStream('trade-1'));

    const done = lines.at(-1) as Record<string, unknown>;
    expect(done).toMatchObject({
      done: true,
      configured: true,
      score: 'A',
      verdict: 'Disciplined Target Exit',
      symbol: 'NVDA',
      error: null,
    });
    expect(reviews.save).toHaveBeenCalled();
    const saved = (reviews.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.review).not.toContain('REVIEW_META');
    expect(saved.review).toContain('Exemplary adherence');
  });

  it('yields a done line with the error copy, and no delta lines, when the stream fails before any text', async () => {
    const { service, reviews } = makeService({
      isConfigured: true,
      llmCompleteStream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new LlmFailure('busy', 'provider said so')),
        }),
      }),
    });

    const lines = await collectLines(service.reviewTradeStream('trade-1'));

    expect(lines).toEqual([
      {
        done: true,
        configured: true,
        tradeId: 'trade-1',
        symbol: 'NVDA',
        score: null,
        verdict: null,
        facts: expect.objectContaining({ symbol: 'NVDA' }),
        createdAt: null,
        error: 'The AI model is busy right now. Worth another tap in a moment.',
        errorKind: 'busy',
      },
    ]);
    expect(reviews.save).not.toHaveBeenCalled();
  });
});
