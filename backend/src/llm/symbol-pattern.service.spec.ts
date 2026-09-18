import { describe, expect, it, vi } from 'vitest';
import { SymbolPatternService } from './symbol-pattern.service.js';
import type { LlmClient } from './llm.client.js';
import type { TradesService } from '../portfolio/trades.service.js';
import type { UsersService } from '../users/users.service.js';
import type { Repository } from 'typeorm';
import type { SymbolPatternRead } from './symbol-pattern.entity.js';
import type { JournalEntry } from '../journal/journal-entry.entity.js';

const summary = {
  symbol: 'NVDA',
  closedCount: 3,
  openCount: 0,
  winRate: 0.67,
  avgWin: 500,
  avgLoss: 200,
  avgRisk: 150,
  riskTradeCount: 3,
  expectancyDollars: 300,
  expectancyR: 1.5,
  rTradeCount: 3,
  totalPnl: 900,
  avgPositionSize: 5000,
  avgHoldingDays: 2,
  feesPaid: 24,
  trades: [
    {
      symbol: 'NVDA',
      direction: 'LONG' as const,
      isOpen: false,
      realizedPnl: 300,
      rMultiple: 1.5,
      enteredAt: new Date('2026-03-01'),
      exitedAt: new Date('2026-03-03'),
      setups: ['breakout'],
      mistakes: [],
    },
  ],
};

const overallStats = {
  closedCount: 20,
  openCount: 2,
  winRate: 0.5,
  avgWin: 400,
  avgLoss: 250,
  avgRisk: 180,
  riskTradeCount: 20,
  expectancyDollars: 100,
  expectancyR: 0.8,
  rTradeCount: 20,
  totalPnl: 2000,
  avgPositionSize: 4500,
  avgHoldingDays: 4,
  trades: [],
};

function makeService(opts: {
  isConfigured?: boolean;
  llmComplete?: () => Promise<string>;
  llmCompleteStream?: () => AsyncIterable<string>;
  savedRead?: any;
}) {
  const trades = {
    getSymbolSummary: vi.fn().mockResolvedValue(summary),
    getStats: vi.fn().mockResolvedValue(overallStats),
    deriveAllTrades: vi.fn().mockResolvedValue([
      {
        symbol: 'NVDA',
        enteredAt: new Date('2026-03-01'),
        exitedAt: new Date('2026-03-03'),
        fills: [
          { entryId: 'e1', executedAt: new Date('2026-03-01'), side: 'BUY', quantity: 10, price: 100, fee: 4 },
          { entryId: 'e2', executedAt: new Date('2026-03-03'), side: 'SELL', quantity: 10, price: 130, fee: 4 },
        ],
      },
    ]),
  } as unknown as TradesService;

  const users = {
    currentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;

  const reads = {
    findOne: vi.fn().mockResolvedValue(opts.savedRead ?? null),
    create: vi.fn().mockImplementation((data) => ({
      ...data,
      id: 'read-1',
      createdAt: new Date(),
    })),
    save: vi.fn().mockImplementation(async (r) => r),
  };

  const entries = {
    find: vi.fn().mockResolvedValue([
      { id: 'e1', body: 'got in on the breakout' },
      { id: 'e2', body: '' },
    ]),
  };

  async function* defaultStream() {
    yield '[PATTERN_META]\nHEADLINE: You hold winners here longer than your average\n[/PATTERN_META]\n\n';
    yield 'You tend to let NVDA winners run past your usual exit.';
  }

  const llm = {
    isConfigured: () => opts.isConfigured ?? true,
    modelName: () => 'gemini-2.5-flash',
    complete:
      opts.llmComplete ??
      vi.fn().mockResolvedValue(`[PATTERN_META]
HEADLINE: You hold winners here longer than your average
[/PATTERN_META]

You tend to let NVDA winners run past your usual exit.`),
    completeStream: opts.llmCompleteStream ?? (() => defaultStream()),
  } as unknown as LlmClient;

  return {
    service: new SymbolPatternService(
      llm,
      trades,
      users,
      reads as unknown as Repository<SymbolPatternRead>,
      entries as unknown as Repository<JournalEntry>,
    ),
    trades,
    reads,
    entries,
    llm,
  };
}

describe('SymbolPatternService', () => {
  it('returns configured: false when the LLM key is not provided', async () => {
    const { service } = makeService({ isConfigured: false });
    const result = await service.generate('nvda', 'ALL');
    expect(result.configured).toBe(false);
    expect(result.headline).toBeNull();
    expect(result.facts?.symbol).toBe('NVDA');
  });

  it('generates and persists a read when the LLM answers', async () => {
    const { service, reads } = makeService({ isConfigured: true });
    const result = await service.generate('nvda', 'ALL');
    expect(result.configured).toBe(true);
    expect(result.headline).toBe('You hold winners here longer than your average');
    expect(result.read).toContain('You tend to let NVDA winners run');
    expect(reads.save).toHaveBeenCalled();
  });

  it('feeds the model both this-name and overall stats for the same window', async () => {
    const { service, trades } = makeService({ isConfigured: true });
    const result = await service.generate('nvda', '1M');
    expect(trades.getSymbolSummary).toHaveBeenCalledWith('nvda', '1M');
    expect(trades.getStats).toHaveBeenCalledWith('1M');
    expect(result.facts?.thisName.totalPnl).toBe(900);
    expect(result.facts?.overall.winRate).toBe(0.5);
  });

  it('collects journal notes from this symbol\'s fills, dropping blanks', async () => {
    const { service } = makeService({ isConfigured: true });
    const result = await service.generate('nvda', 'ALL');
    expect(result.facts?.notes).toEqual(['got in on the breakout']);
  });

  it('retrieves an existing saved read without calling the model', async () => {
    const { service, trades } = makeService({
      savedRead: {
        symbol: 'NVDA',
        range: 'ALL',
        headline: 'Saved headline',
        read: 'Saved read',
        factsSnapshot: JSON.stringify({ symbol: 'NVDA' }),
        createdAt: new Date(),
      },
    });

    const result = await service.getLatest('NVDA', 'ALL');
    expect(result).not.toBeNull();
    expect(result?.headline).toBe('Saved headline');
    expect(trades.getSymbolSummary).not.toHaveBeenCalled();
  });

  it('asks for a minimal thinking budget — a short, structured read', async () => {
    const { service, llm } = makeService({ isConfigured: true });
    await service.generate('nvda', 'ALL');
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'MINIMAL' }),
    );
  });

  it('returns null when nothing has been generated yet', async () => {
    const { service } = makeService({ savedRead: null });
    const result = await service.getLatest('NVDA', 'ALL');
    expect(result).toBeNull();
  });
});

