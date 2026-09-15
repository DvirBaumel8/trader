import { describe, expect, it, vi } from 'vitest';
import { DailyBriefService } from './daily-brief.service.js';

describe('DailyBriefService', () => {
  it('combines portfolio, watchlist, and market notes while keeping portfolio ownership primary', async () => {
    const service = new DailyBriefService(
      {
        getPortfolio: vi.fn().mockResolvedValue({
          positions: [{ symbol: 'NVDA', price: 110, daysUntilEarnings: 0 }],
        }),
      } as any,
      {
        list: vi.fn().mockResolvedValue([
          { symbol: 'NVDA', price: 110, daysUntilEarnings: 0 },
          { symbol: 'PLTR', price: 25, daysUntilEarnings: 3 },
        ]),
      } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { find: vi.fn().mockResolvedValue([]) } as any,
      { ensureFresh: vi.fn().mockResolvedValue(undefined) } as any,
      {
        week: vi.fn().mockResolvedValue([
          { id: 'cpi', name: 'CPI', date: '2026-09-16T12:30:00.000Z', actual: 3.1, expected: 3.0 },
        ]),
      } as any,
    );

    const result = await service.get(new Date('2026-09-16T09:00:00.000Z'));

    expect(result.refreshAfterSeconds).toBe(300);
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'EARNINGS', symbol: 'NVDA', source: 'PORTFOLIO' }),
      expect.objectContaining({ kind: 'EARNINGS', symbol: 'PLTR', source: 'WATCHLIST' }),
      expect.objectContaining({ kind: 'ECONOMIC', source: 'MARKET', title: 'CPI', actual: 3.1, expected: 3.0 }),
    ]));
    expect(result.notes.filter((note) => note.kind === 'EARNINGS' && note.symbol === 'NVDA')).toHaveLength(1);
  });
});
