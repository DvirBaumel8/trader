import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { WatchlistService } from './watchlist.service.js';

interface Row { id: string; userId: string; instrumentId: string; position: number; direction?: string }

function setup(initial: Array<[string, string, number]> = []) {
  // [userId, symbol, position]
  const instruments = new Map<string, { id: string; symbol: string; name: string }>();
  const idFor = (symbol: string) => {
    if (!instruments.has(symbol)) instruments.set(symbol, { id: `i-${symbol}`, symbol, name: `${symbol} Inc` });
    return instruments.get(symbol)!;
  };
  let seq = 0;
  const rows: Row[] = initial.map(([userId, symbol, position]) => ({
    id: `r${seq++}`, userId, instrumentId: idFor(symbol).id, position,
  }));
  const itemsRepo = {
    find: async ({ where }: { where: { userId: string } }) => rows.filter((r) => r.userId === where.userId).map((r) => ({ ...r })),
    findOne: async ({ where }: { where: { userId: string; instrumentId: string } }) =>
      rows.find((r) => r.userId === where.userId && r.instrumentId === where.instrumentId) ?? null,
    count: async ({ where }: { where: { userId: string } }) => rows.filter((r) => r.userId === where.userId).length,
    create: (r: Partial<Row>) => r as Row,
    save: async (r: Row | Row[]) => {
      for (const x of Array.isArray(r) ? r : [r]) {
        const hit = rows.find((y) => y.id === x.id);
        if (hit) Object.assign(hit, x);
        else rows.push({ ...x, id: `r${seq++}` });
      }
      return r;
    },
  };
  const instrumentsRepo = {
    find: async ({ where }: { where: { id: { value: string[] } } }) =>
      [...instruments.values()].filter((i) => where.id.value.includes(i.id)),
  };
  const instrumentsService = { findOrCreate: async (s: string) => idFor(s) };
  const users = { currentUser: async () => ({ id: 'u1' }) };
  const service = new WatchlistService(itemsRepo as never, instrumentsRepo as never, instrumentsService as never, users as never);
  const order = () => rows.filter((r) => r.userId === 'u1').sort((a, b) => a.position - b.position)
    .map((r) => [...instruments.values()].find((i) => i.id === r.instrumentId)!.symbol);
  return { service, rows, order };
}

describe('WatchlistService ordering', () => {
  it('lists by position, ties by symbol', async () => {
    const { service } = setup([['u1', 'ZZ', 0], ['u1', 'BB', 1], ['u1', 'AA', 1]]);
    expect((await service.list()).map((r) => r.symbol)).toEqual(['ZZ', 'AA', 'BB']);
  });

  it('appends a new item after the current last position', async () => {
    const { service, rows } = setup([['u1', 'B', 0], ['u1', 'A', 1], ['u2', 'Q', 9]]);
    await service.add('C');
    expect(rows.find((r) => r.instrumentId === 'i-C')!.position).toBe(2);
  });

  it('starts the first item at position 0', async () => {
    const { service, rows } = setup();
    await service.add('A');
    expect(rows[0].position).toBe(0);
  });

  it('reorders, returning the new list', async () => {
    const { service, order } = setup([['u1', 'A', 0], ['u1', 'B', 1], ['u1', 'C', 2]]);
    const list = await service.reorder(['C', 'A', 'B']);
    expect(list.map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
    expect(order()).toEqual(['C', 'A', 'B']);
  });

  it('keeps unlisted symbols after the listed ones, in their old order', async () => {
    const { service } = setup([['u1', 'A', 0], ['u1', 'B', 1], ['u1', 'C', 2]]);
    expect((await service.reorder(['C'])).map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
  });

  it('rejects an unknown symbol and changes nothing', async () => {
    const { service, order } = setup([['u1', 'A', 0], ['u1', 'B', 1]]);
    await expect(service.reorder(['B', 'X'])).rejects.toThrow(BadRequestException);
    expect(order()).toEqual(['A', 'B']);
  });
});
