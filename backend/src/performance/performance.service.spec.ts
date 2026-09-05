import { describe, expect, it, vi } from 'vitest';
import { PerformanceService } from './performance.service.js';
import type { HistoryService } from '../market-data/history.service.js';
import type { UsersService } from '../users/users.service.js';

function emptyRepo() {
  return { find: vi.fn().mockResolvedValue([]) } as never;
}

function makeService(history: HistoryService) {
  const users = {
    ensureDefaultUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  } as unknown as UsersService;

  return new PerformanceService(
    emptyRepo(),
    emptyRepo(),
    emptyRepo(),
    emptyRepo(),
    emptyRepo(),
    users,
    history,
  );
}

describe('PerformanceService.getSeries', () => {
  it('tops up daily_closes before reading it, so the benchmark chart is never priced off stale bars', async () => {
    const ensureFresh = vi.fn().mockResolvedValue(undefined);
    const history = { ensureFresh } as unknown as HistoryService;
    const service = makeService(history);

    await service.getSeries('ALL');

    expect(ensureFresh).toHaveBeenCalled();
  });
});
