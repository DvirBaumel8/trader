import { describe, expect, it, vi } from 'vitest';
import { AiSummaryService } from './ai-summary.service.js';
import { AiSummary } from './ai-summary.entity.js';
import type { UsersService } from '../users/users.service.js';

/**
 * A minimal in-memory stand-in for TypeORM's Repository<AiSummary>, covering
 * only the methods AiSummaryService actually calls. Exercises the service's
 * own logic (userId scoping, preview truncation, 404-on-miss) without a real
 * Postgres connection — the DB round trip itself is left to the e2e suite.
 */
function fakeRepo() {
  const rows: AiSummary[] = [];
  let seq = 0;
  return {
    rows,
    create: vi.fn((partial: Partial<AiSummary>) => ({ ...partial }) as AiSummary),
    save: vi.fn(async (row: AiSummary) => {
      const saved: AiSummary = {
        ...row,
        id: row.id ?? `id-${++seq}`,
        createdAt: row.createdAt ?? new Date(`2026-01-0${seq}T00:00:00.000Z`),
      };
      rows.push(saved);
      return saved;
    }),
    createQueryBuilder: vi.fn(() => {
      let whereUserId: string | undefined;
      const qb = {
        select: vi.fn(() => qb),
        where: vi.fn((_clause: string, params: { userId: string }) => {
          whereUserId = params.userId;
          return qb;
        }),
        orderBy: vi.fn(() => qb),
        getMany: vi.fn(async () =>
          rows
            .filter((r) => r.userId === whereUserId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ),
      };
      return qb;
    }),
    findOne: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      rows.find((r) => r.id === where.id && r.userId === where.userId) ?? null,
    ),
    delete: vi.fn(async ({ id, userId }: { id: string; userId: string }) => {
      const idx = rows.findIndex((r) => r.id === id && r.userId === userId);
      if (idx === -1) return { affected: 0 };
      rows.splice(idx, 1);
      return { affected: 1 };
    }),
  };
}

function fakeUsers(userId = 'user-1'): UsersService {
  return {
    ensureDefaultUser: vi.fn().mockResolvedValue({ id: userId }),
  } as unknown as UsersService;
}

function makeService(repo: ReturnType<typeof fakeRepo>, users = fakeUsers()) {
  return new AiSummaryService(repo as never, users);
}

const input = (overrides: Partial<Parameters<AiSummaryService['create']>[0]> = {}) => ({
  summary: 'You are up 4.2% this month, concentrated in AAPL.',
  factsSnapshot: 'FACTS (as of 2026-09-02T14:30:00.000Z)...',
  model: 'gemini-2.5-flash',
  grounded: true,
  factsAsOf: '2026-09-02T14:30:00.000Z',
  ...overrides,
});

describe('AiSummaryService', () => {
  it('creates a summary and then lists it, newest first', async () => {
    const repo = fakeRepo();
    const service = makeService(repo);

    const first = await service.create(input({ summary: 'First summary.' }));
    const second = await service.create(input({ summary: 'Second summary.' }));

    const list = await service.list();

    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
    // The list row is light: no factsSnapshot field at all.
    expect(list[0]).not.toHaveProperty('factsSnapshot');
    expect(list[0]).not.toHaveProperty('summary');
    expect(list[0].preview).toBe('Second summary.');
  });

  it('truncates a long summary into a preview for the list', async () => {
    const repo = fakeRepo();
    const service = makeService(repo);
    const long = 'x'.repeat(300);

    await service.create(input({ summary: long }));
    const [row] = await service.list();

    expect(row.preview.length).toBeLessThan(long.length);
    expect(row.preview.endsWith('…')).toBe(true);
  });

  it('fetches one summary in full, including its facts snapshot', async () => {
    const repo = fakeRepo();
    const service = makeService(repo);
    const created = await service.create(input());

    const detail = await service.findOne(created.id);

    expect(detail).toEqual(created);
    expect(detail.factsSnapshot).toBe(input().factsSnapshot);
    expect(detail.model).toBe('gemini-2.5-flash');
    expect(detail.grounded).toBe(true);
  });

  it('throws NotFoundException for an unknown id', async () => {
    const repo = fakeRepo();
    const service = makeService(repo);

    await expect(service.findOne('does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('deletes one summary, leaving the others intact', async () => {
    const repo = fakeRepo();
    const service = makeService(repo);
    const a = await service.create(input({ summary: 'A' }));
    const b = await service.create(input({ summary: 'B' }));
    const c = await service.create(input({ summary: 'C' }));

    await service.remove(b.id);

    const list = await service.list();
    expect(list.map((r) => r.id).sort()).toEqual([a.id, c.id].sort());
    await expect(service.findOne(b.id)).rejects.toThrow(/not found/i);
  });

  it('throws NotFoundException when deleting an unknown id', async () => {
    const repo = fakeRepo();
    const service = makeService(repo);

    await expect(service.remove('does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('never lets one user fetch or delete another user\'s summary', async () => {
    const repo = fakeRepo();
    const ownerService = makeService(repo, fakeUsers('owner'));
    const intruderService = makeService(repo, fakeUsers('intruder'));
    const created = await ownerService.create(input());

    await expect(intruderService.findOne(created.id)).rejects.toThrow(/not found/i);
    await expect(intruderService.remove(created.id)).rejects.toThrow(/not found/i);

    // Still there for the actual owner — the intruder's delete did nothing.
    const stillThere = await ownerService.findOne(created.id);
    expect(stillThere.id).toBe(created.id);
  });
});
