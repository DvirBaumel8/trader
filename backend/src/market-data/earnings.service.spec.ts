import { describe, expect, it, vi } from 'vitest';
import { EarningsService } from './earnings.service.js';

describe('EarningsService', () => {
  it('does not refetch a cached future earnings date', async () => {
    const save = vi.fn(async (row) => row);
    const repo = { save };
    const yahoo = { nextEarningsDate: vi.fn() };
    const service = new EarningsService(repo as never, yahoo as never);
    const instrument = {
      id: 'i1',
      symbol: 'NVDA',
      nextEarningsDate: '2026-09-20',
      earningsCheckedAt: new Date('2026-09-15T08:00:00Z'),
    };

    const result = await service.daysUntil([instrument as never], '2026-09-15');

    expect(result.get('NVDA')).toBe(5);
    expect(yahoo.nextEarningsDate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('checks a passed date once per day and stores the newly published date', async () => {
    const save = vi.fn(async (row) => row);
    const repo = { save };
    const yahoo = { nextEarningsDate: vi.fn().mockResolvedValue('2026-12-18') };
    const service = new EarningsService(repo as never, yahoo as never);
    const instrument = {
      id: 'i1',
      symbol: 'NVDA',
      nextEarningsDate: '2026-09-14',
      earningsCheckedAt: new Date('2026-09-14T08:00:00Z'),
    };

    const result = await service.daysUntil([instrument as never], '2026-09-15');

    expect(result.get('NVDA')).toBe(94);
    expect(yahoo.nextEarningsDate).toHaveBeenCalledWith('NVDA');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ nextEarningsDate: '2026-12-18' }));
  });
});