async function collectLines(stream: AsyncGenerator<string>): Promise<unknown[]> {
  const lines: unknown[] = [];
  for await (const line of stream) lines.push(JSON.parse(line));
  return lines;
}

describe('SymbolPatternService.generateStream', () => {
  it('yields a single done line, unconfigured, without calling the model', async () => {
    const { service } = makeService({ isConfigured: false });
    const lines = await collectLines(service.generateStream('nvda', 'ALL'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ done: true, configured: false, headline: null });
  });

  it('never yields the [PATTERN_META] block as a delta, only the body after it', async () => {
    const { service } = makeService({ isConfigured: true });
    const lines = await collectLines(service.generateStream('nvda', 'ALL'));

    const deltas = lines.filter((l): l is { delta: string } => 'delta' in (l as object));
    const joined = deltas.map((d) => d.delta).join('');
    expect(joined).not.toContain('PATTERN_META');
    expect(joined).toContain('You tend to let NVDA winners run');
  });

  it('yields a final done line with the parsed headline and persists the clean read', async () => {
    const { service, reads } = makeService({ isConfigured: true });
    const lines = await collectLines(service.generateStream('nvda', 'ALL'));

    const done = lines.at(-1) as Record<string, unknown>;
    expect(done).toMatchObject({
      done: true,
      configured: true,
      symbol: 'NVDA',
      headline: 'You hold winners here longer than your average',
      error: null,
    });
    expect(reads.save).toHaveBeenCalled();
    const saved = (reads.save as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.read).not.toContain('PATTERN_META');
    expect(saved.read).toContain('You tend to let NVDA winners run');
  });

  it('asks for a minimal thinking budget on the streamed call too', async () => {
    async function* stub() {
      yield '[PATTERN_META]\nHEADLINE: h\n[/PATTERN_META]\n\nbody';
    }
    const llmCompleteStream = vi.fn(() => stub());
    const { service, llm } = makeService({ isConfigured: true, llmCompleteStream });

    await collectLines(service.generateStream('nvda', 'ALL'));

    expect(llm.completeStream).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'MINIMAL' }),
    );
  });

  it('yields a done line with the error copy, and no delta lines, when the stream fails before any text', async () => {
    const { service, reads } = makeService({
      isConfigured: true,
      llmCompleteStream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new Error('boom')),
        }),
      }),
    });

    const lines = await collectLines(service.generateStream('nvda', 'ALL'));

    expect(lines).toEqual([
      expect.objectContaining({
        done: true,
        configured: true,
        headline: null,
        error: expect.any(String),
        errorKind: 'unknown',
      }),
    ]);
    expect(reads.save).not.toHaveBeenCalled();
  });
});
